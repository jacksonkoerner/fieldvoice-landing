// FieldVoice Pro - PWA Utilities
// Service worker registration, offline detection, and PWA navigation handling
// Single source of truth - do not duplicate in HTML files

/**
 * Initialize all PWA features
 * Call this once at the end of any page that needs PWA support
 *
 * @param {Object} options - Configuration options
 * @param {Function} options.onOnline - Optional callback when device comes online
 * @param {Function} options.onOffline - Optional callback when device goes offline
 * @param {boolean} options.skipServiceWorker - Set true to skip SW registration (e.g., for pages that don't need it)
 */
function initPWA(options = {}) {
    setupPWANavigation();

    if (!options.skipServiceWorker) {
        registerServiceWorker();
    }

    setupOfflineBanner(options.onOnline, options.onOffline);
}

/**
 * Handle internal navigation in standalone PWA mode
 * Prevents Safari from breaking out of standalone mode when clicking links
 */
function setupPWANavigation() {
    // Only apply fix when running as installed PWA
    if (window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches) {
        document.addEventListener('click', function(e) {
            const link = e.target.closest('a');
            if (link && link.href && link.href.startsWith(window.location.origin)) {
                // Internal link - prevent default and use location.href
                e.preventDefault();
                window.location.href = link.href;
            }
        }, true);
    }
}

/**
 * Register service worker with update handling
 */
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./js/sw.js', { scope: '/' })
                .then(registration => {
                    console.log('[PWA] Service Worker registered:', registration.scope);

                    // Check for updates
                    registration.addEventListener('updatefound', () => {
                        const newWorker = registration.installing;
                        newWorker.addEventListener('statechange', () => {
                            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                console.log('[PWA] New version available');
                                showUpdateBanner();
                            }
                        });
                    });
                })
                .catch(error => {
                    console.error('[PWA] Service Worker registration failed:', error);
                });
        });
    }
}

/**
 * Show/hide offline banner based on network status
 *
 * @param {Function} onOnline - Optional callback when device comes online
 * @param {Function} onOffline - Optional callback when device goes offline
 */
function setupOfflineBanner(onOnline, onOffline) {
    const offlineBanner = document.getElementById('offline-banner');

    function showOfflineBanner() {
        if (offlineBanner) {
            offlineBanner.style.display = 'block';
            setTimeout(() => {
                offlineBanner.style.transform = 'translateY(0)';
            }, 10);
        }
    }

    function hideOfflineBanner() {
        if (offlineBanner) {
            offlineBanner.style.transform = 'translateY(-100%)';
            setTimeout(() => {
                offlineBanner.style.display = 'none';
            }, 300);
        }
    }

    // Set up event listeners
    window.addEventListener('online', () => {
        hideOfflineBanner();
        if (typeof onOnline === 'function') {
            onOnline();
        }
    });

    window.addEventListener('offline', () => {
        showOfflineBanner();
        if (typeof onOffline === 'function') {
            onOffline();
        }
    });

    // Check initial state
    if (!navigator.onLine) {
        showOfflineBanner();
    }
}

/**
 * Inject the offline banner HTML into the page
 * Call this if the page doesn't have the banner markup
 *
 * @param {string} message - Optional custom message (default: "You are offline - Some features may be unavailable")
 */
function injectOfflineBanner(message = 'You are offline - Some features may be unavailable') {
    if (!document.getElementById('offline-banner')) {
        const banner = document.createElement('div');
        banner.id = 'offline-banner';
        banner.className = 'fixed top-0 left-0 right-0 bg-yellow-500 text-yellow-900 text-center py-2 px-4 font-bold text-sm z-[9999] transform -translate-y-full transition-transform duration-300';
        banner.style.display = 'none';
        banner.innerHTML = `<i class="fas fa-wifi-slash mr-2"></i>${message}`;
        document.body.insertBefore(banner, document.body.firstChild);
    }
}

/**
 * Show update available banner
 * Creates a blue banner dynamically that reloads the page when clicked
 */
function showUpdateBanner() {
    // Don't create duplicate banners
    if (document.getElementById('update-banner')) {
        return;
    }

    const banner = document.createElement('div');
    banner.id = 'update-banner';
    banner.className = 'fixed top-0 left-0 right-0 bg-blue-500 text-white text-center py-2 px-4 font-bold text-sm z-[9999] cursor-pointer';
    banner.innerHTML = '<i class="fas fa-sync-alt mr-2"></i>Update available — tap to refresh';

    banner.addEventListener('click', () => {
        location.reload();
    });

    document.body.insertBefore(banner, document.body.firstChild);
}
