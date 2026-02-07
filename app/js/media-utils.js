// FieldVoice Pro - Media Utilities
// Photo capture, compression, GPS, and file handling
// Single source of truth - do not duplicate in HTML files

/**
 * Read file as base64 data URL
 * @param {File} file - File object from input
 * @returns {Promise<string>} Base64 data URL
 */
function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

/**
 * Convert data URL to Blob
 * @param {string} dataURL - Base64 data URL
 * @returns {Promise<Blob>} Blob object
 */
async function dataURLtoBlob(dataURL) {
    const response = await fetch(dataURL);
    return response.blob();
}

/**
 * Compress image to target dimensions and quality
 * @param {string} dataUrl - Source image data URL
 * @param {number} maxWidth - Maximum width in pixels (default 1200)
 * @param {number} quality - JPEG quality 0-1 (default 0.7)
 * @returns {Promise<string>} Compressed image data URL
 */
async function compressImage(dataUrl, maxWidth = 1200, quality = 0.7) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            try {
                // Calculate new dimensions
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }

                // Create canvas and draw resized image
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // Convert to compressed JPEG
                const compressedUrl = canvas.toDataURL('image/jpeg', quality);

                console.log(`[PHOTO] Compressed: ${Math.round(dataUrl.length/1024)}KB -> ${Math.round(compressedUrl.length/1024)}KB (${width}x${height})`);

                resolve(compressedUrl);
            } catch (err) {
                reject(err);
            }
        };
        img.onerror = () => reject(new Error('Failed to load image for compression'));
        img.src = dataUrl;
    });
}

/**
 * Compress image to thumbnail size for local storage
 * Used for logos - stores compressed version locally, uploads full version to Supabase
 * @param {File|Blob} file - Image file or blob
 * @param {number} maxWidth - Maximum width in pixels (default 400)
 * @param {number} quality - JPEG quality 0-1 (default 0.7)
 * @returns {Promise<string>} Compressed image as base64 data URL
 */
