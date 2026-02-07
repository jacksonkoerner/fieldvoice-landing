/**
 * Storage Keys Module - Single source of truth for localStorage keys and helpers
 * FieldVoice Pro v6
 *
 * This module defines all localStorage keys used by the application and provides
 * helper functions for common storage operations.
 *
 * @module storage-keys
 */

/**
 * All localStorage keys used by FieldVoice Pro v6
 * @constant {Object}
 */
const STORAGE_KEYS = {
  USER_PROFILE: 'fvp_user_profile',
  PROJECTS: 'fvp_projects',
  ACTIVE_PROJECT_ID: 'fvp_active_project_id',
  CURRENT_REPORTS: 'fvp_current_reports',
  REPORT_DATA: 'fvp_report_',  // Pattern: fvp_report_{reportId}
  AI_REPORTS: 'fvp_ai_reports',
  DRAFTS: 'fvp_drafts',
  SYNC_QUEUE: 'fvp_sync_queue',
  LAST_SYNC: 'fvp_last_sync',
  DEVICE_ID: 'fvp_device_id',
  USER_ID: 'fvp_user_id',
  OFFLINE_QUEUE: 'fvp_offline_queue',
  MIC_GRANTED: 'fvp_mic_granted',
  MIC_TIMESTAMP: 'fvp_mic_timestamp',
  CAM_GRANTED: 'fvp_cam_granted',
  LOC_GRANTED: 'fvp_loc_granted',
  SPEECH_GRANTED: 'fvp_speech_granted',
  ONBOARDED: 'fvp_onboarded',
  BANNER_DISMISSED: 'fvp_banner_dismissed',
  BANNER_DISMISSED_DATE: 'fvp_banner_dismissed_date',
  DICTATION_HINT_DISMISSED: 'fvp_dictation_hint_dismissed',
  QUICK_INTERVIEW_DRAFT: 'fvp_quick_interview_draft',
  PERMISSIONS_DISMISSED: 'fvp_permissions_dismissed'
};

/**
 * @typedef {Object} Contractor
 * @property {string} id - Unique identifier
 * @property {string} name - Contractor name
 * @property {string} company - Company name
 * @property {string} trade - Trade/specialty
 * @property {boolean} is_active - Whether contractor is active
 */

/**
 * @typedef {Object} Project
 * @property {string} id - UUID
 * @property {string} name - Project name
 * @property {string} project_number - Project number/code
 * @property {string} location - Project location
 * @property {string} client_name - Client name
 * @property {Contractor[]} contractors - Array of contractors
 * @property {boolean} is_active - Whether project is active
 */

/**
 * @typedef {Object} WeatherData
 * @property {number} high_temp - High temperature
 * @property {number} low_temp - Low temperature
 * @property {string} precipitation - Precipitation description
 * @property {string} general_condition - General weather condition
 * @property {string} job_site_condition - Job site condition
 * @property {string} adverse_conditions - Any adverse conditions
 */

/**
 * @typedef {Object} Personnel
 * @property {number} supers - Number of superintendents
 * @property {number} foremen - Number of foremen
 * @property {number} operators - Number of operators
 * @property {number} laborers - Number of laborers
 * @property {number} surveyors - Number of surveyors
 * @property {number} others - Number of others
 */

/**
 * @typedef {Object} ReportContractor
 * @property {string} id - Unique identifier
 * @property {string} name - Contractor name
 * @property {string} trade - Trade/specialty
 * @property {Personnel} personnel - Personnel counts
 */

/**
 * @typedef {Object} Photo
 * @property {string} id - Unique identifier
 * @property {string} base64 - Base64 encoded image data
 * @property {string} caption - Photo caption
 * @property {number} taken_at - Timestamp when photo was taken
 * @property {number} [location_lat] - Latitude where photo was taken
 * @property {number} [location_lng] - Longitude where photo was taken
 * @property {string} photo_type - Type of photo
 */

/**
 * @typedef {Object} Entry
 * @property {string} id - Unique identifier
 * @property {string} section - Section name (for guided mode)
 * @property {string} content - Entry content
 * @property {number} order - Display order
 * @property {number} created_at - Creation timestamp
 * @property {number} updated_at - Last update timestamp
 * @property {string} [supabase_id] - Supabase record ID
 * @property {boolean} synced - Whether entry is synced
 */

