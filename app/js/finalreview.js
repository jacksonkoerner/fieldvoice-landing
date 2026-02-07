// FieldVoice Pro - Final Review Page Logic
// DOT RPR Daily Report viewer with print-optimized layout
// v6.6.5: Now supports editable text fields with auto-save to localStorage

// ============ STATE ============
let report = null;
let currentReportId = null; // Supabase report ID
let activeProject = null;
let projectContractors = [];
let userSettings = null;
let userEdits = {}; // Track user edits separately (v6.6.5)
let saveTimeout = null; // For debounced auto-save (v6.6.5)

// ============ INITIALIZATION ============
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await loadActiveProject();
        await loadUserSettings();
        report = await loadReport();

        if (!report) {
            alert('No report found for this date.');
            window.location.href = 'index.html';
            return;
        }

        // Initialize userEdits from loaded report (v6.6.5)
        userEdits = report.userEdits || {};

        populateReport();
        updateTotalPages();
        checkSubmittedState();
        checkEmptyFields();

        // Setup auto-save listeners for editable fields (v6.6.5)
        setupAutoSave();

        // Initialize auto-resize for textareas (v6.6.5)
        initAutoResize();
    } catch (err) {
        console.error('Failed to initialize:', err);
        alert('Failed to load report data. Please try again.');
    }
});

// ============ CHECK SUBMITTED STATE ============
function checkSubmittedState() {
    if (report && report.meta && report.meta.submitted) {
        const submitBtn = document.querySelector('.btn-submit');
        if (submitBtn) {
            submitBtn.innerHTML = '<i class="fas fa-check"></i><span>Submitted</span>';
            submitBtn.disabled = true;
            submitBtn.style.opacity = '0.7';
            submitBtn.style.cursor = 'default';
        }
    }
}

// ============ PROJECT LOADING ============
async function loadActiveProject() {
    const activeId = getStorageItem(STORAGE_KEYS.ACTIVE_PROJECT_ID);
    if (!activeId) {
        console.log('[SUPABASE] No active project ID found in localStorage');
        return null;
    }

    try {
        // Fetch project from Supabase
        const { data: projectRow, error: projectError } = await supabaseClient
            .from('projects')
            .select('*')
            .eq('id', activeId)
            .single();

        if (projectError) {
            console.error('[SUPABASE] Error fetching project:', projectError);
            return null;
        }

        activeProject = fromSupabaseProject(projectRow);

        // Fetch contractors for this project
        const { data: contractorRows, error: contractorError } = await supabaseClient
            .from('contractors')
            .select('*')
            .eq('project_id', activeId);

        if (!contractorError && contractorRows) {
            activeProject.contractors = contractorRows.map(fromSupabaseContractor);
            // Sort contractors: prime first
            projectContractors = [...activeProject.contractors].sort((a, b) => {
                if (a.type === 'prime' && b.type !== 'prime') return -1;
                if (a.type !== 'prime' && b.type === 'prime') return 1;
                return 0;
            });
        } else {
            projectContractors = [];
        }

        console.log('[SUPABASE] Loaded project:', activeProject.projectName);
        return activeProject;
    } catch (e) {
        console.error('[SUPABASE] Failed to load project:', e);
        return null;
    }
}

// ============ USER SETTINGS LOADING ============
async function loadUserSettings() {
    try {
        const { data, error } = await supabaseClient
            .from('user_profiles')
            .select('*')
            .limit(1)
            .single();

        if (error) {
            console.log('[SUPABASE] No user settings found:', error.message);
            return null;
        }

        userSettings = {
            fullName: data.full_name || '',
            company: data.company || '',
            title: data.title || '',
            email: data.email || '',
            phone: data.phone || ''
        };

        console.log('[SUPABASE] Loaded user settings');
        return userSettings;
    } catch (e) {
        console.error('[SUPABASE] Failed to load user settings:', e);
        return null;
    }
}

// ============ REPORT LOADING ============
function getReportDateStr() {
    const params = new URLSearchParams(window.location.search);
    const dateParam = params.get('date');
    return dateParam || new Date().toISOString().split('T')[0];
}

async function loadReport() {
    // Clear any stale report ID before loading
    currentReportId = null;

    const params = new URLSearchParams(window.location.search);
    const reportIdParam = params.get('reportId');
    const reportDateStr = getReportDateStr();

    // v6.6.2: Load from localStorage (same source as report.html)
    // This ensures userEdits made on report.html are available here
    if (!reportIdParam) {
        console.error('[FINAL] No reportId in URL params');
        return null;
    }

    // Load from localStorage using getReportData from storage-keys.js
    const reportData = getReportData(reportIdParam);

    if (!reportData) {
        console.error('[FINAL] No report data found in localStorage for:', reportIdParam);
        return null;
    }

    console.log('[FINAL] Loaded report from localStorage:', reportIdParam);

    // Store the report ID
    currentReportId = reportIdParam;

    // Extract data from localStorage structure
    const aiPayload = reportData.aiGenerated || {};
    const originalInput = reportData.originalInput || {};

    // Build the report object matching the expected structure
    const loadedReport = {
        overview: {
            projectName: activeProject?.projectName || '',
            noabProjectNo: activeProject?.noabProjectNo || '',
            date: reportData.reportDate || reportDateStr,
            startTime: originalInput.startTime || activeProject?.defaultStartTime || '',
            endTime: originalInput.endTime || activeProject?.defaultEndTime || '',
            completedBy: userSettings?.fullName || '',
            weather: originalInput.weather || {},
            location: activeProject?.location || '',
            cnoSolicitationNo: activeProject?.cnoSolicitationNo || 'N/A',
            engineer: activeProject?.engineer || '',
            contractor: activeProject?.primeContractor || '',
            contractDay: calculateContractDay(activeProject?.noticeToProceed, reportData.reportDate || reportDateStr),
            weatherDays: activeProject?.weatherDays || 0
        },
        meta: {
            status: reportData.status || 'refined',
            submitted: reportData.status === 'submitted',
            submittedAt: null,
            createdAt: reportData.createdAt,
            updatedAt: reportData.lastSaved
        },
        activities: [],
        operations: [],
        equipment: [],
        photos: [],
        aiGenerated: {},
        userEdits: reportData.userEdits || {},
        originalInput: originalInput,
        fieldNotes: originalInput.transcript || '',
        guidedNotes: originalInput.guidedNotes || {},
        issues: '',
        communications: '',
        qaqc: '',
        visitors: '',
        safety: { hasIncident: false, notes: '' }
    };

    // Process AI-generated content if available
    if (aiPayload) {
        // v6.6: Support both old and new field names for backwards compatibility
        loadedReport.aiGenerated = {
            activities: aiPayload.activities || [],
            operations: aiPayload.operations || [],
            equipment: aiPayload.equipment || [],
            // v6.6: Support both old (generalIssues) and new (issues_delays) field names
            issues_delays: aiPayload.issues_delays || aiPayload.generalIssues || [],
            qaqc_notes: aiPayload.qaqc_notes || aiPayload.qaqcNotes || [],
            safety: aiPayload.safety || { has_incidents: false, hasIncidents: false, noIncidents: true, summary: '', notes: '' },
            communications: aiPayload.communications || aiPayload.contractorCommunications || '',
            visitors_deliveries: aiPayload.visitors_deliveries || aiPayload.visitorsRemarks || '',
            // v6.6: New fields
            executive_summary: aiPayload.executive_summary || '',
            work_performed: aiPayload.work_performed || '',
            inspector_notes: aiPayload.inspector_notes || '',
            extraction_confidence: aiPayload.extraction_confidence || 'high',
            missing_data_flags: aiPayload.missing_data_flags || []
        };

        console.log('[FINAL] Loaded AI data from localStorage:', loadedReport.aiGenerated);

        // Copy AI text sections to report for easy access
        // v6.6: Handle both old and new field names
        const issuesData = aiPayload.issues_delays || aiPayload.generalIssues;
        if (Array.isArray(issuesData)) {
            loadedReport.issues = issuesData.join('\n');
        } else {
            loadedReport.issues = issuesData || '';
        }

        loadedReport.communications = aiPayload.communications || aiPayload.contractorCommunications || '';

        // Handle both array and string formats for qaqc
        const qaqcData = aiPayload.qaqc_notes || aiPayload.qaqcNotes;
        if (Array.isArray(qaqcData)) {
            loadedReport.qaqc = qaqcData.join('\n');
        } else {
            loadedReport.qaqc = qaqcData || '';
        }

        loadedReport.visitors = aiPayload.visitors_deliveries || aiPayload.visitorsRemarks || '';

        // Safety - handle different property names (has_incidents vs hasIncidents vs hasIncident)
        if (aiPayload.safety) {
            // v6.6: Support new safety.summary field alongside old safety.notes
            const safetyNotes = aiPayload.safety.summary ||
                (Array.isArray(aiPayload.safety.notes) ? aiPayload.safety.notes.join('\n') : (aiPayload.safety.notes || ''));
            loadedReport.safety = {
                hasIncident: aiPayload.safety.has_incidents || aiPayload.safety.hasIncidents || aiPayload.safety.hasIncident || false,
                noIncidents: aiPayload.safety.noIncidents || !aiPayload.safety.has_incidents || false,
                notes: safetyNotes
            };
        }
    }

    // Process photos from originalInput (these have URLs from Supabase storage)
    if (originalInput.photos && originalInput.photos.length > 0) {
        loadedReport.photos = originalInput.photos.map(photo => ({
            id: photo.id || '',
            url: photo.url || '',
            storagePath: photo.storagePath || '',
            fileName: photo.fileName || '',
            caption: photo.caption || '',
            date: photo.date || '',
            time: photo.time || '',
            gps: photo.gps || null
        }));
    }

    console.log('[FINAL] Report loaded with userEdits:', Object.keys(loadedReport.userEdits));
    return loadedReport;
}

