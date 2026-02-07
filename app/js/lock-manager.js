/**
 * Lock Manager - Handles active report locking to prevent edit conflicts
 * FieldVoice Pro v6
 *
 * This module manages locks on reports to prevent multiple devices from
 * editing the same report simultaneously.
 *
 * @module lock-manager
 */

(function() {
    'use strict';

    // Lock expires after 30 minutes without heartbeat
    const LOCK_TIMEOUT_MINUTES = 30;
    // Heartbeat interval: update lock every 2 minutes
    const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000;

    let heartbeatTimer = null;
    let currentLock = null;

    /**
     * Check if a report is currently locked by another device
     * @param {string} projectId - The project UUID
     * @param {string} reportDate - The report date (YYYY-MM-DD)
     * @returns {Promise<Object|null>} Lock info if locked by another device, null if available
     */
    async function checkLock(projectId, reportDate) {
        if (!projectId || !reportDate) {
            console.warn('[LOCK] Missing projectId or reportDate');
            return null;
        }

        const deviceId = getDeviceId();

        try {
            const { data, error } = await supabaseClient
                .from('active_reports')
                .select('*')
                .eq('project_id', projectId)
                .eq('report_date', reportDate)
                .maybeSingle();

            if (error) {
                console.error('[LOCK] Error checking lock:', error);
                return null;
            }

            if (!data) {
                // No lock exists
                return null;
            }

            // Check if lock is stale (no heartbeat for 30 minutes)
            const lastHeartbeat = new Date(data.last_heartbeat);
            const staleThreshold = new Date(Date.now() - LOCK_TIMEOUT_MINUTES * 60 * 1000);

            if (lastHeartbeat < staleThreshold) {
                console.log('[LOCK] Found stale lock, clearing it');
                await releaseLock(projectId, reportDate, data.device_id);
                return null;
            }

            // Check if this is our own lock
            if (data.device_id === deviceId) {
                console.log('[LOCK] Lock belongs to this device');
                return null;
            }

            // Lock belongs to another device
            console.log('[LOCK] Report locked by another device:', data.device_id);
            return {
                deviceId: data.device_id,
                inspectorName: data.inspector_name || 'Another user',
                lockedAt: data.locked_at,
                lastHeartbeat: data.last_heartbeat
            };
        } catch (e) {
            console.error('[LOCK] Exception checking lock:', e);
            return null;
        }
    }

    /**
     * Acquire a lock on a report
     * @param {string} projectId - The project UUID
     * @param {string} reportDate - The report date (YYYY-MM-DD)
     * @param {string} [inspectorName] - Optional inspector name for display
     * @returns {Promise<boolean>} True if lock acquired, false if already locked
     */
    async function acquireLock(projectId, reportDate, inspectorName) {
        if (!projectId || !reportDate) {
            console.warn('[LOCK] Missing projectId or reportDate');
            return false;
        }

        const deviceId = getDeviceId();

        try {
            // First check if there's an existing lock
            const existingLock = await checkLock(projectId, reportDate);
            if (existingLock) {
                console.log('[LOCK] Cannot acquire - locked by:', existingLock.inspectorName);
                return false;
            }

            // Try to upsert the lock
            const { error } = await supabaseClient
                .from('active_reports')
                .upsert({
                    project_id: projectId,
                    report_date: reportDate,
                    device_id: deviceId,
                    inspector_name: inspectorName || null,
                    locked_at: new Date().toISOString(),
                    last_heartbeat: new Date().toISOString()
                }, { onConflict: 'project_id,report_date' });

            if (error) {
                console.error('[LOCK] Error acquiring lock:', error);
                return false;
            }

            console.log('[LOCK] Lock acquired for project:', projectId, 'date:', reportDate);

            // Store current lock info
            currentLock = { projectId, reportDate, deviceId };

            // Start heartbeat
            startHeartbeat();

            return true;
        } catch (e) {
            console.error('[LOCK] Exception acquiring lock:', e);
            return false;
        }
    }

    /**
     * Release a lock on a report
     * @param {string} projectId - The project UUID
     * @param {string} reportDate - The report date (YYYY-MM-DD)
     * @param {string} [forDeviceId] - Optional specific device ID to release (for stale cleanup)
     * @returns {Promise<boolean>} True if released, false on error
     */
    async function releaseLock(projectId, reportDate, forDeviceId) {
        if (!projectId || !reportDate) {
            console.warn('[LOCK] Missing projectId or reportDate');
            return false;
        }

        const deviceId = forDeviceId || getDeviceId();

        try {
            const { error } = await supabaseClient
                .from('active_reports')
                .delete()
                .eq('project_id', projectId)
                .eq('report_date', reportDate)
                .eq('device_id', deviceId);

            if (error) {
                console.error('[LOCK] Error releasing lock:', error);
                return false;
            }

            console.log('[LOCK] Lock released for project:', projectId, 'date:', reportDate);

            // Clear current lock if it matches
            if (currentLock && currentLock.projectId === projectId && currentLock.reportDate === reportDate) {
                currentLock = null;
                stopHeartbeat();
            }

            return true;
        } catch (e) {
            console.error('[LOCK] Exception releasing lock:', e);
            return false;
        }
    }

    /**
     * Release current lock (convenience function)
     * @returns {Promise<boolean>} True if released, false on error or no current lock
     */
    async function releaseCurrentLock() {
        if (!currentLock) {
            console.log('[LOCK] No current lock to release');
            return true;
        }

        return await releaseLock(currentLock.projectId, currentLock.reportDate);
    }

    /**
     * Update heartbeat for current lock
     * @returns {Promise<boolean>} True if updated, false on error
     */
    async function updateHeartbeat() {
        if (!currentLock) {
            return false;
        }

        const deviceId = getDeviceId();

        try {
            const { error } = await supabaseClient
                .from('active_reports')
                .update({ last_heartbeat: new Date().toISOString() })
                .eq('project_id', currentLock.projectId)
                .eq('report_date', currentLock.reportDate)
                .eq('device_id', deviceId);

            if (error) {
                console.error('[LOCK] Error updating heartbeat:', error);
                return false;
            }

            console.log('[LOCK] Heartbeat updated');
            return true;
        } catch (e) {
            console.error('[LOCK] Exception updating heartbeat:', e);
            return false;
        }
    }

    /**
     * Start heartbeat timer
     */
    function startHeartbeat() {
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
        }

        heartbeatTimer = setInterval(async () => {
            await updateHeartbeat();
        }, HEARTBEAT_INTERVAL_MS);

        console.log('[LOCK] Heartbeat started');
    }

    /**
     * Stop heartbeat timer
     */
    function stopHeartbeat() {
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
            console.log('[LOCK] Heartbeat stopped');
        }
    }

    /**
     * Format lock info for display
     * @param {Object} lockInfo - Lock info from checkLock
     * @returns {string} Formatted message for display
     */
    function formatLockMessage(lockInfo) {
        if (!lockInfo) return '';

        const lockedBy = lockInfo.inspectorName || 'Another user';
        const lockedAt = new Date(lockInfo.lockedAt);
        const timeAgo = getTimeAgo(lockedAt);

        return `This report is currently being edited by ${lockedBy} (started ${timeAgo})`;
    }

    /**
     * Get human-readable time ago string
     * @param {Date} date - The date to format
     * @returns {string} Time ago string
     */
    function getTimeAgo(date) {
        const seconds = Math.floor((new Date() - date) / 1000);

        if (seconds < 60) return 'just now';
        if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
        return `${Math.floor(seconds / 86400)} days ago`;
    }

    /**
     * Check if we have an active lock
     * @returns {boolean} True if we have a current lock
     */
    function hasActiveLock() {
        return currentLock !== null;
    }

    /**
     * Get current lock info
     * @returns {Object|null} Current lock info or null
     */
    function getCurrentLock() {
        return currentLock;
    }

    // Clean up lock on page unload
    window.addEventListener('beforeunload', () => {
        // Note: async operations may not complete during unload
        // The heartbeat timeout mechanism will clean up stale locks
        if (currentLock && navigator.sendBeacon) {
            // Use sendBeacon for more reliable unload handling
            const url = `${window.SUPABASE_URL}/rest/v1/active_reports?project_id=eq.${currentLock.projectId}&report_date=eq.${currentLock.reportDate}&device_id=eq.${getDeviceId()}`;
            navigator.sendBeacon(url, '');
        }
    });

    // Handle visibility change (user switches tabs/apps)
    document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'visible' && currentLock) {
            // Refresh heartbeat when returning to page
            await updateHeartbeat();
        }
    });

    // Expose to window
    window.lockManager = {
        checkLock,
        acquireLock,
        releaseLock,
        releaseCurrentLock,
        updateHeartbeat,
        formatLockMessage,
        hasActiveLock,
        getCurrentLock
    };
})();
