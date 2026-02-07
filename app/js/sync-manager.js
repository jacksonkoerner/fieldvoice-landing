/**
 * sync-manager.js
 * Real-time entry backup and offline sync for FieldVoice Pro v6
 *
 * Dependencies: storage-keys.js, supabase-utils.js, config.js
 *
 * @module sync-manager
 */

// ============ AUTO-SYNC DISABLED ============
// Per spec: User controls when data goes to/from cloud via explicit buttons.
// No automatic Supabase sync. Set to true to re-enable auto-backup (not recommended).
const AUTO_SYNC_ENABLED = false;

// ============ CONSTANTS ============
const DEBOUNCE_MS = 2000;  // 2 second debounce for entry backup
const RETRY_DELAY_MS = 5000;  // 5 seconds between retry attempts
const MAX_RETRIES = 3;

// ============ STATE ============
let entryBackupTimers = {};  // reportId -> timeout
let isProcessingQueue = false;
let onlineListener = null;

// ============ ENTRY BACKUP ============

/**
 * Queue an entry for backup to Supabase (debounced)
 * Call this whenever an entry is created/updated
 * @param {string} reportId - The report ID
 * @param {Object} entry - The entry object from localStorage
 */
function queueEntryBackup(reportId, entry) {
    // AUTO-SYNC DISABLED: User controls sync via explicit buttons only
    if (!AUTO_SYNC_ENABLED) {
        console.log('[SYNC] Auto-backup disabled - skipping queue for:', reportId);
        return;
    }

    // Clear existing timer for this report
    if (entryBackupTimers[reportId]) {
        clearTimeout(entryBackupTimers[reportId]);
    }

    // Set new debounced timer
    entryBackupTimers[reportId] = setTimeout(() => {
        backupEntry(reportId, entry);
    }, DEBOUNCE_MS);
}

/**
 * Immediately backup an entry to Supabase
 * @param {string} reportId - The report ID
 * @param {Object} entry - The entry object
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function backupEntry(reportId, entry) {
    if (!navigator.onLine) {
        // Queue for later
        addToSyncQueue({
            type: 'ENTRY_BACKUP',
            reportId,
            entry,
            timestamp: new Date().toISOString()
        });
        console.log('[SYNC] Offline - entry queued for backup');
        return { success: false, error: 'offline' };
    }

    try {
        const supabaseEntry = toSupabaseEntry(entry, reportId);

        // Upsert based on local_id
        const { error } = await supabaseClient
            .from('report_entries')
            .upsert(supabaseEntry, {
                onConflict: 'report_id,local_id',
                ignoreDuplicates: false
            });

        if (error) {
            console.error('[SYNC] Entry backup failed:', error);
            addToSyncQueue({
                type: 'ENTRY_BACKUP',
                reportId,
                entry,
                timestamp: new Date().toISOString()
            });
            return { success: false, error: error.message };
        }

        console.log('[SYNC] Entry backed up:', entry.id);
        return { success: true };
    } catch (e) {
        console.error('[SYNC] Entry backup exception:', e);
        return { success: false, error: e.message };
    }
}

/**
 * Backup all entries for a report (batch operation)
 * @param {string} reportId - The report ID
 * @param {Array} entries - Array of entry objects
 * @returns {Promise<{success: boolean, backed: number, failed: number}>}
 */
async function backupAllEntries(reportId, entries) {
    if (!navigator.onLine) {
        entries.forEach(entry => {
            addToSyncQueue({
                type: 'ENTRY_BACKUP',
                reportId,
                entry,
                timestamp: new Date().toISOString()
            });
        });
        return { success: false, backed: 0, failed: entries.length };
    }

    try {
        const supabaseEntries = entries.map(e => toSupabaseEntry(e, reportId));

        const { error } = await supabaseClient
            .from('report_entries')
            .upsert(supabaseEntries, {
                onConflict: 'report_id,local_id',
                ignoreDuplicates: false
            });

        if (error) {
            console.error('[SYNC] Batch entry backup failed:', error);
            return { success: false, backed: 0, failed: entries.length };
        }

        console.log('[SYNC] Backed up', entries.length, 'entries');
        return { success: true, backed: entries.length, failed: 0 };
    } catch (e) {
        console.error('[SYNC] Batch backup exception:', e);
        return { success: false, backed: 0, failed: entries.length };
    }
}