function calculateContractDay(noticeToProceed, reportDate) {
    if (!noticeToProceed || !reportDate) return '';
    try {
        const ntpDate = new Date(noticeToProceed);
        const repDate = new Date(reportDate);
        const diffTime = repDate - ntpDate;
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;
        return diffDays > 0 ? diffDays : '';
    } catch (e) {
        return '';
    }
}

// ============ POPULATE REPORT ============
function populateReport() {
    const o = report.overview || {};
    const ai = report.aiGenerated || {};
    const userEdits = report.userEdits || {};

    // v6.6.4: Debug logging for userEdits
    console.log('[FINAL] populateReport() - userEdits keys:', Object.keys(userEdits));
    console.log('[FINAL] populateReport() - userEdits object:', JSON.stringify(userEdits, null, 2).substring(0, 500));

    // Helper to get value with priority
    function getValue(path, defaultVal = '') {
        if (userEdits[path] !== undefined) {
            console.log('[FINAL] getValue() - Using userEdit for', path, ':', userEdits[path]);
            return userEdits[path];
        }
        const aiVal = getNestedValue(ai, path);
        if (aiVal !== undefined && aiVal !== null && aiVal !== '') {
            if (Array.isArray(aiVal)) return aiVal.join('\n');
            return aiVal;
        }
        const reportVal = getNestedValue(report, path);
        if (reportVal !== undefined && reportVal !== null && reportVal !== '') {
            if (Array.isArray(reportVal)) return reportVal.join('\n');
            return reportVal;
        }
        return defaultVal;
    }

    function getNestedValue(obj, path) {
        return path.split('.').reduce((o, k) => (o || {})[k], obj);
    }

    // Update header date
    document.getElementById('headerDate').textContent = formatDisplayDate(o.date);

    // Project Overview
    document.getElementById('projectName').textContent = getValue('overview.projectName', activeProject?.projectName || '');
    document.getElementById('reportDate').textContent = formatDisplayDate(o.date);
    document.getElementById('noabProjectNo').textContent = getValue('overview.noabProjectNo', activeProject?.noabProjectNo || '');
    document.getElementById('location').textContent = getValue('overview.location', activeProject?.location || '');
    document.getElementById('cnoSolicitationNo').textContent = getValue('overview.cnoSolicitationNo', activeProject?.cnoSolicitationNo || 'N/A');
    document.getElementById('engineer').textContent = getValue('overview.engineer', activeProject?.engineer || '');

    // Notice to Proceed
    const ntpDate = activeProject?.noticeToProceed;
    document.getElementById('noticeToProceed').textContent = ntpDate ? formatDisplayDate(ntpDate) : '';

    document.getElementById('contractor').textContent = getValue('overview.contractor', activeProject?.primeContractor || '');

    // Contract Duration
    const duration = activeProject?.contractDuration;
    document.getElementById('contractDuration').textContent = duration ? `${duration} days` : '';

    // Times
    document.getElementById('startTime').textContent = formatTimeLocal(getValue('overview.startTime', activeProject?.defaultStartTime || ''));
    document.getElementById('endTime').textContent = formatTimeLocal(getValue('overview.endTime', activeProject?.defaultEndTime || ''));

    // Expected Completion
    const expectedDate = activeProject?.expectedCompletion;
    document.getElementById('expectedCompletion').textContent = expectedDate ? formatDisplayDate(expectedDate) : '';

    // Shift Duration
    const startTime = getValue('overview.startTime', activeProject?.defaultStartTime || '');
    const endTime = getValue('overview.endTime', activeProject?.defaultEndTime || '');
    document.getElementById('shiftDuration').textContent = calculateShiftDuration(startTime, endTime);

    // Contract Day
    const contractDay = getValue('overview.contractDay', '');
    if (contractDay && duration) {
        document.getElementById('contractDay').textContent = `${contractDay} of ${duration} days`;
    } else {
        document.getElementById('contractDay').textContent = contractDay;
    }

    // Weather Days
    document.getElementById('weatherDays').textContent = getValue('overview.weatherDays', activeProject?.weatherDays || '0') + ' days';

    // Completed By
    document.getElementById('completedBy').textContent = getValue('overview.completedBy', '');

    // Weather
    const weather = o.weather || {};
    document.getElementById('weatherTemps').textContent = `High Temp: ${weather.highTemp || 'N/A'}° Low Temp: ${weather.lowTemp || 'N/A'}°`;
    document.getElementById('weatherPrecip').textContent = `Precipitation: ${weather.precipitation || '0.00"'}`;
    document.getElementById('weatherCondition').textContent = `General Condition: ${weather.generalCondition || 'N/A'}`;
    document.getElementById('weatherJobSite').textContent = `Job Site Condition: ${weather.jobSiteCondition || 'N/A'}`;
    document.getElementById('weatherAdverse').textContent = `Adverse Conditions: ${weather.adverseConditions || 'N/A'}`;

    // Signature
    const sigName = getValue('signature.name', getValue('overview.completedBy', ''));
    const sigTitle = getValue('signature.title', '');
    const sigCompany = getValue('signature.company', '');
    document.getElementById('signatureName').textContent = sigName;

    let sigDetails = '';
    if (sigTitle || sigCompany) {
        sigDetails = `Digitally signed by ${sigName}\nDN: cn=${sigName}, c=US,\no=${sigCompany}, ou=${sigTitle},\nemail=${sigName.toLowerCase().replace(/\s/g, '')}@${sigCompany.toLowerCase().replace(/\s/g, '')}.com\nDate: ${new Date().toISOString().split('T')[0]}`;
    }
    document.getElementById('signatureDetails').innerHTML = sigDetails.replace(/\n/g, '<br>');

    // Render dynamic sections
    renderWorkSummary();
    renderOperationsTable();
    renderEquipmentTable();
    renderTextSections();
    renderSafetySection();
    renderPhotos();
    renderLogo();
}

// ============ LOGO RENDERING ============
function renderLogo() {
    // Check if activeProject has a logo
    // Priority: logoUrl (full quality) > logoThumbnail (compressed) > logo (legacy)
    const logoSrc = activeProject?.logoUrl || activeProject?.logoThumbnail || activeProject?.logo;

    if (logoSrc) {
        // Update all logo containers across all pages
        const logoContainers = [
            { placeholder: 'logoPlaceholder', image: 'logoImage' },
            { placeholder: 'logoPlaceholder2', image: 'logoImage2' },
            { placeholder: 'logoPlaceholder3', image: 'logoImage3' },
            { placeholder: 'logoPlaceholder4', image: 'logoImage4' }
        ];

        logoContainers.forEach(container => {
            const placeholder = document.getElementById(container.placeholder);
            const image = document.getElementById(container.image);

            if (placeholder && image) {
                placeholder.style.display = 'none';
                image.src = logoSrc;
                image.style.display = 'block';
            }
        });
    }
}

