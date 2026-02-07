/**
 * FieldVoice Pro v6.6 — Data Layer
 *
 * Single source of truth for all data operations.
 * All pages import from here instead of implementing their own loading logic.
 *
 * Storage Strategy:
 * - localStorage: Small flags only (active_project_id, device_id, user_id, permissions)
 * - IndexedDB: All cached data (projects, reports, photos, userProfile)
 * - Supabase: Source of truth, sync target
 *
 * Pattern: IndexedDB-first, Supabase-fallback, cache on fetch
 */

(function() {
    'use strict';

    // ========================================
    // PROJECTS
    // ========================================

    /**
     * Load all projects from IndexedDB only (no Supabase fallback)
     * Use refreshProjectsFromCloud() to explicitly sync from Supabase
     * @returns {Promise<Array>} Array of project objects (JS format, camelCase)
     */
    async function loadProjects() {
        // Load from IndexedDB only - NO Supabase fallback
        // All users see all projects (no user_id filtering)
        try {
            const allLocalProjects = await window.idb.getAllProjects();

            if (allLocalProjects && allLocalProjects.length > 0) {
                console.log('[DATA] Loaded projects from IndexedDB:', allLocalProjects.length);
                // Convert to JS format in case raw Supabase data was cached
                const normalized = allLocalProjects.map(p => normalizeProject(p));

                // Also cache to localStorage for report-rules.js
                const projectsMap = {};
                normalized.forEach(p => { projectsMap[p.id] = p; });
                setStorageItem(STORAGE_KEYS.PROJECTS, projectsMap);

                return normalized;
            }
        } catch (e) {
            console.warn('[DATA] IndexedDB read failed:', e);
        }

        // Return empty array if IndexedDB is empty - caller should use refreshProjectsFromCloud()
        console.log('[DATA] No projects in IndexedDB');
        return [];
    }

    /**
     * Refresh projects from Supabase (explicit cloud sync with contractors)
     * Call this when user taps Refresh or on initial load when IndexedDB is empty
     * @returns {Promise<Array>} Array of project objects with contractors
     */
    async function refreshProjectsFromCloud() {
        if (!navigator.onLine) {
            console.log('[DATA] Offline, cannot refresh from cloud');
            return [];
        }

        try {
            // Fetch ALL projects WITH contractors using Supabase join
            // All users see all projects (no user_id filtering)
            const { data, error } = await supabaseClient
                .from('projects')
                .select(`
                    *,
                    contractors (*)
                `)
                .order('project_name');

            if (error) throw error;

            // Convert to JS format with contractors
            const projects = (data || []).map(row => {
                const project = fromSupabaseProject(row);
                // Include contractors from the join
                project.contractors = (row.contractors || []).map(c => fromSupabaseContractor(c));
                return project;
            });

            // Cache to IndexedDB (with contractors)
            for (const project of projects) {
                try {
                    await window.idb.saveProject(project);
                } catch (e) {
                    console.warn('[DATA] Failed to cache project:', e);
                }
            }

            // Also cache to localStorage for report-rules.js
            const projectsMap = {};
            projects.forEach(p => { projectsMap[p.id] = p; });
            setStorageItem(STORAGE_KEYS.PROJECTS, projectsMap);

            console.log('[DATA] Refreshed projects from Supabase:', projects.length);
            return projects;
        } catch (e) {
            console.error('[DATA] Supabase fetch failed:', e);
            throw e;
        }
    }

    /**
     * Load active project with contractors (IndexedDB-first, Supabase-fallback)
     * @returns {Promise<Object|null>} Project object with contractors, or null
     */
    async function loadActiveProject() {
        const activeId = getStorageItem(STORAGE_KEYS.ACTIVE_PROJECT_ID);
        if (!activeId) {
            console.log('[DATA] No active project ID set');
            return null;
        }

        // 1. Try IndexedDB first (fast, offline-capable)
        try {
            const localProject = await window.idb.getProject(activeId);
            if (localProject) {
                console.log('[DATA] Loaded active project from IndexedDB:', activeId);
                const project = normalizeProject(localProject);
                project.contractors = (localProject.contractors || []).map(c => normalizeContractor(c));
                return project;
            }
        } catch (e) {
            console.warn('[DATA] IndexedDB read failed:', e);
        }

        // 2. If offline, can't fetch from Supabase
        if (!navigator.onLine) {
            console.log('[DATA] Offline - cannot fetch active project from Supabase');
            return null;
        }

        // 3. Fallback to Supabase and cache locally
        try {
            console.log('[DATA] Active project not in IndexedDB, fetching from Supabase...');
            const { data, error } = await supabaseClient
                .from('projects')
                .select('*, contractors(*)')
                .eq('id', activeId)
                .single();

            if (error || !data) {
                console.warn('[DATA] Could not fetch active project from Supabase:', error);
                return null;
            }

            // Convert from Supabase format and cache to IndexedDB
            const normalized = fromSupabaseProject(data);
            normalized.contractors = (data.contractors || []).map(c => fromSupabaseContractor(c));

            await window.idb.saveProject(normalized);
            console.log('[DATA] Fetched and cached active project from Supabase:', activeId);

            return normalized;
        } catch (e) {
            console.error('[DATA] Supabase fallback failed:', e);
            return null;
        }
    }

    /**
     * Set the active project ID
     * @param {string} projectId
     */
    function setActiveProjectId(projectId) {
        setStorageItem(STORAGE_KEYS.ACTIVE_PROJECT_ID, projectId);
        console.log('[DATA] Set active project ID:', projectId);
    }

    /**
     * Get the active project ID
     * @returns {string|null}
     */
    function getActiveProjectId() {
        return getStorageItem(STORAGE_KEYS.ACTIVE_PROJECT_ID);
    }

    // ========================================
    // NORMALIZERS (handle mixed formats)
    // ========================================

    /**
     * Normalize project object to consistent JS format
     * Handles: raw Supabase (snake_case), converted (camelCase), or mixed
     */
    function normalizeProject(p) {
        if (!p) return null;
        return {
            id: p.id,
            projectName: p.projectName || p.name || p.project_name || '',
            noabProjectNo: p.noabProjectNo || p.noab_project_no || '',
            cnoSolicitationNo: p.cnoSolicitationNo || p.cno_solicitation_no || '',
            location: p.location || '',
            primeContractor: p.primeContractor || p.prime_contractor || '',
            status: p.status || 'active',
            userId: p.userId || p.user_id || '',
            logoUrl: p.logoUrl || p.logo_url || null,
            logoThumbnail: p.logoThumbnail || p.logo_thumbnail || null,
            contractors: p.contractors || []
        };
    }

    /**
     * Normalize contractor object to consistent JS format
     */
    function normalizeContractor(c) {
        if (!c) return null;
        return {
            id: c.id,
            projectId: c.projectId || c.project_id || '',
            name: c.name || '',
            company: c.company || '',
            type: c.type || 'sub',
            status: c.status || 'active'
        };
    }

    // ========================================
    // USER SETTINGS
    // ========================================

    /**
     * Load user settings (IndexedDB-first, Supabase-fallback)
     * @returns {Promise<Object|null>} User settings object or null
     */
    async function loadUserSettings() {
        const deviceId = getStorageItem(STORAGE_KEYS.DEVICE_ID);
        if (!deviceId) {
            console.log('[DATA] No device ID set');
            return null;
        }

        // 1. Try IndexedDB first
        try {
            const localSettings = await window.idb.getUserProfile(deviceId);
            if (localSettings) {
                console.log('[DATA] Loaded user settings from IndexedDB');
                return normalizeUserSettings(localSettings);
            }
        } catch (e) {
            console.warn('[DATA] IndexedDB read failed:', e);
        }

        // 2. Check if offline
        if (!navigator.onLine) {
            console.log('[DATA] Offline, no cached user settings');
            return null;
        }

        // 3. Fetch from Supabase
        try {
            const { data, error } = await supabaseClient
                .from('user_profiles')
                .select('*')
                .eq('device_id', deviceId)
                .maybeSingle();

            if (error) {
                console.warn('[DATA] Supabase user settings error:', error);
                return null;
            }

            if (!data) {
                console.log('[DATA] No user profile found for device:', deviceId);
                return null;
            }

            // 4. Convert to JS format and cache to IndexedDB
            const settings = normalizeUserSettings(data);
            try {
                await window.idb.saveUserProfile(settings);
                console.log('[DATA] Cached user settings to IndexedDB');
            } catch (e) {
                console.warn('[DATA] Failed to cache user settings:', e);
            }

            console.log('[DATA] Loaded user settings from Supabase');
            return settings;
        } catch (e) {
            console.error('[DATA] Failed to load user settings:', e);
            return null;
        }
    }

    /**
     * Save user settings to IndexedDB
     * @param {Object} settings - User settings object
     * @returns {Promise<boolean>} Success status
     */
    async function saveUserSettings(settings) {
        const normalized = normalizeUserSettings(settings);
        if (!normalized || !normalized.deviceId) {
            console.error('[DATA] Cannot save user settings: missing deviceId');
            return false;
        }

        try {
            await window.idb.saveUserProfile(normalized);
            console.log('[DATA] User settings saved to IndexedDB');
            return true;
        } catch (e) {
            console.error('[DATA] Failed to save user settings:', e);
            return false;
        }
    }

    /**
     * Normalize user settings to consistent JS format
     */
    function normalizeUserSettings(s) {
        if (!s) return null;
        return {
            id: s.id,
            deviceId: s.deviceId || s.device_id || '',
            fullName: s.fullName || s.full_name || '',
            title: s.title || '',
            company: s.company || '',
            email: s.email || '',
            phone: s.phone || ''
        };
    }

    // ========================================
    // DRAFTS (localStorage only — temporary data)
    // ========================================

    /**
     * Get current draft for a project/date
     */
    function getCurrentDraft(projectId, date) {
        const reports = getStorageItem(STORAGE_KEYS.CURRENT_REPORTS) || {};
        const key = `draft_${projectId}_${date}`;
        return reports[key] || null;
    }

    /**
     * Save draft (called on every keystroke, debounced by caller)
     */
    function saveDraft(projectId, date, data) {
        const reports = getStorageItem(STORAGE_KEYS.CURRENT_REPORTS) || {};
        const key = `draft_${projectId}_${date}`;
        reports[key] = {
            ...data,
            updatedAt: new Date().toISOString()
        };
        setStorageItem(STORAGE_KEYS.CURRENT_REPORTS, reports);
        console.log('[DATA] Draft saved:', key);
    }

    /**
     * Delete a draft
     */
    function deleteDraft(projectId, date) {
        const reports = getStorageItem(STORAGE_KEYS.CURRENT_REPORTS) || {};
        const key = `draft_${projectId}_${date}`;
        delete reports[key];
        setStorageItem(STORAGE_KEYS.CURRENT_REPORTS, reports);
        console.log('[DATA] Draft deleted:', key);
    }

    /**
     * Get all drafts (for drafts.html)
     */
    function getAllDrafts() {
        const reports = getStorageItem(STORAGE_KEYS.CURRENT_REPORTS) || {};
        return Object.entries(reports).map(([key, data]) => ({
            key,
            ...data
        }));
    }

    // ========================================
    // PHOTOS (IndexedDB — temporary until submitted)
    // ========================================

    /**
     * Save photo to IndexedDB
     */
    async function savePhoto(photo) {
        const photoRecord = {
            id: photo.id || crypto.randomUUID(),
            reportId: photo.reportId,
            blob: photo.blob,
            caption: photo.caption || '',
            timestamp: photo.timestamp || new Date().toISOString(),
            gps: photo.gps || null,
            syncStatus: 'pending',
            supabaseId: null,
            storagePath: null
        };
        await window.idb.savePhoto(photoRecord);
        console.log('[DATA] Photo saved to IndexedDB:', photoRecord.id);
        return photoRecord;
    }

    /**
     * Get all photos for a report
     */
    async function getPhotos(reportId) {
        try {
            const photos = await window.idb.getPhotosByReportId(reportId);
            return photos || [];
        } catch (e) {
            console.warn('[DATA] Failed to get photos:', e);
            return [];
        }
    }

    /**
     * Delete photo from IndexedDB
     */
    async function deletePhoto(photoId) {
        try {
            await window.idb.deletePhoto(photoId);
            console.log('[DATA] Photo deleted:', photoId);
        } catch (e) {
            console.warn('[DATA] Failed to delete photo:', e);
        }
    }

    // ========================================
    // AI RESPONSE CACHE (localStorage — temporary)
    // ========================================

    /**
     * Cache AI response locally
     */
    function cacheAIResponse(reportId, response) {
        const cache = getStorageItem('fvp_ai_cache') || {};
        cache[reportId] = {
            response,
            cachedAt: new Date().toISOString()
        };
        setStorageItem('fvp_ai_cache', cache);
        console.log('[DATA] AI response cached:', reportId);
    }

    /**
     * Get cached AI response
     */
    function getCachedAIResponse(reportId) {
        const cache = getStorageItem('fvp_ai_cache') || {};
        return cache[reportId]?.response || null;
    }

    /**
     * Clear AI response cache for a report
     */
    function clearAIResponseCache(reportId) {
        const cache = getStorageItem('fvp_ai_cache') || {};
        delete cache[reportId];
        setStorageItem('fvp_ai_cache', cache);
    }

    // ========================================
    // ARCHIVES (last 3 in IndexedDB, rest from Supabase)
    // ========================================

    /**
     * Load archived reports
     */
    async function loadArchivedReports(limit = 20) {
        if (!navigator.onLine) {
            console.log('[DATA] Offline, cannot load archives');
            return [];
        }

        try {
            // Fetch ALL archived reports (no user_id filtering)
            // All users see all reports
            const { data, error } = await supabaseClient
                .from('reports')
                .select('*, projects(id, project_name)')
                .eq('status', 'submitted')
                .order('created_at', { ascending: false })
                .limit(limit);

            if (error) throw error;

            return data || [];
        } catch (e) {
            console.error('[DATA] Failed to load archives:', e);
            return [];
        }
    }

    // ========================================
    // SUBMIT (Supabase — final destination)
    // ========================================

    /**
     * Submit final report to Supabase
     */
    async function submitFinalReport(finalData) {
        if (!navigator.onLine) {
            throw new Error('Cannot submit offline — internet required');
        }

        const { reportId, sections } = finalData;

        try {
            for (const section of sections) {
                await supabaseClient
                    .from('final_report_sections')
                    .upsert({
                        report_id: reportId,
                        section_key: section.key,
                        section_title: section.title,
                        content: section.content,
                        order: section.order
                    }, { onConflict: 'report_id,section_key' });
            }

            await supabaseClient
                .from('reports')
                .update({
                    status: 'submitted',
                    submitted_at: new Date().toISOString()
                })
                .eq('id', reportId);

            console.log('[DATA] Final report submitted:', reportId);
            return true;
        } catch (e) {
            console.error('[DATA] Submit failed:', e);
            throw e;
        }
    }

    /**
     * Clear all temporary data after successful submit
     */
    async function clearAfterSubmit(projectId, date, reportId) {
        deleteDraft(projectId, date);
        clearAIResponseCache(reportId);

        const photos = await getPhotos(reportId);
        for (const photo of photos) {
            await deletePhoto(photo.id);
        }

        console.log('[DATA] Cleared temporary data after submit');
    }

    // ========================================
    // UTILITIES
    // ========================================

    /**
     * Check if online
     */
    function isOnline() {
        return navigator.onLine;
    }

    // ========================================
    // EXPORTS
    // ========================================

    window.dataLayer = {
        // Projects
        loadProjects,
        loadActiveProject,
        refreshProjectsFromCloud,
        setActiveProjectId,
        getActiveProjectId,

        // User Settings
        loadUserSettings,
        saveUserSettings,

        // Drafts (localStorage)
        getCurrentDraft,
        saveDraft,
        deleteDraft,
        getAllDrafts,

        // Photos (IndexedDB)
        savePhoto,
        getPhotos,
        deletePhoto,

        // AI Response Cache
        cacheAIResponse,
        getCachedAIResponse,
        clearAIResponseCache,

        // Archives
        loadArchivedReports,

        // Submit
        submitFinalReport,
        clearAfterSubmit,

        // Normalizers (exposed for edge cases)
        normalizeProject,
        normalizeContractor,
        normalizeUserSettings,

        // Utilities
        isOnline
    };

    console.log('[DATA] Data layer initialized');

})();
