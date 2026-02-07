/**
 * Report Rules Module - Business logic enforcement for FieldVoice Pro v6
 *
 * This module enforces all the "Core Rules" from the architecture spec.
 * It validates operations and returns clear results, but does NOT modify data
 * or show UI — callers handle that.
 *
 * @module report-rules
 */

// Dependencies from storage-keys.js (loaded before this file)
// Uses globals: STORAGE_KEYS, getStorageItem, getCurrentReport

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Report status values
 * Flow: draft → pending_refine → refined → submitted
 * @constant {Object}
 */
const REPORT_STATUS = {
  DRAFT: 'draft',
  PENDING_REFINE: 'pending_refine',
  REFINED: 'refined',
  SUBMITTED: 'submitted'
};

/**
 * Data capture modes
 * @constant {Object}
 */
const CAPTURE_MODE = {
  FREEFORM: 'freeform',
  GUIDED: 'guided'
};

/**
 * Guided mode section identifiers
 * Matches data-section attributes in quick-interview.html
 * @constant {Object}
 */
const GUIDED_SECTIONS = {
  WEATHER: 'weather',
  ACTIVITIES: 'activities',
  PERSONNEL: 'personnel',
  EQUIPMENT: 'equipment',
  ISSUES: 'issues',
  COMMUNICATIONS: 'communications',
  QAQC: 'qaqc',
  SAFETY: 'safety',
  VISITORS: 'visitors',
  PHOTOS: 'photos'
};

/**
 * Sections that have Yes/No toggles
 * Note: weather and activities do NOT have toggles
 * @constant {string[]}
 */
const TOGGLE_SECTIONS = [
  'personnel',
  'equipment',
  'issues',
  'communications',
  'qaqc',
  'safety',
  'visitors',
  'photos'
];

/**
 * Status flow order for validation
 * @constant {string[]}
 * @private
 */
const STATUS_FLOW = [
  REPORT_STATUS.DRAFT,
  REPORT_STATUS.PENDING_REFINE,
  REPORT_STATUS.REFINED,
  REPORT_STATUS.SUBMITTED
];

// ============================================================================
// DATE/TIME HELPERS
// ============================================================================

/**
 * Gets today's date as a YYYY-MM-DD string in local timezone
 *
 * @returns {string} Today's date in YYYY-MM-DD format
 */
function getTodayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Checks if a report is from today
 *
 * @param {Object} report - The report object
 * @returns {boolean} True if report date matches today
 */
function isReportFromToday(report) {
  if (!report || !report.date) {
    return false;
  }
  return report.date === getTodayDateString();
}

/**
 * Checks if a report is late (previous day and not submitted)
 *
 * @param {Object} report - The report object
 * @returns {boolean} True if report is late
 */
function isReportLate(report) {
  if (!report || !report.date) {
    return false;
  }
  return report.date < getTodayDateString() && report.status !== REPORT_STATUS.SUBMITTED;
}

// ============================================================================
// PROJECT ELIGIBILITY
// ============================================================================

/**
 * Checks if a new report can be started for a project
 *
 * @param {string} projectId - The project UUID to check
 * @returns {{allowed: boolean, reason: string|null, blockingReportId: string|null}}
 *   - UNFINISHED_PREVIOUS: Has unfinished report from previous day
 *   - ALREADY_SUBMITTED_TODAY: Already has submitted report for today
 *   - CONTINUE_EXISTING: Has in-progress report for today (allowed, but should continue it)
 *   - null: Can start fresh
 */
function canStartNewReport(projectId) {
  if (!projectId) {
    console.warn('canStartNewReport: No projectId provided');
    return { allowed: false, reason: 'NO_PROJECT_ID', blockingReportId: null };
  }

  const reports = getStorageItem(STORAGE_KEYS.CURRENT_REPORTS) || {};
  const today = getTodayDateString();

  // Find all reports for this project
  const projectReports = Object.values(reports).filter(r => r.project_id === projectId);

  // Check 1: Unfinished report from a PREVIOUS day
  const unfinishedPrevious = projectReports.find(
    r => r.date < today && r.status !== REPORT_STATUS.SUBMITTED
  );
  if (unfinishedPrevious) {
    return {
      allowed: false,
      reason: 'UNFINISHED_PREVIOUS',
      blockingReportId: unfinishedPrevious.id
    };
  }

  // Check 2: Already submitted report for TODAY
  const submittedToday = projectReports.find(
    r => r.date === today && r.status === REPORT_STATUS.SUBMITTED
  );
  if (submittedToday) {
    return {
      allowed: false,
      reason: 'ALREADY_SUBMITTED_TODAY',
      blockingReportId: submittedToday.id
    };
  }

  // Check 3: In-progress report for TODAY (not blocked, but caller should continue)
  const inProgressToday = projectReports.find(
    r => r.date === today && r.status !== REPORT_STATUS.SUBMITTED
  );
  if (inProgressToday) {
    return {
      allowed: true,
      reason: 'CONTINUE_EXISTING',
      blockingReportId: inProgressToday.id
    };
  }

  // All clear - can start new report
  return { allowed: true, reason: null, blockingReportId: null };
}