// ============ WORK SUMMARY ============
function renderWorkSummary() {
    const container = document.getElementById('workSummaryContent');

    if (projectContractors.length === 0) {
        // No contractors - show general work summary with editable textarea (v6.6.5)
        const workText = getTextValue('guidedNotes.workSummary', 'issues', 'generalIssues', '');
        container.innerHTML = createEditableTextarea('guidedNotes.workSummary', workText, 'Enter work summary...');
        return;
    }

    // v6.6.5: Render contractor blocks with editable textareas
    let html = '';
    projectContractors.forEach(contractor => {
        const activity = getContractorActivity(contractor.id);
        const typeLabel = contractor.type === 'prime' ? 'PRIME CONTRACTOR' : 'SUBCONTRACTOR';
        const trades = contractor.trades ? ` (${contractor.trades.toUpperCase()})` : '';
        const activityPath = `activity_${contractor.id}`;

        html += `<div class="contractor-block" style="margin-bottom: 16px;">`;
        html += `<div class="contractor-name" style="font-weight: bold; margin-bottom: 8px;">${escapeHtml(contractor.name)} – ${typeLabel}${trades}</div>`;

        // Narrative - editable textarea
        const narrative = activity?.narrative || '';
        html += `<div class="contractor-narrative-container" style="margin-bottom: 8px;">
            <textarea
                class="editable-field contractor-narrative"
                data-path="${activityPath}.narrative"
                data-contractor-id="${contractor.id}"
                placeholder="Describe work performed by ${escapeHtml(contractor.name)}..."
            >${escapeHtml(narrative)}</textarea>
        </div>`;

        // Equipment and Crew - editable textareas
        const equipment = activity?.equipmentUsed || '';
        const crew = activity?.crew || '';
        html += `<div class="contractor-details-container" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
            <div>
                <label style="font-size: 8pt; font-weight: bold; color: #666; text-transform: uppercase;">Equipment</label>
                <textarea
                    class="editable-field contractor-equipment"
                    data-path="${activityPath}.equipmentUsed"
                    data-contractor-id="${contractor.id}"
                    placeholder="Equipment used..."
                >${escapeHtml(equipment)}</textarea>
            </div>
            <div>
                <label style="font-size: 8pt; font-weight: bold; color: #666; text-transform: uppercase;">Crew</label>
                <textarea
                    class="editable-field contractor-crew"
                    data-path="${activityPath}.crew"
                    data-contractor-id="${contractor.id}"
                    placeholder="Crew count/description..."
                >${escapeHtml(crew)}</textarea>
            </div>
        </div>`;

        html += `</div>`;
    });

    container.innerHTML = html;
}

/**
 * v6.6: Supports matching by contractorName for freeform mode (when contractorId is null)
 * v6.6.4: Added debug logging
 */
function getContractorActivity(contractorId) {
    const userEdits = report.userEdits || {};
    const userEditKey = `activity_${contractorId}`;
    if (userEdits[userEditKey]) {
        console.log('[FINAL] getContractorActivity() - Using userEdit for', userEditKey);
        return userEdits[userEditKey];
    }
    console.log('[FINAL] getContractorActivity() - No userEdit for', userEditKey, ', checking AI');

    // Get contractor name for freeform matching
    const contractor = projectContractors.find(c => c.id === contractorId);
    const contractorName = contractor?.name;

    if (report.aiGenerated?.activities) {
        // Try matching by contractorId first (guided mode)
        let aiActivity = report.aiGenerated.activities.find(a => a.contractorId === contractorId);
        
        // v6.6: Fallback to name matching for freeform mode (where contractorId is null)
        if (!aiActivity && contractorName) {
            aiActivity = report.aiGenerated.activities.find(a => 
                a.contractorId === null && 
                a.contractorName?.toLowerCase() === contractorName.toLowerCase()
            );
        }
        
        if (aiActivity) return aiActivity;
    }

    if (report.activities) {
        return report.activities.find(a => a.contractorId === contractorId);
    }
    return null;
}

// ============ OPERATIONS TABLE ============
function renderOperationsTable() {
    const tbody = document.getElementById('operationsTableBody');

    if (projectContractors.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:#666;">No contractors defined</td></tr>`;
        return;
    }

    let html = '';
    projectContractors.forEach(contractor => {
        const ops = getContractorOperations(contractor.id);
        const abbrev = contractor.abbreviation || contractor.name.substring(0, 10).toUpperCase();
        const trades = formatTradesAbbrev(contractor.trades);
        const opsPath = `operations_${contractor.id}`;

        // Create editable input for each personnel field
        const createEditableCell = (field, value) => {
            const displayVal = value || '';
            return `<input type="text"
                class="editable-cell"
                data-path="${opsPath}.${field}"
                data-contractor-id="${contractor.id}"
                value="${escapeHtml(displayVal)}"
                placeholder="--">`;
        };

        html += `<tr>
            <td>${escapeHtml(abbrev)}</td>
            <td>${escapeHtml(trades)}</td>
            <td>${createEditableCell('superintendents', ops?.superintendents)}</td>
            <td>${createEditableCell('foremen', ops?.foremen)}</td>
            <td>${createEditableCell('operators', ops?.operators)}</td>
            <td>${createEditableCell('laborers', ops?.laborers)}</td>
            <td>${createEditableCell('surveyors', ops?.surveyors)}</td>
            <td>${createEditableCell('others', ops?.others)}</td>
        </tr>`;
    });

    tbody.innerHTML = html;
}

/**
 * v6.6: Supports matching by contractorName for freeform mode (when contractorId is null)
 */
function getContractorOperations(contractorId) {
    const userEdits = report.userEdits || {};
    const userEditKey = `operations_${contractorId}`;
    if (userEdits[userEditKey]) return userEdits[userEditKey];

    // Get contractor name for freeform matching
    const contractor = projectContractors.find(c => c.id === contractorId);
    const contractorName = contractor?.name;

    if (report.aiGenerated?.operations) {
        // Try matching by contractorId first (guided mode)
        let aiOps = report.aiGenerated.operations.find(o => o.contractorId === contractorId);
        
        // v6.6: Fallback to name matching for freeform mode (where contractorId is null)
        if (!aiOps && contractorName) {
            aiOps = report.aiGenerated.operations.find(o => 
                o.contractorId === null && 
                o.contractorName?.toLowerCase() === contractorName.toLowerCase()
            );
        }
        
        if (aiOps) return aiOps;
    }

    if (report.operations) {
        return report.operations.find(o => o.contractorId === contractorId);
    }
    return null;
}

function formatTradesAbbrev(trades) {
    if (!trades) return '-';
    // Common trade abbreviations
    const abbrevMap = {
        'construction management': 'CM',
        'project management': 'PM',
        'pile driving': 'PLE',
        'concrete': 'CONC',
        'asphalt': 'ASP',
        'utilities': 'UTL',
        'earthwork': 'ERTHWRK',
        'electrical': 'ELEC',
        'communications': 'COMM',
        'fence': 'FENCE',
        'pavement markings': 'PVMNT MRK',
        'hauling': 'HAUL',
        'pavement subgrade': 'PVMT SUB',
        'demo': 'DEMO',
        'demolition': 'DEMO',
        'general': 'GEN'
    };

    const parts = trades.split(/[;,]/).map(t => t.trim().toLowerCase());
    const abbrevs = parts.map(t => abbrevMap[t] || t.substring(0, 6).toUpperCase());
    return abbrevs.join('; ');
}

// ============ EQUIPMENT TABLE ============
function renderEquipmentTable() {
    const tbody = document.getElementById('equipmentTableBody');
    const equipmentData = getEquipmentData();

    if (equipmentData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#666;">No equipment mobilized</td></tr>`;
        return;
    }

    let html = '';
    equipmentData.forEach((item, index) => {
        // v6.6: Pass contractorName fallback for freeform mode
        const contractorName = getContractorName(item.contractorId, item.contractorName);
        // v6.6.6: Improved equipment notes parsing
        const notes = formatEquipmentNotes(item.status, item.hoursUsed);
        const equipPath = `equipment_${index}`;

        html += `<tr>
            <td>${escapeHtml(contractorName)}</td>
            <td><input type="text"
                class="editable-cell"
                data-path="${equipPath}.type"
                data-equipment-index="${index}"
                value="${escapeHtml(item.type || '')}"
                placeholder="Equipment type..."></td>
            <td><input type="text"
                class="editable-cell"
                data-path="${equipPath}.qty"
                data-equipment-index="${index}"
                value="${item.qty || 1}"
                placeholder="1"
                style="width: 40px;"></td>
            <td><input type="text"
                class="editable-cell"
                data-path="${equipPath}.notes"
                data-equipment-index="${index}"
                value="${escapeHtml(notes)}"
                placeholder="Notes..."></td>
        </tr>`;
    });

    tbody.innerHTML = html;
}

