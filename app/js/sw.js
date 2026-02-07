// FieldVoice Pro Service Worker
// Enables offline functionality for PWA

const CACHE_VERSION = 'v1.19.0';
const CACHE_NAME = `fieldvoice-pro-${CACHE_VERSION}`;

// Files to cache for offline use
const STATIC_ASSETS = [
    './',
    './index.html',
    './quick-interview.html',
    './report.html',
    './finalreview.html',
    './permissions.html',
    './permission-debug.html',
    './settings.html',
    './landing.html',
    './archives.html',
    './drafts.html',
    './project-config.html',
    './projects.html',
    './js/config.js',
    './js/projects.js',
    './js/lock-manager.js',
    './js/supabase-utils.js',
    './js/pwa-utils.js',
    './js/ui-utils.js',
    './js/media-utils.js',
    './manifest.json',
    './icons/icon-192x192.png',
    './icons/icon-512x512.png',
    './icons/icon-192x192-maskable.png',
    './icons/icon-512x512-maskable.png'
];

// External CDN assets to cache
const CDN_ASSETS = [
    'https://cdn.tailwindcss.com',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-solid-900.woff2',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-regular-400.woff2',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-brands-400.woff2'
];

// API endpoints that need special offline handling
const API_PATTERNS = [
    'api.open-meteo.com',
    'n8n',
    'webhook'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
    console.log('[SW] Installing service worker...');

    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[SW] Caching static assets...');
                // Cache static assets
                const staticPromise = cache.addAll(STATIC_ASSETS).catch(err => {
                    console.warn('[SW] Some static assets failed to cache:', err);
                });

                // Cache CDN assets separately (they may fail due to CORS)
                const cdnPromises = CDN_ASSETS.map(url =>
                    fetch(url, { mode: 'cors' })
                        .then(response => {
                            if (response.ok) {
                                return cache.put(url, response);
                            }
                        })
                        .catch(err => console.warn('[SW] CDN asset failed:', url, err))
                );

                return Promise.all([staticPromise, ...cdnPromises]);
            })
            .then(() => {
                console.log('[SW] Installation complete');
                return self.skipWaiting();
            })
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating service worker...');

    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames
                        .filter((name) => name.startsWith('fieldvoice-pro-') && name !== CACHE_NAME)
                        .map((name) => {
                            console.log('[SW] Deleting old cache:', name);
                            return caches.delete(name);
                        })
                );
            })
            .then(() => {
                console.log('[SW] Activation complete');
                return self.clients.claim();
            })
    );
});

// Fetch event - serve from cache or network
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Check if this is an API call that needs special handling
    const isApiCall = API_PATTERNS.some(pattern => url.href.includes(pattern));

    if (isApiCall) {
        // Network-first for API calls, with offline fallback
        event.respondWith(handleApiRequest(event.request));
        return;
    }

    // Cache-first for static assets
    event.respondWith(handleStaticRequest(event.request));
});

// Handle static asset requests (cache-first)
async function handleStaticRequest(request) {
    const cachedResponse = await caches.match(request);

    if (cachedResponse) {
        // Return cached version and update cache in background
        updateCacheInBackground(request);
        return cachedResponse;
    }

    // Not in cache, try network
    try {
        const networkResponse = await fetch(request);

        // Cache successful responses
        if (networkResponse.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, networkResponse.clone());
        }

        return networkResponse;
    } catch (error) {
        // Network failed and not in cache
        console.warn('[SW] Network request failed:', request.url);

        // Return a basic offline page for navigation requests
        if (request.mode === 'navigate') {
            const cache = await caches.open(CACHE_NAME);
            const cachedIndex = await cache.match('./index.html');
            if (cachedIndex) {
                return cachedIndex;
            }
        }

        // Return a generic error response
        return new Response('Offline - Resource not available', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/plain' }
        });
    }
}

// Handle API requests (network-first with offline JSON response)
async function handleApiRequest(request) {
    try {
        const response = await fetch(request);
        return response;
    } catch (error) {
        console.warn('[SW] API request failed (offline):', request.url);

        // Return a JSON error response for API calls
        const offlineResponse = {
            error: true,
            offline: true,
            message: 'You are currently offline. This action will be available when you reconnect.',
            timestamp: new Date().toISOString()
        };

        return new Response(JSON.stringify(offlineResponse), {
            status: 503,
            statusText: 'Service Unavailable',
            headers: {
                'Content-Type': 'application/json',
                'X-Offline-Response': 'true'
            }
        });
    }
}

// Update cache in background (stale-while-revalidate pattern)
async function updateCacheInBackground(request) {
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response);
        }
    } catch (error) {
        // Silent fail - we already served the cached version
    }
}

// Listen for messages from the main app
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }

    if (event.data && event.data.type === 'GET_VERSION') {
        event.ports[0].postMessage({ version: CACHE_VERSION });
    }
});
