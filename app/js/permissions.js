// FieldVoice Pro - Permissions Page Logic
// Device permission setup flow for microphone, camera, and location

// ============ STATE ============
const permissionResults = {
    mic: { status: 'pending', error: null },    // pending, granted, denied, skipped
    cam: { status: 'pending', error: null },
    loc: { status: 'pending', error: null }
};

let currentScreen = 'welcome';
let debugLogs = [];

// ============ DEVICE DETECTION ============
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
const isIOSSafari = isIOS && isSafari;
const isChrome = /Chrome/.test(navigator.userAgent);
const isFirefox = /Firefox/.test(navigator.userAgent);
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
const isAndroid = /Android/i.test(navigator.userAgent);
const isSecureContext = window.isSecureContext;
const hasMediaDevices = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

// ============ ERROR CODE MAPPING ============
const errorCodes = {
    'NotAllowedError': { code: 'ERR_001', message: 'Permission denied by user or system', fix: 'Tap the lock icon in address bar > Site Settings > Allow access' },
    'NotFoundError': { code: 'ERR_002', message: 'No device found', fix: 'Connect a device or check system settings' },
    'NotReadableError': { code: 'ERR_003', message: 'Device is in use by another app', fix: 'Close other apps using this device (Zoom, Teams, etc.)' },
    'OverconstrainedError': { code: 'ERR_004', message: 'Device constraints cannot be satisfied', fix: 'Try a different device or restart browser' },
    'AbortError': { code: 'ERR_005', message: 'Request was aborted', fix: 'Try again or restart browser' },
    'SecurityError': { code: 'ERR_006', message: 'Security policy blocked access', fix: 'Ensure you are on HTTPS' },
    'TypeError': { code: 'ERR_007', message: 'Invalid request or browser incompatible', fix: 'Update your browser to latest version' },
    'PERMISSION_DENIED': { code: 'GEO_001', message: 'Location permission denied', fix: 'Enable location in browser and device settings' },
    'POSITION_UNAVAILABLE': { code: 'GEO_002', message: 'Location unavailable', fix: 'Move to area with better GPS signal' },
    'TIMEOUT': { code: 'GEO_003', message: 'Location request timed out', fix: 'Try again in area with better signal' },
};

function getErrorInfo(error) {
    const name = error.name || error.error || error.message || String(error);
    const code = error.code;
    if (code === 1) return errorCodes['PERMISSION_DENIED'];
    if (code === 2) return errorCodes['POSITION_UNAVAILABLE'];
    if (code === 3) return errorCodes['TIMEOUT'];
    return errorCodes[name] || { code: 'ERR_UNK', message: name || 'Unknown error', fix: 'Try restarting browser or device' };
}

// ============ PERMISSIONS API (Check current state) ============
// Uses the Permissions API to check if permission was already decided
async function checkBrowserPermissionState(permissionName) {
    // Note: Permissions API support varies by browser
    // - Chrome: supports 'microphone', 'camera', 'geolocation'
    // - Safari: limited support (geolocation only on some versions)
    // - Firefox: supports most permissions
    if (!navigator.permissions || !navigator.permissions.query) {
        return 'unknown'; // API not supported
    }

    try {
        const result = await navigator.permissions.query({ name: permissionName });
        log(`Permissions API: ${permissionName} = ${result.state}`, 'info');
        return result.state; // 'granted', 'denied', or 'prompt'
    } catch (err) {
        // Permission name not supported by this browser
        log(`Permissions API: ${permissionName} not supported - ${err.message}`, 'warn');
        return 'unknown';
    }
}

// ============ RESET HELPERS ============
function toggleResetHelp() {
    const panel = document.getElementById('resetHelpPanel');
    const icon = document.getElementById('resetHelpToggle');
    panel.classList.toggle('hidden');
    icon.className = panel.classList.contains('hidden')
        ? 'fas fa-chevron-down text-amber-500 text-xs'
        : 'fas fa-chevron-up text-amber-500 text-xs';
}