/**
 * Mark an entry as deleted (soft delete in Supabase)
 * @param {string} reportId - The report ID
 * @param {string} localId - The entry's local_id
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function deleteEntry(reportId, localId) {
    if (!navigator.onLine) {
        addToSyncQueue({
            type: 'ENTRY_DELETE',
            reportId,
            localId,
            timestamp: new Date().toISOString()
        });
        return { success: false, error: 'offline' };
    }

    try {
        const { error } = await supabaseClient
            .from('report_entries')
            .update({ is_deleted: true })
            .eq('report_id', reportId)
            .eq('local_id', localId);

        if (error) {
            console.error('[SYNC] Entry delete failed:', error);
            return { success: false, error: error.message };
        }

        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// ============ REPORT SYNC ============

/**
 * Create or update a report in Supabase
 * @param {Object} report - The report object from localStorage
 * @param {string} projectId - The project ID
 * @returns {Promise<{success: boolean, reportId?: string, error?: string}>}
 */
async function syncReport(report, projectId) {
    if (!navigator.onLine) {
        addToSyncQueue({
            type: 'REPORT_SYNC',
            report,
            projectId,
            timestamp: new Date().toISOString()
        });
        return { success: false, error: 'offline' };
    }

    try {
        const userId = await getCurrentUserId();
        const deviceId = getDeviceId();
        const supabaseReport = toSupabaseReport(report, projectId, userId, deviceId);

        // Check if report exists
        const { data: existing } = await supabaseClient
            .from('reports')
            .select('id')
            .eq('project_id', projectId)
            .eq('report_date', report.date)
            .eq('user_id', userId)
            .single();

        let reportId;

        if (existing) {
            // Update existing
            const { error } = await supabaseClient
                .from('reports')
                .update(supabaseReport)
                .eq('id', existing.id);

            if (error) throw error;
            reportId = existing.id;
            console.log('[SYNC] Report updated:', reportId);
        } else {
            // Insert new
            const { data, error } = await supabaseClient
                .from('reports')
                .insert(supabaseReport)
                .select('id')
                .single();

            if (error) throw error;
            reportId = data.id;
            console.log('[SYNC] Report created:', reportId);
        }

        return { success: true, reportId };
    } catch (e) {
        console.error('[SYNC] Report sync failed:', e);
        addToSyncQueue({
            type: 'REPORT_SYNC',
            report,
            projectId,
            timestamp: new Date().toISOString()
        });
        return { success: false, error: e.message };
    }
}

/**
 * Sync raw capture data to Supabase
 * @param {Object} captureData - Raw capture object
 * @param {string} reportId - The Supabase report ID
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function syncRawCapture(captureData, reportId) {
    if (!navigator.onLine) {
        addToSyncQueue({
            type: 'RAW_CAPTURE_SYNC',
            captureData,
            reportId,
            timestamp: new Date().toISOString()
        });
        return { success: false, error: 'offline' };
    }

    try {
        const supabaseCapture = toSupabaseRawCapture(captureData, reportId);

        const { error } = await supabaseClient
            .from('report_raw_capture')
            .upsert(supabaseCapture, {
                onConflict: 'report_id',
                ignoreDuplicates: false
            });

        if (error) throw error;

        console.log('[SYNC] Raw capture synced for report:', reportId);
        return { success: true };
    } catch (e) {
        console.error('[SYNC] Raw capture sync failed:', e);
        return { success: false, error: e.message };
    }
}

// ============ OFFLINE QUEUE PROCESSING ============

/**
 * Process all pending operations in the sync queue
 * Call this when coming back online
 */
