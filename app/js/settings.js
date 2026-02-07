// FieldVoice Pro - Settings Page Logic
// Inspector profile management and PWA refresh functionality

// ============ STATE ============
// Store the current profile ID for updates
let currentProfileId = null;
// Track if form has unsaved changes (dirty flag)
let isDirty = false;
// Store original values to compare for dirty detection
let originalValues = {};

// Storage key for scratch pad (localStorage)
const SETTINGS_SCRATCH_KEY = 'fvp_settings_scratch';

// ============ PROFILE MANAGEMENT ============
async function loadSettings() {
    // 1. First check for unsaved scratch data in localStorage
    const scratch = getScratchData();

    if (scratch && scratch.hasUnsavedChanges) {
        // Restore from scratch pad (user was typing but didn't save)
        currentProfileId = scratch.id || null;
        document.getElementById('inspectorName').value = scratch.fullName || '';
        document.getElementById('title').value = scratch.title || '';
        document.getElementById('company').value = scratch.company || '';
        document.getElementById('email').value = scratch.email || '';
        document.getElementById('phone').value = scratch.phone || '';

        // Mark as dirty since we have unsaved changes
        setDirty(true);
        console.log('[SETTINGS] Restored unsaved changes from scratch pad');
    } else {
        // 2. Load from IndexedDB via data-layer (IndexedDB-first, Supabase-fallback)
        const profile = await window.dataLayer.loadUserSettings();

        if (profile) {
            currentProfileId = profile.id || null;
            // Populate form fields
            document.getElementById('inspectorName').value = profile.fullName || '';
            document.getElementById('title').value = profile.title || '';
            document.getElementById('company').value = profile.company || '';
            document.getElementById('email').value = profile.email || '';
            document.getElementById('phone').value = profile.phone || '';
        }

        // Not dirty - data matches saved state
        setDirty(false);
    }

    // Store original values for dirty detection
    storeOriginalValues();
    updateSignaturePreview();
}

/**
 * Get scratch data from localStorage
 */
function getScratchData() {
    try {
        const data = localStorage.getItem(SETTINGS_SCRATCH_KEY);
        return data ? JSON.parse(data) : null;
    } catch (e) {
        console.warn('[SETTINGS] Failed to parse scratch data:', e);
        return null;
    }
}

/**
 * Save current form state to scratch pad (localStorage)
 */
function saveScratchData() {
    const scratch = {
        id: currentProfileId,
        fullName: document.getElementById('inspectorName').value.trim(),
        title: document.getElementById('title').value.trim(),
        company: document.getElementById('company').value.trim(),
        email: document.getElementById('email').value.trim(),
        phone: document.getElementById('phone').value.trim(),
        hasUnsavedChanges: isDirty,
        updatedAt: new Date().toISOString()
    };

    try {
        localStorage.setItem(SETTINGS_SCRATCH_KEY, JSON.stringify(scratch));
    } catch (e) {
        console.warn('[SETTINGS] Failed to save scratch data:', e);
    }
}

/**
 * Clear scratch data after successful save
 */
function clearScratchData() {
    localStorage.removeItem(SETTINGS_SCRATCH_KEY);
}

/**
 * Store original values for dirty detection
 */
function storeOriginalValues() {
    originalValues = {
        fullName: document.getElementById('inspectorName').value.trim(),
        title: document.getElementById('title').value.trim(),
        company: document.getElementById('company').value.trim(),
        email: document.getElementById('email').value.trim(),
        phone: document.getElementById('phone').value.trim()
    };
}

/**
 * Check if current values differ from original
 */
function checkIfDirty() {
    const current = {
        fullName: document.getElementById('inspectorName').value.trim(),
        title: document.getElementById('title').value.trim(),
        company: document.getElementById('company').value.trim(),
        email: document.getElementById('email').value.trim(),
        phone: document.getElementById('phone').value.trim()
    };

    const dirty = Object.keys(originalValues).some(key =>
        current[key] !== originalValues[key]
    );

    setDirty(dirty);
    return dirty;
}