/**
 * v6.6.6: Format equipment notes column properly
 * Shows "IDLE" when idle, "X HRS UTILIZED" when has hours
 */
function formatEquipmentNotes(status, hoursUsed) {
    // Check for explicit idle status
    if (!status || status.toLowerCase() === 'idle' || status === '0' || status === '0 hrs') {
        return 'IDLE';
    }
    
    // Extract hours from various formats
    let hours = hoursUsed;
    if (!hours && status) {
        // Try to extract number from status string (e.g., "8 hrs", "8", "8 hours")
        const match = status.match(/(\d+(?:\.\d+)?)/);
        if (match) {
            hours = parseFloat(match[1]);
        }
    }
    
    if (hours && hours > 0) {
        return `${hours} HRS UTILIZED`;
    }
    
    return 'IDLE';
}

/**
 * v6.6: Supports resolving contractorId from contractorName for freeform mode
 */
function getEquipmentData() {
    if (report.equipment && report.equipment.length > 0) {
        return report.equipment;
    }
    if (report.aiGenerated?.equipment && report.aiGenerated.equipment.length > 0) {
        return report.aiGenerated.equipment.map(item => {
            // v6.6: Resolve contractorId from contractorName for freeform mode
            let contractorId = item.contractorId || '';
            if (!contractorId && item.contractorName) {
                const matchedContractor = projectContractors.find(c => 
                    c.name?.toLowerCase() === item.contractorName?.toLowerCase()
                );
                if (matchedContractor) {
                    contractorId = matchedContractor.id;
                }
            }
            
            return {
                contractorId: contractorId,
                contractorName: item.contractorName || '',
                type: item.type || '',
                qty: item.qty || item.quantity || 1,
                status: item.status || (item.hoursUsed ? `${item.hoursUsed} hrs` : 'IDLE')
            };
        });
    }
    return [];
}

/**
 * v6.6: Updated to support contractorName fallback for freeform mode
 */
function getContractorName(contractorId, contractorNameFallback = null) {
    const contractor = projectContractors.find(c => c.id === contractorId);
    if (contractor) {
        return contractor.abbreviation || contractor.name.substring(0, 15).toUpperCase();
    }
    // v6.6: Use contractorName from AI response if no matching contractor found
    if (contractorNameFallback) {
        return contractorNameFallback.substring(0, 15).toUpperCase();
    }
    return 'UNKNOWN';
}

// ============ TEXT SECTIONS ============
function renderTextSections() {
    // v6.6: Updated to use new field names with fallback to old names
    // v6.6.5: Now renders editable textareas instead of static HTML

    // Issues
    const issues = getTextValueWithFallback('issues', 'issues_delays', 'generalIssues', 'guidedNotes.issues', '');
    document.getElementById('issuesContent').innerHTML = createEditableTextarea('issues', issues, 'Enter issues/delays...');

    // Communications
    const comms = getTextValueWithFallback('communications', 'communications', 'contractorCommunications', '', '');
    document.getElementById('communicationsContent').innerHTML = createEditableTextarea('communications', comms, 'Enter communications...');

    // QA/QC
    const qaqc = getTextValueWithFallback('qaqc', 'qaqc_notes', 'qaqcNotes', '', '');
    document.getElementById('qaqcContent').innerHTML = createEditableTextarea('qaqc', qaqc, 'Enter QA/QC notes...');

    // Visitors
    const visitors = getTextValueWithFallback('visitors', 'visitors_deliveries', 'visitorsRemarks', '', '');
    document.getElementById('visitorsContent').innerHTML = createEditableTextarea('visitors', visitors, 'Enter visitors/deliveries...');
}

/**
 * v6.6.5: Create an editable textarea for text sections
 */
function createEditableTextarea(path, value, placeholder) {
    const escapedValue = escapeHtml(value || '');
    return `<textarea
        class="editable-field"
        data-path="${path}"
        placeholder="${placeholder}"
    >${escapedValue}</textarea>`;
}

/**
 * v6.6: Get text value with support for both new and legacy AI field names
 * v6.6.4: Added debug logging
 */
function getTextValueWithFallback(reportPath, aiPath, legacyAiPath, fallbackPath, defaultVal) {
    const userEdits = report.userEdits || {};

    // User edits first
    if (userEdits[reportPath] !== undefined) {
        console.log('[FINAL] getTextValueWithFallback() - Using userEdit for', reportPath, ':', userEdits[reportPath]);
        return userEdits[reportPath];
    }
    console.log('[FINAL] getTextValueWithFallback() - No userEdit for', reportPath, ', checking AI/fallback');

    // AI generated - try new field name first, then legacy
    if (report.aiGenerated) {
        let aiVal = getNestedValueSimple(report.aiGenerated, aiPath);
        if ((aiVal === undefined || aiVal === null || aiVal === '') && legacyAiPath) {
            aiVal = getNestedValueSimple(report.aiGenerated, legacyAiPath);
        }
        if (aiVal !== undefined && aiVal !== null && aiVal !== '') {
            if (Array.isArray(aiVal)) return aiVal.join('\n');
            return aiVal;
        }
    }

    // Report value
    const reportVal = getNestedValueSimple(report, reportPath);
    if (reportVal !== undefined && reportVal !== null && reportVal !== '') {
        if (Array.isArray(reportVal)) return reportVal.join('\n');
        return reportVal;
    }

    // Fallback path
    if (fallbackPath) {
        const fallbackVal = getNestedValueSimple(report, fallbackPath);
        if (fallbackVal !== undefined && fallbackVal !== null && fallbackVal !== '') {
            if (Array.isArray(fallbackVal)) return fallbackVal.join('\n');
            return fallbackVal;
        }
    }

    return defaultVal;
}

function getTextValue(reportPath, aiPath, fallbackPath, defaultVal) {
    const userEdits = report.userEdits || {};

    // User edits first
    if (userEdits[reportPath] !== undefined) {
        console.log('[FINAL] getTextValue() - Using userEdit for', reportPath, ':', userEdits[reportPath]);
        return userEdits[reportPath];
    }
    console.log('[FINAL] getTextValue() - No userEdit for', reportPath, ', checking AI/fallback');

    // AI generated
    if (report.aiGenerated) {
        const aiVal = getNestedValueSimple(report.aiGenerated, aiPath);
        if (aiVal !== undefined && aiVal !== null && aiVal !== '') {
            if (Array.isArray(aiVal)) return aiVal.join('\n');
            return aiVal;
        }
    }

    // Report value
    const reportVal = getNestedValueSimple(report, reportPath);
    if (reportVal !== undefined && reportVal !== null && reportVal !== '') {
        if (Array.isArray(reportVal)) return reportVal.join('\n');
        return reportVal;
    }

    // Fallback path
    if (fallbackPath) {
        const fallbackVal = getNestedValueSimple(report, fallbackPath);
        if (fallbackVal !== undefined && fallbackVal !== null && fallbackVal !== '') {
            if (Array.isArray(fallbackVal)) return fallbackVal.join('\n');
            return fallbackVal;
        }
    }

    return defaultVal;
}

function getNestedValueSimple(obj, path) {
    return path.split('.').reduce((o, k) => (o || {})[k], obj);
}

function formatTextSection(text) {
    if (!text || text.trim() === '') {
        return '<ul><li class="na-text">N/A.</li></ul>';
    }

    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length === 0) {
        return '<ul><li class="na-text">N/A.</li></ul>';
    }

    if (lines.length === 1) {
        return `<ul><li>${escapeHtml(lines[0])}</li></ul>`;
    }

    return '<ul>' + lines.map(line => `<li>${escapeHtml(line)}</li>`).join('') + '</ul>';
}