async function processOfflineQueue() {
    if (isProcessingQueue) {
        console.log('[SYNC] Already processing queue');
        return;
    }

    if (!navigator.onLine) {
        console.log('[SYNC] Still offline, skipping queue processing');
        return;
    }

    const queue = getSyncQueue();
    if (queue.length === 0) {
        console.log('[SYNC] Queue empty');
        return;
    }

    isProcessingQueue = true;
    console.log('[SYNC] Processing', queue.length, 'queued operations');

    const failedOps = [];

    for (const op of queue) {
        let result;

        switch (op.type) {
            case 'ENTRY_BACKUP':
                result = await backupEntry(op.reportId, op.entry);
                break;
            case 'ENTRY_DELETE':
                result = await deleteEntry(op.reportId, op.localId);
                break;
            case 'REPORT_SYNC':
                result = await syncReport(op.report, op.projectId);
                break;
            case 'RAW_CAPTURE_SYNC':
                result = await syncRawCapture(op.captureData, op.reportId);
                break;
            default:
                console.warn('[SYNC] Unknown operation type:', op.type);
                result = { success: true }; // Skip unknown ops
        }

        if (!result.success && result.error !== 'offline') {
            // Real failure, might retry
            op.retries = (op.retries || 0) + 1;
            if (op.retries < MAX_RETRIES) {
                failedOps.push(op);
            } else {
                console.error('[SYNC] Operation failed after max retries:', op);
            }
        }
    }

    // Clear queue and re-add failed ops
    clearSyncQueue();
    failedOps.forEach(op => addToSyncQueue(op));

    isProcessingQueue = false;
    console.log('[SYNC] Queue processing complete.', failedOps.length, 'operations remaining');
}

// ============ CONNECTIVITY MONITORING ============

/**
 * Initialize sync manager - call on page load
 * Sets up online/offline listeners
 */
function initSyncManager() {
    // AUTO-SYNC DISABLED: User controls sync via explicit buttons only
    if (!AUTO_SYNC_ENABLED) {
        console.log('[SYNC] Auto-sync disabled - sync manager not initialized');
        return;
    }

    // Process queue when coming online
    onlineListener = () => {
        console.log('[SYNC] Back online - processing queue');
        setTimeout(processOfflineQueue, 1000); // Small delay to let connection stabilize
    };

    window.addEventListener('online', onlineListener);

    // Process queue on init if online
    if (navigator.onLine) {
        processOfflineQueue();
    }

    console.log('[SYNC] Sync manager initialized');
}

/**
 * Cleanup sync manager - call on page unload if needed
 */
function destroySyncManager() {
    if (onlineListener) {
        window.removeEventListener('online', onlineListener);
        onlineListener = null;
    }

    // Clear any pending timers
    Object.values(entryBackupTimers).forEach(clearTimeout);
    entryBackupTimers = {};
}

// ============ HELPERS ============

/**
 * Get current user ID from Supabase auth or localStorage
 * @returns {Promise<string>}
 */
async function getCurrentUserId() {
    // Try Supabase auth first
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (user) return user.id;

    // Fall back to stored profile
    const profile = getStorageItem(STORAGE_KEYS.USER_PROFILE);
    if (profile && profile.id) return profile.id;

    // Last resort - device ID
    return getDeviceId();
}

/**
 * Get pending sync count for UI display
 * @returns {number}
 */
function getPendingSyncCount() {
    return getSyncQueue().length;
}

// ============ EXPOSE GLOBALLY ============
if (typeof window !== 'undefined') {
    window.queueEntryBackup = queueEntryBackup;
    window.backupEntry = backupEntry;
    window.backupAllEntries = backupAllEntries;
    window.deleteEntry = deleteEntry;
    window.syncReport = syncReport;
    window.syncRawCapture = syncRawCapture;
    window.processOfflineQueue = processOfflineQueue;
    window.initSyncManager = initSyncManager;
    window.destroySyncManager = destroySyncManager;
    window.getPendingSyncCount = getPendingSyncCount;
}