/**
 * Set dirty flag and update UI
 */
function setDirty(dirty) {
    isDirty = dirty;
    updateDirtyIndicator();
}

/**
 * Update UI to show dirty state
 */
function updateDirtyIndicator() {
    const saveBtn = document.getElementById('saveBtn');
    const dirtyBadge = document.getElementById('dirtyBadge');

    if (isDirty) {
        if (saveBtn) {
            saveBtn.classList.add('ring-2', 'ring-dot-orange', 'ring-offset-2');
        }
        if (dirtyBadge) {
            dirtyBadge.classList.remove('hidden');
        }
    } else {
        if (saveBtn) {
            saveBtn.classList.remove('ring-2', 'ring-dot-orange', 'ring-offset-2');
        }
        if (dirtyBadge) {
            dirtyBadge.classList.add('hidden');
        }
    }
}

async function saveSettings() {
    // Step 1: Get device_id (generates if not exists)
    const deviceId = getDeviceId();

    // Step 2: Get user_id (only if we have one for THIS device)
    let userId = getStorageItem(STORAGE_KEYS.USER_ID);

    // Step 3: Build profile object with all fields
    const profile = {
        // Only include id if we have one for THIS device
        ...(userId && { id: userId }),
        deviceId: deviceId,
        fullName: document.getElementById('inspectorName').value.trim(),
        title: document.getElementById('title').value.trim(),
        company: document.getElementById('company').value.trim(),
        email: document.getElementById('email').value.trim() || '',
        phone: document.getElementById('phone').value.trim() || '',
        updatedAt: new Date().toISOString()
    };

    // Step 4: Save to IndexedDB first (local-first, source of truth)
    const savedToIDB = await window.dataLayer.saveUserSettings(profile);
    if (!savedToIDB) {
        showToast('Failed to save locally', 'error');
        return;
    }

    // Step 5: Only store user_id if we have one
    if (userId) {
        setStorageItem(STORAGE_KEYS.USER_ID, userId);
        currentProfileId = userId;
    }

    updateSignaturePreview();

    // Step 6: Try to upsert to Supabase (cloud backup)
    try {
        const supabaseData = toSupabaseUserProfile(profile);

        const result = await supabaseClient
            .from('user_profiles')
            .upsert(supabaseData, { onConflict: 'device_id' })
            .select()
            .single();

        if (result.error) {
            console.error('[saveSettings] Supabase error:', result.error);
            showToast('Saved locally. Sync to cloud when online.', 'warning');

            // Still clear scratch and mark clean - local save succeeded
            clearScratchData();
            storeOriginalValues();
            setDirty(false);
            return;
        }

        // Step 7: Store the Supabase-returned id (important for new devices)
        if (result.data && result.data.id) {
            const returnedId = result.data.id;
            setStorageItem(STORAGE_KEYS.USER_ID, returnedId);
            currentProfileId = returnedId;

            // Update IndexedDB with the id from Supabase
            profile.id = returnedId;
            await window.dataLayer.saveUserSettings(profile);
        }

        // Step 8: Success - clear scratch and mark clean
        clearScratchData();
        storeOriginalValues();
        setDirty(false);

        console.log('[saveSettings] Profile saved to IndexedDB + Supabase');
        showToast('Profile saved');
    } catch (e) {
        console.error('[saveSettings] Exception:', e);
        showToast('Saved locally. Sync to cloud when online.', 'warning');

        // Still clear scratch and mark clean - local save succeeded
        clearScratchData();
        storeOriginalValues();
        setDirty(false);
    }
}

/**
 * Refresh profile from Supabase (pull latest cloud data)
 * Overwrites scratch pad but requires Save to commit to IndexedDB
 */