/**
 * Gets list of project IDs eligible for starting a new report
 *
 * @returns {string[]} Array of project IDs that pass canStartNewReport()
 */
function getProjectsEligibleForNewReport() {
  const projects = getStorageItem(STORAGE_KEYS.PROJECTS) || {};
  const eligibleIds = [];

  for (const projectId of Object.keys(projects)) {
    const result = canStartNewReport(projectId);
    // Include if allowed (even if CONTINUE_EXISTING)
    if (result.allowed) {
      eligibleIds.push(projectId);
    }
  }

  return eligibleIds;
}

/**
 * Gets all reports categorized by urgency
 *
 * @returns {{late: Object[], todayDrafts: Object[], todayReady: Object[], todaySubmitted: Object[]}}
 *   - late: Previous days, not submitted (red warning) - sorted oldest first
 *   - todayDrafts: Today, status = draft or pending_refine - sorted newest first
 *   - todayReady: Today, status = refined (needs review) - sorted newest first
 *   - todaySubmitted: Today, status = submitted (done) - sorted newest first
 */
function getReportsByUrgency() {
  const reports = getStorageItem(STORAGE_KEYS.CURRENT_REPORTS) || {};
  const today = getTodayDateString();

  const result = {
    late: [],
    todayDrafts: [],
    todayReady: [],
    todaySubmitted: []
  };

  for (const report of Object.values(reports)) {
    if (report.date < today && report.status !== REPORT_STATUS.SUBMITTED) {
      // Late reports (previous days, not submitted)
      result.late.push(report);
    } else if (report.date === today) {
      // Today's reports
      if (report.status === REPORT_STATUS.DRAFT || report.status === REPORT_STATUS.PENDING_REFINE) {
        result.todayDrafts.push(report);
      } else if (report.status === REPORT_STATUS.REFINED) {
        result.todayReady.push(report);
      } else if (report.status === REPORT_STATUS.SUBMITTED) {
        result.todaySubmitted.push(report);
      }
    }
  }

  // Sort late reports by date (oldest first)
  result.late.sort((a, b) => a.date.localeCompare(b.date));

  // Sort today's reports by created_at (newest first)
  result.todayDrafts.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  result.todayReady.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  result.todaySubmitted.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

  return result;
}

// ============================================================================
// STATUS FLOW
// ============================================================================

/**
 * Checks if a report can transition to a target status
 * Enforces one-way flow: draft → pending_refine → refined → submitted
 *
 * @param {string} reportId - The report UUID
 * @param {string} targetStatus - The desired target status
 * @returns {{allowed: boolean, reason: string|null}}
 */
function canTransitionStatus(reportId, targetStatus) {
  const report = getCurrentReport(reportId);

  if (!report) {
    console.warn('canTransitionStatus: Report not found:', reportId);
    return { allowed: false, reason: 'REPORT_NOT_FOUND' };
  }

  const currentIndex = STATUS_FLOW.indexOf(report.status);
  const targetIndex = STATUS_FLOW.indexOf(targetStatus);

  if (currentIndex === -1) {
    console.warn('canTransitionStatus: Invalid current status:', report.status);
    return { allowed: false, reason: 'INVALID_CURRENT_STATUS' };
  }

  if (targetIndex === -1) {
    console.warn('canTransitionStatus: Invalid target status:', targetStatus);
    return { allowed: false, reason: 'INVALID_TARGET_STATUS' };
  }

  // Cannot go backwards
  if (targetIndex < currentIndex) {
    return { allowed: false, reason: 'CANNOT_GO_BACKWARDS' };
  }

  // Cannot skip steps (must be exactly one step forward)
  if (targetIndex > currentIndex + 1) {
    return { allowed: false, reason: 'CANNOT_SKIP_STEPS' };
  }

  // Same status is a no-op but allowed
  if (targetIndex === currentIndex) {
    return { allowed: true, reason: 'ALREADY_AT_STATUS' };
  }

  return { allowed: true, reason: null };
}