// ============ SAFETY SECTION ============
function renderSafetySection() {
    // v6.6: Support both old (hasIncidents) and new (has_incidents) field names
    const hasIncident = report.safety?.hasIncident ||
                        report.aiGenerated?.safety?.has_incidents ||
                        report.aiGenerated?.safety?.hasIncidents ||
                        false;
    const noIncident = !hasIncident;

    document.getElementById('checkYes').textContent = hasIncident ? 'X' : '';
    document.getElementById('checkYes').classList.toggle('checked', hasIncident);
    document.getElementById('checkNo').textContent = noIncident ? 'X' : '';
    document.getElementById('checkNo').classList.toggle('checked', noIncident);

    // v6.6: Support both old (safety.notes) and new (safety.summary) field names
    // v6.6.5: Now renders editable textarea instead of static HTML
    const safetyNotes = getTextValueWithFallback('safety.notes', 'safety.summary', 'safety.notes', 'guidedNotes.safety', '');
    document.getElementById('safetyContent').innerHTML = createEditableTextarea('safety.notes', safetyNotes, 'Enter safety observations...');
}

// ============ PHOTOS ============
function renderPhotos() {
    const photos = report.photos || [];
    const grid = document.getElementById('photosGrid');
    const projectName = report.overview?.projectName || activeProject?.projectName || '';
    const projectNo = report.overview?.noabProjectNo || activeProject?.noabProjectNo || '';

    document.getElementById('photoProjectName').textContent = projectName;
    document.getElementById('photoProjectNo').textContent = projectNo;

    // v6.6.6: Only render cells for actual photos, single message when empty
    if (photos.length === 0) {
        grid.innerHTML = `
            <div class="photo-cell no-photos-message" style="grid-column: 1 / -1; text-align: center; min-height: 100px; display: flex; align-items: center; justify-content: center;">
                <p style="color: #666; font-style: italic;">No photos documented for this date.</p>
            </div>
        `;
        return;
    }

    // Generate photo cells only for actual photos (no empty cells)
    // v6.6.5: Photo captions are now editable textareas
    let html = '';
    const displayPhotos = photos.slice(0, 4); // First 4 photos for page 4

    displayPhotos.forEach((photo, i) => {
        html += `
            <div class="photo-cell">
                <div class="photo-image">
                    <img src="${photo.url}" alt="Photo ${i + 1}">
                </div>
                <div class="photo-meta"><span>Date:</span> ${photo.date || formatDisplayDate(report.overview?.date)}</div>
                <textarea
                    class="editable-field photo-caption"
                    data-path="photos[${i}].caption"
                    data-photo-index="${i}"
                    placeholder="Add caption..."
                >${escapeHtml(photo.caption || '')}</textarea>
            </div>
        `;
    });

    grid.innerHTML = html;

    // If more than 4 photos, add additional photo pages
    if (photos.length > 4) {
        addAdditionalPhotoPages(photos.slice(4));
    }
}

function addAdditionalPhotoPages(remainingPhotos) {
    const container = document.querySelector('.page-container');
    let pageNum = 5;

    for (let i = 0; i < remainingPhotos.length; i += 4) {
        const pagePhotos = remainingPhotos.slice(i, i + 4);
        const page = document.createElement('div');
        page.className = 'page' + (i + 4 < remainingPhotos.length ? ' page-break' : '');

        // v6.6.6: Only render actual photos, no empty cells
        let photosHtml = '';
        pagePhotos.forEach((photo, j) => {
            const photoIndex = 4 + i + j; // Actual index in photos array (first 4 are on page 4)
            photosHtml += `
                <div class="photo-cell">
                    <div class="photo-image">
                        <img src="${photo.url}" alt="Photo">
                    </div>
                    <div class="photo-meta"><span>Date:</span> ${photo.date || formatDisplayDate(report.overview?.date)}</div>
                    <textarea
                        class="editable-field photo-caption"
                        data-path="photos[${photoIndex}].caption"
                        data-photo-index="${photoIndex}"
                        placeholder="Add caption..."
                    >${escapeHtml(photo.caption || '')}</textarea>
                </div>
            `;
        });

        // Determine logo HTML based on whether project has a logo
        // Priority: logoUrl (full quality) > logoThumbnail (compressed) > logo (legacy)
        const logoSrc = activeProject?.logoUrl || activeProject?.logoThumbnail || activeProject?.logo;
        const logoHtml = logoSrc
            ? `<img src="${logoSrc}" class="report-logo" alt="Project Logo">`
            : `<div class="report-logo-placeholder">LOUIS ARMSTRONG<br>NEW ORLEANS<br>INTERNATIONAL AIRPORT</div>`;

        page.innerHTML = `
            <div class="report-header">
                <div>${logoHtml}</div>
                <div class="report-title">RPR DAILY REPORT</div>
            </div>
            <div class="section-header">Daily Photos (Continued)</div>
            <div class="photos-grid">${photosHtml}</div>
            <div class="page-footer">${pageNum} of <span class="total-pages">4</span></div>
        `;

        container.appendChild(page);
        pageNum++;
    }

    updateTotalPages();
}

function updateTotalPages() {
    const pages = document.querySelectorAll('.page');
    const totalPages = pages.length;
    document.querySelectorAll('.total-pages').forEach(el => {
        el.textContent = totalPages;
    });
}

// ============ UTILITY FUNCTIONS ============
function formatDisplayDate(dateStr) {
    if (!dateStr) return 'N/A';
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
    } catch (e) {
        return dateStr;
    }
}

// Local formatTime to avoid conflict with ui-utils.js formatTime
function formatTimeLocal(timeStr) {
    if (!timeStr) return '';
    try {
        // Handle already formatted time (e.g., "6:00 AM")
        if (timeStr.includes('AM') || timeStr.includes('PM')) {
            return timeStr;
        }
        // Handle 24-hour format (e.g., "06:00")
        const parts = timeStr.split(':');
        if (parts.length < 2) return timeStr;
        const hours = parseInt(parts[0], 10);
        const minutes = parseInt(parts[1], 10);
        if (isNaN(hours) || isNaN(minutes)) return timeStr;
        const period = hours >= 12 ? 'PM' : 'AM';
        const displayHours = hours % 12 || 12;
        return `${displayHours}:${String(minutes).padStart(2, '0')} ${period}`;
    } catch (e) {
        return timeStr;
    }
}

function calculateShiftDuration(startTime, endTime) {
    if (!startTime || !endTime) return '';
    try {
        // Handle already formatted times
        let startHours, startMinutes, endHours, endMinutes;

        if (startTime.includes(':')) {
            const startParts = startTime.split(':');
            startHours = parseInt(startParts[0], 10);
            startMinutes = parseInt(startParts[1], 10) || 0;
        } else {
            return '';
        }

        if (endTime.includes(':')) {
            const endParts = endTime.split(':');
            endHours = parseInt(endParts[0], 10);
            endMinutes = parseInt(endParts[1], 10) || 0;
        } else {
            return '';
        }

        if (isNaN(startHours) || isNaN(endHours)) return '';

        let diffMinutes = (endHours * 60 + endMinutes) - (startHours * 60 + startMinutes);
        if (diffMinutes < 0) diffMinutes += 24 * 60; // Handle overnight

        const hours = diffMinutes / 60;
        return `${hours.toFixed(2)} hours`;
    } catch (e) {
        return '';
    }
}

// ============ NAVIGATION ============
function goToEdit() {
    const params = new URLSearchParams(window.location.search);
    const dateParam = params.get('date');
    if (dateParam) {
        window.location.href = `report.html?date=${dateParam}`;
    } else {
        window.location.href = 'report.html';
    }
}

// ============ PDF GENERATION & SUBMIT FLOW ============

/**
 * Main submit function - orchestrates the complete submit flow
 * 1. Check online status
 * 2. Generate PDF from page content
 * 3. Upload PDF to Supabase Storage
 * 4. Save metadata to final_reports table
 * 5. Update reports table status to 'submitted'
 * 6. Clear local storage for this report
 * 7. Navigate to archives with success message
 */