async function refreshFromCloud() {
    if (!navigator.onLine) {
        showToast('You are offline. Cannot refresh from cloud.', 'warning');
        return;
    }

    const deviceId = getDeviceId();
    if (!deviceId) {
        showToast('No device ID set', 'error');
        return;
    }

    try {
        showToast('Refreshing from cloud...', 'info');

        const { data, error } = await supabaseClient
            .from('user_profiles')
            .select('*')
            .eq('device_id', deviceId)
            .maybeSingle();

        if (error) {
            console.error('[refreshFromCloud] Supabase error:', error);
            showToast('Failed to refresh from cloud', 'error');
            return;
        }

        if (!data) {
            showToast('No profile found in cloud for this device', 'warning');
            return;
        }

        // Populate form with cloud data
        currentProfileId = data.id || null;
        document.getElementById('inspectorName').value = data.full_name || '';
        document.getElementById('title').value = data.title || '';
        document.getElementById('company').value = data.company || '';
        document.getElementById('email').value = data.email || '';
        document.getElementById('phone').value = data.phone || '';

        // Store user_id
        if (data.id) {
            setStorageItem(STORAGE_KEYS.USER_ID, data.id);
        }

        // Mark as dirty - user needs to Save to commit to IndexedDB
        setDirty(true);
        saveScratchData();
        updateSignaturePreview();

        showToast('Refreshed from cloud. Press Save to keep changes.', 'success');
    } catch (e) {
        console.error('[refreshFromCloud] Exception:', e);
        showToast('Failed to refresh from cloud', 'error');
    }
}

function updateSignaturePreview() {
    const name = document.getElementById('inspectorName').value.trim();
    const title = document.getElementById('title').value.trim();
    const company = document.getElementById('company').value.trim();

    let signature = '--';
    if (name) {
        signature = name;
        if (title) {
            signature += `, ${title}`;
        }
        if (company) {
            signature += ` (${company})`;
        }
    }

    document.getElementById('signaturePreview').textContent = signature;
}

// Note: This function is kept for compatibility but now fetches from Supabase
async function getFormattedSignature() {
    try {
        const deviceId = getDeviceId();
        const { data, error } = await supabaseClient
            .from('user_profiles')
            .select('full_name, title, company')
            .eq('device_id', deviceId)
            .maybeSingle();

        if (error || !data) return '';

        let signature = data.full_name || '';
        if (data.title) {
            signature += `, ${data.title}`;
        }
        if (data.company) {
            signature += ` (${data.company})`;
        }
        return signature;
    } catch (e) {
        console.error('Failed to get signature:', e);
        return '';
    }
}