function clearLocalPermissionState() {
    localStorage.removeItem(STORAGE_KEYS.MIC_GRANTED);
    localStorage.removeItem(STORAGE_KEYS.MIC_TIMESTAMP);
    localStorage.removeItem(STORAGE_KEYS.CAM_GRANTED);
    localStorage.removeItem(STORAGE_KEYS.LOC_GRANTED);
    localStorage.removeItem(STORAGE_KEYS.SPEECH_GRANTED);
    localStorage.removeItem(STORAGE_KEYS.ONBOARDED);

    // Reset in-memory state
    permissionResults.mic = { status: 'pending', error: null };
    permissionResults.cam = { status: 'pending', error: null };
    permissionResults.loc = { status: 'pending', error: null };
    permissionResults.speech = { status: 'pending', error: null };

    log('Cleared all saved permission states', 'success');
    alert('App permission states cleared!\n\nNote: This only clears the app\'s saved state. To see native iOS dialogs again, you must also reset browser permissions (see instructions above).');

    // Refresh the manual screen
    if (currentScreen === 'manual') {
        location.reload();
    }
}

// ============ DEBUG LOGGING ============
function log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const colors = { info: 'text-slate-300', success: 'text-green-400', error: 'text-red-400', warn: 'text-yellow-400' };
    const icons = { info: 'i', success: '+', error: 'x', warn: '!' };
    const logEntry = `[${timestamp}] [${icons[type]}] ${message}`;
    debugLogs.push(logEntry);
    const logEl = document.getElementById('debugLog');
    if (logEl) {
        const p = document.createElement('p');
        p.className = colors[type];
        p.textContent = logEntry;
        logEl.appendChild(p);
        logEl.scrollTop = logEl.scrollHeight;
    }
    console.log(`[Permissions] ${message}`);
}

function toggleDebug() {
    const console = document.getElementById('debugConsole');
    const icon = document.getElementById('debugToggleIcon');
    console.classList.toggle('hidden');
    icon.className = console.classList.contains('hidden') ? 'fas fa-chevron-down text-slate-500 text-xs' : 'fas fa-chevron-up text-slate-500 text-xs';
}

function copyDebugLog() {
    navigator.clipboard.writeText(debugLogs.join('\n')).then(() => log('Debug log copied', 'success')).catch(err => log('Copy failed: ' + err.message, 'error'));
}

function clearDebugLog() {
    debugLogs = [];
    const logEl = document.getElementById('debugLog');
    if (logEl) logEl.innerHTML = '<p class="text-slate-500">// Debug log cleared</p>';
}

// ============ SCREEN NAVIGATION ============
function showScreen(screenId) {
    const screens = document.querySelectorAll('.flow-screen');
    screens.forEach(screen => {
        if (screen.id === `screen-${currentScreen}`) {
            screen.classList.add('exit-left');
            screen.classList.remove('active');
        }
    });

    setTimeout(() => {
        screens.forEach(screen => {
            screen.classList.remove('exit-left', 'active');
            if (screen.id === `screen-${screenId}`) {
                screen.classList.add('active');
            }
        });
        currentScreen = screenId;

        // Update steppers when showing permission screens
        if (['mic', 'cam', 'loc', 'speech'].includes(screenId)) {
            updateStepper(screenId);
        }
    }, 50);
}

