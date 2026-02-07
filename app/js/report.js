// ============================================================================
// FieldVoice Pro v6 - Report Page (report.js)
//
// Uses:
// - storage-keys.js: STORAGE_KEYS, getStorageItem, setStorageItem
// - config.js: supabaseClient
// - supabase-utils.js: fromSupabaseProject, fromSupabaseContractor, fromSupabaseEquipment
// - ui-utils.js: escapeHtml
// ============================================================================

(function() {
    'use strict';

    // ============ STATE ============
    let report = null;
    let currentReportId = null; // Supabase report ID
    let activeProject = null;
    let projectContractors = [];
    let userEdits = {}; // Track user edits separately
    let userSettings = null;
    let saveTimeout = null;
    let isSaving = false;
    let isReadonly = false;
    let currentTab = 'form';

    const N8N_PROCESS_WEBHOOK = 'https://advidere.app.n8n.cloud/webhook/fieldvoice-refine-v6.6';

    // ============ INITIALIZATION ============
    document.addEventListener('DOMContentLoaded', async () => {
        try {
            // Load project and user settings from Supabase
            const [projectResult, settingsResult] = await Promise.all([
                window.dataLayer.loadActiveProject(),
                window.dataLayer.loadUserSettings()
            ]);
            activeProject = projectResult;
            userSettings = settingsResult;
            if (activeProject) {
                projectContractors = activeProject.contractors || [];
            }

            // Load report data from Supabase
            report = await loadReport();

            // Initialize user edits tracking
            if (!report.userEdits) report.userEdits = {};
            userEdits = report.userEdits;

            // Mark report as viewed
            if (!report.meta) report.meta = {};
            report.meta.reportViewed = true;
            await saveReportSilent();

            // Populate all fields
            populateAllFields();

            // Populate original notes view
            populateOriginalNotes();

            // Check for pending refine status
            checkPendingRefineStatus();

            // Setup auto-save listeners
            setupAutoSave();

            // Initialize auto-expand textareas
            initAllAutoExpandTextareas();

            // Update header date
            updateHeaderDate();

            // Initialize debug panel
            initializeDebugPanel();
        } catch (err) {
            console.error('Failed to initialize report page:', err);
        }
    });

    // ============ TAB SWITCHING ============
    function switchTab(tab) {
        currentTab = tab;
        const tabFormView = document.getElementById('tabFormView');
        const tabOriginalNotes = document.getElementById('tabOriginalNotes');
        const formViewContent = document.getElementById('formViewContent');
        const originalNotesView = document.getElementById('originalNotesView');

        if (tab === 'form') {
            tabFormView.classList.add('border-dot-orange', 'text-white');
            tabFormView.classList.remove('border-transparent', 'text-slate-400');
            tabOriginalNotes.classList.remove('border-dot-orange', 'text-white');
            tabOriginalNotes.classList.add('border-transparent', 'text-slate-400');
            formViewContent.classList.remove('hidden');
            originalNotesView.classList.add('hidden');
        } else {
            tabOriginalNotes.classList.add('border-dot-orange', 'text-white');
            tabOriginalNotes.classList.remove('border-transparent', 'text-slate-400');
            tabFormView.classList.remove('border-dot-orange', 'text-white');
            tabFormView.classList.add('border-transparent', 'text-slate-400');
            originalNotesView.classList.remove('hidden');
            formViewContent.classList.add('hidden');
        }
    }

    // ============ ORIGINAL NOTES POPULATION ============
    /**
     * v6.6: Updated to use originalInput from n8n response when available
     * - If originalInput exists, use it as the source of original data sent to AI
     * - If aiCaptureMode is 'guided', render structured tables by section
     * - If aiCaptureMode is 'freeform', render chronological entry list
     * - Falls back to legacy report.fieldNotes/guidedNotes for older reports
     */
    function populateOriginalNotes() {
        if (!report) return;

        // v6.6: Use aiCaptureMode from n8n response, fall back to meta.captureMode
        const mode = report.aiCaptureMode || report.meta?.captureMode || 'guided';
        document.getElementById('captureModeBadge').textContent =
            mode === 'minimal' || mode === 'freeform' ? 'Quick Notes' : 'Guided';

        // v6.6: Use originalInput from n8n response when available
        const original = report.originalInput;

        if (mode === 'minimal' || mode === 'freeform') {
            // === FREEFORM MODE ===
            document.getElementById('minimalNotesSection').classList.remove('hidden');
            document.getElementById('guidedNotesSection').classList.add('hidden');

            let freeformContent = '';
            if (original?.fieldNotes?.freeform_entries?.length > 0) {
                freeformContent = original.fieldNotes.freeform_entries
                    .filter(e => e.content?.trim())
                    .sort((a, b) => new Date(a.timestamp || a.created_at || 0) - new Date(b.timestamp || b.created_at || 0))
                    .map(e => {
                        const time = e.timestamp || e.created_at;
                        const timeStr = time ? new Date(time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
                        return timeStr ? `[${timeStr}] ${e.content}` : e.content;
                    })
                    .join('\n\n');
            } else if (original?.fieldNotes?.freeformNotes) {
                freeformContent = original.fieldNotes.freeformNotes;
            } else if (report.fieldNotes?.freeformNotes) {
                freeformContent = report.fieldNotes.freeformNotes;
            }

            document.getElementById('originalFreeformNotes').textContent = freeformContent || 'None';

        } else {
            // === GUIDED MODE ===
            document.getElementById('minimalNotesSection').classList.add('hidden');
            document.getElementById('guidedNotesSection').classList.remove('hidden');

            // Build contractor lookup from projectContext
            const contractors = original?.projectContext?.contractors || [];
            const contractorMap = {};
            contractors.forEach(c => {
                contractorMap[c.id] = c.name || c.company || 'Unknown Contractor';
            });

            // --- WORK SUMMARY (per contractor) ---
            renderWorkByContractor(original, contractorMap);

            // --- PERSONNEL ---
            renderPersonnelTable(original, contractorMap);

            // --- EQUIPMENT ---
            renderEquipmentTable(original, contractorMap);

            // --- OTHER SECTIONS ---
            renderEntriesSection(original, 'issues', 'originalIssues');
            renderEntriesSection(original, 'qaqc', 'originalQaqc');
            renderEntriesSection(original, 'communications', 'originalCommunications');
            renderSafetySection(original);
            renderEntriesSection(original, 'visitors', 'originalVisitors');
        }

        // === WEATHER (both modes) ===
        const w = original?.weather || report.overview?.weather || {};
        const weatherHtml = (w.highTemp || w.lowTemp || w.generalCondition)
            ? `High: ${w.highTemp || 'N/A'} | Low: ${w.lowTemp || 'N/A'}<br>${w.generalCondition || 'N/A'} | Site: ${w.jobSiteCondition || 'N/A'}`
            : '<span class="text-slate-400 italic">None</span>';
        document.getElementById('originalWeather').innerHTML = weatherHtml;

        // === PHOTOS (both modes) ===
        // Always use report.photos for display - has URLs from Supabase
        // original.photos only has metadata (no URLs)
        const photos = report.photos || [];
        populateOriginalPhotos(photos);
    }

    // --- HELPER: Render Work Entries Grouped by Contractor ---
    function renderWorkByContractor(original, contractorMap) {
        const container = document.getElementById('originalWorkByContractor');
        const entries = original?.entries?.filter(e => e.section?.startsWith('work_') && !e.is_deleted) || [];

        if (entries.length === 0) {
            container.innerHTML = '<p class="text-slate-400 italic">None</p>';
            return;
        }

        // Group by contractor ID
        const grouped = {};
        entries.forEach(e => {
            const contractorId = e.section.replace('work_', '');
            if (!grouped[contractorId]) grouped[contractorId] = [];
            grouped[contractorId].push(e);
        });

        let html = '';
        Object.keys(grouped).forEach(contractorId => {
            const contractorName = contractorMap[contractorId] || 'Unknown Contractor';
            const contractorEntries = grouped[contractorId].sort((a, b) =>
                new Date(a.timestamp || 0) - new Date(b.timestamp || 0)
            );

            html += `
                <div class="bg-slate-800/50 rounded-lg overflow-hidden">
                    <div class="bg-slate-700/50 px-3 py-2 font-medium text-white text-sm">${escapeHtml(contractorName)}</div>
                    <table class="w-full text-sm">
                        <tbody>
            `;

            contractorEntries.forEach(e => {
                const time = e.timestamp ? new Date(e.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
                html += `
                    <tr class="border-t border-slate-700/50">
                        <td class="px-3 py-2 text-slate-400 whitespace-nowrap w-20">${time}</td>
                        <td class="px-3 py-2 text-slate-200">${escapeHtml(e.content || '')}</td>
                    </tr>
                `;
            });

            html += '</tbody></table></div>';
        });

        container.innerHTML = html;
    }

    // --- HELPER: Render Personnel Table ---
    function renderPersonnelTable(original, contractorMap) {
        const container = document.getElementById('originalPersonnelSection');
        const operations = original?.operations || [];

        if (operations.length === 0) {
            container.innerHTML = '<p class="text-slate-400 italic">None</p>';
            return;
        }

        let html = `
            <table class="w-full text-sm bg-slate-800/50 rounded-lg overflow-hidden">
                <thead class="bg-slate-700/50">
                    <tr>
                        <th class="px-3 py-2 text-left text-slate-300 font-medium">Contractor</th>
                        <th class="px-2 py-2 text-center text-slate-300 font-medium">Supt</th>
                        <th class="px-2 py-2 text-center text-slate-300 font-medium">Fore</th>
                        <th class="px-2 py-2 text-center text-slate-300 font-medium">Oper</th>
                        <th class="px-2 py-2 text-center text-slate-300 font-medium">Labor</th>
                        <th class="px-2 py-2 text-center text-slate-300 font-medium">Surv</th>
                        <th class="px-2 py-2 text-center text-slate-300 font-medium">Other</th>
                    </tr>
                </thead>
                <tbody>
        `;

        let hasAnyPersonnel = false;
        operations.forEach(op => {
            const name = contractorMap[op.contractorId] || op.contractorName || 'Unknown';
            const total = (op.superintendents || 0) + (op.foremen || 0) + (op.operators || 0) +
                          (op.laborers || 0) + (op.surveyors || 0) + (op.others || 0);
            if (total === 0) return; // Skip contractors with no personnel

            hasAnyPersonnel = true;
            html += `
                <tr class="border-t border-slate-700/50">
                    <td class="px-3 py-2 text-slate-200">${escapeHtml(name)}</td>
                    <td class="px-2 py-2 text-center text-slate-300">${op.superintendents || 0}</td>
                    <td class="px-2 py-2 text-center text-slate-300">${op.foremen || 0}</td>
                    <td class="px-2 py-2 text-center text-slate-300">${op.operators || 0}</td>
                    <td class="px-2 py-2 text-center text-slate-300">${op.laborers || 0}</td>
                    <td class="px-2 py-2 text-center text-slate-300">${op.surveyors || 0}</td>
                    <td class="px-2 py-2 text-center text-slate-300">${op.others || 0}</td>
                </tr>
            `;
        });

        html += '</tbody></table>';

        if (!hasAnyPersonnel) {
            container.innerHTML = '<p class="text-slate-400 italic">None</p>';
        } else {
            container.innerHTML = html;
        }
    }

    // --- HELPER: Render Equipment Table ---
    function renderEquipmentTable(original, contractorMap) {
        const container = document.getElementById('originalEquipmentSection');
        const equipment = original?.equipmentRows || [];

        if (equipment.length === 0) {
            container.innerHTML = '<p class="text-slate-400 italic">None</p>';
            return;
        }

        let html = `
            <table class="w-full text-sm bg-slate-800/50 rounded-lg overflow-hidden">
                <thead class="bg-slate-700/50">
                    <tr>
                        <th class="px-3 py-2 text-left text-slate-300 font-medium">Contractor</th>
                        <th class="px-3 py-2 text-left text-slate-300 font-medium">Type</th>
                        <th class="px-2 py-2 text-center text-slate-300 font-medium">Qty</th>
                        <th class="px-2 py-2 text-center text-slate-300 font-medium">Hours</th>
                    </tr>
                </thead>
                <tbody>
        `;

        equipment.forEach(eq => {
            const name = contractorMap[eq.contractorId] || eq.contractorName || 'Unspecified';
            html += `
                <tr class="border-t border-slate-700/50">
                    <td class="px-3 py-2 text-slate-200">${escapeHtml(name)}</td>
                    <td class="px-3 py-2 text-slate-200">${escapeHtml(eq.type || '')}</td>
                    <td class="px-2 py-2 text-center text-slate-300">${eq.qty || 1}</td>
                    <td class="px-2 py-2 text-center text-slate-300">${eq.status || '-'}</td>
                </tr>
            `;
        });

        html += '</tbody></table>';
        container.innerHTML = html;
    }

    // --- HELPER: Render Generic Entry Section ---
    function renderEntriesSection(original, sectionName, elementId) {
        const container = document.getElementById(elementId);
        const entries = original?.entries?.filter(e => e.section === sectionName && !e.is_deleted) || [];

        if (entries.length === 0) {
            container.innerHTML = '<p class="text-slate-400 italic">None</p>';
            return;
        }

        const sorted = entries.sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));

        let html = '<div class="bg-slate-800/50 rounded-lg overflow-hidden"><table class="w-full text-sm"><tbody>';

        sorted.forEach((e, i) => {
            const time = e.timestamp ? new Date(e.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
            const borderClass = i > 0 ? 'border-t border-slate-700/50' : '';
            html += `
                <tr class="${borderClass}">
                    <td class="px-3 py-2 text-slate-400 whitespace-nowrap w-20">${time}</td>
                    <td class="px-3 py-2 text-slate-200">${escapeHtml(e.content || '')}</td>
                </tr>
            `;
        });

        html += '</tbody></table></div>';
        container.innerHTML = html;
    }

    // --- HELPER: Render Safety Section ---
    function renderSafetySection(original) {
        const container = document.getElementById('originalSafety');
        const entries = original?.entries?.filter(e => e.section === 'safety' && !e.is_deleted) || [];
        const safety = original?.safety || {};

        let html = '';

        // Show incident status
        if (safety.noIncidents) {
            html += '<div class="text-green-400 font-medium mb-2"><i class="fas fa-check-circle mr-2"></i>No Incidents Reported</div>';
        } else if (safety.hasIncidents) {
            html += '<div class="text-red-400 font-medium mb-2"><i class="fas fa-exclamation-triangle mr-2"></i>Incident Reported</div>';
        }

        // Show entries
        if (entries.length > 0) {
            const sorted = entries.sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
            html += '<div class="bg-slate-800/50 rounded-lg overflow-hidden"><table class="w-full text-sm"><tbody>';

            sorted.forEach((e, i) => {
                const time = e.timestamp ? new Date(e.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
                const borderClass = i > 0 ? 'border-t border-slate-700/50' : '';
                html += `
                    <tr class="${borderClass}">
                        <td class="px-3 py-2 text-slate-400 whitespace-nowrap w-20">${time}</td>
                        <td class="px-3 py-2 text-slate-200">${escapeHtml(e.content || '')}</td>
                    </tr>
                `;
            });

            html += '</tbody></table></div>';
        } else if (!safety.noIncidents && !safety.hasIncidents) {
            html = '<p class="text-slate-400 italic">None</p>';
        }

        container.innerHTML = html;
    }

    function formatOriginalSafety(report) {
        if (report.safety?.noIncidents) {
            return 'No incidents reported';
        } else if (report.safety?.hasIncidents) {
            return 'INCIDENT REPORTED\n' + (report.safety?.notes?.join('\n') || '');
        } else if (report.safety?.notes?.length > 0) {
            return report.safety.notes.join('\n');
        }
        return 'No safety notes';
    }

    function populateOriginalPhotos(photos) {
        const container = document.getElementById('originalPhotosGrid');
        if (!photos || photos.length === 0) {
            container.innerHTML = '<p class="text-slate-500 col-span-2 text-center py-4">No photos captured</p>';
            return;
        }

        container.innerHTML = photos.map((photo, index) => `
            <div class="bg-white border border-slate-200 rounded overflow-hidden">
                <div class="aspect-square bg-slate-100">
                    <img src="${photo.url}" class="w-full h-full object-cover" alt="Photo ${index + 1}">
                </div>
                <div class="p-2">
                    <p class="text-xs text-slate-500">${photo.date || ''} ${photo.time || ''}</p>
                    <p class="text-sm text-slate-700 mt-1">${escapeHtml(photo.caption) || '<em class="text-slate-400">No caption</em>'}</p>
                </div>
            </div>
        `).join('');
    }

    // ============ PENDING REFINE HANDLING ============
    function checkPendingRefineStatus() {
        if (report.meta?.status === 'pending_refine') {
            document.getElementById('pendingRefineBanner').classList.remove('hidden');
        } else {
            document.getElementById('pendingRefineBanner').classList.add('hidden');
        }
    }

    async function retryRefineProcessing() {
        if (!navigator.onLine) {
            alert('Still offline - please connect to the internet and try again.');
            return;
        }

        const queued = report.meta?.offlineQueue?.find(q => q.type === 'refine');
        if (!queued) {
            alert('No pending processing found.');
            return;
        }

        const retryBtn = document.getElementById('retryRefine');
        const originalBtnHtml = retryBtn.innerHTML;
        retryBtn.disabled = true;
        retryBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Processing...';

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);

            const response = await fetch(N8N_PROCESS_WEBHOOK, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(queued.payload),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`Webhook failed: ${response.status}`);
            }

            const result = await response.json();

            // Save AI response - handle new n8n response structure
            // New structure: { success, captureMode, originalInput, refinedReport }
            // Legacy structure: { aiGenerated }
            if (result.refinedReport) {
                report.aiGenerated = result.refinedReport;
                report.originalInput = result.originalInput || null;
                report.aiCaptureMode = result.captureMode || null;
            } else if (result.aiGenerated) {
                // Legacy fallback
                report.aiGenerated = result.aiGenerated;
            }
            report.meta.status = 'refined';

            // Remove from offline queue
            report.meta.offlineQueue = report.meta.offlineQueue.filter(q => q.type !== 'refine');
            saveReport();

            // Hide banner and refresh page to show new data
            document.getElementById('pendingRefineBanner').classList.add('hidden');
            alert('AI processing complete! Refreshing data...');
            location.reload();

        } catch (error) {
            console.error('Retry failed:', error);
            retryBtn.disabled = false;
            retryBtn.innerHTML = originalBtnHtml;
            alert('Processing failed. Please try again later.');
        }
    }

    // Save report without showing indicator (for silent updates)
    async function saveReportSilent() {
        try {
            await saveReportToSupabase();
        } catch (err) {
            console.error('Failed to save report:', err);
        }
    }

    // ============ PROJECT LOADING ============
    /* DEPRECATED — now using window.dataLayer.loadActiveProject()
    async function loadActiveProject() {
        const activeId = getStorageItem(STORAGE_KEYS.ACTIVE_PROJECT_ID);
        if (!activeId) {
            activeProject = null;
            projectContractors = [];
            return null;
        }

        try {
            // Fetch project from Supabase
            const { data: projectRow, error: projectError } = await supabaseClient
                .from('projects')
                .select('*')
                .eq('id', activeId)
                .single();

            if (projectError || !projectRow) {
                console.error('Failed to load project from Supabase:', projectError);
                activeProject = null;
                projectContractors = [];
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
                // Sort: prime contractors first, then subcontractors
                projectContractors = [...activeProject.contractors].sort((a, b) => {
                    if (a.type === 'prime' && b.type !== 'prime') return -1;
                    if (a.type !== 'prime' && b.type === 'prime') return 1;
                    return 0;
                });
            } else {
                projectContractors = [];
            }

            return activeProject;
        } catch (e) {
            console.error('Failed to load project:', e);
            activeProject = null;
            projectContractors = [];
            return null;
        }
    }
    */

    /* DEPRECATED — now using window.dataLayer.loadUserSettings()
    async function loadUserSettings() {
        try {
            const { data, error } = await supabaseClient
                .from('user_profiles')
                .select('*')
                .limit(1)
                .single();

            if (error && error.code !== 'PGRST116') {
                console.error('Failed to load user settings:', error);
                return null;
            }

            if (data) {
                userSettings = {
                    id: data.id,
                    full_name: data.full_name || '',
                    title: data.title || '',
                    company: data.company || '',
                    email: data.email || '',
                    phone: data.phone || ''
                };
                return userSettings;
            }
            return null;
        } catch (e) {
            console.error('Failed to load user settings:', e);
            return null;
        }
    }
    */

    // ============ REPORT LOADING ============
    function getReportDateStr() {
        const params = new URLSearchParams(window.location.search);
        const dateParam = params.get('date');
        return dateParam || new Date().toISOString().split('T')[0];
    }

    /**
     * v6.6.2: Load report from localStorage ONLY
     * Source of truth is now fvp_report_{reportId} key
     */
    async function loadReport() {
        // Clear any stale report ID before loading
        currentReportId = null;

        // Get reportId from URL params (required)
        const params = new URLSearchParams(window.location.search);
        const reportIdParam = params.get('reportId');
        const reportDateStr = getReportDateStr();

        if (!reportIdParam) {
            console.error('[LOAD] No reportId in URL params');
            showToast('Report not found. Redirecting to home.', 'error');
            setTimeout(() => window.location.href = 'index.html', 2000);
            return createFreshReport();
        }

        // Load from single localStorage key
        const reportData = getReportData(reportIdParam);

        if (!reportData) {
            console.error('[LOAD] No report data found in localStorage for:', reportIdParam);
            showToast('Report data not found. It may have been cleared.', 'error');
            setTimeout(() => window.location.href = 'index.html', 2000);
            return createFreshReport();
        }

        console.log('[LOAD] Loaded report from localStorage:', reportIdParam);

        // Store the report ID
        currentReportId = reportIdParam;

        // Build the report object from localStorage data
        const loadedReport = createFreshReport();

        // Basic report info from localStorage
        loadedReport.meta = {
            createdAt: reportData.createdAt,
            lastSaved: reportData.lastSaved,
            version: 4,
            status: reportData.status || 'refined',
            captureMode: reportData.captureMode || 'minimal',
            reportViewed: true
        };

        loadedReport.overview.date = reportData.reportDate;

        // AI-generated content
        loadedReport.aiGenerated = reportData.aiGenerated || null;

        // Original input for "Original Notes" tab
        loadedReport.originalInput = reportData.originalInput || null;

        // Capture mode
        loadedReport.aiCaptureMode = reportData.captureMode || null;

        // User edits
        loadedReport.userEdits = reportData.userEdits || {};

        // Weather from originalInput
        if (reportData.originalInput?.weather) {
            loadedReport.overview.weather = reportData.originalInput.weather;
        }

        // Photos from originalInput (metadata only, URLs need to be resolved)
        if (reportData.originalInput?.photos) {
            loadedReport.photos = reportData.originalInput.photos;
        }

        return loadedReport;
    }

    function createFreshReport() {
        return {
            meta: {
                createdAt: new Date().toISOString(),
                version: 4
            },
            overview: {
                projectName: activeProject?.projectName || '',
                noabProjectNo: activeProject?.noabProjectNo || '',
                cnoSolicitationNo: activeProject?.cnoSolicitationNo || 'N/A',
                location: activeProject?.location || '',
                date: new Date().toLocaleDateString(),
                contractDay: activeProject?.contractDayNo || '',
                weatherDays: activeProject?.weatherDays || 0,
                engineer: activeProject?.engineer || '',
                contractor: activeProject?.primeContractor || '',
                startTime: activeProject?.defaultStartTime || '06:00',
                endTime: activeProject?.defaultEndTime || '16:00',
                completedBy: '',
                weather: {
                    highTemp: '',
                    lowTemp: '',
                    precipitation: '',
                    generalCondition: '',
                    jobSiteCondition: '',
                    adverseConditions: ''
                }
            },
            activities: [],
            operations: [],
            equipment: [],
            issues: '',
            qaqc: '',
            safety: {
                hasIncident: false,
                notes: ''
            },
            communications: '',
            visitors: '',
            photos: [],
            signature: {
                name: '',
                title: '',
                company: ''
            },
            // AI-generated content (populated by AI processing)
            aiGenerated: null,
            // v6.6: Original input sent to AI (for "Original Notes" view)
            originalInput: null,
            // v6.6: Capture mode from AI response ('guided' or 'freeform')
            aiCaptureMode: null,
            // User edits (tracked separately)
            userEdits: {},
            // Field notes from capture
            fieldNotes: { freeformNotes: '' },
            guidedNotes: { workSummary: '' }
        };
    }

    /**
     * Build a full report object from localStorage draft data
     * Used when no Supabase data exists yet
     */
    function buildReportFromLocalStorage(draftData, reportDateStr) {
        const loadedReport = createFreshReport();
        
        // Meta
        loadedReport.meta.captureMode = draftData.captureMode || draftData.meta?.captureMode || 'guided';
        loadedReport.meta.createdAt = draftData.meta?.createdAt;
        loadedReport.meta.status = 'draft';
        
        // Weather
        if (draftData.weather) {
            loadedReport.overview.weather = draftData.weather;
        }
        
        // Date
        loadedReport.overview.date = reportDateStr;
        
        // Build originalInput for Original Notes display
        loadedReport.originalInput = buildOriginalInputFromDraft(draftData);
        loadedReport.aiCaptureMode = loadedReport.meta.captureMode;
        
        // Activities
        if (draftData.activities) {
            loadedReport.activities = draftData.activities;
        }
        
        // Operations/Personnel
        if (draftData.operations) {
            loadedReport.operations = draftData.operations;
        }
        
        // Equipment
        if (draftData.equipmentRows) {
            loadedReport.equipmentRows = draftData.equipmentRows;
        }
        if (draftData.equipment) {
            loadedReport.equipment = draftData.equipment;
        }
        
        // Safety
        loadedReport.safety = {
            noIncidents: draftData.safetyNoIncidents || false,
            hasIncidents: draftData.safetyHasIncidents || false,
            notes: draftData.safetyNotes || []
        };
        
        // Photos
        if (draftData.photos) {
            loadedReport.photos = draftData.photos;
        }
        
        // Legacy notes
        if (draftData.freeformNotes) {
            loadedReport.fieldNotes = { freeformNotes: draftData.freeformNotes };
        }
        if (draftData.workSummary) {
            loadedReport.guidedNotes = { workSummary: draftData.workSummary };
        }
        
        return loadedReport;
    }

    /**
     * Build an originalInput object from localStorage draft data
     * This matches the structure that n8n would provide
     */
    function buildOriginalInputFromDraft(draftData) {
        return {
            // Weather
            weather: draftData.weather || {},
            
            // Entries (v6 format - for guided mode sections)
            entries: draftData.entries || [],
            
            // Operations/Personnel
            operations: draftData.operations || [],
            
            // Equipment rows
            equipmentRows: draftData.equipmentRows || [],
            
            // Safety status
            safety: {
                noIncidents: draftData.safetyNoIncidents || false,
                hasIncidents: draftData.safetyHasIncidents || false,
                notes: draftData.safetyNotes || []
            },
            
            // Toggle states
            toggleStates: draftData.toggleStates || {},
            
            // Freeform mode data
            fieldNotes: {
                freeformNotes: draftData.freeformNotes || '',
                freeform_entries: draftData.freeform_entries || []
            },
            
            // Project context (for contractor name lookups)
            projectContext: {
                contractors: activeProject?.contractors || projectContractors || []
            }
        };
    }

    // ============ DATA MERGING ============
    /**
     * Get value with priority: userEdits > aiGenerated > fieldNotes > defaults
     * Handles AI-generated arrays by joining them with newlines for text fields
     */
    function getValue(path, defaultValue = '') {
        // Check user edits first - user edits always win
        if (userEdits[path] !== undefined) {
            return userEdits[path];
        }

        // Check AI-generated content
        if (report.aiGenerated) {
            const aiValue = getNestedValue(report.aiGenerated, path);
            if (aiValue !== undefined && aiValue !== null && aiValue !== '') {
                // Handle arrays by joining with newlines (for text fields)
                if (Array.isArray(aiValue)) {
                    return aiValue.join('\n');
                }
                return aiValue;
            }
        }

        // Check existing report data (fieldNotes, guidedNotes, etc.)
        const reportValue = getNestedValue(report, path);
        if (reportValue !== undefined && reportValue !== null && reportValue !== '') {
            // Also handle arrays from regular report data
            if (Array.isArray(reportValue)) {
                return reportValue.join('\n');
            }
            return reportValue;
        }

        return defaultValue;
    }

    function getNestedValue(obj, path) {
        return path.split('.').reduce((o, k) => (o || {})[k], obj);
    }

    /**
     * Get value from AI-generated data with array handling
     * Arrays are joined with newlines, other values returned as-is
     */
    function getAIValue(path, defaultValue = '') {
        if (!report.aiGenerated) return defaultValue;
        const value = getNestedValue(report.aiGenerated, path);
        if (value === undefined || value === null) return defaultValue;
        if (Array.isArray(value)) return value.join('\n');
        return value;
    }

    /**
     * Get text field value with proper priority handling
     * Priority: userEdits > aiGenerated > fieldNotes/guidedNotes > defaults
     * @param {string} reportPath - Path in report object (e.g., 'issues')
     * @param {string} aiPath - Path in aiGenerated object (e.g., 'issues_delays')
     * @param {string} defaultValue - Fallback value if nothing found
     * @param {string} legacyAiPath - Legacy field name for backwards compatibility (e.g., 'generalIssues')
     */
    function getTextFieldValue(reportPath, aiPath, defaultValue = '', legacyAiPath = null) {
        // 1. Check user edits first - user edits always win
        if (userEdits[reportPath] !== undefined) {
            return userEdits[reportPath];
        }

        // 2. Check AI-generated data (try new field name first, then legacy)
        if (report.aiGenerated) {
            // Try new v6.6 field name
            let aiValue = getNestedValue(report.aiGenerated, aiPath);
            
            // Fallback to legacy field name for backwards compatibility
            if ((aiValue === undefined || aiValue === null || aiValue === '') && legacyAiPath) {
                aiValue = getNestedValue(report.aiGenerated, legacyAiPath);
            }
            
            if (aiValue !== undefined && aiValue !== null && aiValue !== '') {
                if (Array.isArray(aiValue)) {
                    return aiValue.join('\n');
                }
                return aiValue;
            }
        }

        // 3. Check existing report data
        const reportValue = getNestedValue(report, reportPath);
        if (reportValue !== undefined && reportValue !== null && reportValue !== '') {
            if (Array.isArray(reportValue)) {
                return reportValue.join('\n');
            }
            return reportValue;
        }

        // 4. Return default (which may come from guidedNotes/fieldNotes)
        return defaultValue;
    }

    function setNestedValue(obj, path, value) {
        const keys = path.split('.');
        const lastKey = keys.pop();
        const target = keys.reduce((o, k) => {
            if (!o[k]) o[k] = {};
            return o[k];
        }, obj);
        target[lastKey] = value;
    }

    // ============ POPULATE FIELDS ============
    function populateAllFields() {
        // Display project logo if exists
        // Priority: logoUrl (full quality) > logoThumbnail (compressed) > logo (legacy)
        const logoContainer = document.getElementById('projectLogoContainer');
        const logoImg = document.getElementById('projectLogo');
        const logoSrc = activeProject?.logoUrl || activeProject?.logoThumbnail || activeProject?.logo;
        if (logoSrc) {
            logoImg.src = logoSrc;
            logoContainer.classList.remove('hidden');
        } else {
            logoContainer.classList.add('hidden');
        }

        // Project Overview - Left Column
        document.getElementById('projectName').value = getValue('overview.projectName', activeProject?.projectName || '');
        document.getElementById('noabProjectNo').value = getValue('overview.noabProjectNo', activeProject?.noabProjectNo || '');
        document.getElementById('cnoSolicitationNo').value = getValue('overview.cnoSolicitationNo', activeProject?.cnoSolicitationNo || 'N/A');

        // Notice to Proceed (display only from project config)
        const ntpInput = document.getElementById('noticeToProceed');
        if (activeProject?.noticeToProceed) {
            ntpInput.value = activeProject.noticeToProceed;
        }

        // Contract Duration (display only)
        const durationInput = document.getElementById('contractDuration');
        if (activeProject?.contractDuration) {
            durationInput.value = activeProject.contractDuration + ' days';
        }

        // Expected Completion (display only from project config)
        const expectedInput = document.getElementById('expectedCompletion');
        if (activeProject?.expectedCompletion) {
            expectedInput.value = activeProject.expectedCompletion;
        }

        // Contract Day (editable, format as "Day X of Y")
        const contractDayValue = getValue('overview.contractDay', activeProject?.contractDayNo || '');
        const contractDayInput = document.getElementById('contractDay');
        if (contractDayValue && activeProject?.contractDuration) {
            contractDayInput.value = `Day ${contractDayValue} of ${activeProject.contractDuration}`;
        } else if (contractDayValue) {
            contractDayInput.value = contractDayValue;
        }

        // Weather Days (editable)
        document.getElementById('weatherDaysCount').value = getValue('overview.weatherDays', activeProject?.weatherDays || 0);

        // Project Overview - Right Column
        // Date
        const dateStr = getValue('overview.date', new Date().toLocaleDateString());
        const dateInput = document.getElementById('reportDate');
        try {
            const d = new Date(dateStr);
            dateInput.value = d.toISOString().split('T')[0];
        } catch (e) {
            dateInput.value = new Date().toISOString().split('T')[0];
        }

        document.getElementById('projectLocation').value = getValue('overview.location', activeProject?.location || '');
        document.getElementById('engineer').value = getValue('overview.engineer', activeProject?.engineer || '');
        document.getElementById('contractor').value = getValue('overview.contractor', activeProject?.primeContractor || '');

        // Start/End Time (editable, defaults from project config)
        document.getElementById('startTime').value = getValue('overview.startTime', activeProject?.defaultStartTime || '06:00');
        document.getElementById('endTime').value = getValue('overview.endTime', activeProject?.defaultEndTime || '16:00');

        // Calculate and display shift duration
        calculateShiftDuration();

        document.getElementById('completedBy').value = getValue('overview.completedBy', '');

        // Weather
        document.getElementById('weatherHigh').value = getValue('overview.weather.highTemp', '');
        document.getElementById('weatherLow').value = getValue('overview.weather.lowTemp', '');
        document.getElementById('weatherPrecip').value = getValue('overview.weather.precipitation', '');
        document.getElementById('weatherCondition').value = getValue('overview.weather.generalCondition', '');
        document.getElementById('weatherJobSite').value = getValue('overview.weather.jobSiteCondition', '');
        document.getElementById('weatherAdverse').value = getValue('overview.weather.adverseConditions', '');

        // Text sections - check AI-generated paths with correct field names
        // Priority: userEdits > aiGenerated > guidedNotes/fieldNotes > report defaults
        // v6.6: Updated field names (issues_delays, qaqc_notes, communications, visitors_deliveries, safety.summary)
        document.getElementById('issuesText').value = getTextFieldValue('issues', 'issues_delays',
            report.guidedNotes?.issues || '', 'generalIssues');
        document.getElementById('qaqcText').value = getTextFieldValue('qaqc', 'qaqc_notes', '', 'qaqcNotes');
        document.getElementById('safetyText').value = getTextFieldValue('safety.notes', 'safety.summary',
            report.guidedNotes?.safety || '', 'safety.notes');
        document.getElementById('communicationsText').value = getTextFieldValue('communications',
            'communications', '', 'contractorCommunications');
        document.getElementById('visitorsText').value = getTextFieldValue('visitors', 'visitors_deliveries', '', 'visitorsRemarks');

        // Safety incident toggle
        // v6.6: Check both old (hasIncident/hasIncidents) and new (has_incidents) field names
        const hasIncident = getValue('safety.hasIncident', false) || 
                            report.aiGenerated?.safety?.has_incidents || 
                            report.aiGenerated?.safety?.hasIncidents || 
                            false;
        document.getElementById('safetyNoIncident').checked = !hasIncident;
        document.getElementById('safetyHasIncident').checked = hasIncident;

        // Signature
        document.getElementById('signatureName').value = getValue('signature.name', '');
        document.getElementById('signatureTitle').value = getValue('signature.title', '');
        document.getElementById('signatureCompany').value = getValue('signature.company', '');
        document.getElementById('signatureDate').textContent = new Date().toLocaleDateString();

        // Render dynamic sections
        renderWorkSummary();
        renderPersonnelTable();
        renderEquipmentTable();
        renderPhotos();

        // Mark user-edited fields
        markUserEditedFields();
    }

    function calculateShiftDuration() {
        const startTime = document.getElementById('startTime').value;
        const endTime = document.getElementById('endTime').value;
        const durationInput = document.getElementById('shiftDuration');

        if (startTime && endTime) {
            const start = new Date(`2000-01-01T${startTime}`);
            const end = new Date(`2000-01-01T${endTime}`);
            let diffMs = end - start;

            // Handle overnight shifts
            if (diffMs < 0) {
                diffMs += 24 * 60 * 60 * 1000;
            }

            const hours = Math.floor(diffMs / (1000 * 60 * 60));
            const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

            if (minutes > 0) {
                durationInput.value = `${hours}h ${minutes}m`;
            } else {
                durationInput.value = `${hours} hours`;
            }
        } else {
            durationInput.value = '';
        }
    }

    function markUserEditedFields() {
        Object.keys(userEdits).forEach(path => {
            const fieldId = pathToFieldId(path);
            const field = document.getElementById(fieldId);
            if (field) {
                field.classList.add('user-edited');
            }
        });
    }

    function pathToFieldId(path) {
        // Convert paths like 'overview.projectName' to 'projectName'
        const mapping = {
            'overview.projectName': 'projectName',
            'overview.noabProjectNo': 'noabProjectNo',
            'overview.cnoSolicitationNo': 'cnoSolicitationNo',
            'overview.location': 'projectLocation',
            'overview.contractDay': 'contractDay',
            'overview.weatherDays': 'weatherDaysCount',
            'overview.engineer': 'engineer',
            'overview.contractor': 'contractor',
            'overview.startTime': 'startTime',
            'overview.endTime': 'endTime',
            'overview.completedBy': 'completedBy',
            'overview.weather.highTemp': 'weatherHigh',
            'overview.weather.lowTemp': 'weatherLow',
            'overview.weather.precipitation': 'weatherPrecip',
            'overview.weather.generalCondition': 'weatherCondition',
            'overview.weather.jobSiteCondition': 'weatherJobSite',
            'overview.weather.adverseConditions': 'weatherAdverse',
            'issues': 'issuesText',
            'qaqc': 'qaqcText',
            'safety.notes': 'safetyText',
            'communications': 'communicationsText',
            'visitors': 'visitorsText',
            'signature.name': 'signatureName',
            'signature.title': 'signatureTitle',
            'signature.company': 'signatureCompany'
        };
        return mapping[path] || path;
    }

    // ============ RENDER WORK SUMMARY ============
    function renderWorkSummary() {
        const container = document.getElementById('workSummaryContainer');

        if (projectContractors.length === 0) {
            // Show simplified work summary if no contractors defined
            container.innerHTML = `
                <div class="bg-slate-50 border border-slate-200 p-4 rounded">
                    <p class="text-xs font-bold text-slate-500 uppercase mb-2">Work Summary</p>
                    <textarea id="generalWorkSummary" class="editable-field auto-expand w-full px-3 py-2 text-sm"
                        placeholder="Describe all work performed today..."
                        data-path="guidedNotes.workSummary">${getValue('guidedNotes.workSummary', '')}</textarea>
                    <p class="text-xs text-slate-400 mt-1">No project contractors defined. Add contractors in Project Settings.</p>
                </div>
            `;
            initAllAutoExpandTextareas();
            return;
        }

        // Render contractor cards
        container.innerHTML = projectContractors.map((contractor, index) => {
            const activity = getContractorActivity(contractor.id);
            const noWork = activity?.noWork ?? true;
            const narrative = activity?.narrative || '';
            const equipment = activity?.equipmentUsed || '';
            const crew = activity?.crew || '';

            const typeLabel = contractor.type === 'prime' ? 'PRIME' : 'SUB';
            const borderColor = contractor.type === 'prime' ? 'border-safety-green' : 'border-dot-blue';
            const badgeBg = contractor.type === 'prime' ? 'bg-safety-green' : 'bg-dot-blue';

            return `
                <div class="contractor-card rounded ${noWork && !narrative ? 'no-work' : 'has-content'}" data-contractor-id="${contractor.id}">
                    <div class="p-4">
                        <div class="flex items-center gap-3 mb-3">
                            <span class="${badgeBg} text-white text-[10px] font-bold px-2 py-0.5 uppercase">${typeLabel}</span>
                            <span class="font-bold text-slate-800">${escapeHtml(contractor.name)}</span>
                            ${contractor.trades ? `<span class="text-xs text-slate-500">(${escapeHtml(contractor.trades)})</span>` : ''}
                        </div>

                        <label class="flex items-center gap-2 p-2 bg-slate-100 border border-slate-200 cursor-pointer mb-3">
                            <input type="checkbox" class="w-4 h-4 no-work-checkbox"
                                data-contractor-id="${contractor.id}"
                                ${noWork ? 'checked' : ''}
                                onchange="toggleNoWork('${contractor.id}', this.checked)">
                            <span class="text-sm text-slate-600">No work performed today</span>
                        </label>

                        <div class="work-fields ${noWork ? 'hidden' : ''}" data-contractor-id="${contractor.id}">
                            <div class="mb-3">
                                <label class="block text-xs font-bold text-slate-500 uppercase mb-1">Work Narrative</label>
                                <textarea class="editable-field auto-expand w-full px-3 py-2 text-sm contractor-narrative"
                                    data-contractor-id="${contractor.id}"
                                    placeholder="Describe work performed by ${contractor.name}...">${escapeHtml(narrative)}</textarea>
                            </div>
                            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label class="block text-xs font-bold text-slate-500 uppercase mb-1">Equipment Used</label>
                                    <input type="text" class="editable-field w-full px-3 py-2 text-sm contractor-equipment"
                                        data-contractor-id="${contractor.id}"
                                        placeholder="e.g., Excavator (1), Dump Truck (2)"
                                        value="${escapeHtml(equipment)}">
                                </div>
                                <div>
                                    <label class="block text-xs font-bold text-slate-500 uppercase mb-1">Crew</label>
                                    <input type="text" class="editable-field w-full px-3 py-2 text-sm contractor-crew"
                                        data-contractor-id="${contractor.id}"
                                        placeholder="e.g., Foreman (1), Laborers (4)"
                                        value="${escapeHtml(crew)}">
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        initAllAutoExpandTextareas();
        setupContractorListeners();
    }

    /**
     * Get contractor activity with priority: userEdits > aiGenerated > report.activities
     * v6.6: Supports matching by contractorName for freeform mode (when contractorId is null)
     */
    function getContractorActivity(contractorId) {
        // Check if user has edited this contractor's activity
        const userEditKey = `activity_${contractorId}`;
        if (userEdits[userEditKey]) {
            return userEdits[userEditKey];
        }

        // Get contractor name for freeform matching
        const contractor = projectContractors.find(c => c.id === contractorId);
        const contractorName = contractor?.name;

        // Check AI-generated activities first
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
            
            if (aiActivity) {
                return {
                    contractorId: contractorId,
                    noWork: aiActivity.noWork ?? false,
                    narrative: aiActivity.narrative || '',
                    equipmentUsed: aiActivity.equipmentUsed || '',
                    crew: aiActivity.crew || ''
                };
            }
        }

        // Fall back to report.activities
        if (!report.activities) return null;
        return report.activities.find(a => a.contractorId === contractorId);
    }

    function toggleNoWork(contractorId, isNoWork) {
        const workFields = document.querySelector(`.work-fields[data-contractor-id="${contractorId}"]`);
        const card = document.querySelector(`.contractor-card[data-contractor-id="${contractorId}"]`);

        if (isNoWork) {
            workFields.classList.add('hidden');
            card.classList.add('no-work');
            card.classList.remove('has-content');
        } else {
            workFields.classList.remove('hidden');
            card.classList.remove('no-work');
            card.classList.add('has-content');
            // Focus narrative field
            const narrative = workFields.querySelector('.contractor-narrative');
            if (narrative) setTimeout(() => narrative.focus(), 100);
        }

        updateContractorActivity(contractorId);
    }

    function setupContractorListeners() {
        // Narrative textareas
        document.querySelectorAll('.contractor-narrative').forEach(el => {
            el.addEventListener('blur', () => {
                updateContractorActivity(el.dataset.contractorId);
            });
        });

        // Equipment inputs
        document.querySelectorAll('.contractor-equipment').forEach(el => {
            el.addEventListener('blur', () => {
                updateContractorActivity(el.dataset.contractorId);
            });
        });

        // Crew inputs
        document.querySelectorAll('.contractor-crew').forEach(el => {
            el.addEventListener('blur', () => {
                updateContractorActivity(el.dataset.contractorId);
            });
        });
    }

    function updateContractorActivity(contractorId) {
        if (!report.activities) report.activities = [];

        const checkbox = document.querySelector(`.no-work-checkbox[data-contractor-id="${contractorId}"]`);
        const narrative = document.querySelector(`.contractor-narrative[data-contractor-id="${contractorId}"]`);
        const equipment = document.querySelector(`.contractor-equipment[data-contractor-id="${contractorId}"]`);
        const crew = document.querySelector(`.contractor-crew[data-contractor-id="${contractorId}"]`);

        let activity = report.activities.find(a => a.contractorId === contractorId);
        if (!activity) {
            activity = { contractorId };
            report.activities.push(activity);
        }

        activity.noWork = checkbox?.checked ?? true;
        activity.narrative = narrative?.value?.trim() || '';
        activity.equipmentUsed = equipment?.value?.trim() || '';
        activity.crew = crew?.value?.trim() || '';

        // Track in userEdits for persistence
        const userEditKey = `activity_${contractorId}`;
        userEdits[userEditKey] = activity;
        report.userEdits = userEdits;

        // Add visual indicator to edited fields
        if (narrative) narrative.classList.add('user-edited');
        if (equipment) equipment.classList.add('user-edited');
        if (crew) crew.classList.add('user-edited');

        scheduleSave();
    }

    // ============ RENDER PERSONNEL TABLE ============
    function renderPersonnelTable() {
        const tbody = document.getElementById('personnelTableBody');

        if (projectContractors.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="9" class="text-center text-slate-400 py-4">
                        No contractors defined. Add contractors in Project Settings.
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = projectContractors.map(contractor => {
            const ops = getContractorOperations(contractor.id);
            return `
                <tr data-contractor-id="${contractor.id}">
                    <td class="font-medium text-xs">${escapeHtml(contractor.abbreviation || contractor.name)}</td>
                    <td class="text-xs">${escapeHtml(contractor.trades || '-')}</td>
                    <td><input type="number" class="personnel-input" data-contractor-id="${contractor.id}" data-field="superintendents" value="${ops?.superintendents || ''}" min="0" placeholder="-"></td>
                    <td><input type="number" class="personnel-input" data-contractor-id="${contractor.id}" data-field="foremen" value="${ops?.foremen || ''}" min="0" placeholder="-"></td>
                    <td><input type="number" class="personnel-input" data-contractor-id="${contractor.id}" data-field="operators" value="${ops?.operators || ''}" min="0" placeholder="-"></td>
                    <td><input type="number" class="personnel-input" data-contractor-id="${contractor.id}" data-field="laborers" value="${ops?.laborers || ''}" min="0" placeholder="-"></td>
                    <td><input type="number" class="personnel-input" data-contractor-id="${contractor.id}" data-field="surveyors" value="${ops?.surveyors || ''}" min="0" placeholder="-"></td>
                    <td><input type="number" class="personnel-input" data-contractor-id="${contractor.id}" data-field="others" value="${ops?.others || ''}" min="0" placeholder="-"></td>
                    <td class="text-center font-bold row-total">0</td>
                </tr>
            `;
        }).join('');

        // Setup listeners
        document.querySelectorAll('.personnel-input').forEach(input => {
            input.addEventListener('change', () => {
                updatePersonnelRow(input.dataset.contractorId);
                updatePersonnelTotals();
            });
        });

        updatePersonnelTotals();
    }

    /**
     * Get contractor operations/personnel with priority: userEdits > aiGenerated > report.operations
     * v6.6: Supports matching by contractorName for freeform mode (when contractorId is null)
     */
    function getContractorOperations(contractorId) {
        // Check if user has edited this contractor's operations
        const userEditKey = `operations_${contractorId}`;
        if (userEdits[userEditKey]) {
            return userEdits[userEditKey];
        }

        // Get contractor name for freeform matching
        const contractor = projectContractors.find(c => c.id === contractorId);
        const contractorName = contractor?.name;

        // Check AI-generated operations first
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
            
            if (aiOps) {
                return {
                    contractorId: contractorId,
                    superintendents: aiOps.superintendents || null,
                    foremen: aiOps.foremen || null,
                    operators: aiOps.operators || null,
                    laborers: aiOps.laborers || null,
                    surveyors: aiOps.surveyors || null,
                    others: aiOps.others || null
                };
            }
        }

        // Fall back to report.operations
        if (!report.operations) return null;
        return report.operations.find(o => o.contractorId === contractorId);
    }

    function updatePersonnelRow(contractorId) {
        if (!report.operations) report.operations = [];

        let ops = report.operations.find(o => o.contractorId === contractorId);
        if (!ops) {
            ops = { contractorId };
            report.operations.push(ops);
        }

        const row = document.querySelector(`tr[data-contractor-id="${contractorId}"]`);
        const inputs = row.querySelectorAll('.personnel-input');

        let rowTotal = 0;
        inputs.forEach(input => {
            const value = parseInt(input.value) || 0;
            ops[input.dataset.field] = value || null;
            rowTotal += value;
            input.classList.add('user-edited');
        });

        // Track in userEdits for persistence
        const userEditKey = `operations_${contractorId}`;
        userEdits[userEditKey] = ops;
        report.userEdits = userEdits;

        row.querySelector('.row-total').textContent = rowTotal || '-';
        scheduleSave();
    }

    function updatePersonnelTotals() {
        const fields = ['superintendents', 'foremen', 'operators', 'laborers', 'surveyors', 'others'];
        const totals = { superintendents: 0, foremen: 0, operators: 0, laborers: 0, surveyors: 0, others: 0 };
        let grandTotal = 0;

        document.querySelectorAll('.personnel-input').forEach(input => {
            const value = parseInt(input.value) || 0;
            totals[input.dataset.field] += value;
            grandTotal += value;
        });

        document.getElementById('totalSuper').textContent = totals.superintendents || '-';
        document.getElementById('totalForeman').textContent = totals.foremen || '-';
        document.getElementById('totalOperators').textContent = totals.operators || '-';
        document.getElementById('totalLaborers').textContent = totals.laborers || '-';
        document.getElementById('totalSurveyors').textContent = totals.surveyors || '-';
        document.getElementById('totalOthers').textContent = totals.others || '-';
        document.getElementById('totalAll').textContent = grandTotal || '-';
    }

    // ============ RENDER EQUIPMENT TABLE ============
    /**
     * Get equipment data with priority: report.equipment (user edited) > aiGenerated.equipment
     * v6.6: Supports resolving contractorId from contractorName for freeform mode
     */
    function getEquipmentData() {
        // If user has saved equipment data, use that
        if (report.equipment && report.equipment.length > 0) {
            return report.equipment;
        }

        // Check AI-generated equipment
        if (report.aiGenerated?.equipment && report.aiGenerated.equipment.length > 0) {
            return report.aiGenerated.equipment.map(aiItem => {
                // Try to match equipmentId to project config for type/model
                let type = aiItem.type || '';
                if (aiItem.equipmentId && activeProject?.equipment) {
                    const projectEquip = activeProject.equipment.find(e => e.id === aiItem.equipmentId);
                    if (projectEquip) {
                        type = projectEquip.type || projectEquip.model || type;
                    }
                }
                
                // v6.6: Resolve contractorId from contractorName for freeform mode
                let contractorId = aiItem.contractorId || '';
                if (!contractorId && aiItem.contractorName) {
                    const matchedContractor = projectContractors.find(c => 
                        c.name?.toLowerCase() === aiItem.contractorName?.toLowerCase()
                    );
                    if (matchedContractor) {
                        contractorId = matchedContractor.id;
                    }
                }
                
                return {
                    contractorId: contractorId,
                    contractorName: aiItem.contractorName || '',
                    type: type,
                    qty: aiItem.qty || aiItem.quantity || 1,
                    status: aiItem.status || aiItem.hoursUsed ? `${aiItem.hoursUsed} hrs` : 'IDLE'
                };
            });
        }

        return [];
    }

    function renderEquipmentTable() {
        const tbody = document.getElementById('equipmentTableBody');
        const equipmentData = getEquipmentData();

        if (equipmentData.length === 0) {
            // Show empty state with one blank row
            tbody.innerHTML = `
                <tr data-equipment-index="0">
                    <td>
                        <select class="equipment-contractor w-full text-xs p-1">
                            <option value="">Select...</option>
                            ${projectContractors.map(c => `<option value="${c.id}">${escapeHtml(c.abbreviation || c.name)}</option>`).join('')}
                        </select>
                    </td>
                    <td><input type="text" class="equipment-type w-full text-xs" placeholder="e.g., CAT 320 Excavator"></td>
                    <td><input type="number" class="equipment-qty w-full text-xs text-center" value="1" min="1"></td>
                    <td>
                        <select class="equipment-status w-full text-xs p-1">
                            <option value="IDLE">IDLE</option>
                            ${[1,2,3,4,5,6,7,8,9,10].map(h => `<option value="${h} hrs">${h} hrs utilized</option>`).join('')}
                        </select>
                    </td>
                </tr>
            `;
            setupEquipmentListeners();
            return;
        }

        tbody.innerHTML = equipmentData.map((item, index) => `
            <tr data-equipment-index="${index}">
                <td>
                    <select class="equipment-contractor w-full text-xs p-1">
                        <option value="">Select...</option>
                        ${projectContractors.map(c => `<option value="${c.id}" ${item.contractorId === c.id ? 'selected' : ''}>${escapeHtml(c.abbreviation || c.name)}</option>`).join('')}
                    </select>
                </td>
                <td><input type="text" class="equipment-type w-full text-xs" value="${escapeHtml(item.type || '')}" placeholder="e.g., CAT 320 Excavator"></td>
                <td><input type="number" class="equipment-qty w-full text-xs text-center" value="${item.qty || 1}" min="1"></td>
                <td>
                    <select class="equipment-status w-full text-xs p-1">
                        <option value="IDLE" ${item.status === 'IDLE' ? 'selected' : ''}>IDLE</option>
                        ${[1,2,3,4,5,6,7,8,9,10].map(h => `<option value="${h} hrs" ${item.status === `${h} hrs` ? 'selected' : ''}>${h} hrs utilized</option>`).join('')}
                    </select>
                </td>
            </tr>
        `).join('');

        setupEquipmentListeners();
    }

    function setupEquipmentListeners() {
        document.querySelectorAll('#equipmentTableBody tr').forEach(row => {
            row.querySelectorAll('input, select').forEach(input => {
                input.addEventListener('change', () => updateEquipmentRow(row));
            });
        });
    }

    function updateEquipmentRow(row) {
        const index = parseInt(row.dataset.equipmentIndex);
        if (!report.equipment) report.equipment = [];

        const item = {
            contractorId: row.querySelector('.equipment-contractor').value,
            type: row.querySelector('.equipment-type').value.trim(),
            qty: parseInt(row.querySelector('.equipment-qty').value) || 1,
            status: row.querySelector('.equipment-status').value
        };

        if (index < report.equipment.length) {
            report.equipment[index] = item;
        } else {
            report.equipment.push(item);
        }

        scheduleSave();
    }

    function addEquipmentRow() {
        const tbody = document.getElementById('equipmentTableBody');
        const newIndex = tbody.querySelectorAll('tr').length;

        const newRow = document.createElement('tr');
        newRow.dataset.equipmentIndex = newIndex;
        newRow.innerHTML = `
            <td>
                <select class="equipment-contractor w-full text-xs p-1">
                    <option value="">Select...</option>
                    ${projectContractors.map(c => `<option value="${c.id}">${escapeHtml(c.abbreviation || c.name)}</option>`).join('')}
                </select>
            </td>
            <td><input type="text" class="equipment-type w-full text-xs" placeholder="e.g., CAT 320 Excavator"></td>
            <td><input type="number" class="equipment-qty w-full text-xs text-center" value="1" min="1"></td>
            <td>
                <select class="equipment-status w-full text-xs p-1">
                    <option value="IDLE">IDLE</option>
                    ${[1,2,3,4,5,6,7,8,9,10].map(h => `<option value="${h} hrs">${h} hrs utilized</option>`).join('')}
                </select>
            </td>
        `;

        tbody.appendChild(newRow);

        // Setup listeners for new row
        newRow.querySelectorAll('input, select').forEach(input => {
            input.addEventListener('change', () => updateEquipmentRow(newRow));
        });

        // Focus the type input
        newRow.querySelector('.equipment-type').focus();
    }

    // ============ RENDER PHOTOS ============
    function renderPhotos() {
        const container = document.getElementById('photosContainer');
        const photos = report.photos || [];
        const totalPhotos = photos.length;

        document.getElementById('photoCount').textContent = `${totalPhotos} photo${totalPhotos !== 1 ? 's' : ''}`;

        if (totalPhotos === 0) {
            container.innerHTML = `
                <div class="text-center text-slate-400 py-12">
                    <i class="fas fa-images text-5xl mb-3"></i>
                    <p class="text-sm font-medium">No photos captured</p>
                    <p class="text-xs mt-1">Photos from field capture will appear here</p>
                </div>
            `;
            return;
        }

        container.innerHTML = photos.map((photo, index) => {
            const photoNum = index + 1;
            const dateStr = photo.date || '--';
            const timeStr = photo.time || '--';
            const gpsStr = photo.gps
                ? `${photo.gps.lat.toFixed(5)}, ${photo.gps.lng.toFixed(5)}`
                : null;

            return `
                <div class="photo-card" data-photo-index="${index}">
                    <!-- Photo Header -->
                    <div class="photo-card-header">
                        <span>Photo ${photoNum} of ${totalPhotos}</span>
                    </div>

                    <!-- Photo Image Container -->
                    <div class="photo-card-image" id="photo-container-${index}">
                        <!-- Loading state -->
                        <div class="photo-loading" id="photo-loading-${index}">
                            <i class="fas fa-spinner fa-spin text-2xl text-slate-400"></i>
                        </div>
                        <!-- Image (hidden until loaded) -->
                        <img
                            src="${photo.url}"
                            alt="Progress photo ${photoNum}"
                            id="photo-img-${index}"
                            style="display: none;"
                            onload="handlePhotoLoad(${index})"
                            onerror="handlePhotoError(${index})"
                        >
                    </div>

                    <!-- Photo Footer with metadata and caption -->
                    <div class="photo-card-footer">
                        <!-- Metadata Row -->
                        <div class="photo-card-meta">
                            <div class="photo-card-meta-item">
                                <i class="fas fa-calendar-alt"></i>
                                <span>${dateStr}</span>
                            </div>
                            <div class="photo-card-meta-item">
                                <i class="fas fa-clock"></i>
                                <span>${timeStr}</span>
                            </div>
                            ${gpsStr ? `
                            <div class="photo-card-meta-item">
                                <i class="fas fa-map-marker-alt"></i>
                                <span>${gpsStr}</span>
                            </div>
                            ` : ''}
                        </div>

                        <!-- Caption -->
                        <div>
                            <label class="block text-xs font-bold text-slate-500 uppercase mb-1">Caption</label>
                            <textarea
                                class="photo-card-caption auto-expand"
                                data-photo-index="${index}"
                                placeholder="Describe what this photo shows..."
                            >${escapeHtml(photo.caption || '')}</textarea>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        // Setup caption listeners
        document.querySelectorAll('.photo-card-caption').forEach(textarea => {
            textarea.addEventListener('blur', () => {
                const index = parseInt(textarea.dataset.photoIndex);
                if (report.photos[index]) {
                    report.photos[index].caption = textarea.value.trim();
                    scheduleSave();
                }
            });
            // Also save on input with debounce for better UX
            textarea.addEventListener('input', debounce(() => {
                const index = parseInt(textarea.dataset.photoIndex);
                if (report.photos[index]) {
                    report.photos[index].caption = textarea.value.trim();
                    scheduleSave();
                }
            }, 1000));
        });

        initAllAutoExpandTextareas();
    }

    /**
     * Handle successful photo load - detect orientation and show image
     */
    function handlePhotoLoad(index) {
        const img = document.getElementById(`photo-img-${index}`);
        const container = document.getElementById(`photo-container-${index}`);
        const loading = document.getElementById(`photo-loading-${index}`);

        if (!img || !container) return;

        // Hide loading spinner
        if (loading) loading.style.display = 'none';

        // Detect orientation based on natural dimensions
        const isPortrait = img.naturalHeight > img.naturalWidth;
        container.classList.remove('portrait', 'landscape');
        container.classList.add(isPortrait ? 'portrait' : 'landscape');

        // Show the image
        img.style.display = 'block';
    }

    /**
     * Handle photo load error - show error state
     */
    function handlePhotoError(index) {
        const container = document.getElementById(`photo-container-${index}`);
        const loading = document.getElementById(`photo-loading-${index}`);

        if (!container) return;

        // Hide loading spinner
        if (loading) loading.style.display = 'none';

        // Show error message
        container.innerHTML = `
            <div class="photo-error">
                <i class="fas fa-exclamation-triangle text-3xl mb-2"></i>
                <p class="font-medium">Failed to load image</p>
                <p class="text-xs mt-1">The photo may be corrupted or missing</p>
            </div>
        `;
    }

    /**
     * Simple debounce function
     */
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // ============ AUTO-SAVE ============
    function setupAutoSave() {
        // Field mappings for auto-save
        const fieldMappings = {
            'projectName': 'overview.projectName',
            'noabProjectNo': 'overview.noabProjectNo',
            'cnoSolicitationNo': 'overview.cnoSolicitationNo',
            'projectLocation': 'overview.location',
            'reportDate': 'overview.date',
            'contractDay': 'overview.contractDay',
            'weatherDaysCount': 'overview.weatherDays',
            'engineer': 'overview.engineer',
            'contractor': 'overview.contractor',
            'startTime': 'overview.startTime',
            'endTime': 'overview.endTime',
            'completedBy': 'overview.completedBy',
            'weatherHigh': 'overview.weather.highTemp',
            'weatherLow': 'overview.weather.lowTemp',
            'weatherPrecip': 'overview.weather.precipitation',
            'weatherCondition': 'overview.weather.generalCondition',
            'weatherJobSite': 'overview.weather.jobSiteCondition',
            'weatherAdverse': 'overview.weather.adverseConditions',
            'issuesText': 'issues',
            'qaqcText': 'qaqc',
            'safetyText': 'safety.notes',
            'communicationsText': 'communications',
            'visitorsText': 'visitors',
            'signatureName': 'signature.name',
            'signatureTitle': 'signature.title',
            'signatureCompany': 'signature.company'
        };

        Object.entries(fieldMappings).forEach(([fieldId, path]) => {
            const field = document.getElementById(fieldId);
            if (!field) return;

            // v6.6.3: Input event with debounce - saves 500ms after typing stops
            field.addEventListener('input', () => {
                // Update userEdits immediately so data isn't lost
                const value = field.value;
                setNestedValue(report, path, value);
                userEdits[path] = value;
                report.userEdits = userEdits;
                field.classList.add('user-edited');

                // Debounced save to localStorage
                scheduleSave();
            });

            // Safety net: blur cancels pending debounce and saves immediately
            field.addEventListener('blur', () => {
                if (saveTimeout) {
                    clearTimeout(saveTimeout);
                    saveTimeout = null;
                }
                // Save immediately on blur
                saveReportToLocalStorage();
                showSaveIndicator();
            });
        });

        // Recalculate shift duration when start/end time changes
        ['startTime', 'endTime'].forEach(fieldId => {
            const field = document.getElementById(fieldId);
            if (field) {
                field.addEventListener('change', calculateShiftDuration);
            }
        });

        // Safety incident toggle
        document.querySelectorAll('input[name="safetyIncident"]').forEach(radio => {
            radio.addEventListener('change', () => {
                const hasIncident = document.getElementById('safetyHasIncident').checked;
                report.safety = report.safety || {};
                report.safety.hasIncident = hasIncident;
                userEdits['safety.hasIncident'] = hasIncident;
                report.userEdits = userEdits;
                scheduleSave();
            });
        });

        // General work summary (when no contractors)
        const generalSummary = document.getElementById('generalWorkSummary');
        if (generalSummary) {
            const path = 'guidedNotes.workSummary';

            // v6.6.3: Input event with debounce
            generalSummary.addEventListener('input', () => {
                const value = generalSummary.value;
                setNestedValue(report, path, value);
                userEdits[path] = value;
                report.userEdits = userEdits;
                generalSummary.classList.add('user-edited');
                scheduleSave();
            });

            // Safety net: blur saves immediately
            generalSummary.addEventListener('blur', () => {
                if (saveTimeout) {
                    clearTimeout(saveTimeout);
                    saveTimeout = null;
                }
                saveReportToLocalStorage();
                showSaveIndicator();
            });
        }
    }

    function scheduleSave() {
        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            saveReport();
        }, 500);
    }

    async function saveReport() {
        // Save to localStorage (primary storage for report.html)
        saveReportToLocalStorage();
        showSaveIndicator();
    }

    /**
     * v6.6.2: Save report data to localStorage using single key pattern
     * Key: fvp_report_{reportId}
     */
    function saveReportToLocalStorage() {
        if (!currentReportId) {
            console.warn('[LOCAL] No reportId, cannot save');
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
            originalInput: report.originalInput || existingData.originalInput || {},

            // User edits - this is what we're updating
            userEdits: report.userEdits || {},

            // Metadata
            createdAt: existingData.createdAt || report.meta?.createdAt || new Date().toISOString(),
            lastSaved: new Date().toISOString()
        };

        // Use saveReportData from storage-keys.js
        const success = saveReportData(currentReportId, reportToSave);
        if (success) {
            console.log('[LOCAL] Report saved to localStorage:', currentReportId);
        } else {
            console.error('[LOCAL] Failed to save report to localStorage');
        }
    }

    /**
     * Actually save report to Supabase
     */
    async function saveReportToSupabase() {
        if (isSaving || !activeProject) return;
        isSaving = true;

        try {
            const reportDateStr = getReportDateStr();

            // 1. Upsert the main report record
            let reportId = currentReportId;
            if (!reportId) {
                // Check if a report already exists for this project+date before generating new ID
                const { data: existingReport } = await supabaseClient
                    .from('reports')
                    .select('id')
                    .eq('project_id', activeProject.id)
                    .eq('report_date', reportDateStr)
                    .maybeSingle();

                reportId = existingReport?.id || generateId();
            }

            const reportData = {
                id: reportId,
                project_id: activeProject.id,
                report_date: reportDateStr,
                inspector_name: report.overview?.completedBy || userSettings?.full_name || '',
                status: report.meta?.status || 'draft',
                updated_at: new Date().toISOString()
            };

            const { error: reportError } = await supabaseClient
                .from('reports')
                .upsert(reportData, { onConflict: 'id' });

            if (reportError) {
                console.error('Error saving report:', reportError);
                isSaving = false;
                return;
            }

            currentReportId = reportId;

            // 2. Upsert raw capture data
            // Build user_edits array for storage in raw_data
            const userEditsArray = report.userEdits && Object.keys(report.userEdits).length > 0
                ? Object.entries(report.userEdits).map(([fieldPath, editedValue]) => ({
                    field_path: fieldPath,
                    edited_value: typeof editedValue === 'string' ? editedValue : JSON.stringify(editedValue),
                    edited_at: new Date().toISOString()
                }))
                : [];

            // Build contractor_work array for storage in raw_data
            const contractorWorkArray = report.activities && report.activities.length > 0
                ? report.activities.map(a => ({
                    contractor_id: a.contractorId,
                    no_work_performed: a.noWork || false,
                    narrative: a.narrative || '',
                    equipment_used: a.equipmentUsed || '',
                    crew: a.crew || ''
                }))
                : [];

            // Build personnel array for storage in raw_data
            const personnelArray = report.operations && report.operations.length > 0
                ? report.operations.map(o => ({
                    contractor_id: o.contractorId,
                    superintendents: o.superintendents || 0,
                    foremen: o.foremen || 0,
                    operators: o.operators || 0,
                    laborers: o.laborers || 0,
                    surveyors: o.surveyors || 0,
                    others: o.others || 0
                }))
                : [];

            // Build equipment_usage array for storage in raw_data
            const equipmentUsageArray = report.equipment && report.equipment.length > 0
                ? report.equipment.map(e => ({
                    equipment_id: e.equipmentId,
                    contractor_id: e.contractorId || '',
                    type: e.type || '',
                    qty: e.qty || 1,
                    status: e.status === 'IDLE' ? 'idle' : 'active',
                    hours_used: e.status && e.status !== 'IDLE' ? parseInt(e.status) || 0 : 0,
                    notes: ''
                }))
                : [];

            const rawCaptureData = {
                report_id: reportId,
                capture_mode: report.meta?.captureMode || 'guided',
                freeform_notes: report.fieldNotes?.freeformNotes || '',
                work_summary: report.guidedNotes?.workSummary || '',
                issues_notes: report.issues || report.guidedNotes?.issues || '',
                safety_notes: report.safety?.notes || report.guidedNotes?.safety || '',
                weather_data: report.overview?.weather || {},
                captured_at: new Date().toISOString(),
                // Store user_edits, contractor_work, personnel, and equipment_usage in raw_data JSONB
                raw_data: {
                    user_edits: userEditsArray,
                    contractor_work: contractorWorkArray,
                    personnel: personnelArray,
                    equipment_usage: equipmentUsageArray
                }
            };

            // Delete existing and insert new (simpler than upsert for child tables)
            await supabaseClient
                .from('report_raw_capture')
                .delete()
                .eq('report_id', reportId);

            await supabaseClient
                .from('report_raw_capture')
                .insert(rawCaptureData);

            // 3. Contractor work - now stored in raw_data.contractor_work (handled above in rawCaptureData)

            // 4. Personnel - now stored in raw_data.personnel (handled above in rawCaptureData)

            // 5. Equipment usage - now stored in raw_data.equipment_usage (handled above in rawCaptureData)

            // 6. User edits - now stored in raw_data.user_edits (handled above in rawCaptureData)

            // 7. Save text sections (issues, qaqc, communications, visitors, safety)
            // These are stored in the main report data, update via raw_capture or as separate fields

            console.log('[SUPABASE] Report saved successfully');
        } catch (err) {
            console.error('[SUPABASE] Save failed:', err);
        } finally {
            isSaving = false;
        }
    }

    function showSaveIndicator() {
        const indicator = document.getElementById('saveIndicator');
        indicator.classList.add('visible');
        setTimeout(() => {
            indicator.classList.remove('visible');
        }, 2000);
    }

    // initAllAutoExpandTextareas() replaced by initAllAutoExpandTextareas() from /js/ui-utils.js

    // ============ UI HELPERS ============
    function updateHeaderDate() {
        const dateStr = new Date().toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric'
        });
        document.getElementById('headerDate').textContent = dateStr;
    }

    // ============ FINAL REVIEW ============
    async function goToFinalReview() {
        // Save the current report before navigating
        await saveReport();

        // Get the report date from URL or current date
        const reportDateStr = getReportDateStr();

        // Navigate to final review page with report ID if available
        let url = `finalreview.html?date=${reportDateStr}`;
        if (currentReportId) {
            url += `&reportId=${currentReportId}`;
        }
        window.location.href = url;
    }

    function showSubmitModal() {
        // Legacy - redirect to final review
        goToFinalReview();
    }

    function hideSubmitModal() {
        document.getElementById('submitModal').classList.add('hidden');
    }

    function confirmSubmit() {
        // Legacy function - kept for backwards compatibility
        goToFinalReview();
    }

    // ============ DEBUG TOOL ============
    let fieldMappingIssues = [];
    let debugBannerDismissed = false;

    /**
     * Detect field mapping mismatches between AI response and expected structure
     * Returns array of issue objects: { type: 'schema'|'empty'|'type'|'contractor', field: string, message: string }
     */
    function detectFieldMismatches() {
        const issues = [];
        const ai = report.aiGenerated;

        if (!ai) {
            return issues; // No AI data to check
        }

        // Expected top-level keys in aiGenerated
        const expectedTopLevelKeys = [
            'activities', 'generalIssues', 'qaqcNotes', 'safety',
            'contractorCommunications', 'visitorsRemarks', 'operations', 'equipment'
        ];

        // a) Schema mismatches - check for unexpected top-level keys
        Object.keys(ai).forEach(key => {
            if (!expectedTopLevelKeys.includes(key)) {
                issues.push({
                    type: 'schema',
                    field: `aiGenerated.${key}`,
                    message: `Unexpected top-level key "${key}" in AI response`
                });
            }
        });

        // Check activities structure
        if (ai.activities && Array.isArray(ai.activities)) {
            ai.activities.forEach((activity, index) => {
                const expectedActivityKeys = ['contractorId', 'narrative', 'noWork', 'equipmentUsed', 'crew'];
                Object.keys(activity).forEach(key => {
                    if (!expectedActivityKeys.includes(key)) {
                        issues.push({
                            type: 'schema',
                            field: `aiGenerated.activities[${index}].${key}`,
                            message: `Unexpected key "${key}" in activity at index ${index}`
                        });
                    }
                });
            });
        }

        // Check safety structure
        if (ai.safety && typeof ai.safety === 'object') {
            const expectedSafetyKeys = ['notes', 'hasIncident', 'noIncidents'];
            Object.keys(ai.safety).forEach(key => {
                if (!expectedSafetyKeys.includes(key)) {
                    issues.push({
                        type: 'schema',
                        field: `aiGenerated.safety.${key}`,
                        message: `Unexpected key "${key}" in safety section`
                    });
                }
            });
        }

        // Check operations structure
        if (ai.operations && Array.isArray(ai.operations)) {
            ai.operations.forEach((op, index) => {
                const expectedOpKeys = ['contractorId', 'superintendents', 'foremen', 'operators', 'laborers', 'surveyors', 'others'];
                Object.keys(op).forEach(key => {
                    if (!expectedOpKeys.includes(key)) {
                        issues.push({
                            type: 'schema',
                            field: `aiGenerated.operations[${index}].${key}`,
                            message: `Unexpected key "${key}" in operations at index ${index}`
                        });
                    }
                });
            });
        }

        // b) Empty responses - AI returned null/empty when fieldNotes had content
        const fieldNotes = report.fieldNotes || {};
        const guidedNotes = report.guidedNotes || {};

        // Check if AI generalIssues is empty but guidedNotes.issues has content
        if (guidedNotes.issues && guidedNotes.issues.trim()) {
            const aiIssues = ai.generalIssues;
            if (!aiIssues || (Array.isArray(aiIssues) && aiIssues.length === 0) || aiIssues === '') {
                issues.push({
                    type: 'empty',
                    field: 'aiGenerated.generalIssues',
                    message: 'AI returned empty generalIssues but guidedNotes.issues has content'
                });
            }
        }

        // Check if AI safety.notes is empty but guidedNotes.safety has content
        if (guidedNotes.safety && guidedNotes.safety.trim()) {
            const aiSafetyNotes = ai.safety?.notes;
            if (!aiSafetyNotes || (Array.isArray(aiSafetyNotes) && aiSafetyNotes.length === 0) || aiSafetyNotes === '') {
                issues.push({
                    type: 'empty',
                    field: 'aiGenerated.safety.notes',
                    message: 'AI returned empty safety.notes but guidedNotes.safety has content'
                });
            }
        }

        // Check if AI activities is empty but guidedNotes.workSummary has content
        if (guidedNotes.workSummary && guidedNotes.workSummary.trim()) {
            const aiActivities = ai.activities;
            if (!aiActivities || (Array.isArray(aiActivities) && aiActivities.length === 0)) {
                issues.push({
                    type: 'empty',
                    field: 'aiGenerated.activities',
                    message: 'AI returned empty activities but guidedNotes.workSummary has content'
                });
            }
        }

        // c) Type mismatches - expected array but got string or vice versa
        const arrayFields = ['generalIssues', 'qaqcNotes', 'activities', 'operations', 'equipment'];
        arrayFields.forEach(fieldName => {
            const value = ai[fieldName];
            if (value !== undefined && value !== null) {
                if (typeof value === 'string' && value.trim() !== '') {
                    issues.push({
                        type: 'type',
                        field: `aiGenerated.${fieldName}`,
                        message: `Expected array for "${fieldName}" but got string`
                    });
                }
            }
        });

        // Check safety.notes - should be array or string
        if (ai.safety?.notes !== undefined && ai.safety?.notes !== null) {
            // This is acceptable as either array or string, but flag if it's something else
            const notesType = typeof ai.safety.notes;
            if (notesType !== 'string' && !Array.isArray(ai.safety.notes)) {
                issues.push({
                    type: 'type',
                    field: 'aiGenerated.safety.notes',
                    message: `Expected array or string for "safety.notes" but got ${notesType}`
                });
            }
        }

        // d) ContractorId mismatches - AI contractorId doesn't match any project contractor
        const validContractorIds = projectContractors.map(c => c.id);

        if (ai.activities && Array.isArray(ai.activities)) {
            ai.activities.forEach((activity, index) => {
                if (activity.contractorId && !validContractorIds.includes(activity.contractorId)) {
                    issues.push({
                        type: 'contractor',
                        field: `aiGenerated.activities[${index}].contractorId`,
                        message: `ContractorId "${activity.contractorId}" doesn't match any project contractor`
                    });
                }
            });
        }

        if (ai.operations && Array.isArray(ai.operations)) {
            ai.operations.forEach((op, index) => {
                if (op.contractorId && !validContractorIds.includes(op.contractorId)) {
                    issues.push({
                        type: 'contractor',
                        field: `aiGenerated.operations[${index}].contractorId`,
                        message: `ContractorId "${op.contractorId}" doesn't match any project contractor`
                    });
                }
            });
        }

        if (ai.equipment && Array.isArray(ai.equipment)) {
            ai.equipment.forEach((equip, index) => {
                if (equip.contractorId && !validContractorIds.includes(equip.contractorId)) {
                    issues.push({
                        type: 'contractor',
                        field: `aiGenerated.equipment[${index}].contractorId`,
                        message: `ContractorId "${equip.contractorId}" doesn't match any project contractor`
                    });
                }
            });
        }

        return issues;
    }

    /**
     * Initialize debug panel with current data
     */
    function initializeDebugPanel() {
        // Detect issues
        fieldMappingIssues = detectFieldMismatches();

        // Update AI Response Data section
        const aiContent = document.getElementById('debugAIContent');
        if (report.aiGenerated) {
            aiContent.textContent = JSON.stringify(report.aiGenerated, null, 2);
        } else {
            aiContent.textContent = 'No AI response data';
        }

        // Update Field Notes section
        const fieldNotesContent = document.getElementById('debugFieldNotesContent');
        const fieldNotesData = {
            fieldNotes: report.fieldNotes || {},
            guidedNotes: report.guidedNotes || {}
        };
        fieldNotesContent.textContent = JSON.stringify(fieldNotesData, null, 2);

        // Update User Edits section
        const userEditsContent = document.getElementById('debugUserEditsContent');
        if (report.userEdits && Object.keys(report.userEdits).length > 0) {
            userEditsContent.textContent = JSON.stringify(report.userEdits, null, 2);
        } else {
            userEditsContent.textContent = 'No user edits';
        }

        // Update Current State section
        const currentStateContent = document.getElementById('debugCurrentStateContent');
        const currentState = {
            activities: report.activities || [],
            operations: report.operations || [],
            equipment: report.equipment || []
        };
        currentStateContent.textContent = JSON.stringify(currentState, null, 2);

        // Update Issues section
        updateDebugIssues();

        // Show/hide banner based on issues
        if (fieldMappingIssues.length > 0 && !debugBannerDismissed) {
            document.getElementById('debugIssueBanner').classList.remove('hidden');
        }
    }

    /**
     * Update the debug issues display
     */
    function updateDebugIssues() {
        const issuesContainer = document.getElementById('debugIssuesContent');
        const issueCount = document.getElementById('debugIssueCount');

        issueCount.textContent = fieldMappingIssues.length;

        if (fieldMappingIssues.length === 0) {
            issuesContainer.innerHTML = '<p class="text-sm text-green-600"><i class="fas fa-check-circle mr-1"></i>No issues detected</p>';
            issueCount.classList.remove('bg-yellow-500');
            issueCount.classList.add('bg-green-500');
        } else {
            issueCount.classList.remove('bg-green-500');
            issueCount.classList.add('bg-yellow-500');
            issuesContainer.innerHTML = fieldMappingIssues.map(issue => `
                <div class="debug-issue ${issue.type}">
                    <div class="debug-issue-type">${escapeHtml(issue.type)}</div>
                    <div class="font-medium text-slate-700">${escapeHtml(issue.field)}</div>
                    <div class="text-slate-600">${escapeHtml(issue.message)}</div>
                </div>
            `).join('');
        }
    }

    /**
     * Toggle debug panel expanded/collapsed
     */
    function toggleDebugPanel() {
        const panel = document.getElementById('debugPanel');
        const chevron = document.getElementById('debugPanelChevron');

        panel.classList.toggle('collapsed');
        panel.classList.toggle('expanded');

        if (panel.classList.contains('expanded')) {
            chevron.classList.remove('fa-chevron-down');
            chevron.classList.add('fa-chevron-up');
        } else {
            chevron.classList.remove('fa-chevron-up');
            chevron.classList.add('fa-chevron-down');
        }
    }

    /**
     * Toggle debug section expanded/collapsed
     */
    function toggleDebugSection(sectionName) {
        const section = document.getElementById(`debugSection${sectionName}`);
        const chevron = section.querySelector('.debug-chevron');

        section.classList.toggle('expanded');

        if (section.classList.contains('expanded')) {
            chevron.classList.remove('fa-chevron-down');
            chevron.classList.add('fa-chevron-up');
        } else {
            chevron.classList.remove('fa-chevron-up');
            chevron.classList.add('fa-chevron-down');
        }
    }

    /**
     * Scroll to debug panel and expand it
     */
    function scrollToDebugPanel() {
        const panel = document.getElementById('debugPanel');

        // Expand the panel if collapsed
        if (panel.classList.contains('collapsed')) {
            toggleDebugPanel();
        }

        // Scroll to panel
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    /**
     * Dismiss the debug banner
     */
    function dismissDebugBanner(event) {
        event.stopPropagation();
        debugBannerDismissed = true;
        document.getElementById('debugIssueBanner').classList.add('hidden');
    }

    /**
     * Format timestamp for filenames
     */
    function formatDebugTimestamp() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        return `${year}-${month}-${day}-${hours}${minutes}${seconds}`;
    }

    /**
     * Download debug data as JSON
     */
    function downloadDebugJSON() {
        const debugData = {
            exportedAt: new Date().toISOString(),
            reportDate: report.overview?.date || '',
            projectName: activeProject?.projectName || '',
            aiGenerated: report.aiGenerated || null,
            fieldNotes: report.fieldNotes || {},
            guidedNotes: report.guidedNotes || {},
            userEdits: report.userEdits || {},
            currentState: {
                activities: report.activities || [],
                operations: report.operations || [],
                equipment: report.equipment || []
            },
            detectedIssues: fieldMappingIssues
        };

        const blob = new Blob([JSON.stringify(debugData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const filename = `fieldvoice-debug-${formatDebugTimestamp()}.json`;

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /**
     * Download debug data as Markdown
     */
    function downloadDebugMarkdown() {
        const timestamp = new Date().toISOString();
        const reportDate = report.overview?.date || 'Unknown';
        const projectName = activeProject?.projectName || 'Unknown';

        let md = `# FieldVoice Debug Export\n\n`;
        md += `**Exported:** ${timestamp}\n`;
        md += `**Report Date:** ${reportDate}\n`;
        md += `**Project:** ${projectName}\n\n`;

        // Detected Issues
        md += `## Detected Issues\n\n`;
        if (fieldMappingIssues.length === 0) {
            md += `No issues detected.\n\n`;
        } else {
            fieldMappingIssues.forEach((issue, index) => {
                md += `### Issue ${index + 1}: ${issue.type.toUpperCase()}\n`;
                md += `- **Field:** ${issue.field}\n`;
                md += `- **Message:** ${issue.message}\n\n`;
            });
        }

        // AI Generated Data
        md += `## AI Generated Data\n\n`;
        if (report.aiGenerated) {
            md += `\`\`\`json\n${JSON.stringify(report.aiGenerated, null, 2)}\n\`\`\`\n\n`;
        } else {
            md += `No AI response data.\n\n`;
        }

        // Raw Field Notes
        md += `## Raw Field Notes\n\n`;
        md += `### Field Notes\n`;
        md += `\`\`\`json\n${JSON.stringify(report.fieldNotes || {}, null, 2)}\n\`\`\`\n\n`;
        md += `### Guided Notes\n`;
        md += `\`\`\`json\n${JSON.stringify(report.guidedNotes || {}, null, 2)}\n\`\`\`\n\n`;

        // User Edits
        md += `## User Edits\n\n`;
        if (report.userEdits && Object.keys(report.userEdits).length > 0) {
            md += `\`\`\`json\n${JSON.stringify(report.userEdits, null, 2)}\n\`\`\`\n\n`;
        } else {
            md += `No user edits.\n\n`;
        }

        // Current Report State
        md += `## Current Report State\n\n`;
        md += `### Activities\n`;
        md += `\`\`\`json\n${JSON.stringify(report.activities || [], null, 2)}\n\`\`\`\n\n`;
        md += `### Operations\n`;
        md += `\`\`\`json\n${JSON.stringify(report.operations || [], null, 2)}\n\`\`\`\n\n`;
        md += `### Equipment\n`;
        md += `\`\`\`json\n${JSON.stringify(report.equipment || [], null, 2)}\n\`\`\`\n\n`;

        const blob = new Blob([md], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const filename = `fieldvoice-debug-${formatDebugTimestamp()}.md`;

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // ============ EXPORT ============
    function exportPDF() {
        // TODO: Implement PDF export
        alert('PDF export coming soon!');
    }

    // ============ EXPOSE FUNCTIONS TO WINDOW ============
    // Functions called from onclick handlers in HTML must be globally accessible
    window.saveReport = saveReport;
    window.exportPDF = exportPDF;
    window.goToFinalReview = goToFinalReview;
    window.switchTab = switchTab;
    window.retryRefineProcessing = retryRefineProcessing;
    window.scrollToDebugPanel = scrollToDebugPanel;
    window.dismissDebugBanner = dismissDebugBanner;
    window.addEquipmentRow = addEquipmentRow;
    window.toggleDebugPanel = toggleDebugPanel;
    window.toggleDebugSection = toggleDebugSection;
    window.downloadDebugJSON = downloadDebugJSON;
    window.downloadDebugMarkdown = downloadDebugMarkdown;
    window.confirmSubmit = confirmSubmit;
    window.hideSubmitModal = hideSubmitModal;
    window.toggleNoWork = toggleNoWork;
    window.handlePhotoLoad = handlePhotoLoad;
    window.handlePhotoError = handlePhotoError;

    // Debug access for development
    window.__fvp_debug = {
        get report() { return report; },
        get activeProject() { return activeProject; },
        get currentReportId() { return currentReportId; },
        get userEdits() { return userEdits; }
    };

})();