async function submitReport() {
    // 1. Check online status
    if (!navigator.onLine) {
        showError('Cannot submit offline. Please connect to internet.');
        return;
    }

    if (!report) {
        showError('No report data found.');
        return;
    }

    if (!currentReportId) {
        showError('No report ID found. Cannot submit.');
        return;
    }

    // 2. Show loading state
    showSubmitLoading(true);

    try {
        console.log('[SUBMIT] Starting report submission for:', currentReportId);

        // 3. Generate PDF from page content
        console.log('[SUBMIT] Generating PDF...');
        const pdf = await generatePDF();
        console.log('[SUBMIT] PDF generated:', pdf.filename);

        // 4. Upload PDF to Supabase Storage
        console.log('[SUBMIT] Uploading PDF to storage...');
        const pdfUrl = await uploadPDFToStorage(pdf);
        console.log('[SUBMIT] PDF uploaded:', pdfUrl);

        // 5. Ensure report exists in reports table (foreign key requirement)
        console.log('[SUBMIT] Ensuring report exists in reports table...');
        await ensureReportExists();
        console.log('[SUBMIT] Report record ensured');

        // 6. Save metadata to final_reports table
        console.log('[SUBMIT] Saving to final_reports...');
        await saveToFinalReports(pdfUrl);
        console.log('[SUBMIT] Saved to final_reports');

        // 7. Update reports table status to 'submitted'
        console.log('[SUBMIT] Updating report status...');
        await updateReportStatus('submitted', pdfUrl);
        console.log('[SUBMIT] Report status updated');

        // 8. Clear local storage for this report
        console.log('[SUBMIT] Cleaning up local storage...');
        await cleanupLocalStorage();
        console.log('[SUBMIT] Local storage cleaned up');

        // 9. Navigate to archives with success message
        console.log('[SUBMIT] Submit complete, navigating to archives...');
        window.location.href = 'archives.html?submitted=true';

    } catch (error) {
        console.error('[SUBMIT] Error:', error);
        showError('Submit failed: ' + error.message);
        showSubmitLoading(false);
    }
}

/**
 * Generate PDF from the page content using html2pdf.js
 * @returns {Promise<{blob: Blob, filename: string}>}
 */
async function generatePDF() {
    // Get the printable content area (page-container contains all pages)
    const element = document.querySelector('.page-container');

    if (!element) {
        throw new Error('Could not find report content to generate PDF');
    }

    // v6.6.6: Clone the DOM and convert for clean PDF output
    const clonedElement = element.cloneNode(true);
    
    // v6.6.6: Convert contractor blocks to DOT inline format
    clonedElement.querySelectorAll('.contractor-block').forEach(block => {
        const nameEl = block.querySelector('.contractor-name');
        const narrativeEl = block.querySelector('.contractor-narrative');
        const equipmentEl = block.querySelector('.contractor-equipment');
        const crewEl = block.querySelector('.contractor-crew');
        
        const contractorName = nameEl ? nameEl.textContent : '';
        const narrative = narrativeEl ? (narrativeEl.value || narrativeEl.textContent || '').trim() : '';
        const equipment = equipmentEl ? (equipmentEl.value || equipmentEl.textContent || '').trim() : '';
        const crew = crewEl ? (crewEl.value || crewEl.textContent || '').trim() : '';
        
        // Build DOT-style inline format
        let html = `<div class="contractor-name" style="font-weight: bold; text-transform: uppercase; margin-bottom: 4px;">${escapeHtml(contractorName)}</div>`;
        
        if (narrative || equipment || crew) {
            html += `<p style="margin: 0 0 4px 0;">${escapeHtml(narrative) || 'No work performed.'}</p>`;
            
            // Inline equipment and crew
            const details = [];
            if (equipment) details.push(`EQUIPMENT: ${escapeHtml(equipment)}`);
            if (crew) details.push(`CREW: ${escapeHtml(crew)}`);
            
            if (details.length > 0) {
                html += `<p style="margin: 0; font-size: 9pt; text-transform: uppercase;">${details.join('. ')}.</p>`;
            }
        } else {
            html += `<p style="margin: 0;">No work performed on this date.</p>`;
        }
        
        block.innerHTML = html;
    });
    
    // v6.6.6: Convert text sections to bulleted format
    const textSectionIds = ['issuesContent', 'communicationsContent', 'qaqcContent', 'visitorsContent', 'safetyContent'];
    textSectionIds.forEach(sectionId => {
        const section = clonedElement.querySelector(`#${sectionId}`);
        if (!section) return;
        
        const textarea = section.querySelector('textarea');
        if (!textarea) return;
        
        const text = (textarea.value || textarea.textContent || '').trim();
        
        if (!text) {
            section.innerHTML = '<ul><li style="color: #666;">N/A</li></ul>';
            return;
        }
        
        // Split by newlines and create bullet list
        const lines = text.split('\n').filter(line => line.trim());
        if (lines.length === 0) {
            section.innerHTML = '<ul><li style="color: #666;">N/A</li></ul>';
        } else if (lines.length === 1) {
            section.innerHTML = `<ul><li>${escapeHtml(lines[0])}</li></ul>`;
        } else {
            section.innerHTML = '<ul>' + lines.map(line => `<li>• ${escapeHtml(line.replace(/^[•\-\*]\s*/, ''))}</li>`).join('') + '</ul>';
        }
    });
    
    // Convert any remaining textareas/inputs to styled divs (photo captions, table cells, etc.)
    clonedElement.querySelectorAll('textarea, input[type="text"]').forEach(input => {
        const div = document.createElement('div');
        div.className = 'pdf-text-content';
        div.style.cssText = `
            font-family: inherit;
            font-size: inherit;
            line-height: 1.4;
            white-space: pre-wrap;
            word-wrap: break-word;
        `;
        
        const text = input.value || input.textContent || '';
        if (text.trim()) {
            div.textContent = text;
        } else {
            div.innerHTML = '<span style="color: #666;">N/A</span>';
        }
        
        input.parentNode.replaceChild(div, input);
    });
    
    // v6.6.7: Position clone for html2canvas capture
    // Note: html2canvas requires the element to be in the visible viewport
    // We position at 0,0 with fixed position but below the modal overlay
    clonedElement.style.position = 'fixed';
    clonedElement.style.left = '0';
    clonedElement.style.top = '0';
    clonedElement.style.zIndex = '1'; // Below modal overlay (z-index: 1000)
    clonedElement.style.pointerEvents = 'none';
    clonedElement.style.background = '#fff'; // Ensure white background
    document.body.appendChild(clonedElement);

    // Generate filename
    const projectName = getProjectName().replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
    const reportDate = getReportDate();
    const filename = `${projectName}_${reportDate}.pdf`;

    const options = {
        margin: [0.25, 0.25, 0.25, 0.25], // inches - smaller margins for better fit
        filename: filename,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: {
            scale: 2,
            useCORS: true,
            logging: false,
            letterRendering: true,
            allowTaint: true
        },
        jsPDF: {
            unit: 'in',
            format: 'letter',
            orientation: 'portrait'
        },
        pagebreak: {
            mode: ['css'],
            before: '.page-break',
            avoid: ['tr', 'td', '.contractor-block', '.photo-cell']
        }
    };

    // Generate PDF blob from cloned element
    const pdfBlob = await html2pdf()
        .set(options)
        .from(clonedElement)
        .outputPdf('blob');
    
    // Clean up cloned element
    document.body.removeChild(clonedElement);

    return {
        blob: pdfBlob,
        filename: filename
    };
}

/**
 * Upload PDF to Supabase Storage (report-pdfs bucket)
 * @param {Object} pdf - PDF object with blob and filename
 * @returns {Promise<string>} Public URL of the uploaded PDF
 */
async function uploadPDFToStorage(pdf) {
    const storagePath = `${currentReportId}/${pdf.filename}`;

    const { data, error } = await supabaseClient
        .storage
        .from('report-pdfs')
        .upload(storagePath, pdf.blob, {
            contentType: 'application/pdf',
            upsert: true
        });

    if (error) {
        throw new Error('PDF upload failed: ' + error.message);
    }

    // Get public URL
    const { data: urlData } = supabaseClient
        .storage
        .from('report-pdfs')
        .getPublicUrl(storagePath);

    return urlData.publicUrl;
}

/**
 * Ensure the report exists in the reports table (required for foreign key)
 * This upserts the report before we can insert into final_reports
 */
async function ensureReportExists() {
    const reportData = getReportData(currentReportId) || {};
    const reportDate = getReportDate();
    
    const reportRow = {
        id: currentReportId,
        project_id: report.projectId,
        report_date: reportDate,
        status: 'draft', // Will be updated to 'submitted' after
        capture_mode: reportData.captureMode || 'guided',
        created_at: reportData.createdAt || new Date().toISOString(),
        updated_at: new Date().toISOString()
    };
    
    const { error } = await supabaseClient
        .from('reports')
        .upsert(reportRow, { onConflict: 'id' });
    
    if (error) {
        throw new Error('Failed to create report record: ' + error.message);
    }
    
    console.log('[SUBMIT] Report record ensured in reports table:', currentReportId);
}

/**
 * Save report metadata to final_reports table
 * @param {string} pdfUrl - URL of the uploaded PDF
 */