// ============ STEPPER UI ============
function updateStepper(currentStep) {
    const steps = ['mic', 'cam', 'loc', 'speech'];
    const stepNames = ['Mic', 'Cam', 'GPS', 'Voice'];
    const currentIndex = steps.indexOf(currentStep);

    steps.forEach(step => {
        const stepperEl = document.getElementById(`stepper-${step}`);
        if (!stepperEl) return;

        let html = '';
        steps.forEach((s, i) => {
            const result = permissionResults[s];
            let indicatorClass = 'pending';
            let icon = i + 1;

            if (i < currentIndex) {
                if (result.status === 'granted') {
                    indicatorClass = 'completed';
                    icon = '<i class="fas fa-check text-xs"></i>';
                } else if (result.status === 'denied') {
                    indicatorClass = 'failed';
                    icon = '<i class="fas fa-times text-xs"></i>';
                } else if (result.status === 'skipped') {
                    indicatorClass = 'skipped';
                    icon = '<i class="fas fa-forward text-xs"></i>';
                }
            } else if (i === currentIndex) {
                indicatorClass = 'active';
            }

            html += `<div class="step-indicator ${indicatorClass}">${icon}</div>`;

            if (i < steps.length - 1) {
                const lineClass = i < currentIndex ? 'completed' : '';
                html += `<div class="step-line ${lineClass}"></div>`;
            }
        });

        stepperEl.innerHTML = html;
    });
}

// ============ SEQUENTIAL FLOW ============
function startPermissionFlow() {
    log('Starting sequential permission flow', 'info');

    // Show iOS warning on speech pre-screen if on iOS
    if (isIOS) {
        const iosWarning = document.getElementById('ios-speech-warning');
        if (iosWarning) {
            iosWarning.classList.remove('hidden');
        }
    }

    showScreen('mic');
}

function skipToManual() {
    log('Skipping to manual setup', 'info');
    showScreen('manual');
    initManualScreen();
}

function skipPermission(type) {
    log(`Skipping ${type} permission`, 'warn');
    permissionResults[type].status = 'skipped';
    proceedToNext(type);
}

function proceedToNext(current) {
    const sequence = ['mic', 'cam', 'loc', 'summary'];
    const currentIndex = sequence.indexOf(current);
    const nextScreen = sequence[currentIndex + 1];

    setTimeout(() => {
        showScreen(nextScreen);
        if (nextScreen === 'summary') {
            renderSummary();
        }
    }, current === 'summary' ? 0 : 1500);
}

// ============ MICROPHONE PERMISSION ============
async function requestMicPermission() {
    const preEl = document.getElementById('mic-pre');
    const loadingEl = document.getElementById('mic-loading');
    const successEl = document.getElementById('mic-success');
    const errorEl = document.getElementById('mic-error');

    preEl.classList.add('hidden');
    loadingEl.classList.remove('hidden');

    // Check current permission state and update loading UI
    const currentState = await checkBrowserPermissionState('microphone');
    log(`Microphone current state: ${currentState}`);

    const loadingTitle = document.getElementById('mic-loading-title');
    const loadingSubtitle = document.getElementById('mic-loading-subtitle');

    if (currentState === 'granted') {
        log('Microphone already granted - no dialog will appear', 'info');
        loadingTitle.textContent = 'Verifying microphone access...';
        loadingSubtitle.textContent = 'Previously granted - checking...';
    } else if (currentState === 'denied') {
        log('Microphone already denied - no dialog will appear', 'warn');
        loadingTitle.textContent = 'Checking microphone access...';
        loadingSubtitle.textContent = 'Previously denied - attempting request...';
    } else {
        log('Requesting microphone permission - native dialog should appear...', 'info');
        loadingTitle.textContent = 'Waiting for permission...';
        loadingSubtitle.textContent = 'Tap "Allow" in the browser dialog';
    }

    if (!hasMediaDevices) {
        showMicError('ERR_API', 'MediaDevices API not supported', 'Use a modern browser (Chrome, Safari, Firefox)');
        return;
    }

    if (!isSecureContext) {
        showMicError('ERR_SEC', 'HTTPS required', 'Access this page via HTTPS');
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const tracks = stream.getAudioTracks();
        if (tracks.length > 0) {
            log(`Microphone: ${tracks[0].label}`, 'success');
        }
        stream.getTracks().forEach(track => track.stop());

        permissionResults.mic.status = 'granted';
        localStorage.setItem(STORAGE_KEYS.MIC_GRANTED, 'true');
        localStorage.setItem(STORAGE_KEYS.MIC_TIMESTAMP, Date.now().toString());

        loadingEl.classList.add('hidden');
        successEl.classList.remove('hidden');
        log('Microphone permission granted!', 'success');

        proceedToNext('mic');
    } catch (err) {
        log(`Microphone error: ${err.name} - ${err.message}`, 'error');
        const errInfo = getErrorInfo(err);
        permissionResults.mic.status = 'denied';
        permissionResults.mic.error = errInfo;
        showMicError(errInfo.code, errInfo.message, errInfo.fix);
    }
}