async function compressImageToThumbnail(file, maxWidth = 400, quality = 0.7) {
    return new Promise((resolve, reject) => {
        // Read file as data URL first
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                try {
                    // Calculate new dimensions maintaining aspect ratio
                    let width = img.width;
                    let height = img.height;

                    if (width > maxWidth) {
                        height = Math.round((height * maxWidth) / width);
                        width = maxWidth;
                    }

                    // Create canvas and draw resized image
                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;

                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    // Convert to compressed JPEG
                    const compressedUrl = canvas.toDataURL('image/jpeg', quality);

                    const originalSize = Math.round(e.target.result.length / 1024);
                    const compressedSize = Math.round(compressedUrl.length / 1024);
                    console.log(`[LOGO] Compressed thumbnail: ${originalSize}KB -> ${compressedSize}KB (${width}x${height})`);

                    resolve(compressedUrl);
                } catch (err) {
                    reject(err);
                }
            };
            img.onerror = () => reject(new Error('Failed to load image for compression'));
            img.src = e.target.result;
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
}

/**
 * Upload logo to Supabase Storage
 * @param {File} file - Logo file to upload
 * @param {string} projectId - Project ID for file naming
 * @returns {Promise<string|null>} Public URL on success, null on failure
 */
async function uploadLogoToStorage(file, projectId) {
    try {
        // Check if Supabase client is available
        if (typeof supabaseClient === 'undefined') {
            console.warn('[LOGO] Supabase client not available - offline mode');
            return null;
        }

        // Debug: Log client details for troubleshooting
        console.log('[LOGO] Using client:', typeof supabaseClient, supabaseClient?.supabaseUrl);

        // Get file extension
        const ext = file.name.split('.').pop().toLowerCase() || 'png';
        const filePath = `${projectId}.${ext}`;

        // Delete existing logo first (to handle extension changes)
        await deleteLogoFromStorage(projectId);

        // Upload new logo
        const { data, error } = await supabaseClient.storage
            .from('project-logos')
            .upload(filePath, file, {
                cacheControl: '3600',
                upsert: true
            });

        if (error) {
            console.error('[LOGO] Upload error:', error);
            return null;
        }

        // Get public URL
        const { data: urlData } = supabaseClient.storage
            .from('project-logos')
            .getPublicUrl(filePath);

        console.log('[LOGO] Uploaded successfully:', urlData.publicUrl);
        return urlData.publicUrl;
    } catch (err) {
        console.warn('[LOGO] Upload failed (offline?):', err.message);
        return null;
    }
}

/**
 * Delete logo from Supabase Storage
 * Tries common image extensions since we may not know the exact filename
 * @param {string} projectId - Project ID
 * @returns {Promise<void>}
 */
async function deleteLogoFromStorage(projectId) {
    try {
        // Check if Supabase client is available
        if (typeof supabaseClient === 'undefined') {
            console.warn('[LOGO] Supabase client not available - cannot delete');
            return;
        }

        // Try to delete files with common extensions
        const extensions = ['png', 'jpg', 'jpeg', 'gif', 'svg'];
        const filesToDelete = extensions.map(ext => `${projectId}.${ext}`);

        const { error } = await supabaseClient.storage
            .from('project-logos')
            .remove(filesToDelete);

        if (error) {
            // Ignore "not found" errors - file may not exist
            if (!error.message?.includes('not found')) {
                console.warn('[LOGO] Delete error:', error);
            }
        } else {
            console.log('[LOGO] Deleted logo files for project:', projectId);
        }
    } catch (err) {
        console.warn('[LOGO] Delete failed (offline?):', err.message);
    }
}

/**
 * Get high-accuracy GPS coordinates using multi-reading approach
 * Takes up to 3 readings over ~5 seconds and returns the most accurate one
 * @param {boolean} showWeakSignalWarning - Whether to show toast warning for weak GPS (default true)
 * @returns {Promise<{lat: number, lng: number, accuracy: number}|null>}
 */
async function getHighAccuracyGPS(showWeakSignalWarning = true) {
    const gpsOptions = {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0
    };

    // Function to get a single GPS reading
    const getSingleReading = () => new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
            (pos) => resolve({
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                accuracy: pos.coords.accuracy
            }),
            () => resolve(null),
            gpsOptions
        );
    });

    // Take up to 3 readings spaced over ~5 seconds
    const delays = [0, 1500, 3000]; // Start at 0s, 1.5s, 3s

    const readingPromises = delays.map((delay) =>
        new Promise((resolve) => {
            setTimeout(async () => {
                const reading = await getSingleReading();
                if (reading) {
                    console.log(`[GPS] Reading: ${reading.lat.toFixed(6)}, ${reading.lng.toFixed(6)} (±${reading.accuracy.toFixed(0)}m)`);
                }
                resolve(reading);
            }, delay);
        })
    );

    // Wait for all readings to complete
    const results = await Promise.all(readingPromises);
    const validReadings = results.filter(r => r !== null);

    if (validReadings.length === 0) {
        console.warn('[GPS] No valid readings obtained');
        return null;
    }

    // Find the reading with lowest accuracy value (most precise)
    const bestReading = validReadings.reduce((best, current) =>
        (!best || current.accuracy < best.accuracy) ? current : best
    , null);

    console.log(`[GPS] Best of ${validReadings.length} readings: ±${bestReading.accuracy.toFixed(0)}m`);

    // Warn if accuracy is poor (> 100m)
    if (showWeakSignalWarning && bestReading.accuracy > 100) {
        // Use showToast if available (from ui-utils.js), otherwise just log
        if (typeof showToast === 'function') {
            showToast('GPS signal is weak. Photo location may be approximate.', 'warning');
        } else {
            console.warn('[GPS] Signal is weak. Photo location may be approximate.');
        }
    }

    return {
        lat: bestReading.lat,
        lng: bestReading.lng,
        accuracy: Math.round(bestReading.accuracy)
    };
}