async function saveToFinalReports(pdfUrl) {
    const reportData = getReportData(currentReportId) || {};
    const weather = report.overview?.weather || {};
    const submittedAt = new Date().toISOString();

    // Helper to clean weather values - convert "--", "N/A", empty to null
    // Also extract numeric values from strings like "71°F", "39°F", "0.00""
    function cleanWeatherValue(val) {
        if (val === null || val === undefined || val === '' || val === '--' || val === 'N/A') {
            return null;
        }
        // Extract numeric value from strings like "71°F", "39°F", "0.00""
        const numMatch = String(val).match(/^[\d.]+/);
        if (numMatch) {
            const num = parseFloat(numMatch[0]);
            return isNaN(num) ? null : num;
        }
        return null;
    }

    const finalReportData = {
        report_id: currentReportId,
        pdf_url: pdfUrl,
        submitted_at: submittedAt,
        // Weather fields (cleaned to convert "--" to null for numeric columns)
        weather_high_temp: cleanWeatherValue(weather.highTemp),
        weather_low_temp: cleanWeatherValue(weather.lowTemp),
        weather_precipitation: cleanWeatherValue(weather.precipitation),
        weather_general_condition: cleanWeatherValue(weather.generalCondition),
        weather_job_site_condition: cleanWeatherValue(weather.jobSiteCondition),
        weather_adverse_conditions: cleanWeatherValue(weather.adverseConditions),
        // Text summary fields
        executive_summary: report.aiGenerated?.executive_summary || report.aiGenerated?.executiveSummary || '',
        work_performed: report.aiGenerated?.work_performed || report.aiGenerated?.workPerformed || '',
        safety_observations: report.safety?.notes || report.aiGenerated?.safety?.summary || '',
        delays_issues: report.issues || '',
        qaqc_notes: report.qaqc || '',
        communications_notes: report.communications || '',
        visitors_deliveries_notes: report.visitors || '',
        inspector_notes: report.aiGenerated?.inspector_notes || '',
        // Store structured data in JSONB columns
        contractors_json: report.aiGenerated?.activities || report.activities || [],
        personnel_json: report.aiGenerated?.operations || report.operations || [],
        equipment_json: report.aiGenerated?.equipment || report.equipment || [],
        // Boolean flags
        has_contractor_personnel: (report.aiGenerated?.activities?.length > 0) || (report.aiGenerated?.operations?.length > 0),
        has_equipment: (report.aiGenerated?.equipment?.length > 0) || (report.equipment?.length > 0),
        has_issues: !!report.issues,
        has_communications: !!report.communications,
        has_qaqc: !!report.qaqc,
        has_safety_incidents: report.safety?.hasIncident || report.aiGenerated?.safety?.has_incidents || false,
        has_visitors_deliveries: !!report.visitors,
        has_photos: report.photos?.length > 0
    };

    // Upsert to final_reports (insert or update if exists)
    const { error } = await supabaseClient
        .from('final_reports')
        .upsert(finalReportData, { onConflict: 'report_id' });

    if (error) {
        throw new Error('Failed to save report: ' + error.message);
    }
}

/**
 * Update reports table status
 * @param {string} status - New status (e.g., 'submitted')
 * @param {string} pdfUrl - URL of the uploaded PDF
 */
async function updateReportStatus(status, pdfUrl) {
    const submittedAt = new Date().toISOString();

    const { error } = await supabaseClient
        .from('reports')
        .update({
            status: status,
            submitted_at: submittedAt,
            updated_at: submittedAt,
            pdf_url: pdfUrl
        })
        .eq('id', currentReportId);

    if (error) {
        throw new Error('Failed to update status: ' + error.message);
    }

    // Update local state
    report.meta = report.meta || {};
    report.meta.submitted = true;
    report.meta.submittedAt = submittedAt;
    report.meta.status = 'submitted';
}

/**
 * Clean up local storage for this report after successful submit
 */
async function cleanupLocalStorage() {
    // Remove report data using storage-keys.js helper
    deleteReportData(currentReportId);

    // Remove from current reports list
    const currentReports = JSON.parse(localStorage.getItem('fvp_current_reports') || '{}');
    delete currentReports[currentReportId];
    localStorage.setItem('fvp_current_reports', JSON.stringify(currentReports));

    // Clear photos from IndexedDB for this report (if available)
    if (window.idb && typeof window.idb.deletePhotosByReportId === 'function') {
        try {
            await window.idb.deletePhotosByReportId(currentReportId);
            console.log('[SUBMIT] IndexedDB photos cleaned up for:', currentReportId);
        } catch (e) {
            console.warn('[SUBMIT] Could not clean IndexedDB photos:', e);
        }
    }

    console.log('[SUBMIT] Local storage cleaned up for:', currentReportId);
}

/**
 * Show/hide loading state on submit button
 * @param {boolean} show - Whether to show loading state
 */
function showSubmitLoading(show) {
    const btn = document.querySelector('.btn-submit');
    if (!btn) return;

    if (show) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';
        btn.style.cursor = 'wait';
    } else {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-paper-plane"></i><span>Submit</span>';
        btn.style.cursor = 'pointer';
    }
}

/**
 * Show error message to user
 * @param {string} message - Error message to display
 */