/**
 * Gets the next valid status in the flow
 *
 * @param {string} currentStatus - The current status
 * @returns {string|null} The next valid status, or null if at end
 */
function getNextValidStatus(currentStatus) {
  const currentIndex = STATUS_FLOW.indexOf(currentStatus);

  if (currentIndex === -1) {
    console.warn('getNextValidStatus: Invalid status:', currentStatus);
    return null;
  }

  if (currentIndex >= STATUS_FLOW.length - 1) {
    return null; // Already at submitted
  }

  return STATUS_FLOW[currentIndex + 1];
}

/**
 * Checks if a report is editable
 *
 * @param {string} reportId - The report UUID
 * @returns {boolean} True if status is 'draft' or 'refined'
 */
function isReportEditable(reportId) {
  const report = getCurrentReport(reportId);

  if (!report) {
    console.warn('isReportEditable: Report not found:', reportId);
    return false;
  }

  // Editable in draft (initial entry) or refined (post-AI review)
  return report.status === REPORT_STATUS.DRAFT || report.status === REPORT_STATUS.REFINED;
}

/**
 * Checks if user can return to note-taking mode
 *
 * @param {string} reportId - The report UUID
 * @returns {boolean} True only if status is 'draft'
 */
function canReturnToNotes(reportId) {
  const report = getCurrentReport(reportId);

  if (!report) {
    console.warn('canReturnToNotes: Report not found:', reportId);
    return false;
  }

  // Once AI processes (pending_refine or beyond), cannot return to note-taking
  return report.status === REPORT_STATUS.DRAFT;
}

// ============================================================================
// TOGGLE RULES
// ============================================================================

/**
 * Checks if a section toggle can be changed
 * Toggles lock once user picks Yes or No
 *
 * @param {string} reportId - The report UUID
 * @param {string} section - The section name
 * @returns {{allowed: boolean, currentValue: boolean|null}}
 */
function canChangeToggle(reportId, section) {
  const report = getCurrentReport(reportId);

  if (!report) {
    console.warn('canChangeToggle: Report not found:', reportId);
    return { allowed: false, currentValue: null };
  }

  const toggles = report.section_toggles || {};
  const currentValue = toggles[section];

  // null means not yet selected - can change
  // true or false means already selected - locked
  if (currentValue === null || currentValue === undefined) {
    return { allowed: true, currentValue: null };
  }

  return { allowed: false, currentValue };
}

/**
 * Gets the current toggle state for a section
 *
 * @param {string} reportId - The report UUID
 * @param {string} section - The section name
 * @returns {boolean|null} Toggle state: true, false, or null if not yet selected
 */
function getSectionToggleState(reportId, section) {
  const report = getCurrentReport(reportId);

  if (!report) {
    console.warn('getSectionToggleState: Report not found:', reportId);
    return null;
  }

  const toggles = report.section_toggles || {};
  const value = toggles[section];

  // Return null for undefined values
  return value === undefined ? null : value;
}

// ============================================================================
// MODE SWITCHING
// ============================================================================

/**
 * Checks if capture mode can be switched
 *
 * @param {string} reportId - The report UUID
 * @returns {{allowed: boolean, reason: string|null, dataWillMigrate: boolean}}
 */