function showMicError(code, message, fix) {
    document.getElementById('mic-loading').classList.add('hidden');
    document.getElementById('mic-error').classList.remove('hidden');
    document.getElementById('mic-error-message').textContent = message;
    document.getElementById('mic-error-fix').textContent = fix;
}

// ============ CAMERA PERMISSION ============
async function requestCamPermission() {
    const preEl = document.getElementById('cam-pre');
    const loadingEl = document.getElementById('cam-loading');
    const successEl = document.getElementById('cam-success');

    preEl.classList.add('hidden');
    loadingEl.classList.remove('hidden');

    // Check current permission state and update loading UI
    const currentState = await checkBrowserPermissionState('camera');
    log(`Camera current state: ${currentState}`);

    const loadingTitle = document.getElementById('cam-loading-title');
    const loadingSubtitle = document.getElementById('cam-loading-subtitle');

    if (currentState === 'granted') {
        log('Camera already granted - no dialog will appear', 'info');
        loadingTitle.textContent = 'Verifying camera access...';
        loadingSubtitle.textContent = 'Previously granted - checking...';
    } else if (currentState === 'denied') {
        log('Camera already denied - no dialog will appear', 'warn');
        loadingTitle.textContent = 'Checking camera access...';
        loadingSubtitle.textContent = 'Previously denied - attempting request...';
    } else {
        log('Requesting camera permission - native dialog should appear...', 'info');
        loadingTitle.textContent = 'Waiting for permission...';
        loadingSubtitle.textContent = 'Tap "Allow" in the browser dialog';
    }

    if (!hasMediaDevices) {
        showCamError('ERR_API', 'Camera API not supported', 'Use a modern browser');
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        const tracks = stream.getVideoTracks();
        if (tracks.length > 0) {
            log(`Camera: ${tracks[0].label}`, 'success');
        }
        stream.getTracks().forEach(track => track.stop());

        permissionResults.cam.status = 'granted';
        localStorage.setItem(STORAGE_KEYS.CAM_GRANTED, 'true');

        loadingEl.classList.add('hidden');
        successEl.classList.remove('hidden');
        log('Camera permission granted!', 'success');

        proceedToNext('cam');
    } catch (err) {
        log(`Camera error: ${err.name} - ${err.message}`, 'error');
        const errInfo = getErrorInfo(err);
        permissionResults.cam.status = 'denied';
        permissionResults.cam.error = errInfo;
        showCamError(errInfo.code, errInfo.message, errInfo.fix);
    }
}

function showCamError(code, message, fix) {
    document.getElementById('cam-loading').classList.add('hidden');
    document.getElementById('cam-error').classList.remove('hidden');
    document.getElementById('cam-error-message').textContent = message;
    document.getElementById('cam-error-fix').textContent = fix;
}