function showError(message) {
    // Create error toast/modal
    const existingToast = document.getElementById('errorToast');
    if (existingToast) existingToast.remove();

    const toast = document.createElement('div');
    toast.id = 'errorToast';
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: #dc2626;
        color: white;
        padding: 16px 24px;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 500;
        z-index: 10000;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        gap: 12px;
        max-width: 90vw;
    `;
    toast.innerHTML = `
        <i class="fas fa-exclamation-circle"></i>
        <span>${escapeHtml(message)}</span>
        <button onclick="this.parentElement.remove()" style="
            background: transparent;
            border: none;
            color: white;
            cursor: pointer;
            padding: 4px;
            margin-left: 8px;
        "><i class="fas fa-times"></i></button>
    `;
    document.body.appendChild(toast);

    // Auto-dismiss after 8 seconds
    setTimeout(() => {
        if (toast.parentElement) toast.remove();
    }, 8000);
}

/**
 * Get project name for PDF filename
 * @returns {string}
 */
function getProjectName() {
    return report?.overview?.projectName || activeProject?.projectName || 'Report';
}

/**
 * Get report date for PDF filename
 * @returns {string}
 */
function getReportDate() {
    return report?.overview?.date || getReportDateStr() || new Date().toISOString().split('T')[0];
}

function showSubmitSuccess() {
    // Create and show a success modal
    const modal = document.createElement('div');
    modal.id = 'submitSuccessModal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        padding: 20px;
    `;

    modal.innerHTML = `
        <div style="
            background: white;
            max-width: 400px;
            width: 100%;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        ">
            <div style="
                background: #16a34a;
                padding: 20px;
                text-align: center;
            ">
                <i class="fas fa-check-circle" style="color: white; font-size: 48px;"></i>
            </div>
            <div style="padding: 24px; text-align: center;">
                <h3 style="
                    font-size: 18px;
                    font-weight: bold;
                    color: #1e293b;
                    margin-bottom: 8px;
                    text-transform: uppercase;
                ">Report Submitted</h3>
                <p style="
                    color: #64748b;
                    font-size: 14px;
                    margin-bottom: 20px;
                ">Your report has been saved to the archives.</p>
                <div style="display: flex; gap: 12px;">
                    <button onclick="closeSubmitModal()" style="
                        flex: 1;
                        padding: 12px;
                        background: #f1f5f9;
                        border: 1px solid #e2e8f0;
                        color: #475569;
                        font-weight: bold;
                        text-transform: uppercase;
                        font-size: 12px;
                        cursor: pointer;
                    ">Close</button>
                    <button onclick="window.location.href='archives.html'" style="
                        flex: 1;
                        padding: 12px;
                        background: #0a1628;
                        border: none;
                        color: white;
                        font-weight: bold;
                        text-transform: uppercase;
                        font-size: 12px;
                        cursor: pointer;
                    ">View Archives</button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Update the submit button to show submitted state
    const submitBtn = document.querySelector('.btn-submit');
    if (submitBtn) {
        submitBtn.innerHTML = '<i class="fas fa-check"></i><span>Submitted</span>';
        submitBtn.disabled = true;
        submitBtn.style.opacity = '0.7';
        submitBtn.style.cursor = 'default';
    }
}

function closeSubmitModal() {
    const modal = document.getElementById('submitSuccessModal');
    if (modal) {
        modal.remove();
    }
}

// ============ EMPTY FIELD HIGHLIGHTING ============
const PROJECT_OVERVIEW_FIELDS = [
    { id: 'projectName', label: 'Project Name' },
    { id: 'noabProjectNo', label: 'NOAB Project No.' },
    { id: 'cnoSolicitationNo', label: 'CNO Solicitation No.' },
    { id: 'location', label: 'Location' },
    { id: 'engineer', label: 'Engineer' },
    { id: 'contractor', label: 'Contractor' },
    { id: 'noticeToProceed', label: 'Notice to Proceed' },
    { id: 'contractDuration', label: 'Contract Duration' },
    { id: 'expectedCompletion', label: 'Expected Completion' },
    { id: 'contractDay', label: 'Contract Day #' },
    { id: 'weatherDays', label: 'Weather Days' },
    { id: 'reportDate', label: 'Report Date' },
    { id: 'startTime', label: 'Start Time' },
    { id: 'endTime', label: 'End Time' },
    { id: 'completedBy', label: 'Completed By' }
];

function checkEmptyFields() {
    let emptyCount = 0;

    PROJECT_OVERVIEW_FIELDS.forEach(field => {
        const element = document.getElementById(field.id);
        if (!element) return;

        const value = element.textContent.trim();
        const isEmpty = value === '' || value === '--' || value === 'N/A';

        if (isEmpty) {
            element.classList.add('missing-field');
            emptyCount++;
        } else {
            element.classList.remove('missing-field');
        }
    });

    // Update and show/hide banner
    const banner = document.getElementById('incompleteBanner');
    const bannerText = document.getElementById('incompleteBannerText');

    if (emptyCount > 0) {
        bannerText.textContent = `${emptyCount} field${emptyCount === 1 ? '' : 's'} incomplete in Project Overview`;
        banner.style.display = 'flex';
    } else {
        banner.style.display = 'none';
    }
}

function dismissIncompleteBanner() {
    const banner = document.getElementById('incompleteBanner');
    if (banner) {
        banner.style.display = 'none';
    }
}

// ============ AUTO-RESIZE (v6.6.5) ============
/**
 * v6.6.5: Auto-resize textarea to fit content
 */
function autoResize(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
}

/**
 * v6.6.5: Initialize auto-resize for all editable fields
 */
function initAutoResize() {
    document.querySelectorAll('.editable-field').forEach(field => {
        if (field.tagName === 'TEXTAREA') {
            autoResize(field);
            field.addEventListener('input', () => autoResize(field));
        }
    });
}

// ============ AUTO-SAVE (v6.6.5) ============
/**
 * v6.6.5: Setup auto-save listeners for all editable fields
 * Matches the pattern from report.js for consistency
 */
function setupAutoSave() {
    // Find all editable fields with data-path attribute
    document.querySelectorAll('[data-path]').forEach(field => {
        // Input event: update userEdits and schedule debounced save
        field.addEventListener('input', () => {
            const path = field.getAttribute('data-path');
            const value = field.value;

            // Handle special paths for photos and contractor activities
            if (path.startsWith('photos[')) {
                // Photo caption: photos[0].caption -> update report.photos[0].caption
                const match = path.match(/photos\[(\d+)\]\.caption/);
                if (match) {
                    const photoIndex = parseInt(match[1]);
                    if (report.photos && report.photos[photoIndex]) {
                        report.photos[photoIndex].caption = value;
                    }
                    // Also store in userEdits for persistence
                    userEdits[path] = value;
                    report.userEdits = userEdits;
                }
            } else if (path.startsWith('activity_')) {
                // Contractor activity: activity_uuid.narrative -> update userEdits as nested object
                // Path format: activity_{contractorId}.{field} (e.g., activity_abc123.narrative)
                const match = path.match(/^(activity_[^.]+)\.(.+)$/);
                if (match) {
                    const activityKey = match[1]; // e.g., "activity_abc123"
                    const fieldName = match[2];   // e.g., "narrative"

                    // Initialize the activity object if needed
                    if (!userEdits[activityKey]) {
                        userEdits[activityKey] = {};
                    }
                    userEdits[activityKey][fieldName] = value;
                } else {
                    // Simple activity path without nested field
                    userEdits[path] = value;
                }
                report.userEdits = userEdits;
            } else if (path.startsWith('operations_')) {
                // Operations table: operations_uuid.field -> update userEdits as nested object
                const match = path.match(/^(operations_[^.]+)\.(.+)$/);
                if (match) {
                    const opsKey = match[1];
                    const fieldName = match[2];

                    if (!userEdits[opsKey]) {
                        userEdits[opsKey] = {};
                    }
                    userEdits[opsKey][fieldName] = value;
                }
                report.userEdits = userEdits;
            } else if (path.startsWith('equipment_')) {
                // Equipment table: equipment_index.field -> update userEdits as nested object
                const match = path.match(/^(equipment_\d+)\.(.+)$/);
                if (match) {
                    const equipKey = match[1];
                    const fieldName = match[2];

                    if (!userEdits[equipKey]) {
                        userEdits[equipKey] = {};
                    }
                    userEdits[equipKey][fieldName] = value;
                }
                report.userEdits = userEdits;
            } else {
                // Standard text field
                userEdits[path] = value;
                report.userEdits = userEdits;
            }

            field.classList.add('user-edited');
            scheduleSave();
        });

        // Blur event: cancel pending debounce and save immediately
        field.addEventListener('blur', () => {
            if (saveTimeout) {
                clearTimeout(saveTimeout);
                saveTimeout = null;
            }
            saveReportToLocalStorage();
            showSaveIndicator();
        });
    });

    console.log('[FINAL] Auto-save listeners attached to', document.querySelectorAll('[data-path]').length, 'fields');
}

/**
 * v6.6.5: Schedule a debounced save (500ms delay)
 */
function scheduleSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        saveReportToLocalStorage();
        showSaveIndicator();
    }, 500);
}

/**
 * v6.6.5: Save report data to localStorage using single key pattern
 * Key: fvp_report_{reportId}
 * Matches the pattern from report.js
 */
function saveReportToLocalStorage() {
    if (!currentReportId) {
        console.warn('[FINAL] No reportId, cannot save');
        return;
    }

    // Read current data to preserve fields we don't modify here
    const existingData = getReportData(currentReportId) || {};

    // Build the report object to save (matches spec structure)
    const reportToSave = {
        reportId: currentReportId,
        projectId: existingData.projectId || activeProject?.id,
        reportDate: existingData.reportDate || getReportDateStr(),
        status: report.meta?.status || existingData.status || 'refined',

        // From n8n webhook response (preserve original)
        aiGenerated: report.aiGenerated || existingData.aiGenerated || {},
        captureMode: report.aiCaptureMode || existingData.captureMode || 'minimal',

        // Original field notes (preserve original)
        originalInput: {
            ...existingData.originalInput,
            // Update photos with edited captions
            photos: report.photos || existingData.originalInput?.photos || []
        },

        // User edits - this is what we're updating
        userEdits: { ...existingData.userEdits, ...userEdits },

        // Metadata
        createdAt: existingData.createdAt || report.meta?.createdAt || new Date().toISOString(),
        lastSaved: new Date().toISOString()
    };

    // Use saveReportData from storage-keys.js
    const success = saveReportData(currentReportId, reportToSave);
    if (success) {
        console.log('[FINAL] Report saved to localStorage:', currentReportId);
    } else {
        console.error('[FINAL] Failed to save report to localStorage');
    }
}

/**
 * v6.6.5: Show brief save indicator
 */
function showSaveIndicator() {
    // Check if indicator already exists
    let indicator = document.getElementById('saveIndicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'saveIndicator';
        indicator.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #16a34a;
            color: white;
            padding: 8px 16px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: bold;
            z-index: 9999;
            opacity: 0;
            transition: opacity 0.3s ease;
        `;
        indicator.textContent = 'Saved';
        document.body.appendChild(indicator);
    }

    // Show indicator
    indicator.style.opacity = '1';

    // Hide after 1.5 seconds
    setTimeout(() => {
        indicator.style.opacity = '0';
    }, 1500);
}

// ============ EXPOSE TO WINDOW FOR ONCLICK HANDLERS ============
window.goToEdit = goToEdit;
window.submitReport = submitReport;
window.dismissIncompleteBanner = dismissIncompleteBanner;
window.closeSubmitModal = closeSubmitModal;