// ============ PWA REFRESH FUNCTIONS ============
function refreshApp() {
    console.log('[PWA Refresh] Opening refresh confirmation modal');
    const modal = document.getElementById('refresh-modal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
}

function hideRefreshModal() {
    console.log('[PWA Refresh] Closing refresh modal');
    const modal = document.getElementById('refresh-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

async function executeRefresh() {
    console.log('[PWA Refresh] Starting app refresh...');

    // Hide modal first
    hideRefreshModal();

    // Show toast notification
    showToast('Refreshing app...', 'warning');

    try {
        // IMPORTANT: Delete caches BEFORE unregistering service workers (order matters!)
        if ('caches' in window) {
            console.log('[PWA Refresh] Deleting all caches...');
            const cacheNames = await caches.keys();
            await Promise.all(cacheNames.map(cacheName => {
                console.log('[PWA Refresh] Deleting cache:', cacheName);
                return caches.delete(cacheName);
            }));
            console.log('[PWA Refresh] All caches deleted:', cacheNames);
        }

        // Unregister all service workers AFTER caches are deleted
        if ('serviceWorker' in navigator) {
            console.log('[PWA Refresh] Unregistering service workers...');
            const registrations = await navigator.serviceWorker.getRegistrations();
            await Promise.all(registrations.map(registration => {
                console.log('[PWA Refresh] Unregistering SW:', registration.scope);
                return registration.unregister();
            }));
            console.log('[PWA Refresh] All service workers unregistered:', registrations.length);
        }

        console.log('[PWA Refresh] Reloading page...');
        // Note: localStorage is preserved - user data is safe
        // Use cache-busting redirect instead of reload() for iOS PWA compatibility
        window.location.href = window.location.pathname + '?refresh=' + Date.now();

    } catch (error) {
        console.error('[PWA Refresh] Error during refresh:', error);
        showToast('Error refreshing. Try removing and re-adding the app.', 'error');
    }
}

// ============ NUCLEAR RESET ============
async function resetAllData() {
    // Show confirmation dialog
    const confirmed = confirm(
        'This will delete ALL local data including your profile, projects, and drafts. This cannot be undone. Continue?'
    );

    if (!confirmed) {
        return;
    }

    console.log('[Nuclear Reset] Starting complete data reset...');

    // Update button to show resetting state
    const resetBtn = document.getElementById('reset-all-btn');
    if (resetBtn) {
        resetBtn.disabled = true;
        resetBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Resetting...';
    }

    try {
        // Step 1: Clear localStorage
        console.log('[Nuclear Reset] Clearing localStorage...');
        localStorage.clear();

        // Step 2: Clear sessionStorage
        console.log('[Nuclear Reset] Clearing sessionStorage...');
        sessionStorage.clear();

        // Step 3: Delete IndexedDB database
        console.log('[Nuclear Reset] Deleting IndexedDB database...');
        indexedDB.deleteDatabase('fieldvoice-pro');

        // Step 4: Delete all caches
        if ('caches' in window) {
            console.log('[Nuclear Reset] Deleting all caches...');
            const cacheNames = await caches.keys();
            await Promise.all(cacheNames.map(name => caches.delete(name)));
            console.log('[Nuclear Reset] Deleted caches:', cacheNames);
        }

        // Step 5: Unregister all service workers
        if ('serviceWorker' in navigator) {
            console.log('[Nuclear Reset] Unregistering service workers...');
            const registrations = await navigator.serviceWorker.getRegistrations();
            await Promise.all(registrations.map(reg => reg.unregister()));
            console.log('[Nuclear Reset] Unregistered service workers:', registrations.length);
        }

        console.log('[Nuclear Reset] All local data cleared. Redirecting to index...');

        // Hard reload to index.html
        window.location.href = '/index.html';

    } catch (error) {
        console.error('[Nuclear Reset] Error during reset:', error);
        // Even if some steps fail, try to redirect
        window.location.href = '/index.html';
    }
}

// ============ INIT ============
document.addEventListener('DOMContentLoaded', () => {
    // Get all form input fields
    const inputFields = [
        document.getElementById('inspectorName'),
        document.getElementById('title'),
        document.getElementById('company'),
        document.getElementById('email'),
        document.getElementById('phone')
    ];

    // Add listeners to all input fields
    inputFields.forEach(input => {
        if (!input) return;

        // Update preview and check dirty on input
        input.addEventListener('input', () => {
            updateSignaturePreview();
            checkIfDirty();

            // Save to scratch pad on every keystroke
            if (isDirty) {
                saveScratchData();
            }
        });
    });

    // Warn user before leaving with unsaved changes
    window.addEventListener('beforeunload', (e) => {
        if (isDirty) {
            e.preventDefault();
            e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
            return e.returnValue;
        }
    });

    // Load settings from IndexedDB (or scratch pad if unsaved changes exist)
    loadSettings();
});

// ============ EXPOSE TO WINDOW FOR ONCLICK HANDLERS ============
window.saveSettings = saveSettings;
window.refreshFromCloud = refreshFromCloud;
window.refreshApp = refreshApp;
window.hideRefreshModal = hideRefreshModal;
window.executeRefresh = executeRefresh;
window.resetAllData = resetAllData;