/**
 * @typedef {Object} FreeformEntry
 * @property {string} id - Unique identifier
 * @property {string} content - Entry content
 * @property {number} created_at - Creation timestamp
 * @property {number} updated_at - Last update timestamp
 * @property {string} [supabase_id] - Supabase record ID
 * @property {boolean} synced - Whether entry is synced
 */

/**
 * @typedef {Object} Report
 * @property {string} id - UUID
 * @property {string} project_id - Associated project UUID
 * @property {string} project_name - Project name (denormalized)
 * @property {string} date - Report date in YYYY-MM-DD format
 * @property {'draft'|'pending_refine'|'refined'|'submitted'} status - Report status
 * @property {'freeform'|'guided'} capture_mode - Data capture mode
 * @property {number} created_at - Creation timestamp
 * @property {number} updated_at - Last update timestamp
 * @property {Object} [freeform_checklist] - Checklist for freeform mode
 * @property {FreeformEntry[]} [freeform_entries] - Entries for freeform mode
 * @property {boolean|null} [freeform_photos_toggle] - Photos toggle for freeform mode
 * @property {WeatherData} [weather] - Weather data for guided mode
 * @property {Object} [section_toggles] - Section toggles for guided mode
 * @property {Entry[]} [entries] - Entries for guided mode
 * @property {ReportContractor[]} [contractors] - Contractors on report
 * @property {Photo[]} [photos] - Photos attached to report
 */

/**
 * @typedef {Object} SyncOperation
 * @property {'entry'|'report'|'photo'} type - Type of operation
 * @property {'upsert'|'delete'} action - Action to perform
 * @property {Object} data - Operation data
 * @property {number} timestamp - When operation was queued
 */

/**
 * Gets or creates a persistent device ID
 * Device ID persists forever on this device
 *
 * @returns {string} The device UUID
 */
function getDeviceId() {
  let deviceId = localStorage.getItem(STORAGE_KEYS.DEVICE_ID);

  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEYS.DEVICE_ID, deviceId);
    console.log('Generated new device ID:', deviceId);
  }

  return deviceId;
}

/**
 * Gets an item from localStorage and parses it as JSON
 *
 * @param {string} key - The localStorage key
 * @returns {*} The parsed value, or the raw string if not valid JSON, or null if not found
 */
function getStorageItem(key) {
  const item = localStorage.getItem(key);
  if (item === null) {
    return null;
  }
  try {
    return JSON.parse(item);
  } catch (e) {
    // Value is a plain string, not JSON - return as-is
    return item;
  }
}

/**
 * Sets an item in localStorage after JSON stringifying it
 *
 * @param {string} key - The localStorage key
 * @param {*} value - The value to store (will be JSON stringified)
 * @returns {boolean} True on success, false on failure
 */
function setStorageItem(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error(`Error setting localStorage item "${key}":`, error);
    return false;
  }
}

/**
 * Removes an item from localStorage
 *
 * @param {string} key - The localStorage key to remove
 */
function removeStorageItem(key) {
  localStorage.removeItem(key);
}

/**
 * Gets a specific report from current reports by ID
 *
 * @param {string} reportId - The report UUID to find
 * @returns {Report|null} The report object or null if not found
 */
function getCurrentReport(reportId) {
  const reports = getStorageItem(STORAGE_KEYS.CURRENT_REPORTS);

  if (!reports || typeof reports !== 'object') {
    return null;
  }

  return reports[reportId] || null;
}

/**
 * Saves a report to current reports
 * Updates the report's updated_at timestamp automatically
 *
 * @param {Report} report - The report object to save (must have id property)
 * @returns {boolean} True on success, false on failure
 */
function saveCurrentReport(report) {
  if (!report || !report.id) {
    console.error('Cannot save report: missing id');
    return false;
  }

  const reports = getStorageItem(STORAGE_KEYS.CURRENT_REPORTS) || {};

  report.updated_at = Date.now();
  reports[report.id] = report;

  return setStorageItem(STORAGE_KEYS.CURRENT_REPORTS, reports);
}

/**
 * Deletes a report from current reports
 *
 * @param {string} reportId - The report UUID to delete
 * @returns {boolean} True on success, false on failure
 */
