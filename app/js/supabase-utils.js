/**
 * Supabase Data Converters - FieldVoice Pro v6
 *
 * Converts between Supabase row format (snake_case) and JS object format (camelCase).
 * Single source of truth for all database schema mappings.
 *
 * @module supabase-utils
 */

// ============================================================================
// PROJECT CONVERTERS
// ============================================================================

/**
 * Convert Supabase project row to JS format
 *
 * DB columns: id, user_id, project_name, noab_project_no, cno_solicitation_no,
 *             location, engineer, prime_contractor, notice_to_proceed,
 *             contract_duration, expected_completion, default_start_time,
 *             default_end_time, weather_days, logo_thumbnail, logo_url,
 *             logo (legacy), status, created_at, updated_at
 *
 * NOTE: Database migration required to add logo_thumbnail and logo_url columns
 *
 * @param {Object} row - Supabase project row
 * @returns {Object} JS project object
 */
function fromSupabaseProject(row) {
    if (!row) return null;
    return {
        id: row.id,
        projectName: row.project_name || '',
        noabProjectNo: row.noab_project_no || '',
        cnoSolicitationNo: row.cno_solicitation_no || '',
        location: row.location || '',
        engineer: row.engineer || '',
        primeContractor: row.prime_contractor || '',
        noticeToProceed: row.notice_to_proceed || null,
        contractDuration: row.contract_duration || null,
        expectedCompletion: row.expected_completion || null,
        defaultStartTime: row.default_start_time || '',
        defaultEndTime: row.default_end_time || '',
        weatherDays: row.weather_days || null,
        // New logo fields
        logoThumbnail: row.logo_thumbnail || null,
        logoUrl: row.logo_url || null,
        // Legacy logo field for backwards compatibility
        logo: row.logo || null,
        status: row.status || 'active',
        userId: row.user_id || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

/**
 * Convert JS project object to Supabase format
 *
 * @param {Object} project - JS project object
 * @returns {Object} Supabase row format
 */
function toSupabaseProject(project) {
    if (!project) return null;
    const row = {
        project_name: project.projectName || project.name || '',
        noab_project_no: project.noabProjectNo || '',
        cno_solicitation_no: project.cnoSolicitationNo || '',
        location: project.location || '',
        engineer: project.engineer || '',
        prime_contractor: project.primeContractor || '',
        notice_to_proceed: project.noticeToProceed || null,
        contract_duration: project.contractDuration || null,
        expected_completion: project.expectedCompletion || null,
        default_start_time: project.defaultStartTime || '',
        default_end_time: project.defaultEndTime || '',
        weather_days: project.weatherDays || null,
        // New logo fields
        logo_thumbnail: project.logoThumbnail || null,
        logo_url: project.logoUrl || null,
        status: project.status || 'active'
    };

    // Only include id if it exists (for updates/upserts)
    if (project.id) {
        row.id = project.id;
    }

    return row;
}

// ============================================================================
// CONTRACTOR CONVERTERS
// ============================================================================

/**
 * Convert Supabase contractor row to JS format
 *
 * DB columns: id, project_id, name, company, abbreviation, type, trades,
 *             status, added_date, removed_date, created_at
 *
 * @param {Object} row - Supabase contractor row
 * @returns {Object} JS contractor object
 */
function fromSupabaseContractor(row) {
    if (!row) return null;
    return {
        id: row.id,
        projectId: row.project_id,
        name: row.name || '',
        company: row.company || '',
        abbreviation: row.abbreviation || '',
        type: row.type || 'sub',
        trades: row.trades || '',
        status: row.status || 'active',
        addedDate: row.added_date || row.created_at,
        removedDate: row.removed_date || null
    };
}

/**
 * Convert JS contractor object to Supabase format
 *
 * @param {Object} contractor - JS contractor object
 * @param {string} projectId - Project ID
 * @returns {Object} Supabase row format
 */
function toSupabaseContractor(contractor, projectId) {
    if (!contractor) return null;
    const row = {
        project_id: projectId || contractor.projectId,
        name: contractor.name || '',
        company: contractor.company || '',
        abbreviation: contractor.abbreviation || '',
        type: contractor.type || 'sub',
        trades: contractor.trades || '',
        status: contractor.status || 'active',
        added_date: contractor.addedDate || null,
        removed_date: contractor.removedDate || null
    };

    // Only include id if it exists (for updates/upserts)
    if (contractor.id) {
        row.id = contractor.id;
    }

    return row;
}

// ============================================================================
// REPORT CONVERTERS
// ============================================================================

/**
 * Convert Supabase report row to JS format
 *
 * DB columns: id, project_id, user_id, device_id, report_date, status,
 *             capture_mode, pdf_url, created_at, updated_at, submitted_at
 *
 * @param {Object} row - Supabase report row
 * @returns {Object} JS report object
 */
function fromSupabaseReport(row) {
  return {
    id: row.id,
    projectId: row.project_id || null,
    userId: row.user_id || null,
    deviceId: row.device_id || null,
    reportDate: row.report_date || null,
    status: row.status || 'draft',
    captureMode: row.capture_mode || 'guided',
    pdfUrl: row.pdf_url || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    submittedAt: row.submitted_at || null
  };
}

/**
 * Convert JS report object to Supabase format
 *
 * @param {Object} report - JS report object
 * @param {string} projectId - Project ID
 * @param {string} userId - User ID
 * @param {string} deviceId - Device ID
 * @returns {Object} Supabase row format
 */
function toSupabaseReport(report, projectId, userId, deviceId) {
  const row = {
    project_id: projectId,
    user_id: userId,
    device_id: deviceId,
    report_date: report.reportDate || report.date || new Date().toISOString().split('T')[0],
    status: report.status || 'draft',
    capture_mode: report.captureMode || report.capture_mode || 'guided',
    updated_at: new Date().toISOString(),
    toggle_states: report.toggleStates || {},
    safety_no_incidents: report.safety?.noIncidents ?? null
  };

  // Only include id if it exists (for updates)
  if (report.id) {
    row.id = report.id;
  }

  // Include pdf_url if set
  if (report.pdfUrl) {
    row.pdf_url = report.pdfUrl;
  }

  // Include submitted_at if status is submitted
  if (report.status === 'submitted' && !report.submittedAt) {
    row.submitted_at = new Date().toISOString();
  } else if (report.submittedAt) {
    row.submitted_at = report.submittedAt;
  }

  return row;
}

// ============================================================================
// ENTRY CONVERTERS
// ============================================================================

/**
 * Convert Supabase report entry row to JS format
 *
 * DB columns: id, report_id, local_id, section, content, entry_order,
 *             created_at, updated_at, is_deleted
 *
 * @param {Object} row - Supabase entry row
 * @returns {Object} JS entry object
 */
function fromSupabaseEntry(row) {
  return {
    id: row.id,
    reportId: row.report_id || null,
    localId: row.local_id || null,
    section: row.section || '',
    content: row.content || '',
    entryOrder: row.entry_order ?? 0,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    isDeleted: row.is_deleted ?? false
  };
}

/**
 * Convert JS entry object to Supabase format
 *
 * @param {Object} entry - JS entry object
 * @param {string} reportId - Report ID
 * @returns {Object} Supabase row format
 */
function toSupabaseEntry(entry, reportId) {
  // Extract contractor_id from section if it's a work entry (format: "work_<uuid>")
  let contractorId = null;
  if (entry.section && entry.section.startsWith('work_')) {
    contractorId = entry.section.substring(5); // Remove "work_" prefix
  }

  // Handle timestamp - could be ISO string or Unix number (from freeform)
  let timestamp = null;
  if (entry.timestamp) {
    timestamp = entry.timestamp; // Already ISO string
  } else if (entry.created_at) {
    // Freeform uses created_at as Unix timestamp
    timestamp = typeof entry.created_at === 'number' 
      ? new Date(entry.created_at).toISOString()
      : entry.created_at;
  }

  const row = {
    report_id: reportId,
    local_id: entry.localId || entry.id || null,
    section: entry.section || 'minimal',  // Default to 'minimal' for freeform
    content: entry.content || '',
    entry_order: entry.entryOrder ?? entry.order ?? 0,
    timestamp: timestamp,
    contractor_id: contractorId,
    updated_at: entry.updated_at 
      ? (typeof entry.updated_at === 'number' ? new Date(entry.updated_at).toISOString() : entry.updated_at)
      : new Date().toISOString(),
    is_deleted: entry.isDeleted ?? entry.is_deleted ?? false
  };

  // Only include id if it exists (for updates)
  if (entry.supabaseId || entry.id) {
    // Prefer supabaseId for server-side ID
    const serverId = entry.supabaseId || (entry.id && entry.id.length === 36 ? entry.id : null);
    if (serverId) {
      row.id = serverId;
    }
  }

  return row;
}

// ============================================================================
// RAW CAPTURE CONVERTERS
// ============================================================================

/**
 * Convert Supabase raw capture row to JS format
 *
 * DB columns: id, report_id, capture_mode, raw_data (jsonb),
 *             weather (jsonb), location (jsonb), created_at
 *
 * @param {Object} row - Supabase raw capture row
 * @returns {Object} JS raw capture object
 */
function fromSupabaseRawCapture(row) {
  return {
    id: row.id,
    reportId: row.report_id || null,
    captureMode: row.capture_mode || 'guided',
    rawData: row.raw_data || null,
    weather: row.weather || null,
    location: row.location || null,
    createdAt: row.created_at || null
  };
}

/**
 * Convert capture data to Supabase format
 *
 * @param {Object} captureData - Capture data object
 * @param {string} captureData.captureMode - 'freeform' or 'guided'
 * @param {Array} [captureData.entries] - Entry array
 * @param {Array} [captureData.contractors] - Contractors on report
 * @param {Array} [captureData.equipment] - Equipment used
 * @param {Object} [captureData.weather] - Weather data
 * @param {Object} [captureData.location] - Location data
 * @param {string} reportId - Report ID
 * @returns {Object} Supabase row format
 */
function toSupabaseRawCapture(captureData, reportId) {
  // Build raw_data object from entries, contractors, equipment
  const rawData = {
    entries: captureData.entries || [],
    contractors: captureData.contractors || [],
    equipment: captureData.equipment || []
  };

  // Include freeform-specific data if present
  if (captureData.freeformEntries) {
    rawData.freeformEntries = captureData.freeformEntries;
  }
  if (captureData.freeformChecklist) {
    rawData.freeformChecklist = captureData.freeformChecklist;
  }
  if (captureData.sectionToggles) {
    rawData.sectionToggles = captureData.sectionToggles;
  }

  return {
    report_id: reportId,
    capture_mode: captureData.captureMode || 'guided',
    raw_data: rawData,
    weather: captureData.weather || null,
    location: captureData.location || null,
    created_at: new Date().toISOString()
  };
}

// ============================================================================
// AI RESPONSE CONVERTERS
// ============================================================================

/**
 * Convert Supabase AI response row to JS format
 *
 * DB columns: id, report_id, raw_response (jsonb),
 *             generated_content (jsonb), created_at
 *
 * @param {Object} row - Supabase AI response row
 * @returns {Object} JS AI response object
 */
function fromSupabaseAIResponse(row) {
  return {
    id: row.id,
    reportId: row.report_id || null,
    rawResponse: row.raw_response || null,
    generatedContent: row.generated_content || null,
    createdAt: row.created_at || null
  };
}

/**
 * Convert AI response data to Supabase format
 *
 * @param {Object} aiData - AI response data
 * @param {Object} aiData.rawResponse - Raw API response
 * @param {Object} aiData.generatedContent - Processed/generated content
 * @param {string} reportId - Report ID
 * @returns {Object} Supabase row format
 */
function toSupabaseAIResponse(aiData, reportId) {
  return {
    report_id: reportId,
    raw_response: aiData.rawResponse || null,
    generated_content: aiData.generatedContent || null,
    created_at: new Date().toISOString()
  };
}

// ============================================================================
// FINAL REPORT CONVERTERS
// ============================================================================

/**
 * Convert Supabase final report row to JS format with nested structure
 *
 * DB columns: id, report_id, pdf_url,
 *   weather_high_temp, weather_low_temp, weather_precipitation,
 *   weather_general_condition, weather_job_site_condition, weather_adverse_conditions,
 *   executive_summary, work_performed, safety_observations, delays_issues,
 *   materials_used, qaqc_notes, communications_notes, visitors_deliveries_notes, inspector_notes,
 *   has_contractor_personnel, has_equipment, has_issues, has_communications,
 *   has_qaqc, has_safety_incidents, has_visitors_deliveries, has_photos,
 *   contractors_display, contractors_json, equipment_display, equipment_json,
 *   personnel_display, personnel_json, created_at, submitted_at
 *
 * @param {Object} row - Supabase final report row
 * @returns {Object} JS final report object with nested structure
 */
function fromSupabaseFinal(row) {
  return {
    id: row.id,
    reportId: row.report_id || null,
    pdfUrl: row.pdf_url || null,

    weather: {
      highTemp: row.weather_high_temp ?? null,
      lowTemp: row.weather_low_temp ?? null,
      precipitation: row.weather_precipitation || '',
      generalCondition: row.weather_general_condition || '',
      jobSiteCondition: row.weather_job_site_condition || '',
      adverseConditions: row.weather_adverse_conditions || ''
    },

    content: {
      executiveSummary: row.executive_summary || '',
      workPerformed: row.work_performed || '',
      safetyObservations: row.safety_observations || '',
      delaysIssues: row.delays_issues || '',
      materialsUsed: row.materials_used || '',
      qaqcNotes: row.qaqc_notes || '',
      communicationsNotes: row.communications_notes || '',
      visitorsDeliveriesNotes: row.visitors_deliveries_notes || '',
      inspectorNotes: row.inspector_notes || ''
    },

    toggles: {
      hasContractorPersonnel: row.has_contractor_personnel ?? false,
      hasEquipment: row.has_equipment ?? false,
      hasIssues: row.has_issues ?? false,
      hasCommunications: row.has_communications ?? false,
      hasQaqc: row.has_qaqc ?? false,
      hasSafetyIncidents: row.has_safety_incidents ?? false,
      hasVisitorsDeliveries: row.has_visitors_deliveries ?? false,
      hasPhotos: row.has_photos ?? false
    },

    contractors: {
      display: row.contractors_display || '',
      json: row.contractors_json || null
    },

    equipment: {
      display: row.equipment_display || '',
      json: row.equipment_json || null
    },

    personnel: {
      display: row.personnel_display || '',
      json: row.personnel_json || null
    },

    createdAt: row.created_at || null,
    submittedAt: row.submitted_at || null
  };
}

/**
 * Convert JS final report object to Supabase format (flattens nested structure)
 *
 * @param {Object} finalData - JS final report object with nested structure
 * @param {string} reportId - Report ID
 * @returns {Object} Supabase row format (flat)
 */
function toSupabaseFinal(finalData, reportId) {
  const weather = finalData.weather || {};
  const content = finalData.content || {};
  const toggles = finalData.toggles || {};
  const contractors = finalData.contractors || {};
  const equipment = finalData.equipment || {};
  const personnel = finalData.personnel || {};

  const row = {
    report_id: reportId,

    // Weather fields
    weather_high_temp: weather.highTemp ?? null,
    weather_low_temp: weather.lowTemp ?? null,
    weather_precipitation: weather.precipitation || '',
    weather_general_condition: weather.generalCondition || '',
    weather_job_site_condition: weather.jobSiteCondition || '',
    weather_adverse_conditions: weather.adverseConditions || '',

    // Content fields
    executive_summary: content.executiveSummary || '',
    work_performed: content.workPerformed || '',
    safety_observations: content.safetyObservations || '',
    delays_issues: content.delaysIssues || '',
    materials_used: content.materialsUsed || '',
    qaqc_notes: content.qaqcNotes || '',
    communications_notes: content.communicationsNotes || '',
    visitors_deliveries_notes: content.visitorsDeliveriesNotes || '',
    inspector_notes: content.inspectorNotes || '',

    // Toggle fields
    has_contractor_personnel: toggles.hasContractorPersonnel ?? false,
    has_equipment: toggles.hasEquipment ?? false,
    has_issues: toggles.hasIssues ?? false,
    has_communications: toggles.hasCommunications ?? false,
    has_qaqc: toggles.hasQaqc ?? false,
    has_safety_incidents: toggles.hasSafetyIncidents ?? false,
    has_visitors_deliveries: toggles.hasVisitorsDeliveries ?? false,
    has_photos: toggles.hasPhotos ?? false,

    // Dual-format fields
    contractors_display: contractors.display || '',
    contractors_json: contractors.json || null,
    equipment_display: equipment.display || '',
    equipment_json: equipment.json || null,
    personnel_display: personnel.display || '',
    personnel_json: personnel.json || null,

    created_at: new Date().toISOString()
  };

  // Only include id if it exists (for updates)
  if (finalData.id) {
    row.id = finalData.id;
  }

  // Include pdf_url if set
  if (finalData.pdfUrl) {
    row.pdf_url = finalData.pdfUrl;
  }

  // Include submitted_at if set
  if (finalData.submittedAt) {
    row.submitted_at = finalData.submittedAt;
  }

  return row;
}

// ============================================================================
// PHOTO CONVERTERS
// ============================================================================

/**
 * Convert Supabase photo row to JS format
 *
 * DB columns: id, report_id, photo_url, caption, photo_type,
 *             taken_at, location_lat, location_lng, created_at
 *
 * @param {Object} row - Supabase photo row
 * @returns {Object} JS photo object
 */
function fromSupabasePhoto(row) {
  return {
    id: row.id,
    reportId: row.report_id || null,
    photoUrl: row.photo_url || '',
    caption: row.caption || '',
    photoType: row.photo_type || '',
    takenAt: row.taken_at || null,
    locationLat: row.location_lat ?? null,
    locationLng: row.location_lng ?? null,
    createdAt: row.created_at || null
  };
}

/**
 * Convert JS photo object to Supabase format
 *
 * @param {Object} photo - JS photo object
 * @param {string} reportId - Report ID
 * @returns {Object} Supabase row format
 */
function toSupabasePhoto(photo, reportId) {
  const row = {
    report_id: reportId,
    photo_url: photo.photoUrl || photo.photo_url || '',
    caption: photo.caption || '',
    photo_type: photo.photoType || photo.photo_type || '',
    taken_at: photo.takenAt || photo.taken_at || new Date().toISOString(),
    location_lat: photo.locationLat ?? photo.location_lat ?? null,
    location_lng: photo.locationLng ?? photo.location_lng ?? null,
    created_at: new Date().toISOString()
  };

  // Only include id if it exists (for updates)
  if (photo.id) {
    row.id = photo.id;
  }

  return row;
}

// ============================================================================
// USER PROFILE CONVERTERS
// ============================================================================

/**
 * Convert Supabase user_profiles row to JS format
 *
 * DB columns: id, device_id, full_name, title, company, email, phone, created_at, updated_at
 */
function fromSupabaseUserProfile(row) {
    if (!row) return null;
    return {
        id: row.id,
        deviceId: row.device_id || null,
        fullName: row.full_name || '',
        title: row.title || '',
        company: row.company || '',
        email: row.email || '',
        phone: row.phone || '',
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

/**
 * Convert JS user profile to Supabase format
 */
function toSupabaseUserProfile(profile) {
    if (!profile) return null;
    const row = {
        device_id: profile.deviceId || null,
        full_name: profile.fullName || '',
        title: profile.title || '',
        company: profile.company || '',
        email: profile.email || '',
        phone: profile.phone || '',
        updated_at: new Date().toISOString()
    };

    // Include id for upserts
    if (profile.id) {
        row.id = profile.id;
    }

    return row;
}

// ============================================================================
// EQUIPMENT CONVERTERS
// ============================================================================

/**
 * Convert Supabase equipment row to JS format
 *
 * DB columns: id, project_id, name, description, is_active, created_at
 *
 * @param {Object} row - Supabase equipment row
 * @returns {Object} JS equipment object
 */
function fromSupabaseEquipment(row) {
  return {
    id: row.id,
    projectId: row.project_id || null,
    name: row.name || '',
    description: row.description || '',
    isActive: row.is_active ?? true,
    createdAt: row.created_at || null
  };
}

/**
 * Convert JS equipment object to Supabase format
 *
 * @param {Object} equipment - JS equipment object
 * @param {string} projectId - Project ID
 * @returns {Object} Supabase row format
 */
function toSupabaseEquipment(equipment, projectId) {
  return {
    id: equipment.id,
    project_id: projectId,
    name: equipment.name || '',
    description: equipment.description || '',
    is_active: equipment.isActive ?? true
  };
}

// ============================================================================
// GLOBAL EXPORTS
// ============================================================================
// Make functions globally available (loaded as regular script, not ES module)

window.fromSupabaseProject = fromSupabaseProject;
window.toSupabaseProject = toSupabaseProject;
window.fromSupabaseContractor = fromSupabaseContractor;
window.toSupabaseContractor = toSupabaseContractor;
window.fromSupabaseReport = fromSupabaseReport;
window.toSupabaseReport = toSupabaseReport;
window.fromSupabaseEntry = fromSupabaseEntry;
window.toSupabaseEntry = toSupabaseEntry;
window.fromSupabaseRawCapture = fromSupabaseRawCapture;
window.toSupabaseRawCapture = toSupabaseRawCapture;
window.fromSupabaseAIResponse = fromSupabaseAIResponse;
window.toSupabaseAIResponse = toSupabaseAIResponse;
window.fromSupabaseFinal = fromSupabaseFinal;
window.toSupabaseFinal = toSupabaseFinal;
window.fromSupabasePhoto = fromSupabasePhoto;
window.toSupabasePhoto = toSupabasePhoto;
window.fromSupabaseEquipment = fromSupabaseEquipment;
window.toSupabaseEquipment = toSupabaseEquipment;
window.fromSupabaseUserProfile = fromSupabaseUserProfile;
window.toSupabaseUserProfile = toSupabaseUserProfile;