function canSwitchCaptureMode(reportId) {
  const report = getCurrentReport(reportId);

  if (!report) {
    console.warn('canSwitchCaptureMode: Report not found:', reportId);
    return { allowed: false, reason: 'REPORT_NOT_FOUND', dataWillMigrate: false };
  }

  // Must be in draft status
  if (report.status !== REPORT_STATUS.DRAFT) {
    return { allowed: false, reason: 'NOT_IN_DRAFT', dataWillMigrate: false };
  }

  // Check for synced entries (entries with supabase_id)
  const guidedEntries = report.entries || [];
  const freeformEntries = report.freeform_entries || [];
  const allEntries = [...guidedEntries, ...freeformEntries];

  const hasSyncedEntries = allEntries.some(entry => entry.supabase_id);

  if (hasSyncedEntries) {
    return { allowed: false, reason: 'ENTRIES_ALREADY_SYNCED', dataWillMigrate: false };
  }

  // Check if there are local entries that would need migration
  const hasLocalEntries = allEntries.length > 0;

  return {
    allowed: true,
    reason: null,
    dataWillMigrate: hasLocalEntries
  };
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validates a report before sending to AI for refinement
 *
 * @param {string} reportId - The report UUID
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateReportForAI(reportId) {
  const report = getCurrentReport(reportId);
  const errors = [];

  if (!report) {
    return { valid: false, errors: ['Report not found'] };
  }

  // Must be in draft status
  if (report.status !== REPORT_STATUS.DRAFT) {
    errors.push(`Report must be in draft status to send to AI (current: ${report.status})`);
  }

  // Check for at least one entry
  if (report.capture_mode === CAPTURE_MODE.FREEFORM) {
    const entries = report.freeform_entries || [];
    if (entries.length === 0) {
      errors.push('At least one freeform entry is required');
    }
  } else if (report.capture_mode === CAPTURE_MODE.GUIDED) {
    const entries = report.entries || [];
    if (entries.length === 0) {
      errors.push('At least one guided entry is required');
    }

    // Weather data is required in guided mode
    if (!report.weather) {
      errors.push('Weather data is required in guided mode');
    } else {
      // Check for required weather fields
      const weather = report.weather;
      if (weather.high_temp === undefined || weather.high_temp === null) {
        errors.push('High temperature is required');
      }
      if (weather.low_temp === undefined || weather.low_temp === null) {
        errors.push('Low temperature is required');
      }
      if (!weather.general_condition) {
        errors.push('General weather condition is required');
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validates a report before final submission
 *
 * @param {string} reportId - The report UUID
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateReportForSubmit(reportId) {
  const report = getCurrentReport(reportId);
  const errors = [];

  if (!report) {
    return { valid: false, errors: ['Report not found'] };
  }

  // Must be in refined status
  if (report.status !== REPORT_STATUS.REFINED) {
    errors.push(`Report must be in refined status to submit (current: ${report.status})`);
  }

  // Check for required fields
  if (!report.project_id) {
    errors.push('Project ID is required');
  }

  if (!report.date) {
    errors.push('Report date is required');
  }

  // Check for at least one entry
  if (report.capture_mode === CAPTURE_MODE.FREEFORM) {
    const entries = report.freeform_entries || [];
    if (entries.length === 0) {
      errors.push('At least one freeform entry is required');
    }
  } else if (report.capture_mode === CAPTURE_MODE.GUIDED) {
    const entries = report.entries || [];
    if (entries.length === 0) {
      errors.push('At least one guided entry is required');
    }

    // Weather is required in guided mode
    if (!report.weather) {
      errors.push('Weather data is required');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

// Expose to window for non-module scripts
if (typeof window !== 'undefined') {
  // Constants
  window.REPORT_STATUS = REPORT_STATUS;
  window.CAPTURE_MODE = CAPTURE_MODE;
  window.GUIDED_SECTIONS = GUIDED_SECTIONS;
  window.TOGGLE_SECTIONS = TOGGLE_SECTIONS;

  // Date/time helpers
  window.getTodayDateString = getTodayDateString;
  window.isReportFromToday = isReportFromToday;
  window.isReportLate = isReportLate;

  // Project eligibility
  window.canStartNewReport = canStartNewReport;
  window.getProjectsEligibleForNewReport = getProjectsEligibleForNewReport;
  window.getReportsByUrgency = getReportsByUrgency;

  // Status flow
  window.canTransitionStatus = canTransitionStatus;
  window.getNextValidStatus = getNextValidStatus;
  window.isReportEditable = isReportEditable;
  window.canReturnToNotes = canReturnToNotes;

  // Toggle rules
  window.canChangeToggle = canChangeToggle;
  window.getSectionToggleState = getSectionToggleState;

  // Mode switching
  window.canSwitchCaptureMode = canSwitchCaptureMode;

  // Validation
  window.validateReportForAI = validateReportForAI;
  window.validateReportForSubmit = validateReportForSubmit;
}