// ============ LOCATION PERMISSION ============
async function requestLocPermission() {
    const preEl = document.getElementById('loc-pre');
    const loadingEl = document.getElementById('loc-loading');
    const successEl = document.getElementById('loc-success');

    preEl.classList.add('hidden');
    loadingEl.classList.remove('hidden');

    // Check current permission state and update loading UI
    const currentState = await checkBrowserPermissionState('geolocation');
    log(`Location current state: ${currentState}`);

    const loadingTitle = document.getElementById('loc-loading-title');
    const loadingSubtitle = document.getElementById('loc-loading-subtitle');

    if (currentState === 'granted') {
        log('Location already granted - no dialog will appear', 'info');
        loadingTitle.textContent = 'Getting your location...';
        loadingSubtitle.textContent = 'Previously granted - fetching GPS...';
    } else if (currentState === 'denied') {
        log('Location already denied - no dialog will appear', 'warn');
        loadingTitle.textContent = 'Checking location access...';
        loadingSubtitle.textContent = 'Previously denied - attempting request...';
    } else {
        log('Requesting location permission - native dialog should appear...', 'info');
        loadingTitle.textContent = 'Waiting for permission...';
        loadingSubtitle.textContent = 'Tap "Allow" in the browser dialog';
    }

    if (!navigator.geolocation) {
        showLocError('GEO_API', 'Geolocation not supported', 'Use a modern browser');
        return;
    }

    try {
        const position = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: true,
                timeout: 15000,
                maximumAge: 0
            });
        });

        log(`Location: ${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}`, 'success');
        log(`Accuracy: ${position.coords.accuracy.toFixed(0)}m`, 'info');

        permissionResults.loc.status = 'granted';
        localStorage.setItem(STORAGE_KEYS.LOC_GRANTED, 'true');

        loadingEl.classList.add('hidden');
        successEl.classList.remove('hidden');
        document.getElementById('loc-success-coords').textContent = `Location: ${position.coords.latitude.toFixed(4)}, ${position.coords.longitude.toFixed(4)}`;
        log('Location permission granted!', 'success');

        proceedToNext('loc');
    } catch (err) {
        log(`Location error: code=${err.code}, message=${err.message}`, 'error');
        const errInfo = getErrorInfo(err);
        permissionResults.loc.status = 'denied';
        permissionResults.loc.error = errInfo;
        showLocError(errInfo.code, errInfo.message, errInfo.fix);
    }
}

function showLocError(code, message, fix) {
    document.getElementById('loc-loading').classList.add('hidden');
    document.getElementById('loc-error').classList.remove('hidden');
    document.getElementById('loc-error-message').textContent = message;
    document.getElementById('loc-error-fix').textContent = fix;
}