function deleteCurrentReport(reportId) {
  const reports = getStorageItem(STORAGE_KEYS.CURRENT_REPORTS);

  if (!reports || typeof reports !== 'object') {
    return true; // Nothing to delete
  }

  delete reports[reportId];

  return setStorageItem(STORAGE_KEYS.CURRENT_REPORTS, reports);
}

/**
 * Gets the currently active project
 * Looks up the project ID from fvp_active_project_id and returns the full project object
 *
 * @returns {Project|null} The active project object or null if none set
 */
function getActiveProject() {
  const activeProjectId = getStorageItem(STORAGE_KEYS.ACTIVE_PROJECT_ID);

  if (!activeProjectId) {
    return null;
  }

  const projects = getStorageItem(STORAGE_KEYS.PROJECTS);

  if (!projects || typeof projects !== 'object') {
    return null;
  }

  return projects[activeProjectId] || null;
}

/**
 * Adds an operation to the sync queue for later processing
 * Used for offline operations that need to be synced when online
 *
 * @param {SyncOperation} operation - The operation to queue
 * @param {('entry'|'report'|'photo')} operation.type - Type of operation
 * @param {('upsert'|'delete')} operation.action - Action to perform
 * @param {Object} operation.data - Operation data
 * @param {number} [operation.timestamp] - When operation was queued (defaults to now)
 * @returns {boolean} True on success, false on failure
 */
function addToSyncQueue(operation) {
  const queue = getStorageItem(STORAGE_KEYS.SYNC_QUEUE) || [];

  // Ensure timestamp is set
  if (!operation.timestamp) {
    operation.timestamp = Date.now();
  }

  queue.push(operation);

  console.log('Added to sync queue:', operation.type, operation.action);

  return setStorageItem(STORAGE_KEYS.SYNC_QUEUE, queue);
}

/**
 * Gets all operations in the sync queue
 *
 * @returns {SyncOperation[]} Array of queued operations (empty array if none)
 */
function getSyncQueue() {
  return getStorageItem(STORAGE_KEYS.SYNC_QUEUE) || [];
}

/**
 * Clears all operations from the sync queue
 */
function clearSyncQueue() {
  removeStorageItem(STORAGE_KEYS.SYNC_QUEUE);
  console.log('Sync queue cleared');
}

/**
 * Gets the localStorage key for a specific report
 * @param {string} reportId - The report UUID
 * @returns {string} The localStorage key
 */
function getReportDataKey(reportId) {
  return `${STORAGE_KEYS.REPORT_DATA}${reportId}`;
}

/**
 * Gets report data from localStorage by reportId
 * @param {string} reportId - The report UUID
 * @returns {Object|null} The report data or null if not found
 */
function getReportData(reportId) {
  if (!reportId) return null;
  const key = getReportDataKey(reportId);
  return getStorageItem(key);
}

/**
 * Saves report data to localStorage
 * @param {string} reportId - The report UUID
 * @param {Object} data - The report data to save
 * @returns {boolean} True on success, false on failure
 */
function saveReportData(reportId, data) {
  if (!reportId || !data) {
    console.error('Cannot save report data: missing reportId or data');
    return false;
  }

  const key = getReportDataKey(reportId);
  data.lastSaved = new Date().toISOString();
  return setStorageItem(key, data);
}

/**
 * Deletes report data from localStorage
 * @param {string} reportId - The report UUID
 */
function deleteReportData(reportId) {
  if (!reportId) return;
  const key = getReportDataKey(reportId);
  removeStorageItem(key);
  console.log('Report data deleted:', key);
}

// Expose to window for non-module scripts
if (typeof window !== 'undefined') {
  window.STORAGE_KEYS = STORAGE_KEYS;
  window.getDeviceId = getDeviceId;
  window.getStorageItem = getStorageItem;
  window.setStorageItem = setStorageItem;
  window.removeStorageItem = removeStorageItem;
  window.getCurrentReport = getCurrentReport;
  window.saveCurrentReport = saveCurrentReport;
  window.deleteCurrentReport = deleteCurrentReport;
  window.getActiveProject = getActiveProject;
  window.addToSyncQueue = addToSyncQueue;
  window.getSyncQueue = getSyncQueue;
  window.clearSyncQueue = clearSyncQueue;
  window.getReportDataKey = getReportDataKey;
  window.getReportData = getReportData;
  window.saveReportData = saveReportData;
  window.deleteReportData = deleteReportData;
}
