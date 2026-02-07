/**
 * IndexedDB Utilities for FieldVoice Pro
 * Generic helpers for local-first storage
 */

(function() {
    'use strict';

    const DB_NAME = 'fieldvoice-pro';
    const DB_VERSION = 2; // Bumped for photos + archives stores

    let db = null;

    /**
     * Opens/creates the IndexedDB database
     * @returns {Promise<IDBDatabase>} The database instance
     */
    function initDB() {
        return new Promise((resolve, reject) => {
            if (db) {
                resolve(db);
                return;
            }

            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = (event) => {
                console.error('IndexedDB error:', event.target.error);
                reject(event.target.error);
            };

            request.onsuccess = (event) => {
                db = event.target.result;
                console.log('IndexedDB initialized successfully');
                resolve(db);
            };

            request.onupgradeneeded = (event) => {
                const database = event.target.result;

                // Create projects store
                if (!database.objectStoreNames.contains('projects')) {
                    database.createObjectStore('projects', { keyPath: 'id' });
                    console.log('Created projects object store');
                }

                // Create userProfile store
                if (!database.objectStoreNames.contains('userProfile')) {
                    database.createObjectStore('userProfile', { keyPath: 'deviceId' });
                    console.log('Created userProfile object store');
                }

                // Create photos store (v2)
                if (!database.objectStoreNames.contains('photos')) {
                    const photosStore = database.createObjectStore('photos', { keyPath: 'id' });
                    photosStore.createIndex('reportId', 'reportId', { unique: false });
                    photosStore.createIndex('syncStatus', 'syncStatus', { unique: false });
                    console.log('Created photos object store');
                }

                // Create archives store (v2)
                if (!database.objectStoreNames.contains('archives')) {
                    const archivesStore = database.createObjectStore('archives', { keyPath: 'id' });
                    archivesStore.createIndex('projectId', 'projectId', { unique: false });
                    archivesStore.createIndex('reportDate', 'reportDate', { unique: false });
                    console.log('Created archives object store');
                }
            };
        });
    }

    /**
     * Ensures the database is initialized before operations
     * @returns {Promise<IDBDatabase>} The database instance
     */
    function ensureDB() {
        if (db) {
            return Promise.resolve(db);
        }
        return initDB();
    }

    // ============================================
    // PROJECTS STORE
    // ============================================

    /**
     * Upserts a single project object (with nested contractors)
     * @param {Object} project - The project object to save
     * @returns {Promise<void>}
     */
    function saveProject(project) {
        return ensureDB().then((database) => {
            return new Promise((resolve, reject) => {
                const transaction = database.transaction(['projects'], 'readwrite');
                const store = transaction.objectStore('projects');
                const request = store.put(project);

                request.onsuccess = () => {
                    resolve();
                };

                request.onerror = (event) => {
                    console.error('Error saving project:', event.target.error);
                    reject(event.target.error);
                };
            });
        });
    }

    /**
     * Returns a single project by ID
     * @param {string} id - The project ID
     * @returns {Promise<Object|undefined>} The project object or undefined if not found
     */
    function getProject(id) {
        return ensureDB().then((database) => {
            return new Promise((resolve, reject) => {
                const transaction = database.transaction(['projects'], 'readonly');
                const store = transaction.objectStore('projects');
                const request = store.get(id);

                request.onsuccess = (event) => {
                    resolve(event.target.result);
                };

                request.onerror = (event) => {
                    console.error('Error getting project:', event.target.error);
                    reject(event.target.error);
                };
            });
        });
    }

    /**
     * Returns all projects as an array
     * @returns {Promise<Array>} Array of all project objects
     */
    function getAllProjects() {
        return ensureDB().then((database) => {
            return new Promise((resolve, reject) => {
                const transaction = database.transaction(['projects'], 'readonly');
                const store = transaction.objectStore('projects');
                const request = store.getAll();

                request.onsuccess = (event) => {
                    resolve(event.target.result || []);
                };

                request.onerror = (event) => {
                    console.error('Error getting all projects:', event.target.error);
                    reject(event.target.error);
                };
            });
        });
    }

    /**
     * Deletes a project by ID
     * @param {string} id - The project ID to delete
     * @returns {Promise<void>}
     */
    function deleteProject(id) {
        return ensureDB().then((database) => {
            return new Promise((resolve, reject) => {
                const transaction = database.transaction(['projects'], 'readwrite');
                const store = transaction.objectStore('projects');
                const request = store.delete(id);

                request.onsuccess = () => {
                    resolve();
                };

                request.onerror = (event) => {
                    console.error('Error deleting project:', event.target.error);
                    reject(event.target.error);
                };
            });
        });
    }

    // ============================================
    // USER PROFILE STORE
    // ============================================

    /**
     * Upserts a user profile
     * @param {Object} profile - The user profile object (must include deviceId)
     * @returns {Promise<void>}
     */
    function saveUserProfile(profile) {
        return ensureDB().then((database) => {
            return new Promise((resolve, reject) => {
                const transaction = database.transaction(['userProfile'], 'readwrite');
                const store = transaction.objectStore('userProfile');
                const request = store.put(profile);

                request.onsuccess = () => {
                    resolve();
                };

                request.onerror = (event) => {
                    console.error('Error saving user profile:', event.target.error);
                    reject(event.target.error);
                };
            });
        });
    }

    /**
     * Returns a user profile by deviceId
     * @param {string} deviceId - The device ID
     * @returns {Promise<Object|undefined>} The profile object or undefined if not found
     */
    function getUserProfile(deviceId) {
        return ensureDB().then((database) => {
            return new Promise((resolve, reject) => {
                const transaction = database.transaction(['userProfile'], 'readonly');
                const store = transaction.objectStore('userProfile');
                const request = store.get(deviceId);

                request.onsuccess = (event) => {
                    resolve(event.target.result);
                };

                request.onerror = (event) => {
                    console.error('Error getting user profile:', event.target.error);
                    reject(event.target.error);
                };
            });
        });
    }

    // ============================================
    // PHOTOS STORE
    // ============================================

    /**
     * Saves a photo to IndexedDB
     * @param {Object} photo - Photo object (must include id, reportId)
     * @returns {Promise<void>}
     */
    function savePhoto(photo) {
        return ensureDB().then((database) => {
            return new Promise((resolve, reject) => {
                const transaction = database.transaction(['photos'], 'readwrite');
                const store = transaction.objectStore('photos');
                const request = store.put(photo);

                request.onsuccess = () => {
                    resolve();
                };

                request.onerror = (event) => {
                    console.error('Error saving photo:', event.target.error);
                    reject(event.target.error);
                };
            });
        });
    }

    /**
     * Gets a photo by ID
     * @param {string} id - The photo ID
     * @returns {Promise<Object|undefined>}
     */
    function getPhoto(id) {
        return ensureDB().then((database) => {
            return new Promise((resolve, reject) => {
                const transaction = database.transaction(['photos'], 'readonly');
                const store = transaction.objectStore('photos');
                const request = store.get(id);

                request.onsuccess = (event) => {
                    resolve(event.target.result);
                };

                request.onerror = (event) => {
                    console.error('Error getting photo:', event.target.error);
                    reject(event.target.error);
                };
            });
        });
    }

    /**
     * Gets all photos for a report
     * @param {string} reportId - The report ID
     * @returns {Promise<Array>}
     */
    function getPhotosByReportId(reportId) {
        return ensureDB().then((database) => {
            return new Promise((resolve, reject) => {
                const transaction = database.transaction(['photos'], 'readonly');
                const store = transaction.objectStore('photos');
                const index = store.index('reportId');
                const request = index.getAll(reportId);

                request.onsuccess = (event) => {
                    resolve(event.target.result || []);
                };

                request.onerror = (event) => {
                    console.error('Error getting photos by reportId:', event.target.error);
                    reject(event.target.error);
                };
            });
        });
    }

    /**
     * Gets all photos with a specific sync status
     * @param {string} syncStatus - The sync status ('pending', 'synced', 'failed')
     * @returns {Promise<Array>}
     */
    function getPhotosBySyncStatus(syncStatus) {
        return ensureDB().then((database) => {
            return new Promise((resolve, reject) => {
                const transaction = database.transaction(['photos'], 'readonly');
                const store = transaction.objectStore('photos');
                const index = store.index('syncStatus');
                const request = index.getAll(syncStatus);

                request.onsuccess = (event) => {
                    resolve(event.target.result || []);
                };

                request.onerror = (event) => {
                    console.error('Error getting photos by syncStatus:', event.target.error);
                    reject(event.target.error);
                };
            });
        });
    }

    /**
     * Deletes a photo by ID
     * @param {string} id - The photo ID
     * @returns {Promise<void>}
     */
    function deletePhoto(id) {
        return ensureDB().then((database) => {
            return new Promise((resolve, reject) => {
                const transaction = database.transaction(['photos'], 'readwrite');
                const store = transaction.objectStore('photos');
                const request = store.delete(id);

                request.onsuccess = () => {
                    resolve();
                };

                request.onerror = (event) => {
                    console.error('Error deleting photo:', event.target.error);
                    reject(event.target.error);
                };
            });
        });
    }

    /**
     * Deletes all photos for a report
     * @param {string} reportId - The report ID
     * @returns {Promise<void>}
     */
    function deletePhotosByReportId(reportId) {
        return ensureDB().then((database) => {
            return new Promise((resolve, reject) => {
                const transaction = database.transaction(['photos'], 'readwrite');
                const store = transaction.objectStore('photos');
                const index = store.index('reportId');
                const request = index.openCursor(reportId);

                request.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor) {
                        cursor.delete();
                        cursor.continue();
                    } else {
                        resolve();
                    }
                };

                request.onerror = (event) => {
                    console.error('Error deleting photos by reportId:', event.target.error);
                    reject(event.target.error);
                };
            });
        });
    }

    // ============================================
    // ARCHIVES STORE
    // ============================================

    /**
     * Saves an archived report to IndexedDB
     * @param {Object} archive - Archive object (must include id)
     * @returns {Promise<void>}
     */
    function saveArchive(archive) {
        return ensureDB().then((database) => {
            return new Promise((resolve, reject) => {
                const transaction = database.transaction(['archives'], 'readwrite');
                const store = transaction.objectStore('archives');
                const request = store.put(archive);

                request.onsuccess = () => {
                    resolve();
                };

                request.onerror = (event) => {
                    console.error('Error saving archive:', event.target.error);
                    reject(event.target.error);
                };
            });
        });
    }

    /**
     * Gets an archive by ID
     * @param {string} id - The archive ID
     * @returns {Promise<Object|undefined>}
     */
    function getArchive(id) {
        return ensureDB().then((database) => {
            return new Promise((resolve, reject) => {
                const transaction = database.transaction(['archives'], 'readonly');
                const store = transaction.objectStore('archives');
                const request = store.get(id);

                request.onsuccess = (event) => {
                    resolve(event.target.result);
                };

                request.onerror = (event) => {
                    console.error('Error getting archive:', event.target.error);
                    reject(event.target.error);
                };
            });
        });
    }

    /**
     * Gets all archived reports
     * @returns {Promise<Array>}
     */
    function getAllArchives() {
        return ensureDB().then((database) => {
            return new Promise((resolve, reject) => {
                const transaction = database.transaction(['archives'], 'readonly');
                const store = transaction.objectStore('archives');
                const request = store.getAll();

                request.onsuccess = (event) => {
                    resolve(event.target.result || []);
                };

                request.onerror = (event) => {
                    console.error('Error getting all archives:', event.target.error);
                    reject(event.target.error);
                };
            });
        });
    }

    /**
     * Gets all archives for a project
     * @param {string} projectId - The project ID
     * @returns {Promise<Array>}
     */
    function getArchivesByProjectId(projectId) {
        return ensureDB().then((database) => {
            return new Promise((resolve, reject) => {
                const transaction = database.transaction(['archives'], 'readonly');
                const store = transaction.objectStore('archives');
                const index = store.index('projectId');
                const request = index.getAll(projectId);

                request.onsuccess = (event) => {
                    resolve(event.target.result || []);
                };

                request.onerror = (event) => {
                    console.error('Error getting archives by projectId:', event.target.error);
                    reject(event.target.error);
                };
            });
        });
    }

    /**
     * Deletes an archive by ID
     * @param {string} id - The archive ID
     * @returns {Promise<void>}
     */
    function deleteArchive(id) {
        return ensureDB().then((database) => {
            return new Promise((resolve, reject) => {
                const transaction = database.transaction(['archives'], 'readwrite');
                const store = transaction.objectStore('archives');
                const request = store.delete(id);

                request.onsuccess = () => {
                    resolve();
                };

                request.onerror = (event) => {
                    console.error('Error deleting archive:', event.target.error);
                    reject(event.target.error);
                };
            });
        });
    }

    // ============================================
    // GENERAL
    // ============================================

    /**
     * Clears all records from a store
     * @param {string} storeName - The name of the object store to clear
     * @returns {Promise<void>}
     */
    function clearStore(storeName) {
        return ensureDB().then((database) => {
            return new Promise((resolve, reject) => {
                if (!database.objectStoreNames.contains(storeName)) {
                    console.error('Store not found:', storeName);
                    reject(new Error(`Store not found: ${storeName}`));
                    return;
                }

                const transaction = database.transaction([storeName], 'readwrite');
                const store = transaction.objectStore(storeName);
                const request = store.clear();

                request.onsuccess = () => {
                    console.log(`Cleared store: ${storeName}`);
                    resolve();
                };

                request.onerror = (event) => {
                    console.error('Error clearing store:', event.target.error);
                    reject(event.target.error);
                };
            });
        });
    }

    // Export to window.idb
    window.idb = {
        // Setup
        initDB,

        // Projects store
        saveProject,
        getProject,
        getAllProjects,
        deleteProject,

        // User profile store
        saveUserProfile,
        getUserProfile,

        // Photos store
        savePhoto,
        getPhoto,
        getPhotosByReportId,
        getPhotosBySyncStatus,
        deletePhoto,
        deletePhotosByReportId,

        // Archives store
        saveArchive,
        getArchive,
        getAllArchives,
        getArchivesByProjectId,
        deleteArchive,

        // General
        clearStore
    };

})();