// ============ SUMMARY SCREEN ============
function renderSummary() {
    const types = ['mic', 'cam', 'loc'];
    const icons = {
        mic: 'fa-microphone',
        cam: 'fa-camera',
        loc: 'fa-location-dot'
    };
    const colors = {
        mic: 'bg-dot-navy',
        cam: 'bg-dot-orange',
        loc: 'bg-safety-green'
    };

    let grantedCount = 0;
    let deniedCount = 0;
    let skippedCount = 0;

    types.forEach(type => {
        const result = permissionResults[type];
        const card = document.getElementById(`result-${type}`);
        const iconEl = document.getElementById(`result-${type}-icon`);
        const statusEl = document.getElementById(`result-${type}-status`);
        const badgeEl = document.getElementById(`result-${type}-badge`);

        if (result.status === 'granted') {
            grantedCount++;
            card.classList.add('success');
            iconEl.className = `w-12 h-12 bg-safety-green flex items-center justify-center rounded-full flex-shrink-0`;
            iconEl.innerHTML = `<i class="fas fa-check text-white text-lg"></i>`;
            statusEl.textContent = 'Enabled';
            statusEl.className = 'text-xs text-safety-green font-medium';
            badgeEl.className = 'fas fa-check-circle text-safety-green';
        } else if (result.status === 'denied') {
            deniedCount++;
            card.classList.add('failed');
            iconEl.className = `w-12 h-12 bg-red-500 flex items-center justify-center rounded-full flex-shrink-0`;
            iconEl.innerHTML = `<i class="fas fa-times text-white text-lg"></i>`;
            statusEl.textContent = result.error ? result.error.message : 'Permission denied';
            statusEl.className = 'text-xs text-red-500';
            badgeEl.className = 'fas fa-times-circle text-red-500';
        } else if (result.status === 'skipped') {
            skippedCount++;
            card.classList.add('skipped');
            iconEl.className = `w-12 h-12 bg-slate-400 flex items-center justify-center rounded-full flex-shrink-0`;
            iconEl.innerHTML = `<i class="fas ${icons[type]} text-white text-lg"></i>`;
            statusEl.textContent = 'Skipped';
            statusEl.className = 'text-xs text-slate-500';
            badgeEl.className = 'fas fa-minus-circle text-slate-400';
        }
    });

    // Update header
    const title = document.getElementById('summary-title');
    const subtitle = document.getElementById('summary-subtitle');
    const headerIcon = document.getElementById('summary-header-icon');
    const messageText = document.getElementById('summary-message-text');

    if (grantedCount === 3) {
        title.textContent = 'All Systems Ready!';
        subtitle.textContent = 'Full functionality enabled';
        headerIcon.className = 'fas fa-check text-dot-navy text-2xl';
        messageText.textContent = 'You have access to all FieldVoice Pro features. Use your keyboard\'s microphone button to dictate notes!';
    } else if (grantedCount >= 2) {
        title.textContent = 'Partial Setup Complete';
        subtitle.textContent = `${grantedCount} of 3 permissions enabled`;
        headerIcon.className = 'fas fa-exclamation text-dot-navy text-2xl';
        messageText.textContent = `Some features may be limited. You can enable additional permissions later from your browser settings.`;
    } else {
        title.textContent = 'Limited Functionality';
        subtitle.textContent = `Only ${grantedCount} permission${grantedCount !== 1 ? 's' : ''} enabled`;
        headerIcon.className = 'fas fa-exclamation-triangle text-dot-navy text-2xl';
        messageText.textContent = 'Many features will be unavailable. Consider enabling more permissions for the best experience.';
    }

    // Show retry button if any failed
    if (deniedCount > 0) {
        document.getElementById('retry-failed-btn').classList.remove('hidden');
    }
}

function retryFailed() {
    // Find first failed permission and restart from there
    const sequence = ['mic', 'cam', 'loc'];
    for (const type of sequence) {
        if (permissionResults[type].status === 'denied') {
            // Reset the states
            document.getElementById(`${type}-pre`).classList.remove('hidden');
            document.getElementById(`${type}-loading`).classList.add('hidden');
            document.getElementById(`${type}-success`).classList.add('hidden');
            document.getElementById(`${type}-error`).classList.add('hidden');

            permissionResults[type].status = 'pending';
            permissionResults[type].error = null;

            showScreen(type);
            return;
        }
    }
}

// ============ MANUAL MODE HANDLERS ============
function initManualScreen() {
    // Set device info
    const deviceText = [];
    if (isIOS) deviceText.push('iOS');
    if (isAndroid) deviceText.push('Android');
    if (isSafari) deviceText.push('Safari');
    if (isChrome) deviceText.push('Chrome');
    if (isFirefox) deviceText.push('Firefox');
    if (isMobile) deviceText.push('Mobile');
    if (!isMobile) deviceText.push('Desktop');

    const deviceStr = deviceText.join(' + ') + ` | Secure: ${isSecureContext ? 'Yes' : 'No'}`;
    document.getElementById('deviceInfoText').textContent = deviceStr;

    log('=== Manual Setup Mode ===', 'info');
    log(`Device: ${deviceStr}`, 'info');

    // Check existing permissions
    checkExistingPermissions();
}

function checkExistingPermissions() {
    if (localStorage.getItem(STORAGE_KEYS.MIC_GRANTED) === 'true') {
        permissionResults.mic.status = 'granted';
        updateManualCard('mic', 'granted');
    }
    if (localStorage.getItem(STORAGE_KEYS.CAM_GRANTED) === 'true') {
        permissionResults.cam.status = 'granted';
        updateManualCard('cam', 'granted');
    }
    if (localStorage.getItem(STORAGE_KEYS.LOC_GRANTED) === 'true') {
        permissionResults.loc.status = 'granted';
        updateManualCard('loc', 'granted');
    }
    updateManualSummary();
}

function updateManualCard(type, status) {
    const card = document.getElementById(`manual-${type}-card`);
    const icon = document.getElementById(`manual-${type}-icon`);
    const statusEl = document.getElementById(`manual-${type}-status`);
    const btn = document.getElementById(`manual-${type}-btn`);

    if (status === 'granted') {
        card.classList.add('border-safety-green', 'bg-green-50');
        card.classList.remove('border-slate-200');
        icon.className = 'fas fa-check text-safety-green text-lg';
        statusEl.textContent = 'Enabled';
        statusEl.className = 'text-xs text-safety-green font-medium';
        btn.innerHTML = '<i class="fas fa-check"></i>';
        btn.className = 'px-4 py-2 bg-safety-green text-white font-bold text-xs uppercase cursor-default rounded';
        btn.disabled = true;
    } else if (status === 'denied') {
        card.classList.add('border-red-500', 'bg-red-50');
        card.classList.remove('border-slate-200');
        icon.className = 'fas fa-times text-red-500 text-lg';
        statusEl.textContent = 'Permission denied';
        statusEl.className = 'text-xs text-red-500';
        btn.textContent = 'Retry';
        btn.className = 'px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold text-xs uppercase transition-colors rounded';
        btn.disabled = false;
    }
}

function updateManualSummary() {
    const icon = document.getElementById('manual-summary-icon');
    const title = document.getElementById('manual-summary-title');
    const text = document.getElementById('manual-summary-text');

    const enabledCount = ['mic', 'cam', 'loc'].filter(type => permissionResults[type].status === 'granted').length;

    if (enabledCount === 3) {
        icon.className = 'w-10 h-10 bg-safety-green flex items-center justify-center rounded';
        icon.innerHTML = '<i class="fas fa-check text-white"></i>';
        title.textContent = 'All Systems Ready';
        title.className = 'font-bold text-safety-green text-sm uppercase';
        text.textContent = 'Full functionality enabled';
        text.className = 'text-xs text-safety-green';
    } else if (enabledCount >= 2) {
        icon.className = 'w-10 h-10 bg-dot-orange flex items-center justify-center rounded';
        icon.innerHTML = '<i class="fas fa-exclamation text-white"></i>';
        title.textContent = `${enabledCount}/3 Permissions`;
        title.className = 'font-bold text-dot-orange text-sm uppercase';
        text.textContent = 'Some features may be limited';
        text.className = 'text-xs text-dot-orange';
    } else {
        icon.className = 'w-10 h-10 bg-slate-200 flex items-center justify-center rounded';
        icon.innerHTML = '<i class="fas fa-clock text-slate-400"></i>';
        title.textContent = 'Setup Required';
        title.className = 'font-bold text-slate-800 text-sm uppercase';
        text.textContent = 'Enable permissions above';
        text.className = 'text-xs text-slate-500';
    }
}

async function manualRequestMic() {
    const btn = document.getElementById('manual-mic-btn');
    const status = document.getElementById('manual-mic-status');

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    btn.disabled = true;
    status.textContent = 'Requesting...';
    log('Manual: Requesting microphone...', 'info');

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());

        permissionResults.mic.status = 'granted';
        localStorage.setItem(STORAGE_KEYS.MIC_GRANTED, 'true');
        updateManualCard('mic', 'granted');
        log('Manual: Microphone granted', 'success');
    } catch (err) {
        log(`Manual: Microphone error - ${err.message}`, 'error');
        permissionResults.mic.status = 'denied';
        updateManualCard('mic', 'denied');
    }
    updateManualSummary();
}

async function manualRequestCam() {
    const btn = document.getElementById('manual-cam-btn');
    const status = document.getElementById('manual-cam-status');

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    btn.disabled = true;
    status.textContent = 'Requesting...';
    log('Manual: Requesting camera...', 'info');

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        stream.getTracks().forEach(track => track.stop());

        permissionResults.cam.status = 'granted';
        localStorage.setItem(STORAGE_KEYS.CAM_GRANTED, 'true');
        updateManualCard('cam', 'granted');
        log('Manual: Camera granted', 'success');
    } catch (err) {
        log(`Manual: Camera error - ${err.message}`, 'error');
        permissionResults.cam.status = 'denied';
        updateManualCard('cam', 'denied');
    }
    updateManualSummary();
}

async function manualRequestLoc() {
    const btn = document.getElementById('manual-loc-btn');
    const status = document.getElementById('manual-loc-status');

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    btn.disabled = true;
    status.textContent = 'Getting location...';
    log('Manual: Requesting location...', 'info');

    try {
        await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: true,
                timeout: 15000,
                maximumAge: 0
            });
        });

        permissionResults.loc.status = 'granted';
        localStorage.setItem(STORAGE_KEYS.LOC_GRANTED, 'true');
        updateManualCard('loc', 'granted');
        log('Manual: Location granted', 'success');
    } catch (err) {
        log(`Manual: Location error - ${err.message}`, 'error');
        permissionResults.loc.status = 'denied';
        updateManualCard('loc', 'denied');
    }
    updateManualSummary();
}

// ============ FINISH SETUP ============
function finishSetup() {
    localStorage.setItem(STORAGE_KEYS.ONBOARDED, 'true');
    log('Setup complete - redirecting to dashboard', 'success');
    window.location.href = 'index.html';
}

// ============ INIT ============
function init() {
    log('=== FieldVoice Pro Permission Setup ===', 'info');
    log(`iOS: ${isIOS}, Safari: ${isSafari}, Secure: ${isSecureContext}`, 'info');
    log(`MediaDevices: ${hasMediaDevices}`, 'info');

    // Check if already onboarded
    if (localStorage.getItem(STORAGE_KEYS.ONBOARDED) === 'true') {
        // Check if all permissions still valid
        const allGranted =
            localStorage.getItem(STORAGE_KEYS.MIC_GRANTED) === 'true' &&
            localStorage.getItem(STORAGE_KEYS.CAM_GRANTED) === 'true' &&
            localStorage.getItem(STORAGE_KEYS.LOC_GRANTED) === 'true' &&
            localStorage.getItem(STORAGE_KEYS.SPEECH_GRANTED) === 'true';

        if (allGranted) {
            log('Already onboarded with all permissions - redirecting', 'info');
            // Optional: redirect to dashboard
            // window.location.href = 'index.html';
        }
    }
}

document.addEventListener('DOMContentLoaded', init);

// ============ EXPOSE TO WINDOW FOR ONCLICK HANDLERS ============
window.startPermissionFlow = startPermissionFlow;
window.skipToManual = skipToManual;
window.skipPermission = skipPermission;
window.requestMicPermission = requestMicPermission;
window.requestCamPermission = requestCamPermission;
window.requestLocPermission = requestLocPermission;
window.retryFailed = retryFailed;
window.finishSetup = finishSetup;
window.manualRequestMic = manualRequestMic;
window.manualRequestCam = manualRequestCam;
window.manualRequestLoc = manualRequestLoc;
window.toggleResetHelp = toggleResetHelp;
window.clearLocalPermissionState = clearLocalPermissionState;
window.toggleDebug = toggleDebug;
window.copyDebugLog = copyDebugLog;
window.clearDebugLog = clearDebugLog;
