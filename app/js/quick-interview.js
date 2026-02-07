        // ============ STATE ============
        let currentSection = null;
        let report = null;
        let currentReportId = null; // Supabase report ID
        let permissionsChecked = false;
        let activeProject = null;
        let projectContractors = [];
        let userSettings = null;

        // Track auto-saved entries so "+" buttons don't create duplicates
        // Structure: { 'work_<contractorId>': { entryId: 'xxx', saved: true }, ... }
        const autoSaveState = {};

        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        const isIOSSafari = isIOS && isSafari;
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

        // ============ ENTRY MANAGEMENT (v6) ============

        /**
         * Create a new entry
         * @param {string} section - The section identifier (e.g., 'issues', 'safety', 'inspections')
         * @param {string} content - The entry content
         * @returns {Object} The created entry object
         */
        function createEntry(section, content) {
            const entry = {
                id: `entry_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                section: section,
                content: content.trim(),
                timestamp: new Date().toISOString(),
                entry_order: getNextEntryOrder(section),
                is_deleted: false
            };

            if (!report.entries) report.entries = [];
            report.entries.push(entry);

            // Queue for real-time backup
            if (currentReportId) {
                queueEntryBackup(currentReportId, entry);
            }

            saveReport();
            return entry;
        }

        /**
         * Get next entry order for a section
         * @param {string} section - The section identifier
         * @returns {number} The next order number
         */
        function getNextEntryOrder(section) {
            if (!report.entries) return 1;
            const sectionEntries = report.entries.filter(e => e.section === section && !e.is_deleted);
            return sectionEntries.length + 1;
        }

        /**
         * Get all entries for a section (not deleted)
         * @param {string} section - The section identifier
         * @returns {Array} Array of entry objects sorted by entry_order
         */
        function getEntriesForSection(section) {
            if (!report.entries) return [];
            return report.entries
                .filter(e => e.section === section && !e.is_deleted)
                .sort((a, b) => a.entry_order - b.entry_order);
        }

        /**
         * Update an entry's content
         * @param {string} entryId - The entry ID to update
         * @param {string} newContent - The new content
         * @returns {Object|null} The updated entry or null if not found
         */
        function updateEntry(entryId, newContent) {
            const entry = report.entries?.find(e => e.id === entryId);
            if (!entry) return null;

            entry.content = newContent.trim();
            // Note: timestamp preserved (not updated on edit)

            if (currentReportId) {
                queueEntryBackup(currentReportId, entry);
            }

            saveReport();
            return entry;
        }

        /**
         * Delete an entry (soft delete)
         * @param {string} entryId - The entry ID to delete
         */
        function deleteEntryById(entryId) {
            const entry = report.entries?.find(e => e.id === entryId);
            if (!entry) return;

            entry.is_deleted = true;

            if (currentReportId) {
                deleteEntry(currentReportId, entryId);  // from sync-manager.js
            }

            saveReport();
        }

        /**
         * v6.6: Start editing an entry (swap to textarea)
         * @param {string} entryId - The entry ID to edit
         * @param {string} sectionType - The section type for re-rendering
         */
        function startEditEntry(entryId, sectionType) {
            const entry = report.entries?.find(e => e.id === entryId);
            if (!entry) return;

            const entryDiv = document.querySelector(`[data-entry-id="${entryId}"]`);
            if (!entryDiv) return;

            // Find the content paragraph and replace with textarea
            const contentP = entryDiv.querySelector('.entry-content');
            const editBtn = entryDiv.querySelector('.edit-btn');
            
            if (contentP && editBtn) {
                // Create textarea with current content
                const textarea = document.createElement('textarea');
                textarea.id = `edit-textarea-${entryId}`;
                textarea.className = 'entry-edit-textarea w-full text-sm text-slate-700 border border-slate-300 rounded p-2 bg-white focus:outline-none focus:border-dot-blue auto-expand';
                textarea.value = entry.content;
                textarea.rows = 2;
                
                // Debounced auto-save on typing
                let editSaveTimeout = null;
                textarea.addEventListener('input', () => {
                    autoExpand(textarea);
                    if (editSaveTimeout) clearTimeout(editSaveTimeout);
                    editSaveTimeout = setTimeout(() => {
                        const text = textarea.value.trim();
                        if (text) {
                            updateEntry(entryId, text);
                            saveReport();
                            // Queue backup to Supabase
                            if (currentReportId && entry) {
                                entry.content = text;
                                queueEntryBackup(currentReportId, entry);
                            }
                            console.log('[EDIT AUTOSAVE] Entry saved:', entryId);
                        }
                    }, 500);
                });
                
                // Replace p with textarea
                contentP.replaceWith(textarea);
                
                // Auto-expand and focus
                autoExpand(textarea);
                textarea.focus();
                textarea.setSelectionRange(textarea.value.length, textarea.value.length);
                
                // Change edit button to save button
                editBtn.innerHTML = '<i class="fas fa-check text-xs"></i>';
                editBtn.className = 'save-btn text-safety-green hover:text-green-700 p-1';
                editBtn.onclick = () => saveEditEntry(entryId, sectionType);
            }
        }

        /**
         * v6.6: Save edited entry and return to read-only
         * @param {string} entryId - The entry ID being edited
         * @param {string} sectionType - The section type for re-rendering
         */
        function saveEditEntry(entryId, sectionType) {
            const textarea = document.getElementById(`edit-textarea-${entryId}`);
            if (!textarea) return;

            const newContent = textarea.value.trim();
            if (newContent) {
                updateEntry(entryId, newContent);
            }

            // Re-render the appropriate section
            if (sectionType === 'contractor-work') {
                renderContractorWorkCards();
            } else {
                renderSection(sectionType);
            }
            
            updateAllPreviews();
            showToast('Entry updated', 'success');
        }

        // ============ AUTO-SAVE ON TYPING (v6.6) ============
        
        // Track active auto-save sessions to prevent duplicates
        const guidedAutoSaveSessions = {};
        
        /**
         * Initialize auto-save on typing for guided section textareas
         * Creates entry on first keystroke, updates on subsequent keystrokes
         * @param {string} textareaId - The textarea element ID
         * @param {string} section - The section identifier (e.g., 'communications', 'qaqc')
         */
        function initGuidedAutoSave(textareaId, section) {
            const textarea = document.getElementById(textareaId);
            if (!textarea) return;
            
            // Prevent duplicate initialization
            if (textarea.dataset.autoSaveInit === 'true') return;
            textarea.dataset.autoSaveInit = 'true';
            
            let currentEntryId = null;
            let saveTimeout = null;
            
            textarea.addEventListener('input', () => {
                if (saveTimeout) clearTimeout(saveTimeout);
                
                saveTimeout = setTimeout(() => {
                    const text = textarea.value.trim();
                    if (!text) return;
                    
                    if (!currentEntryId) {
                        // Create new entry on first meaningful keystroke
                        const entry = {
                            id: `entry_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                            section: section,
                            content: text,
                            timestamp: new Date().toISOString(),
                            entry_order: getNextEntryOrder(section),
                            is_deleted: false
                        };
                        
                        if (!report.entries) report.entries = [];
                        report.entries.push(entry);
                        currentEntryId = entry.id;
                        
                        if (currentReportId) {
                            queueEntryBackup(currentReportId, entry);
                        }
                        
                        saveReport();
                        // Track in shared state so "+" button knows entry exists
                        autoSaveState[section] = { entryId: currentEntryId, saved: true };
                        console.log('[AUTOSAVE] Created guided entry:', section, currentEntryId);
                    } else {
                        // Update existing entry
                        const entry = report.entries?.find(e => e.id === currentEntryId);
                        if (entry) {
                            entry.content = text;
                            if (currentReportId) {
                                queueEntryBackup(currentReportId, entry);
                            }
                            saveReport();
                            // Keep shared state updated
                            autoSaveState[section] = { entryId: currentEntryId, saved: true };
                            console.log('[AUTOSAVE] Updated guided entry:', section, currentEntryId);
                        }
                    }
                }, 500);
            });
            
            // Save on blur as safety net
            textarea.addEventListener('blur', () => {
                if (saveTimeout) clearTimeout(saveTimeout);
                const text = textarea.value.trim();
                if (text && currentEntryId) {
                    const entry = report.entries?.find(e => e.id === currentEntryId);
                    if (entry && entry.content !== text) {
                        entry.content = text;
                        if (currentReportId) queueEntryBackup(currentReportId, entry);
                        saveReport();
                        // Track in shared state so "+" button knows entry exists
                        autoSaveState[section] = { entryId: currentEntryId, saved: true };
                        console.log('[AUTOSAVE] Guided entry saved on blur:', section, currentEntryId);
                    }
                }
            });
            
            // Store session for potential cleanup
            guidedAutoSaveSessions[textareaId] = { section, currentEntryId };
        }
        
        /**
         * Initialize auto-save for contractor work entry textareas
         * @param {string} contractorId - The contractor ID
         */
        function initContractorWorkAutoSave(contractorId) {
            const textareaId = `work-input-${contractorId}`;
            const section = `work_${contractorId}`;
            
            const textarea = document.getElementById(textareaId);
            if (!textarea) return;
            
            // Prevent duplicate initialization
            if (textarea.dataset.autoSaveInit === 'true') return;
            textarea.dataset.autoSaveInit = 'true';
            
            let currentEntryId = null;
            let saveTimeout = null;
            
            textarea.addEventListener('input', () => {
                if (saveTimeout) clearTimeout(saveTimeout);
                
                saveTimeout = setTimeout(() => {
                    const text = textarea.value.trim();
                    if (!text) return;
                    
                    if (!currentEntryId) {
                        // Create new entry on first meaningful keystroke
                        const entry = {
                            id: `entry_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                            section: section,
                            content: text,
                            timestamp: new Date().toISOString(),
                            entry_order: getNextEntryOrder(section),
                            is_deleted: false
                        };
                        
                        if (!report.entries) report.entries = [];
                        report.entries.push(entry);
                        currentEntryId = entry.id;
                        
                        if (currentReportId) {
                            queueEntryBackup(currentReportId, entry);
                        }
                        
                        saveReport();
                        // Track in shared state so "+" button knows entry exists
                        autoSaveState[section] = { entryId: currentEntryId, saved: true };
                        console.log('[AUTOSAVE] Created contractor work entry:', contractorId, currentEntryId);
                    } else {
                        // Update existing entry
                        const entry = report.entries?.find(e => e.id === currentEntryId);
                        if (entry) {
                            entry.content = text;
                            if (currentReportId) {
                                queueEntryBackup(currentReportId, entry);
                            }
                            saveReport();
                            // Keep shared state updated
                            autoSaveState[section] = { entryId: currentEntryId, saved: true };
                            console.log('[AUTOSAVE] Updated contractor work entry:', contractorId, currentEntryId);
                        }
                    }
                }, 500);
            });
            
            // Save on blur as safety net
            textarea.addEventListener('blur', () => {
                if (saveTimeout) clearTimeout(saveTimeout);
                const text = textarea.value.trim();
                if (text && !currentEntryId) {
                    // Create entry if there's text but no entry yet
                    const entry = {
                        id: `entry_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        section: section,
                        content: text,
                        timestamp: new Date().toISOString(),
                        entry_order: getNextEntryOrder(section),
                        is_deleted: false
                    };
                    
                    if (!report.entries) report.entries = [];
                    report.entries.push(entry);
                    
                    if (currentReportId) {
                        queueEntryBackup(currentReportId, entry);
                    }
                    
                    saveReport();
                    currentEntryId = entry.id;  // Track for subsequent updates
                    // Track in shared state so "+" button knows entry exists
                    autoSaveState[section] = { entryId: currentEntryId, saved: true };
                    console.log('[AUTOSAVE] Contractor work entry saved on blur:', contractorId);
                }
            });
        }
        
        /**
         * Initialize all guided section auto-save listeners
         * Called after sections are rendered
         */
        function initAllGuidedAutoSave() {
            // Init if toggle is Yes OR not yet answered (textarea visible in both cases)
            // Only skip if toggle is explicitly No (false)
            if (getToggleState('communications_made') !== false) {
                initGuidedAutoSave('communications-input', 'communications');
            }
            if (getToggleState('qaqc_performed') !== false) {
                initGuidedAutoSave('qaqc-input', 'qaqc');
            }
            if (getToggleState('visitors_present') !== false) {
                initGuidedAutoSave('visitors-input', 'visitors');
            }
            // Issues and Safety don't have toggles - always visible
            initGuidedAutoSave('issue-input', 'issues');
            initGuidedAutoSave('safety-input', 'safety');
        }

        // ============ TOGGLE STATE MANAGEMENT (v6) ============

        /**
         * Set a toggle state (locks immediately)
         * @param {string} section - The section identifier
         * @param {boolean} value - true = Yes, false = No
         * @returns {boolean} Success status
         */
        function setToggleState(section, value) {
            // Check if toggle can be changed using report-rules.js
            if (currentReportId && typeof canChangeToggle === 'function') {
                const canChange = canChangeToggle(currentReportId, section);
                if (!canChange.allowed) {
                    showToast(`Toggle locked: already set`, 'warning');
                    return false;
                }
            }

            if (!report.toggleStates) report.toggleStates = {};
            report.toggleStates[section] = value;  // true = Yes, false = No

            saveReport();
            return true;
        }

        /**
         * Get toggle state for a section
         * @param {string} section - The section identifier
         * @returns {boolean|null} Toggle state: true, false, or null if not set
         */
        function getToggleState(section) {
            return report.toggleStates?.[section] ?? null;  // null = not set
        }

        /**
         * Check if a toggle is locked
         * @param {string} section - The section identifier
         * @returns {boolean} True if toggle is locked
         */
        function isToggleLocked(section) {
            return report.toggleStates?.[section] !== undefined && report.toggleStates?.[section] !== null;
        }

        /**
         * Render a toggle button pair for a section
         * @param {string} section - The section identifier
         * @param {string} label - The display label
         * @returns {string} HTML string for toggle buttons
         */
        function renderToggleButtons(section, label) {
            const state = getToggleState(section);
            const locked = isToggleLocked(section);

            const yesClass = state === true
                ? 'bg-safety-green text-white border-safety-green'
                : 'bg-white text-slate-600 border-slate-300 hover:border-safety-green';
            const noClass = state === false
                ? 'bg-red-500 text-white border-red-500'
                : 'bg-white text-slate-600 border-slate-300 hover:border-red-500';

            const disabledAttr = locked ? 'disabled' : '';
            const lockedIcon = locked ? '<i class="fas fa-lock text-xs ml-1"></i>' : '';

            return `
                <div class="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 mb-3">
                    <span class="text-sm font-medium text-slate-700">${label}</span>
                    <div class="flex gap-2">
                        <button
                            onclick="handleToggle('${section}', true)"
                            class="px-4 py-1.5 text-xs font-bold uppercase border-2 ${yesClass} transition-colors"
                            ${disabledAttr}
                        >Yes${state === true ? lockedIcon : ''}</button>
                        <button
                            onclick="handleToggle('${section}', false)"
                            class="px-4 py-1.5 text-xs font-bold uppercase border-2 ${noClass} transition-colors"
                            ${disabledAttr}
                        >No${state === false ? lockedIcon : ''}</button>
                    </div>
                </div>
            `;
        }

        /**
         * Handle toggle button click
         * @param {string} section - The section identifier
         * @param {boolean} value - The selected value
         */
        function handleToggle(section, value) {
            if (isToggleLocked(section)) {
                showToast('Toggle is locked after selection', 'warning');
                return;
            }

            const success = setToggleState(section, value);
            if (success) {
                // Map toggle section names to render section names
                const sectionMap = {
                    'communications_made': 'communications',
                    'qaqc_performed': 'qaqc',
                    'visitors_present': 'visitors',
                    'personnel_onsite': 'personnel'
                };
                const renderSectionName = sectionMap[section] || section;
                
                // Re-render the section to show locked state
                renderSection(renderSectionName);
                updateAllPreviews();
                updateProgress();
                
                // v6.6: Initialize auto-save if toggle was set to Yes
                if (value === true) {
                    const autoSaveMap = {
                        'communications_made': { textareaId: 'communications-input', section: 'communications' },
                        'qaqc_performed': { textareaId: 'qaqc-input', section: 'qaqc' },
                        'visitors_present': { textareaId: 'visitors-input', section: 'visitors' }
                    };
                    const config = autoSaveMap[section];
                    if (config) {
                        // Small delay to ensure DOM is updated
                        setTimeout(() => {
                            initGuidedAutoSave(config.textareaId, config.section);
                        }, 100);
                    }
                }
            }
        }

        // ============ STATE PROTECTION ============
        /**
         * Check if report is already refined - redirect if so
         * This prevents users from editing after AI refinement
         * v6: Uses canReturnToNotes() from report-rules.js
         */
        async function checkReportState() {
            const activeProjectId = getStorageItem(STORAGE_KEYS.ACTIVE_PROJECT_ID);
            if (!activeProjectId) {
                return true; // No project selected, allow page to load (will show project picker)
            }

            const today = getTodayDateString();

            try {
                const { data: reportData, error } = await supabaseClient
                    .from('reports')
                    .select('id, status')
                    .eq('project_id', activeProjectId)
                    .eq('report_date', today)
                    .maybeSingle();

                if (error) {
                    console.error('[STATE CHECK] Error checking report state:', error);
                    return true; // Allow page to load on error, let normal flow handle it
                }

                if (reportData) {
                    // v6: Use canReturnToNotes() from report-rules.js to check if editing is allowed
                    // Note: canReturnToNotes expects a reportId, but we check status directly here
                    // since we already have the status from Supabase
                    const canEdit = reportData.status === REPORT_STATUS.DRAFT;
                    if (!canEdit) {
                        console.log('[STATE CHECK] Cannot edit - status:', reportData.status);
                        window.location.href = `report.html?date=${today}`;
                        return false;
                    }
                }

                return true;
            } catch (e) {
                console.error('[STATE CHECK] Failed to check report state:', e);
                return true; // Allow page to load on error
            }
        }

        // ============ LOCALSTORAGE DRAFT MANAGEMENT ============
        // v6: Use STORAGE_KEYS from storage-keys.js for all localStorage operations
        // Draft storage uses STORAGE_KEYS.CURRENT_REPORTS via getCurrentReport()/saveCurrentReport()
        // Sync queue uses STORAGE_KEYS.SYNC_QUEUE via getSyncQueue()/addToSyncQueue()

        /**
         * Save all form data to localStorage
         * This is called during editing - data only goes to Supabase on FINISH
         */
        function saveToLocalStorage() {
            const activeProjectId = getStorageItem(STORAGE_KEYS.ACTIVE_PROJECT_ID);
            const todayStr = getTodayDateString();

            const data = {
                projectId: activeProjectId,
                reportDate: todayStr,
                captureMode: report.meta?.captureMode || null,
                lastSaved: new Date().toISOString(),

                // Meta
                meta: {
                    createdAt: report.meta?.createdAt,
                    version: report.meta?.version || 2,
                    naMarked: report.meta?.naMarked || {},
                    captureMode: report.meta?.captureMode,
                    status: 'draft'
                },

                // Weather data
                weather: report.overview?.weather || {},

                // Minimal/Freeform mode - legacy single-string notes (for migration)
                freeformNotes: report.fieldNotes?.freeformNotes || '',
                
                // v6.6: Freeform mode - timestamped entries + visual checklist
                freeform_entries: report.freeform_entries || [],
                freeform_checklist: report.freeform_checklist || {},

                // Guided mode sections
                workSummary: report.guidedNotes?.workSummary || '',
                siteConditions: report.overview?.weather?.jobSiteCondition || '',
                issuesNotes: report.generalIssues || [],
                safetyNoIncidents: report.safety?.noIncidents || false,
                safetyHasIncidents: report.safety?.hasIncidents || false,
                safetyNotes: report.safety?.notes || [],
                qaqcNotes: report.qaqcNotes || [],
                communications: report.contractorCommunications || '',
                visitorsRemarks: report.visitorsRemarks || '',
                additionalNotes: report.additionalNotes || '',

                // Contractor work (activities)
                activities: report.activities || [],

                // Personnel/operations
                operations: report.operations || [],

                // Equipment usage (legacy)
                equipment: report.equipment || [],

                // v6.6: Structured equipment rows
                equipmentRows: report.equipmentRows || [],

                // Photos (metadata only - actual files uploaded separately)
                photos: (report.photos || []).map(p => ({
                    id: p.id,
                    storagePath: p.storagePath || '',
                    url: p.url || '',
                    caption: p.caption || '',
                    timestamp: p.timestamp,
                    date: p.date,
                    time: p.time,
                    gps: p.gps,
                    fileName: p.fileName
                })),

                // Reporter info
                reporter: report.reporter || {},

                // Overview
                overview: {
                    date: report.overview?.date,
                    startTime: report.overview?.startTime,
                    completedBy: report.overview?.completedBy,
                    projectName: report.overview?.projectName
                },

                // v6: Entry-based notes and toggle states
                entries: report.entries || [],
                toggleStates: report.toggleStates || {}
            };

            try {
                // v6: Use saveCurrentReport for draft storage
                const reportData = {
                    id: currentReportId || `draft_${activeProjectId}_${todayStr}`,
                    project_id: activeProjectId,
                    project_name: activeProject?.projectName || activeProject?.project_name || '',
                    date: todayStr,
                    status: 'draft',
                    capture_mode: data.captureMode,
                    created_at: report.meta?.createdAt || Date.now(),
                    // Store the full draft data in a nested object for compatibility
                    _draft_data: data
                };
                saveCurrentReport(reportData);
                console.log('[LOCAL] Draft saved to localStorage via saveCurrentReport');
            } catch (e) {
                console.error('[LOCAL] Failed to save to localStorage:', e);
                // If localStorage is full, try to continue without local save
            }
        }

        /**
         * Load form data from localStorage
         * Returns null if no valid draft exists for current project/date
         */
        function loadFromLocalStorage() {
            const activeProjectId = getStorageItem(STORAGE_KEYS.ACTIVE_PROJECT_ID);
            const today = getTodayDateString();
            const draftId = currentReportId || `draft_${activeProjectId}_${today}`;

            try {
                // v6: Use getCurrentReport to load draft
                const storedReport = getCurrentReport(draftId);
                if (!storedReport) return null;

                // Extract draft data from stored report
                const data = storedReport._draft_data;
                if (!data) return null;

                // Verify it's for the same project and date
                if (data.projectId !== activeProjectId || data.reportDate !== today) {
                    // Different project or date - clear old draft
                    console.log('[LOCAL] Draft is for different project/date, clearing');
                    deleteCurrentReport(draftId);
                    return null;
                }

                console.log('[LOCAL] Found valid draft from', data.lastSaved);
                return data;
            } catch (e) {
                console.error('[LOCAL] Failed to parse stored draft:', e);
                deleteCurrentReport(draftId);
                return null;
            }
        }

        /**
         * Restore report object from localStorage data
         */
        function restoreFromLocalStorage(localData) {
            if (!localData) return false;

            console.log('[LOCAL] Restoring draft from localStorage');

            // Restore meta
            if (localData.meta) {
                report.meta = { ...report.meta, ...localData.meta };
            }
            if (localData.captureMode) {
                report.meta.captureMode = localData.captureMode;
            }

            // Restore weather
            if (localData.weather) {
                report.overview.weather = localData.weather;
            }

            // Restore freeform notes (minimal mode - legacy)
            if (localData.freeformNotes) {
                report.fieldNotes.freeformNotes = localData.freeformNotes;
            }

            // v6.6: Restore freeform entries and checklist
            if (localData.freeform_entries && Array.isArray(localData.freeform_entries)) {
                report.freeform_entries = localData.freeform_entries;
            }
            if (localData.freeform_checklist) {
                report.freeform_checklist = localData.freeform_checklist;
            }

            // Restore guided sections
            if (localData.siteConditions) {
                report.overview.weather.jobSiteCondition = localData.siteConditions;
            }
            if (localData.issuesNotes && Array.isArray(localData.issuesNotes)) {
                report.generalIssues = localData.issuesNotes;
            }
            if (localData.safetyNoIncidents !== undefined) {
                report.safety.noIncidents = localData.safetyNoIncidents;
            }
            if (localData.safetyHasIncidents !== undefined) {
                report.safety.hasIncidents = localData.safetyHasIncidents;
            }
            if (localData.safetyNotes && Array.isArray(localData.safetyNotes)) {
                report.safety.notes = localData.safetyNotes;
            }
            if (localData.qaqcNotes && Array.isArray(localData.qaqcNotes)) {
                report.qaqcNotes = localData.qaqcNotes;
            }
            if (localData.communications) {
                report.contractorCommunications = localData.communications;
            }
            if (localData.visitorsRemarks) {
                report.visitorsRemarks = localData.visitorsRemarks;
            }
            if (localData.additionalNotes) {
                report.additionalNotes = localData.additionalNotes;
            }

            // Restore contractor work
            if (localData.activities && Array.isArray(localData.activities)) {
                report.activities = localData.activities;
            }

            // Restore operations/personnel
            if (localData.operations && Array.isArray(localData.operations)) {
                report.operations = localData.operations;
            }

            // Restore equipment (legacy)
            if (localData.equipment && Array.isArray(localData.equipment)) {
                report.equipment = localData.equipment;
            }

            // v6.6: Restore structured equipment rows
            if (localData.equipmentRows && Array.isArray(localData.equipmentRows)) {
                report.equipmentRows = localData.equipmentRows;
            }

            // Restore photos
            if (localData.photos && Array.isArray(localData.photos)) {
                report.photos = localData.photos;
            }

            // Restore reporter
            if (localData.reporter) {
                report.reporter = { ...report.reporter, ...localData.reporter };
            }

            // Restore overview
            if (localData.overview) {
                report.overview = { ...report.overview, ...localData.overview };
            }

            // v6: Restore entries and toggleStates
            if (localData.entries && Array.isArray(localData.entries)) {
                report.entries = localData.entries;
            }
            if (localData.toggleStates) {
                report.toggleStates = localData.toggleStates;
            }

            return true;
        }

        /**
         * Clear localStorage draft (called after successful FINISH)
         * Also removes from offline queue if present
         */
        function clearLocalStorageDraft() {
            const activeProjectId = getStorageItem(STORAGE_KEYS.ACTIVE_PROJECT_ID);
            const todayStr = getTodayDateString();
            const draftId = currentReportId || `draft_${activeProjectId}_${todayStr}`;

            // v6: Use deleteCurrentReport to clear draft
            deleteCurrentReport(draftId);

            // v6: Sync queue is now managed by sync-manager.js
            // The processOfflineQueue() function handles cleanup automatically
            console.log('[LOCAL] Draft cleared from localStorage');
        }

        // Update localStorage report to 'refined' status (instead of deleting)
        // v6.6.1: Preserve existing draft data for swipe-out recovery
        function updateLocalReportToRefined() {
            const todayStr = getTodayDateString();
            const draftKey = `draft_${activeProject?.id}_${todayStr}`;
            const reportId = currentReportId || draftKey;

            // Get existing report data to preserve _draft_data
            // Try the draft key first (has the full data), then the reportId
            const existingReport = getCurrentReport(draftKey) || getCurrentReport(reportId) || {};

            saveCurrentReport({
                ...existingReport,  // Preserve existing data including _draft_data
                id: reportId,
                project_id: activeProject?.id,
                project_name: activeProject?.projectName || activeProject?.project_name,
                date: todayStr,
                report_date: todayStr,
                status: 'refined',
                created_at: existingReport.created_at || report.meta?.createdAt || new Date().toISOString()
            });

            // v6.6.1: If we have a real Supabase ID, delete the old draft key to prevent duplicates
            if (currentReportId && currentReportId !== draftKey) {
                deleteCurrentReport(draftKey);
                console.log('[LOCAL] Deleted old draft key:', draftKey);
            }

            console.log('[LOCAL] Report updated to refined status in localStorage (draft data preserved)');
        }

        // autoExpand(), initAutoExpand(), initAllAutoExpandTextareas() moved to /js/ui-utils.js

        // ============ CAPTURE MODE HANDLING ============
        /**
         * Check if we should show mode selection screen
         * Show if: no captureMode set AND report is essentially empty
         */
        function shouldShowModeSelection() {
            if (!report) return true;
            if (report.meta?.captureMode) return false;

            // Check if report has any meaningful data (besides default values)
            const hasPhotos = report.photos?.length > 0;
            const hasActivities = report.activities?.length > 0;
            const hasIssues = report.generalIssues?.length > 0;
            const hasNotes = report.additionalNotes?.trim().length > 0;
            const hasFieldNotes = report.fieldNotes?.freeformNotes?.trim().length > 0 || 
                                  (report.freeform_entries?.length > 0 && report.freeform_entries.some(e => e.content?.trim()));
            const hasReporterName = report.reporter?.name?.trim().length > 0;

            // If any data exists, don't show mode selection
            return !(hasPhotos || hasActivities || hasIssues || hasNotes || hasFieldNotes || hasReporterName);
        }

        /**
         * Select a capture mode and show the appropriate UI
         */
        function selectCaptureMode(mode) {
            report.meta.captureMode = mode;
            saveReport();
            showModeUI(mode);
        }

        /**
         * Show the appropriate UI for the selected mode
         */
        function showModeUI(mode) {
            const modeSelectionScreen = document.getElementById('modeSelectionScreen');
            const minimalModeApp = document.getElementById('minimalModeApp');
            const guidedModeApp = document.getElementById('app');

            modeSelectionScreen.classList.add('hidden');

            if (mode === 'minimal') {
                minimalModeApp.classList.remove('hidden');
                guidedModeApp.classList.add('hidden');
                initMinimalModeUI();
            } else {
                minimalModeApp.classList.add('hidden');
                guidedModeApp.classList.remove('hidden');
                initGuidedModeUI();
            }
        }

        /**
         * Show the mode selection screen
         */
        function showModeSelectionScreen() {
            const modeSelectionScreen = document.getElementById('modeSelectionScreen');
            const minimalModeApp = document.getElementById('minimalModeApp');
            const guidedModeApp = document.getElementById('app');

            modeSelectionScreen.classList.remove('hidden');
            minimalModeApp.classList.add('hidden');
            guidedModeApp.classList.add('hidden');

            // Update mode selection header
            const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
            document.getElementById('modeSelectionDate').textContent = dateStr;

            if (activeProject) {
                document.getElementById('modeSelectionProjectName').textContent = activeProject.projectName;
            }
        }

        /**
         * Show confirmation modal for switching modes
         */
        function showSwitchModeConfirm() {
            const modal = document.getElementById('switchModeModal');
            const warning = document.getElementById('switchModeWarning');
            const targetSpan = document.getElementById('switchModeTarget');
            const currentMode = report.meta?.captureMode;

            // Set target mode text
            if (currentMode === 'minimal') {
                targetSpan.textContent = 'Guided Sections';
                // Show warning if there are freeform entries or legacy notes
                const hasEntries = report.freeform_entries?.some(e => e.content?.trim());
                const hasLegacyNotes = report.fieldNotes?.freeformNotes?.trim();
                if (hasEntries || hasLegacyNotes) {
                    warning.classList.remove('hidden');
                } else {
                    warning.classList.add('hidden');
                }
            } else {
                targetSpan.textContent = 'Quick Notes';
                warning.classList.add('hidden');
            }

            modal.classList.remove('hidden');
        }

        /**
         * Close the switch mode confirmation modal
         */
        function closeSwitchModeModal() {
            document.getElementById('switchModeModal').classList.add('hidden');
        }

        /**
         * Confirm switching modes
         */
        function confirmSwitchMode() {
            const currentMode = report.meta?.captureMode;
            const newMode = currentMode === 'minimal' ? 'guided' : 'minimal';

            // Preserve data when switching
            if (currentMode === 'minimal' && newMode === 'guided') {
                // v6.6: Combine freeform entries into additionalNotes
                const entriesText = (report.freeform_entries || [])
                    .filter(e => e.content?.trim())
                    .sort((a, b) => a.created_at - b.created_at)
                    .map(e => e.content.trim())
                    .join('\n\n');
                
                // Also check legacy freeformNotes
                const legacyNotes = report.fieldNotes?.freeformNotes?.trim() || '';
                const allNotes = [entriesText, legacyNotes].filter(Boolean).join('\n\n');
                
                if (allNotes) {
                    const existingNotes = report.additionalNotes?.trim() || '';
                    report.additionalNotes = existingNotes
                        ? `${existingNotes}\n\n--- Field Notes ---\n${allNotes}`
                        : allNotes;
                }
            }

            // Photos and weather are always preserved (shared between modes)

            report.meta.captureMode = newMode;
            saveReport();
            closeSwitchModeModal();
            showModeUI(newMode);
        }

        // ============ LOCK WARNING MODAL ============

        /**
         * Show the lock warning modal when another device is editing
         * @param {Object} lockInfo - Lock information from lockManager.checkLock
         */
        function showLockWarningModal(lockInfo) {
            const modal = document.getElementById('lockWarningModal');
            if (!modal) {
                // Fallback: show alert and redirect
                alert(window.lockManager.formatLockMessage(lockInfo));
                window.location.href = 'index.html';
                return;
            }

            // Update modal content
            const messageEl = document.getElementById('lockWarningMessage');
            if (messageEl) {
                messageEl.textContent = window.lockManager.formatLockMessage(lockInfo);
            }

            const detailsEl = document.getElementById('lockWarningDetails');
            if (detailsEl && lockInfo.inspectorName) {
                detailsEl.textContent = `Editor: ${lockInfo.inspectorName}`;
            }

            modal.classList.remove('hidden');
        }

        /**
         * Handle "Go Back" from lock warning modal
         */
        function handleLockWarningBack() {
            window.location.href = 'index.html';
        }

        /**
         * Handle "Force Edit" from lock warning modal (take over the lock)
         */
        async function handleLockWarningForceEdit() {
            const btn = document.getElementById('lockForceEditBtn');
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Taking over...';
            }

            try {
                const todayStr = getTodayDateString();
                const inspectorName = userSettings?.full_name || '';

                // Force acquire the lock
                const { error } = await supabaseClient
                    .from('active_reports')
                    .upsert({
                        project_id: activeProject.id,
                        report_date: todayStr,
                        device_id: getDeviceId(),
                        inspector_name: inspectorName,
                        locked_at: new Date().toISOString(),
                        last_heartbeat: new Date().toISOString()
                    }, { onConflict: 'project_id,report_date' });

                if (error) {
                    console.error('[LOCK] Force edit failed:', error);
                    showToast('Failed to take over editing', 'error');
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = '<i class="fas fa-exclamation-triangle mr-2"></i>Force Edit Anyway';
                    }
                    return;
                }

                // Reload the page to continue with normal initialization
                window.location.reload();
            } catch (e) {
                console.error('[LOCK] Force edit exception:', e);
                showToast('Failed to take over editing', 'error');
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-exclamation-triangle mr-2"></i>Force Edit Anyway';
                }
            }
        }

        // ============ CANCEL REPORT FUNCTIONS ============

        /**
         * Show the cancel report confirmation modal
         */
        function showCancelReportModal() {
            document.getElementById('cancelReportModal').classList.remove('hidden');
        }

        /**
         * Hide the cancel report confirmation modal
         */
        function hideCancelReportModal() {
            document.getElementById('cancelReportModal').classList.add('hidden');
        }

        /**
         * Confirm cancellation and delete the report
         */
        async function confirmCancelReport() {
            const confirmBtn = document.getElementById('confirmCancelBtn');
            const originalText = confirmBtn.textContent;

            try {
                // Show loading state
                confirmBtn.disabled = true;
                confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Deleting...';

                // Get the correct draft ID (same pattern as saveToLocalStorage)
                const activeProjectId = getStorageItem(STORAGE_KEYS.ACTIVE_PROJECT_ID);
                const todayStr = getTodayDateString();
                const draftId = currentReportId || `draft_${activeProjectId}_${todayStr}`;

                // Delete from Supabase only if we have a real Supabase ID (UUID format, 36 chars)
                if (currentReportId && currentReportId.length === 36) {
                    await deleteReportFromSupabase(currentReportId);
                }

                // Always delete from localStorage using the correct key
                deleteCurrentReport(draftId);

                // Clear any sync queue items for this report
                clearSyncQueueForReport(draftId);

                // Reset local state
                currentReportId = null;
                report = {};

                // Release the lock before navigating away
                if (window.lockManager) {
                    await window.lockManager.releaseCurrentLock();
                }

                // Navigate to home
                window.location.href = 'index.html';

            } catch (error) {
                console.error('[CANCEL] Error canceling report:', error);
                alert('Error deleting report. Please try again.');
                confirmBtn.disabled = false;
                confirmBtn.textContent = originalText;
            }
        }

        /**
         * Delete report and all related data from Supabase
         * @param {string} reportId - The report UUID to delete
         */
        async function deleteReportFromSupabase(reportId) {
            if (!reportId || !supabaseClient) return;

            console.log('[CANCEL] Deleting report from Supabase:', reportId);

            try {
                // 1. Get photos to delete from storage
                const { data: photos } = await supabaseClient
                    .from('photos')
                    .select('id, storage_path')
                    .eq('report_id', reportId);

                // 2. Delete photos from storage bucket
                if (photos && photos.length > 0) {
                    const storagePaths = photos.map(p => p.storage_path).filter(Boolean);
                    if (storagePaths.length > 0) {
                        await supabaseClient.storage
                            .from('report-photos')
                            .remove(storagePaths);
                    }
                }

                // 3. Delete from photos table
                await supabaseClient
                    .from('photos')
                    .delete()
                    .eq('report_id', reportId);

                // 4. Delete from report_entries
                await supabaseClient
                    .from('report_entries')
                    .delete()
                    .eq('report_id', reportId);

                // 5. Delete from report_raw_capture
                await supabaseClient
                    .from('report_raw_capture')
                    .delete()
                    .eq('report_id', reportId);

                // 6. Delete from ai_responses (if any)
                await supabaseClient
                    .from('ai_responses')
                    .delete()
                    .eq('report_id', reportId);

                // 7. Delete from reports (last, as it's the parent)
                await supabaseClient
                    .from('reports')
                    .delete()
                    .eq('id', reportId);

                console.log('[CANCEL] Report deleted from Supabase');

            } catch (error) {
                console.error('[CANCEL] Supabase deletion error:', error);
                throw error;
            }
        }

        /**
         * Clear sync queue items for a specific report
         * @param {string} reportId - The report UUID
         */
        function clearSyncQueueForReport(reportId) {
            if (!reportId) return;

            try {
                const queue = getStorageItem(STORAGE_KEYS.SYNC_QUEUE) || [];
                const filtered = queue.filter(item => item.reportId !== reportId);
                setStorageItem(STORAGE_KEYS.SYNC_QUEUE, filtered);
                console.log('[CANCEL] Cleared sync queue for report:', reportId);
            } catch (error) {
                console.error('[CANCEL] Error clearing sync queue:', error);
            }
        }

        // ============ MINIMAL/FREEFORM MODE UI ============
        
        /**
         * Checklist items for freeform mode (visual only, no functionality)
         */
        const FREEFORM_CHECKLIST_ITEMS = [
            'Weather', 'Work Performed', 'Contractors', 'Equipment', 'Issues',
            'Communications', 'QA/QC', 'Safety', 'Visitors', 'Photos'
        ];

        /**
         * Initialize the minimal mode UI
         */
        function initMinimalModeUI() {
            // Set date
            const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
            document.getElementById('minimalCurrentDate').textContent = dateStr;

            // Migrate old freeformNotes string to entries array (one-time)
            migrateFreeformNotesToEntries();

            // Initialize freeform entries and checklist
            initFreeformEntries();

            // Update weather display
            updateMinimalWeatherDisplay();

            // Render photos
            renderMinimalPhotos();

            // Setup photo input handler
            const photoInput = document.getElementById('minimalPhotoInput');
            if (photoInput) {
                photoInput.addEventListener('change', handleMinimalPhotoInput);
            }
        }

        /**
         * Migrate old single-string freeformNotes to freeform_entries array
         */
        function migrateFreeformNotesToEntries() {
            // Check if there's old-style notes that need migration
            const oldNotes = report.fieldNotes?.freeformNotes;
            if (oldNotes && oldNotes.trim() && (!report.freeform_entries || report.freeform_entries.length === 0)) {
                // Create first entry from old notes
                report.freeform_entries = [{
                    id: crypto.randomUUID(),
                    content: oldNotes.trim(),
                    created_at: report.meta?.createdAt || Date.now(),
                    updated_at: Date.now(),
                    synced: false
                }];
                // Clear old notes to prevent re-migration
                report.fieldNotes.freeformNotes = '';
                saveReport();
                console.log('[Freeform] Migrated old notes to entries array');
            }
        }

        /**
         * Initialize freeform entries and checklist data structures
         */
        function initFreeformEntries() {
            if (!report.freeform_entries) report.freeform_entries = [];
            if (!report.freeform_checklist) {
                report.freeform_checklist = {};
                FREEFORM_CHECKLIST_ITEMS.forEach(item => {
                    report.freeform_checklist[item] = false;
                });
            }
            renderFreeformEntries();
            renderFreeformChecklist();
        }

        /**
         * Add a new freeform entry
         */
        function addFreeformEntry() {
            const entry = {
                id: crypto.randomUUID(),
                content: '',
                created_at: Date.now(),
                updated_at: Date.now(),
                synced: false
            };
            report.freeform_entries.push(entry);
            
            // Queue for real-time backup to Supabase
            if (currentReportId) {
                queueEntryBackup(currentReportId, entry);
            }
            
            renderFreeformEntries();
            saveReport();
            // Start editing the new entry immediately
            startFreeformEdit(entry.id);
        }

        /**
         * Render all freeform entries in chronological order
         */
        function renderFreeformEntries() {
            const container = document.getElementById('freeformEntriesContainer');
            const countEl = document.getElementById('freeformEntriesCount');
            if (!container || !countEl) return;

            const entries = report.freeform_entries || [];
            
            // Update count
            countEl.textContent = entries.length === 0 
                ? 'No entries yet' 
                : `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`;
            
            if (entries.length === 0) {
                container.innerHTML = '<p class="text-slate-400 text-center py-4 text-sm">Tap "+ Add Entry" to start</p>';
                return;
            }
            
            // Sort chronologically (oldest first)
            const sorted = [...entries].sort((a, b) => a.created_at - b.created_at);
            
            container.innerHTML = sorted.map(entry => {
                const time = new Date(entry.created_at).toLocaleTimeString('en-US', { 
                    hour: 'numeric', 
                    minute: '2-digit'
                });
                const escapedContent = escapeHtml(entry.content);
                const displayContent = escapedContent || '<span class="text-slate-400 italic">Empty entry</span>';
                
                return `
                    <div class="freeform-entry border border-slate-200 rounded" data-freeform-entry-id="${entry.id}">
                        <div class="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-200">
                            <span class="text-xs text-slate-500 font-medium">${time}</span>
                            <div class="flex items-center gap-3">
                                <button onclick="startFreeformEdit('${entry.id}')" class="freeform-edit-btn text-slate-400 hover:text-dot-blue p-1" title="Edit">
                                    <i class="fas fa-pencil-alt text-xs"></i>
                                </button>
                                <button onclick="deleteFreeformEntry('${entry.id}')" class="text-slate-400 hover:text-red-500 p-1" title="Delete">
                                    <i class="fas fa-trash text-xs"></i>
                                </button>
                            </div>
                        </div>
                        <div class="p-3">
                            <p class="freeform-entry-content whitespace-pre-wrap text-slate-700 text-sm">${displayContent}</p>
                        </div>
                    </div>
                `;
            }).join('');
        }

        /**
         * Start editing a freeform entry (inline edit pattern matching guided mode)
         */
        function startFreeformEdit(entryId) {
            const entry = report.freeform_entries?.find(e => e.id === entryId);
            if (!entry) return;

            const entryDiv = document.querySelector(`[data-freeform-entry-id="${entryId}"]`);
            if (!entryDiv) return;

            const contentP = entryDiv.querySelector('.freeform-entry-content');
            const editBtn = entryDiv.querySelector('.freeform-edit-btn');
            
            if (contentP && editBtn) {
                // Create textarea with current content
                const textarea = document.createElement('textarea');
                textarea.id = `freeform-edit-textarea-${entryId}`;
                textarea.className = 'w-full text-sm text-slate-700 border border-slate-300 rounded p-2 bg-white focus:outline-none focus:border-dot-blue';
                textarea.value = entry.content;
                textarea.rows = 3;
                textarea.placeholder = 'Enter your field notes...';
                
                // v6.6: Auto-save on typing (debounced 500ms)
                let freeformSaveTimeout = null;
                textarea.addEventListener('input', () => {
                    if (freeformSaveTimeout) clearTimeout(freeformSaveTimeout);
                    freeformSaveTimeout = setTimeout(() => {
                        const entry = report.freeform_entries?.find(e => e.id === entryId);
                        if (entry) {
                            entry.content = textarea.value.trim();
                            entry.updated_at = Date.now();
                            entry.synced = false;
                            if (currentReportId) {
                                queueEntryBackup(currentReportId, entry);
                            }
                            saveReport();
                            console.log('[AUTOSAVE] Freeform entry saved:', entryId);
                        }
                    }, 500);
                });
                
                // v6.6: Also save on blur (safety net)
                textarea.addEventListener('blur', () => {
                    if (freeformSaveTimeout) clearTimeout(freeformSaveTimeout);
                    const entry = report.freeform_entries?.find(e => e.id === entryId);
                    if (entry) {
                        const newContent = textarea.value.trim();
                        if (newContent !== entry.content) {
                            entry.content = newContent;
                            entry.updated_at = Date.now();
                            entry.synced = false;
                            if (currentReportId) queueEntryBackup(currentReportId, entry);
                            saveReport();
                            console.log('[AUTOSAVE] Freeform entry saved on blur:', entryId);
                        }
                    }
                });
                
                // Replace p with textarea
                contentP.replaceWith(textarea);
                
                // Auto-expand and focus
                autoExpand(textarea);
                textarea.focus();
                textarea.setSelectionRange(textarea.value.length, textarea.value.length);
                
                // Change edit button to save button (pencil → check)
                editBtn.innerHTML = '<i class="fas fa-check text-xs"></i>';
                editBtn.className = 'freeform-save-btn text-safety-green hover:text-green-700 p-1';
                editBtn.title = 'Save';
                editBtn.onclick = () => saveFreeformEdit(entryId);
            }
        }

        /**
         * Save freeform entry edit
         */
        function saveFreeformEdit(entryId) {
            const textarea = document.getElementById(`freeform-edit-textarea-${entryId}`);
            if (!textarea) return;

            const newContent = textarea.value.trim();
            const entry = report.freeform_entries?.find(e => e.id === entryId);
            
            if (entry) {
                entry.content = newContent;
                entry.updated_at = Date.now();
                entry.synced = false;
                
                // Queue for real-time backup to Supabase
                if (currentReportId) {
                    queueEntryBackup(currentReportId, entry);
                }
                
                saveReport();
            }

            renderFreeformEntries();
            showToast('Entry saved', 'success');
        }

        /**
         * Delete a freeform entry
         */
        function deleteFreeformEntry(entryId) {
            if (!confirm('Delete this entry?')) return;
            
            report.freeform_entries = report.freeform_entries.filter(e => e.id !== entryId);
            saveReport();
            renderFreeformEntries();
            showToast('Entry deleted', 'success');
        }

        /**
         * Render the freeform checklist (visual only)
         */
        function renderFreeformChecklist() {
            const container = document.getElementById('freeformChecklist');
            if (!container) return;

            container.innerHTML = FREEFORM_CHECKLIST_ITEMS.map(item => {
                const checked = report.freeform_checklist?.[item] || false;
                const checkedClass = checked ? 'bg-green-50 border-green-300' : 'bg-white';
                return `
                    <label class="flex items-center gap-2 p-2 border border-slate-200 rounded cursor-pointer hover:bg-slate-50 transition-colors ${checkedClass}">
                        <input type="checkbox" ${checked ? 'checked' : ''} 
                            onchange="toggleFreeformChecklistItem('${item}', this.checked)" 
                            class="w-4 h-4 accent-safety-green rounded">
                        <span class="text-sm text-slate-700">${item}</span>
                    </label>
                `;
            }).join('');
        }

        /**
         * Toggle a freeform checklist item (visual only, no validation impact)
         */
        function toggleFreeformChecklistItem(item, checked) {
            if (!report.freeform_checklist) report.freeform_checklist = {};
            report.freeform_checklist[item] = checked;
            renderFreeformChecklist();
            saveReport();
        }

        /**
         * Initialize the guided mode UI (existing functionality)
         */
        function initGuidedModeUI() {
            // Set date
            const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
            document.getElementById('currentDate').textContent = dateStr;

            // v6: Initialize v6 structures if not present
            if (!report.entries) report.entries = [];
            if (!report.toggleStates) report.toggleStates = {};

            renderAllSections();
            updateAllPreviews();
            updateProgress();
            updateNAButtons();

            // Work Summary entries are rendered by renderSection('activities')
            // Input field starts empty for new entries

            // Safety checkboxes - sync with report state
            document.getElementById('no-incidents').checked = report.safety?.noIncidents || false;
            document.getElementById('has-incidents').checked = report.safety?.hasIncidents || false;

            // Initialize auto-expand for all textareas
            initAllAutoExpandTextareas();
            
            // v6.6: Initialize auto-save on typing for guided sections
            initAllGuidedAutoSave();
        }

        /**
         * v6.6: Get work entries for a specific contractor
         * @param {string} contractorId - The contractor ID
         * @returns {Array} Array of entry objects for this contractor
         */
        function getContractorWorkEntries(contractorId) {
            return getEntriesForSection(`work_${contractorId}`);
        }

        /**
         * v6.6: Add a work entry for a specific contractor
         * @param {string} contractorId - The contractor ID
         */
        function addContractorWorkEntry(contractorId) {
            const input = document.getElementById(`work-input-${contractorId}`);
            if (!input) return;
            
            const text = input.value.trim();
            if (!text) return;
            
            const stateKey = `work_${contractorId}`;
            
            // If auto-save already created an entry for this content, just clear and render
            if (autoSaveState[stateKey]?.saved) {
                input.value = '';
                delete autoSaveState[stateKey];  // Clear state for next entry
                renderContractorWorkCards();
                updateAllPreviews();
                updateProgress();
                return;
            }
            
            // Otherwise create new entry (user clicked "+" before auto-save triggered)
            createEntry(stateKey, text);
            input.value = '';
            renderContractorWorkCards();
            updateAllPreviews();
            updateProgress();
        }

        /**
         * v6.6: Delete a contractor work entry
         * @param {string} entryId - The entry ID to delete
         */
        function deleteContractorWorkEntry(entryId) {
            deleteEntryById(entryId);
            renderContractorWorkCards();
            updateAllPreviews();
            updateProgress();
        }

        /**
         * v6.6: Update the activities section preview based on contractor work
         * Format: "X contractors, Y no work" or "Tap to add"
         */
        function updateActivitiesPreview() {
            const preview = document.getElementById('activities-preview');
            const status = document.getElementById('activities-status');

            if (!projectContractors || projectContractors.length === 0) {
                preview.textContent = 'No contractors configured';
                status.innerHTML = '<i class="fas fa-chevron-down text-slate-400 text-xs"></i>';
                return;
            }

            // Count contractors with work logged
            let withWork = 0;
            let noWork = 0;

            projectContractors.forEach(contractor => {
                const activity = getContractorActivity(contractor.id);
                const entries = getContractorWorkEntries(contractor.id);
                
                if (activity?.noWork && entries.length === 0) {
                    noWork++;
                } else if (entries.length > 0 || !activity?.noWork) {
                    withWork++;
                }
            });

            if (withWork > 0 || noWork > 0) {
                const parts = [];
                if (withWork > 0) parts.push(`${withWork} with work`);
                if (noWork > 0) parts.push(`${noWork} no work`);
                preview.textContent = parts.join(', ');
                status.innerHTML = '<i class="fas fa-check text-safety-green text-xs"></i>';
            } else {
                preview.textContent = 'Tap to add';
                status.innerHTML = '<i class="fas fa-chevron-down text-slate-400 text-xs"></i>';
            }
        }

        /**
         * Update the weather display in minimal mode
         */
        function updateMinimalWeatherDisplay() {
            const weather = report.overview?.weather;
            if (!weather) return;

            const conditionEl = document.getElementById('minimalWeatherCondition');
            const tempEl = document.getElementById('minimalWeatherTemp');
            const precipEl = document.getElementById('minimalWeatherPrecip');
            const iconEl = document.getElementById('minimalWeatherIcon');

            if (conditionEl) conditionEl.textContent = weather.generalCondition || '--';
            if (tempEl) {
                const high = weather.highTemp || '--';
                const low = weather.lowTemp || '--';
                tempEl.textContent = `${high}° / ${low}°`;
            }
            if (precipEl) precipEl.textContent = `Precip: ${weather.precipitation || '--'}`;

            // Update icon based on condition
            if (iconEl) {
                const condition = (weather.generalCondition || '').toLowerCase();
                let iconClass = 'fa-cloud-sun';
                if (condition.includes('rain') || condition.includes('shower')) iconClass = 'fa-cloud-rain';
                else if (condition.includes('cloud')) iconClass = 'fa-cloud';
                else if (condition.includes('sun') || condition.includes('clear')) iconClass = 'fa-sun';
                else if (condition.includes('snow')) iconClass = 'fa-snowflake';
                else if (condition.includes('storm') || condition.includes('thunder')) iconClass = 'fa-bolt';
                iconEl.className = `fas ${iconClass} text-white`;
            }
        }

        /**
         * Render photos in minimal mode
         */
        function renderMinimalPhotos() {
            const grid = document.getElementById('minimalPhotosGrid');
            const countEl = document.getElementById('minimalPhotosCount');

            if (!grid) return;

            const photos = report.photos || [];
            countEl.textContent = photos.length > 0 ? `${photos.length} photo${photos.length > 1 ? 's' : ''}` : 'No photos yet';

            if (photos.length === 0) {
                grid.innerHTML = '';
                return;
            }

            grid.innerHTML = photos.map((p, idx) => `
                <div class="border-2 border-slate-300 overflow-hidden bg-slate-100">
                    <div class="relative">
                        <img src="${p.url}" class="w-full aspect-square object-cover" onerror="this.onerror=null; this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%23cbd5e1%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2250%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%2364748b%22 font-size=%2212%22>Error</text></svg>';">
                        <button onclick="deleteMinimalPhoto(${idx})" class="absolute top-2 right-2 w-7 h-7 bg-red-600 text-white text-xs flex items-center justify-center shadow-lg"><i class="fas fa-times"></i></button>
                        <div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-2 pt-6">
                            <div class="flex items-center gap-1 text-white/90 mb-1">
                                <i class="fas fa-clock text-[8px]"></i>
                                <p class="text-[10px] font-medium">${p.date || ''} ${p.time || ''}</p>
                            </div>
                            ${p.gps ? `
                                <div class="flex items-center gap-1 text-safety-green">
                                    <i class="fas fa-map-marker-alt text-[8px]"></i>
                                    <p class="text-[9px] font-mono">${p.gps.lat.toFixed(5)}, ${p.gps.lng.toFixed(5)}</p>
                                    ${p.gps.accuracy ? `<span class="text-[8px] text-white/60">(±${p.gps.accuracy}m)</span>` : ''}
                                </div>
                            ` : `
                                <div class="flex items-center gap-1 text-dot-orange">
                                    <i class="fas fa-location-crosshairs text-[8px]"></i>
                                    <p class="text-[9px]">No GPS</p>
                                </div>
                            `}
                        </div>
                    </div>
                    <div class="p-2 bg-white">
                        <textarea
                            class="w-full text-xs border border-slate-200 rounded p-2 bg-slate-50 focus:bg-white focus:border-dot-blue focus:outline-none resize-none"
                            placeholder="Add caption..."
                            maxlength="500"
                            rows="2"
                            oninput="updateMinimalPhotoCaption(${idx}, this.value)"
                            onblur="updateMinimalPhotoCaption(${idx}, this.value)"
                        >${p.caption || ''}</textarea>
                    </div>
                </div>
            `).join('');
        }

        /**
         * Handle photo input in minimal mode
         * Saves to IndexedDB locally, uploads to Supabase on Submit
         */
        async function handleMinimalPhotoInput(e) {
            const files = e.target.files;
            if (!files || files.length === 0) return;

            for (const file of files) {
                try {
                    showToast('Processing photo...', 'info');

                    // Get GPS if available (using multi-reading high accuracy)
                    let gps = null;
                    try {
                        gps = await getHighAccuracyGPS(true);
                    } catch (e) {
                        console.warn('[PHOTO] GPS failed:', e);
                    }

                    const photoId = crypto.randomUUID();
                    const now = new Date();

                    // Compress image
                    const rawDataUrl = await readFileAsDataURL(file);
                    const compressedDataUrl = await compressImage(rawDataUrl, 1200, 0.7);

                    // Try to upload to Supabase if online, otherwise store base64 for later
                    let storagePath = null;
                    let publicUrl = compressedDataUrl; // Use base64 as fallback URL for display

                    if (navigator.onLine) {
                        try {
                            showToast('Uploading photo...', 'info');
                            const compressedBlob = await dataURLtoBlob(compressedDataUrl);
                            const result = await uploadPhotoToSupabase(compressedBlob, photoId);
                            storagePath = result.storagePath;
                            publicUrl = result.publicUrl;
                        } catch (uploadErr) {
                            console.warn('[PHOTO] Upload failed, saving locally:', uploadErr);
                            // Keep base64 for later upload
                        }
                    }

                    const photoObj = {
                        id: photoId,
                        url: publicUrl,
                        base64: storagePath ? null : compressedDataUrl, // Only store base64 if not uploaded
                        storagePath: storagePath,
                        caption: '',
                        timestamp: now.toISOString(),
                        date: now.toLocaleDateString(),
                        time: now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
                        gps: gps,
                        fileName: file.name,
                        fileSize: file.size,
                        fileType: file.type
                    };

                    report.photos.push(photoObj);

                    // Save photo to IndexedDB (local-first)
                    await savePhotoToIndexedDB(photoObj);

                    renderMinimalPhotos();
                    saveReport();
                    showToast(storagePath ? 'Photo saved' : 'Photo saved locally', 'success');
                } catch (err) {
                    console.error('Error adding photo:', err);
                    showToast('Failed to add photo', 'error');
                }
            }

            // Reset input
            e.target.value = '';
        }

        // readFileAsDataURL() and dataURLtoBlob() moved to /js/media-utils.js

        /**
         * Delete a photo in minimal mode
         */
        async function deleteMinimalPhoto(idx) {
            if (!confirm('Delete this photo?')) return;

            const photo = report.photos[idx];
            if (photo) {
                // Delete from IndexedDB first
                try {
                    await window.idb.deletePhoto(photo.id);
                    console.log('[PHOTO] Deleted from IndexedDB:', photo.id);
                } catch (err) {
                    console.warn('[PHOTO] Failed to delete from IndexedDB:', err);
                }

                // Delete from Supabase if it was uploaded
                if (photo.storagePath) {
                    await deletePhotoFromSupabase(photo.id, photo.storagePath);
                }
            }

            report.photos.splice(idx, 1);
            saveReport();
            renderMinimalPhotos();
        }

        /**
         * Update photo caption in minimal/freeform mode
         */
        function updateMinimalPhotoCaption(idx, caption) {
            if (report.photos[idx]) {
                report.photos[idx].caption = caption;
                saveReport();
            }
        }

        // ============ AI PROCESSING WEBHOOK ============
        const N8N_PROCESS_WEBHOOK = 'https://advidere.app.n8n.cloud/webhook/fieldvoice-refine-v6.6';

        /**
         * Build the payload for AI processing
         */
        function buildProcessPayload() {
            const todayStr = getTodayDateString();
            const reportKey = getReportKey(activeProject?.id, todayStr);

            return {
                reportId: reportKey,
                captureMode: report.meta.captureMode || 'guided',

                projectContext: {
                    projectId: activeProject?.id || null,
                    projectName: activeProject?.projectName || report.project?.projectName || '',
                    noabProjectNo: activeProject?.noabProjectNo || '',
                    location: activeProject?.location || '',
                    engineer: activeProject?.engineer || '',
                    primeContractor: activeProject?.primeContractor || '',
                    contractors: activeProject?.contractors || [],
                    equipment: activeProject?.equipment || []
                },

                fieldNotes: report.meta.captureMode === 'minimal'
                    ? { 
                        // v6.6: Combine all freeform entries into single string for AI processing
                        freeformNotes: (report.freeform_entries || [])
                            .filter(e => e.content && e.content.trim())
                            .sort((a, b) => a.created_at - b.created_at)
                            .map(e => e.content.trim())
                            .join('\n\n') || report.fieldNotes?.freeformNotes || '',
                        // Also include raw entries for future AI improvements
                        freeform_entries: report.freeform_entries || []
                      }
                    : {
                        workSummary: report.guidedNotes?.workSummary || '',
                        issues: report.guidedNotes?.issues || '',
                        safety: report.guidedNotes?.safety || ''
                      },

                weather: report.overview?.weather || {},

                photos: (report.photos || []).map(p => ({
                    id: p.id,
                    url: p.url,
                    storagePath: p.storagePath,
                    caption: p.caption || '',
                    timestamp: p.timestamp,
                    date: p.date,
                    time: p.time,
                    gps: p.gps
                })),

                reportDate: report.overview?.date || new Date().toLocaleDateString(),
                inspectorName: report.overview?.completedBy || '',

                // v6.6: Structured data for AI processing
                operations: report.operations || [],
                equipmentRows: report.equipmentRows || [],
                activities: report.activities || [],
                safety: report.safety || { hasIncidents: false, noIncidents: true, notes: [] },

                // v6: Entry-based notes and toggle states
                entries: report.entries || [],
                toggleStates: report.toggleStates || {}
            };
        }

        /**
         * Call the AI processing webhook
         */
        async function callProcessWebhook(payload) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);

            try {
                const response = await fetch(N8N_PROCESS_WEBHOOK, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    throw new Error(`Webhook failed: ${response.status}`);
                }

                const data = await response.json();

                // Validate response structure
                if (!data.success && !data.aiGenerated) {
                    console.error('Invalid webhook response:', data);
                    throw new Error('Invalid response from AI processing');
                }

                // If aiGenerated is a string, try to parse it
                if (typeof data.aiGenerated === 'string') {
                    try {
                        data.aiGenerated = JSON.parse(data.aiGenerated);
                    } catch (e) {
                        console.error('Failed to parse aiGenerated string:', e);
                    }
                }

                // Validate required fields in AI response
                const ai = data.aiGenerated;
                if (ai) {
                    // Ensure arrays exist
                    ai.activities = ai.activities || [];
                    ai.operations = ai.operations || [];
                    ai.equipment = ai.equipment || [];
                    ai.generalIssues = ai.generalIssues || [];
                    ai.qaqcNotes = ai.qaqcNotes || [];
                    ai.safety = ai.safety || { hasIncidents: false, noIncidents: true, notes: '' };
                }

                // Log the AI response for debugging
                console.log('[AI] Received response:', JSON.stringify(data.aiGenerated, null, 2));

                return data;
            } catch (error) {
                clearTimeout(timeoutId);
                throw error;
            }
        }

        /**
         * Save AI request to Supabase
         * DISABLED: report_ai_request table removed - debug logging not needed
         */
        async function saveAIRequest(payload) {
            // No-op: AI request logging disabled in v6.6
            return;
        }

        /**
         * Save AI response to Supabase
         */
        async function saveAIResponse(response, processingTimeMs) {
            if (!currentReportId) return;

            try {
                const responseData = {
                    report_id: currentReportId,
                    response_payload: response,
                    model_used: 'n8n-fieldvoice-refine',
                    processing_time_ms: processingTimeMs,
                    received_at: new Date().toISOString()
                };

                // Use upsert to handle retries/reprocessing - prevents duplicate rows
                const { error } = await supabaseClient
                    .from('ai_responses')
                    .upsert(responseData, { onConflict: 'report_id' });

                if (error) {
                    console.error('Error saving AI response:', error);
                }
            } catch (err) {
                console.error('Failed to save AI response:', err);
            }
        }

        // ============ NETWORK ERROR MODAL HELPERS ============
        /**
         * Show network error modal with retry and drafts options
         * @param {string} title - Modal title
         * @param {string} message - Modal message
         * @param {Function} onRetry - Callback when retry is clicked
         * @param {Function} onDrafts - Callback when save to drafts is clicked
         */
        function showNetworkErrorModal(title, message, onRetry, onDrafts) {
            const modal = document.getElementById('network-error-modal');
            const titleEl = document.getElementById('network-modal-title');
            const messageEl = document.getElementById('network-modal-message');
            const retryBtn = document.getElementById('network-modal-retry');
            const draftsBtn = document.getElementById('network-modal-drafts');

            titleEl.textContent = title || 'Connection Issue';
            messageEl.textContent = message || 'Unable to submit report. Your data is safe.';

            // Remove old listeners by cloning buttons
            const newRetryBtn = retryBtn.cloneNode(true);
            const newDraftsBtn = draftsBtn.cloneNode(true);
            retryBtn.parentNode.replaceChild(newRetryBtn, retryBtn);
            draftsBtn.parentNode.replaceChild(newDraftsBtn, draftsBtn);

            // Add new listeners
            newRetryBtn.addEventListener('click', () => {
                hideNetworkErrorModal();
                if (onRetry) onRetry();
            });

            newDraftsBtn.addEventListener('click', () => {
                hideNetworkErrorModal();
                if (onDrafts) onDrafts();
            });

            modal.classList.remove('hidden');
        }

        /**
         * Hide network error modal
         */
        function hideNetworkErrorModal() {
            const modal = document.getElementById('network-error-modal');
            modal.classList.add('hidden');
        }

        /**
         * Handle offline/error scenario for AI processing
         * v6: Uses addToSyncQueue() from storage-keys.js for offline queue
         */
        function handleOfflineProcessing(payload, redirectToDrafts = false) {
            const activeProjectId = getStorageItem(STORAGE_KEYS.ACTIVE_PROJECT_ID);
            const todayStr = getTodayDateString();

            // v6: Use addToSyncQueue for offline operations
            const syncOperation = {
                type: 'report',
                action: 'upsert',
                data: {
                    projectId: activeProjectId,
                    projectName: report.overview?.projectName || activeProject?.projectName || 'Unknown Project',
                    reportDate: todayStr,
                    captureMode: report.meta?.captureMode || 'guided',
                    payload: payload,
                    reportData: {
                        meta: report.meta,
                        overview: report.overview,
                        weather: report.overview?.weather,
                        guidedNotes: report.guidedNotes,
                        fieldNotes: report.fieldNotes,
                        activities: report.activities,
                        operations: report.operations,
                        equipment: report.equipment,
                        photos: report.photos,
                        safety: report.safety,
                        generalIssues: report.generalIssues,
                        qaqcNotes: report.qaqcNotes,
                        contractorCommunications: report.contractorCommunications,
                        visitorsRemarks: report.visitorsRemarks,
                        additionalNotes: report.additionalNotes,
                        reporter: report.reporter
                    }
                },
                timestamp: Date.now()
            };

            // v6: Add to sync queue using storage-keys.js helper
            addToSyncQueue(syncOperation);
            console.log('[OFFLINE] Report added to sync queue');

            // Also update local meta status
            report.meta.status = 'pending_refine';
            saveReport();

            showToast("You're offline. Report saved to drafts.", 'warning');

            // Redirect to drafts page if requested
            if (redirectToDrafts) {
                window.location.href = 'drafts.html';
            }
        }

        /**
         * Finish the minimal mode report with AI processing
         */
        async function finishMinimalReport() {
            // Early offline check - show modal when offline
            if (!navigator.onLine) {
                showNetworkErrorModal(
                    'No Internet Connection',
                    'You appear to be offline. Your report data is saved locally.',
                    () => finishMinimalReport(),  // Retry
                    () => {
                        showToast('Report saved to drafts', 'info');
                        window.location.href = 'drafts.html';
                    }
                );
                return;
            }

            // Validate - check for at least one entry with content
            const entries = report.freeform_entries || [];
            const hasContent = entries.some(e => e.content && e.content.trim());
            if (!hasContent) {
                showToast('Please add at least one field note entry', 'error');
                return;
            }

            // Get button reference for loading state
            const finishBtn = document.querySelector('#minimalModeScreen button[onclick="finishMinimalReport()"]');
            const originalBtnHtml = finishBtn ? finishBtn.innerHTML : '';

            // Show loading state
            if (finishBtn) {
                finishBtn.disabled = true;
                finishBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Processing with AI...';
            }
            showToast('Processing with AI...', 'info');

            // Mark as interview completed
            report.meta.interviewCompleted = true;
            report.overview.endTime = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

            // Ensure report is saved to Supabase first
            await saveReportToSupabase();

            // Upload any pending photos and insert metadata into photos table
            await uploadPendingPhotos();

            // Build payload
            const payload = buildProcessPayload();

            // Check if online
            if (!navigator.onLine) {
                handleOfflineProcessing(payload, true);
                return;
            }

            // Save AI request to Supabase
            await saveAIRequest(payload);

            const startTime = Date.now();

            // Call webhook
            try {
                const result = await callProcessWebhook(payload);
                const processingTime = Date.now() - startTime;

                // Save AI response to Supabase
                await saveAIResponse(result.aiGenerated, processingTime);

                // Save AI response to local report
                if (result.aiGenerated) {
                    report.aiGenerated = result.aiGenerated;
                }
                report.meta.status = 'refined';
                await saveReportToSupabase();

                // v6.6.2: Save complete report package to single localStorage key
                // This is the source of truth for report.html
                const todayStr = getTodayDateString();
                const reportDataPackage = {
                    reportId: currentReportId,
                    projectId: activeProject?.id,
                    reportDate: todayStr,
                    status: 'refined',

                    // From n8n webhook response
                    aiGenerated: result.aiGenerated || {},
                    captureMode: result.captureMode || report.meta?.captureMode || 'minimal',

                    // Original field notes (for "Original Notes" tab)
                    originalInput: result.originalInput || payload,

                    // User edits - initialize empty (will be populated on report.html)
                    userEdits: {},

                    // Metadata
                    createdAt: report.meta?.createdAt || new Date().toISOString(),
                    lastSaved: new Date().toISOString()
                };

                const saveSuccess = saveReportData(currentReportId, reportDataPackage);
                if (saveSuccess) {
                    console.log('[LOCAL] Complete report package saved to localStorage:', currentReportId);
                } else {
                    console.warn('[LOCAL] Failed to save report package to localStorage');
                }

                // v6.6.3: Update fvp_current_reports so dashboard can find this refined report
                const currentReports = JSON.parse(localStorage.getItem('fvp_current_reports') || '{}');
                currentReports[currentReportId] = {
                    id: currentReportId,
                    project_id: activeProject?.id,
                    project_name: activeProject?.projectName || activeProject?.project_name,
                    date: todayStr,
                    report_date: todayStr,
                    status: 'refined',
                    created_at: report.meta?.createdAt ? new Date(report.meta.createdAt).getTime() : Date.now(),
                    lastSaved: new Date().toISOString()
                };
                localStorage.setItem('fvp_current_reports', JSON.stringify(currentReports));
                console.log('[LOCAL] Updated fvp_current_reports with refined status:', currentReportId);

                // Clean up old draft key if we have a real Supabase ID
                const draftKey = `draft_${activeProject?.id}_${todayStr}`;
                if (currentReportId && currentReportId !== draftKey) {
                    deleteCurrentReport(draftKey);
                    console.log('[LOCAL] Cleaned up old draft key:', draftKey);
                }

                // Release the lock before navigating away
                if (window.lockManager) {
                    await window.lockManager.releaseCurrentLock();
                }

                // Navigate to report with date and reportId parameters
                window.location.href = `report.html?date=${todayStr}&reportId=${currentReportId}`;
            } catch (error) {
                console.error('AI processing failed:', error);

                // Restore button state
                if (finishBtn) {
                    finishBtn.disabled = false;
                    finishBtn.innerHTML = originalBtnHtml;
                }

                // Show modal with retry/drafts options
                showNetworkErrorModal(
                    'Submission Failed',
                    'Could not reach the server. Your report data is safe.',
                    () => finishMinimalReport(),  // Retry
                    () => {
                        handleOfflineProcessing(payload, true);
                    }
                );
            }
        }

        // ============ PROJECT & CONTRACTOR LOADING ============
        /* DEPRECATED — now using window.dataLayer.loadActiveProject()
        async function loadActiveProject() {
            // v6: Use getStorageItem with STORAGE_KEYS.ACTIVE_PROJECT_ID
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

                // v6: Equipment is now entered per-report, not loaded from project
                // Equipment functions removed - see renderEquipmentInput() for per-report entry
                activeProject.equipment = [];

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

        function getTodayDateFormatted() {
            return new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        }

        function getContractorActivity(contractorId) {
            if (!report || !report.activities) return null;
            return report.activities.find(a => a.contractorId === contractorId);
        }

        /**
         * v6.6: Initialize contractor activities (simplified - noWork flag only)
         */
        function initializeContractorActivities() {
            if (!report.activities) report.activities = [];

            // Ensure each contractor has an activity entry (noWork flag only)
            projectContractors.forEach(contractor => {
                const existing = report.activities.find(a => a.contractorId === contractor.id);
                if (!existing) {
                    report.activities.push({
                        contractorId: contractor.id,
                        noWork: true
                    });
                }
            });
        }

        /**
         * v6.6: Render contractor work cards with timestamped entries
         */
        function renderContractorWorkCards() {
            const container = document.getElementById('contractor-work-list');
            const warningEl = document.getElementById('no-project-warning');
            const footerEl = document.getElementById('contractor-work-footer');

            if (!activeProject || projectContractors.length === 0) {
                warningEl?.classList.remove('hidden');
                footerEl?.classList.add('hidden');
                container.innerHTML = '';
                return;
            }

            warningEl?.classList.add('hidden');
            footerEl?.classList.remove('hidden');
            initializeContractorActivities();

            const todayDate = getTodayDateFormatted();

            container.innerHTML = projectContractors.map((contractor) => {
                const activity = getContractorActivity(contractor.id) || { noWork: true };
                const entries = getContractorWorkEntries(contractor.id);
                const hasWork = !activity.noWork || entries.length > 0;
                const isExpanded = hasWork || !activity.noWork;
                
                const typeLabel = contractor.type === 'prime' ? 'PRIME' : 'SUB';
                const tradesText = contractor.trades ? ` • ${contractor.trades.toUpperCase()}` : '';
                const headerText = `${contractor.name.toUpperCase()} – ${typeLabel}${tradesText}`;
                const borderColor = contractor.type === 'prime' ? 'border-safety-green' : 'border-dot-blue';
                const bgColor = contractor.type === 'prime' ? 'bg-safety-green' : 'bg-dot-blue';
                const textColor = contractor.type === 'prime' ? 'text-safety-green' : 'text-dot-blue';

                // Build entries HTML
                const entriesHtml = entries.length > 0 ? entries.map(entry => {
                    const time = new Date(entry.timestamp).toLocaleTimeString('en-US', { 
                        hour: 'numeric', 
                        minute: '2-digit',
                        hour12: true 
                    });
                    return `
                        <div class="bg-white border border-slate-200 p-3 relative group" data-entry-id="${entry.id}">
                            <div class="flex items-start justify-between gap-2">
                                <div class="flex-1">
                                    <p class="text-[10px] font-medium text-slate-400 uppercase">${time}</p>
                                    <p class="entry-content text-sm text-slate-700 mt-1">${escapeHtml(entry.content)}</p>
                                </div>
                                <div class="flex items-center gap-1 opacity-50 group-hover:opacity-100 transition-opacity">
                                    <button onclick="startEditEntry('${entry.id}', 'contractor-work')" 
                                            class="edit-btn text-slate-400 hover:text-dot-blue p-1">
                                        <i class="fas fa-pencil-alt text-xs"></i>
                                    </button>
                                    <button onclick="deleteContractorWorkEntry('${entry.id}')" 
                                            class="text-red-400 hover:text-red-600 p-1">
                                        <i class="fas fa-trash text-xs"></i>
                                    </button>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('') : '';

                // Subtitle text
                let subtitleText = 'Tap to add work';
                if (activity.noWork && entries.length === 0) {
                    subtitleText = 'No work performed';
                } else if (entries.length > 0) {
                    subtitleText = `${entries.length} note${entries.length === 1 ? '' : 's'} logged`;
                }

                return `
                    <div class="contractor-work-card border-2 ${hasWork ? borderColor : 'border-slate-200'} rounded-lg overflow-hidden" data-contractor-id="${contractor.id}">
                        <!-- Header -->
                        <button onclick="toggleContractorCard('${contractor.id}')" class="w-full p-3 flex items-center gap-3 text-left ${hasWork ? bgColor + '/10' : 'bg-slate-50'}">
                            <div class="w-8 h-8 ${hasWork ? bgColor : 'bg-slate-300'} rounded flex items-center justify-center shrink-0">
                                <i class="fas ${hasWork ? 'fa-hard-hat' : 'fa-minus'} text-white text-sm"></i>
                            </div>
                            <div class="flex-1 min-w-0">
                                <p class="text-xs font-bold ${hasWork ? textColor : 'text-slate-500'} uppercase leading-tight truncate">${escapeHtml(headerText)}</p>
                                <p class="text-[10px] text-slate-500 mt-0.5">${subtitleText}</p>
                            </div>
                            <i id="contractor-chevron-${contractor.id}" class="fas fa-chevron-down text-slate-400 text-xs transition-transform ${isExpanded ? 'rotate-180' : ''}"></i>
                        </button>

                        <!-- Expandable Content -->
                        <div id="contractor-content-${contractor.id}" class="contractor-content ${isExpanded ? '' : 'hidden'} border-t border-slate-200 p-3 space-y-3">
                            <!-- No Work Toggle -->
                            <label class="flex items-center gap-3 p-3 bg-slate-100 border border-slate-300 rounded cursor-pointer hover:bg-slate-200 transition-colors">
                                <input type="checkbox"
                                    id="no-work-${contractor.id}"
                                    ${activity.noWork ? 'checked' : ''}
                                    onchange="toggleNoWork('${contractor.id}', this.checked)"
                                    class="w-5 h-5 accent-slate-600">
                                <span class="text-sm font-medium text-slate-600">No work performed on ${todayDate}</span>
                            </label>

                            <!-- Work Entry Fields (hidden when no work checked) -->
                            <div id="work-fields-${contractor.id}" class="${activity.noWork ? 'hidden' : ''} space-y-3">
                                <!-- Existing entries -->
                                ${entriesHtml ? `<div class="space-y-2">${entriesHtml}</div>` : ''}
                                
                                <!-- Add new entry -->
                                <div class="flex items-start gap-2">
                                    <textarea
                                        id="work-input-${contractor.id}"
                                        class="flex-1 bg-white border-2 border-slate-300 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-${contractor.type === 'prime' ? 'safety-green' : 'dot-blue'} rounded auto-expand"
                                        rows="2"
                                        placeholder="Describe work performed..."
                                    ></textarea>
                                    <button onclick="addContractorWorkEntry('${contractor.id}')" 
                                            class="px-4 py-2 ${bgColor} hover:opacity-90 text-white font-bold rounded transition-colors">
                                        <i class="fas fa-plus"></i>
                                    </button>
                                </div>
                                <p class="text-xs text-slate-400"><i class="fas fa-microphone mr-1"></i>Tap keyboard mic to dictate</p>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

            // Initialize auto-expand for dynamically created textareas
            initAllAutoExpandTextareas();
            
            // v6.6: Initialize auto-save for contractor work entry textareas
            projectContractors.forEach(contractor => {
                initContractorWorkAutoSave(contractor.id);
            });
        }

        /**
         * Toggle contractor card expand/collapse
         */
        function toggleContractorCard(contractorId) {
            const content = document.getElementById(`contractor-content-${contractorId}`);
            const chevron = document.getElementById(`contractor-chevron-${contractorId}`);

            if (content.classList.contains('hidden')) {
                content.classList.remove('hidden');
                chevron.classList.add('rotate-180');
            } else {
                content.classList.add('hidden');
                chevron.classList.remove('rotate-180');
            }
        }

        /**
         * v6.6: Toggle "no work performed" for a contractor
         */
        function toggleNoWork(contractorId, isNoWork) {
            const activity = report.activities.find(a => a.contractorId === contractorId);
            if (!activity) return;

            activity.noWork = isNoWork;

            const workFields = document.getElementById(`work-fields-${contractorId}`);
            if (isNoWork) {
                workFields?.classList.add('hidden');
            } else {
                workFields?.classList.remove('hidden');
                // Focus the input field
                setTimeout(() => {
                    document.getElementById(`work-input-${contractorId}`)?.focus();
                }, 100);
            }

            saveReport();
            renderContractorWorkCards();
            updateAllPreviews();
        }

        function getWorkSummaryPreview() {
            if (!report || !report.activities || !projectContractors.length) {
                return 'Tap to add';
            }

            const withWork = report.activities.filter(a => !a.noWork || a.narrative);
            const noWork = report.activities.filter(a => a.noWork && !a.narrative);

            if (withWork.length === 0) {
                return noWork.length > 0 ? `${noWork.length} contractors - no work` : 'Tap to add';
            }

            return `${withWork.length} working, ${noWork.length} idle`;
        }

        // ============ PERSONNEL / OPERATIONS ============
        function getTradeAbbreviation(trades) {
            if (!trades) return '';
            // Common trade abbreviations
            const abbreviations = {
                'pile driving': 'PLE',
                'piling': 'PLE',
                'concrete': 'CONC',
                'concrete pvmt': 'CONC',
                'asphalt': 'ASP',
                'utilities': 'UTL',
                'earthwork': 'ERTHWRK',
                'grading': 'GRAD',
                'demolition': 'DEMO',
                'demo': 'DEMO',
                'electrical': 'ELEC',
                'plumbing': 'PLMB',
                'mechanical': 'MECH',
                'structural': 'STRUC',
                'steel': 'STL',
                'masonry': 'MASN',
                'roofing': 'ROOF',
                'painting': 'PAINT',
                'landscaping': 'LNDSCP',
                'survey': 'SURV',
                'surveying': 'SURV',
                'traffic': 'TRAF',
                'signage': 'SIGN',
                'drainage': 'DRAIN',
                'cm/pm': 'CM/PM',
                'general': 'GEN'
            };

            // Split by semicolon and abbreviate each trade
            return trades.split(';').map(trade => {
                const trimmed = trade.trim().toLowerCase();
                // Check if we have a known abbreviation
                for (const [key, abbr] of Object.entries(abbreviations)) {
                    if (trimmed.includes(key)) {
                        return abbr;
                    }
                }
                // If no match, use first 4 chars uppercase
                return trimmed.substring(0, 4).toUpperCase();
            }).join('; ');
        }

        function getContractorOperations(contractorId) {
            if (!report || !report.operations) return null;
            return report.operations.find(o => o.contractorId === contractorId);
        }

        function initializeOperations() {
            if (!report.operations) report.operations = [];

            // Ensure each contractor has an operations entry
            projectContractors.forEach(contractor => {
                const existing = report.operations.find(o => o.contractorId === contractor.id);
                if (!existing) {
                    report.operations.push({
                        contractorId: contractor.id,
                        superintendents: null,
                        foremen: null,
                        operators: null,
                        laborers: null,
                        surveyors: null,
                        others: null
                    });
                }
            });
        }

        function renderPersonnelCards() {
            const container = document.getElementById('personnel-list');
            const warningEl = document.getElementById('no-project-warning-ops');
            const totalsEl = document.getElementById('personnel-totals');

            if (!activeProject || projectContractors.length === 0) {
                warningEl.classList.remove('hidden');
                totalsEl.classList.add('hidden');
                container.innerHTML = '';
                return;
            }

            warningEl.classList.add('hidden');
            totalsEl.classList.remove('hidden');
            initializeOperations();

            container.innerHTML = projectContractors.map((contractor) => {
                const ops = getContractorOperations(contractor.id) || {
                    superintendents: null, foremen: null, operators: null,
                    laborers: null, surveyors: null, others: null
                };
                const typeLabel = contractor.type === 'prime' ? 'PRIME' : 'SUB';
                const borderColor = contractor.type === 'prime' ? 'border-l-safety-green' : 'border-l-dot-blue';
                const headerBg = contractor.type === 'prime' ? 'bg-safety-green/10' : 'bg-dot-blue/10';
                const titleColor = contractor.type === 'prime' ? 'text-safety-green' : 'text-dot-blue';

                // Check if contractor has any personnel data
                const hasData = (ops.superintendents > 0) || (ops.foremen > 0) || (ops.operators > 0) ||
                               (ops.laborers > 0) || (ops.surveyors > 0) || (ops.others > 0);
                const totalPersonnel = (ops.superintendents || 0) + (ops.foremen || 0) + (ops.operators || 0) +
                                      (ops.laborers || 0) + (ops.surveyors || 0) + (ops.others || 0);
                const summaryText = hasData ? `${totalPersonnel} personnel` : 'Tap to add';

                return `
                    <div class="personnel-card bg-white border-2 ${hasData ? borderColor.replace('border-l-', 'border-') : 'border-slate-200'} ${borderColor} border-l-4" data-ops-contractor-id="${contractor.id}">
                        <!-- Card Header - Tap to expand -->
                        <button onclick="togglePersonnelCard('${contractor.id}')" class="w-full p-3 flex items-center gap-3 text-left ${hasData ? headerBg : 'bg-slate-50'}">
                            <div class="flex-1 min-w-0">
                                <div class="flex items-center gap-2">
                                    <span class="text-lg font-bold ${hasData ? titleColor : 'text-slate-600'}">${escapeHtml(contractor.abbreviation)}</span>
                                    <span class="text-[10px] font-medium text-slate-400 uppercase">${typeLabel}</span>
                                </div>
                                <p class="text-xs text-slate-500 truncate">${escapeHtml(contractor.name)}${contractor.trades ? ' • ' + escapeHtml(contractor.trades) : ''}</p>
                                <p class="text-[10px] ${hasData ? titleColor : 'text-slate-400'} mt-1">${summaryText}</p>
                            </div>
                            <i id="personnel-chevron-${contractor.id}" class="fas fa-chevron-down personnel-card-chevron text-slate-400 text-xs"></i>
                        </button>

                        <!-- Expandable Content -->
                        <div class="personnel-card-content">
                            <div class="p-3 border-t border-slate-200 bg-slate-50/50">
                                <!-- 2-column, 3-row grid for role inputs -->
                                <div class="grid grid-cols-2 gap-3">
                                    <!-- Row 1: Superintendent, Foreman -->
                                    <div>
                                        <label class="text-xs font-bold text-slate-500 uppercase block mb-1">Superintendent</label>
                                        <input type="number" min="0" max="99"
                                            id="ops-supt-${contractor.id}"
                                            value="${ops.superintendents || ''}"
                                            onchange="updateOperations('${contractor.id}')"
                                            class="w-full h-10 text-center text-base font-medium border-2 border-slate-300 focus:border-dot-blue focus:outline-none bg-white"
                                            placeholder="0">
                                    </div>
                                    <div>
                                        <label class="text-xs font-bold text-slate-500 uppercase block mb-1">Foreman</label>
                                        <input type="number" min="0" max="99"
                                            id="ops-frmn-${contractor.id}"
                                            value="${ops.foremen || ''}"
                                            onchange="updateOperations('${contractor.id}')"
                                            class="w-full h-10 text-center text-base font-medium border-2 border-slate-300 focus:border-dot-blue focus:outline-none bg-white"
                                            placeholder="0">
                                    </div>
                                    <!-- Row 2: Operator, Laborer -->
                                    <div>
                                        <label class="text-xs font-bold text-slate-500 uppercase block mb-1">Operator</label>
                                        <input type="number" min="0" max="99"
                                            id="ops-oper-${contractor.id}"
                                            value="${ops.operators || ''}"
                                            onchange="updateOperations('${contractor.id}')"
                                            class="w-full h-10 text-center text-base font-medium border-2 border-slate-300 focus:border-dot-blue focus:outline-none bg-white"
                                            placeholder="0">
                                    </div>
                                    <div>
                                        <label class="text-xs font-bold text-slate-500 uppercase block mb-1">Laborer</label>
                                        <input type="number" min="0" max="99"
                                            id="ops-labr-${contractor.id}"
                                            value="${ops.laborers || ''}"
                                            onchange="updateOperations('${contractor.id}')"
                                            class="w-full h-10 text-center text-base font-medium border-2 border-slate-300 focus:border-dot-blue focus:outline-none bg-white"
                                            placeholder="0">
                                    </div>
                                    <!-- Row 3: Surveyor, Other -->
                                    <div>
                                        <label class="text-xs font-bold text-slate-500 uppercase block mb-1">Surveyor</label>
                                        <input type="number" min="0" max="99"
                                            id="ops-surv-${contractor.id}"
                                            value="${ops.surveyors || ''}"
                                            onchange="updateOperations('${contractor.id}')"
                                            class="w-full h-10 text-center text-base font-medium border-2 border-slate-300 focus:border-dot-blue focus:outline-none bg-white"
                                            placeholder="0">
                                    </div>
                                    <div>
                                        <label class="text-xs font-bold text-slate-500 uppercase block mb-1">Other</label>
                                        <input type="number" min="0" max="99"
                                            id="ops-othr-${contractor.id}"
                                            value="${ops.others || ''}"
                                            onchange="updateOperations('${contractor.id}')"
                                            class="w-full h-10 text-center text-base font-medium border-2 border-slate-300 focus:border-dot-blue focus:outline-none bg-white"
                                            placeholder="0">
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

            updatePersonnelTotals();
        }

        function togglePersonnelCard(contractorId) {
            const card = document.querySelector(`[data-ops-contractor-id="${contractorId}"]`);
            if (!card) return;

            card.classList.toggle('expanded');
        }

        function updateOperations(contractorId) {
            const ops = report.operations.find(o => o.contractorId === contractorId);
            if (!ops) return;

            const getValue = (id) => {
                const input = document.getElementById(id);
                if (!input) return null;
                const val = parseInt(input.value);
                return isNaN(val) ? null : val;
            };

            ops.superintendents = getValue(`ops-supt-${contractorId}`);
            ops.foremen = getValue(`ops-frmn-${contractorId}`);
            ops.operators = getValue(`ops-oper-${contractorId}`);
            ops.laborers = getValue(`ops-labr-${contractorId}`);
            ops.surveyors = getValue(`ops-surv-${contractorId}`);
            ops.others = getValue(`ops-othr-${contractorId}`);

            saveReport();
            updatePersonnelTotals();
            updatePersonnelCardStyle(contractorId);
            updateAllPreviews();
        }

        function updatePersonnelCardStyle(contractorId) {
            const ops = report.operations.find(o => o.contractorId === contractorId);
            const contractor = projectContractors.find(c => c.id === contractorId);
            if (!ops || !contractor) return;

            const card = document.querySelector(`[data-ops-contractor-id="${contractorId}"]`);
            if (!card) return;

            const hasData = (ops.superintendents > 0) || (ops.foremen > 0) || (ops.operators > 0) ||
                           (ops.laborers > 0) || (ops.surveyors > 0) || (ops.others > 0);
            const totalPersonnel = (ops.superintendents || 0) + (ops.foremen || 0) + (ops.operators || 0) +
                                  (ops.laborers || 0) + (ops.surveyors || 0) + (ops.others || 0);

            const borderColor = contractor.type === 'prime' ? 'border-safety-green' : 'border-dot-blue';
            const headerBg = contractor.type === 'prime' ? 'bg-safety-green/10' : 'bg-dot-blue/10';
            const titleColor = contractor.type === 'prime' ? 'text-safety-green' : 'text-dot-blue';

            // Update card border
            card.classList.remove('border-slate-200', 'border-safety-green', 'border-dot-blue');
            card.classList.add(hasData ? borderColor : 'border-slate-200');

            // Update header
            const header = card.querySelector('button');
            header.classList.remove('bg-slate-50', 'bg-safety-green/10', 'bg-dot-blue/10');
            header.classList.add(hasData ? headerBg : 'bg-slate-50');

            // Update abbreviation color
            const abbr = header.querySelector('span.text-lg');
            if (abbr) {
                abbr.classList.remove('text-slate-600', 'text-safety-green', 'text-dot-blue');
                abbr.classList.add(hasData ? titleColor : 'text-slate-600');
            }

            // Update summary text
            const summaryP = header.querySelector('p.text-\\[10px\\]');
            if (summaryP) {
                summaryP.textContent = hasData ? `${totalPersonnel} personnel` : 'Tap to add';
                summaryP.classList.remove('text-slate-400', 'text-safety-green', 'text-dot-blue');
                summaryP.classList.add(hasData ? titleColor : 'text-slate-400');
            }
        }

        function updatePersonnelTotals() {
            if (!report || !report.operations) return;

            let totals = {
                superintendents: 0,
                foremen: 0,
                operators: 0,
                laborers: 0,
                surveyors: 0,
                others: 0
            };

            report.operations.forEach(ops => {
                totals.superintendents += ops.superintendents || 0;
                totals.foremen += ops.foremen || 0;
                totals.operators += ops.operators || 0;
                totals.laborers += ops.laborers || 0;
                totals.surveyors += ops.surveyors || 0;
                totals.others += ops.others || 0;
            });

            const grandTotal = totals.superintendents + totals.foremen + totals.operators +
                              totals.laborers + totals.surveyors + totals.others;

            // Update the personnel total count element (v6 simplified UI)
            const grandTotalEl = document.getElementById('personnel-total-count');
            if (grandTotalEl) {
                grandTotalEl.textContent = grandTotal || '0';
            }
        }

        function getOperationsPreview() {
            if (!report || !report.operations || !projectContractors.length) {
                return 'Tap to add';
            }

            let totalPersonnel = 0;
            let contractorsWithPersonnel = 0;

            report.operations.forEach(ops => {
                const count = (ops.superintendents || 0) + (ops.foremen || 0) +
                              (ops.operators || 0) + (ops.laborers || 0) +
                              (ops.surveyors || 0) + (ops.others || 0);
                totalPersonnel += count;
                if (count > 0) contractorsWithPersonnel++;
            });

            if (totalPersonnel === 0) {
                return 'Tap to add';
            }

            return `${totalPersonnel} personnel from ${contractorsWithPersonnel} contractor${contractorsWithPersonnel !== 1 ? 's' : ''}`;
        }

        function hasOperationsData() {
            if (!report || !report.operations) return false;
            return report.operations.some(ops =>
                (ops.superintendents !== null && ops.superintendents > 0) ||
                (ops.foremen !== null && ops.foremen > 0) ||
                (ops.operators !== null && ops.operators > 0) ||
                (ops.laborers !== null && ops.laborers > 0) ||
                (ops.surveyors !== null && ops.surveyors > 0) ||
                (ops.others !== null && ops.others > 0)
            );
        }

        /**
         * Get total personnel count across all contractors
         * @returns {number} Total personnel count
         */
        function getTotalPersonnelCount() {
            if (!report || !report.operations) return 0;
            let total = 0;
            report.operations.forEach(ops => {
                total += (ops.superintendents || 0) + (ops.foremen || 0) +
                         (ops.operators || 0) + (ops.laborers || 0) +
                         (ops.surveyors || 0) + (ops.others || 0);
            });
            return total;
        }

        // ============ EQUIPMENT ============
        // v6: Equipment is now entered as text per-report, not loaded from project config
        // Old functions removed: getProjectEquipment, getEquipmentEntry, initializeEquipment,
        // updateEquipmentQuantity, updateEquipmentStatus, markAllEquipmentIdle, updateEquipmentTotals

        /**
         * v6: Render simple text-based equipment input
         * Equipment is entered fresh per-report instead of selecting from project config
         */
        /**
         * v6.6: Render structured equipment rows
         */
        function renderEquipmentSection() {
            const container = document.getElementById('equipment-rows-list');
            if (!container) return;

            const rows = report.equipmentRows || [];

            // Build contractor options HTML
            const contractorOptions = `
                <option value="">-- Select Contractor --</option>
                ${projectContractors.map(c => `
                    <option value="${c.id}">${escapeHtml(c.name)} (${c.type === 'prime' ? 'Prime' : 'Sub'})</option>
                `).join('')}
            `;

            if (rows.length === 0) {
                container.innerHTML = `
                    <p class="text-sm text-slate-400 text-center py-4">No equipment added yet. Click "+ Add Equipment" below.</p>
                `;
                return;
            }

            container.innerHTML = rows.map(row => {
                // Build contractor options with correct selection
                const contractorOptionsWithSelection = contractorOptions.replace(
                    `value="${row.contractorId}"`,
                    `value="${row.contractorId}" selected`
                );

                return `
                    <div class="equipment-row bg-orange-50 border border-orange-200 p-3 rounded" data-equipment-id="${row.id}">
                        <!-- Mobile: Stack vertically, Desktop: Grid -->
                        <div class="space-y-2 sm:space-y-0 sm:grid sm:grid-cols-12 sm:gap-2 sm:items-center">
                            <!-- Contractor Dropdown -->
                            <select class="w-full sm:col-span-3 text-xs border border-slate-300 rounded px-2 py-2 bg-white"
                                    onchange="updateEquipmentRow('${row.id}', 'contractorId', this.value)">
                                ${contractorOptionsWithSelection}
                            </select>
                            
                            <!-- Type/Model -->
                            <input type="text" 
                                   class="w-full sm:col-span-4 text-xs border border-slate-300 rounded px-2 py-2"
                                   placeholder="Equipment type/model"
                                   value="${escapeHtml(row.type || '')}"
                                   onchange="updateEquipmentRow('${row.id}', 'type', this.value)">
                            
                            <!-- Qty + Status + Delete row on mobile -->
                            <div class="flex gap-2 sm:contents">
                                <!-- Qty -->
                                <input type="number" 
                                       class="w-20 sm:w-full sm:col-span-2 text-xs border border-slate-300 rounded px-2 py-2 text-center"
                                       placeholder="Qty" min="1" value="${row.qty || 1}"
                                       onchange="updateEquipmentRow('${row.id}', 'qty', parseInt(this.value) || 1)">
                                
                                <!-- Status Dropdown -->
                                <select class="flex-1 sm:flex-none sm:col-span-2 text-xs border border-slate-300 rounded px-2 py-2 bg-white"
                                        onchange="updateEquipmentRow('${row.id}', 'status', this.value)">
                                    <option value="Idle" ${row.status === 'Idle' ? 'selected' : ''}>Idle</option>
                                    <option value="1hr" ${row.status === '1hr' ? 'selected' : ''}>1hr</option>
                                    <option value="2hr" ${row.status === '2hr' ? 'selected' : ''}>2hr</option>
                                    <option value="3hr" ${row.status === '3hr' ? 'selected' : ''}>3hr</option>
                                    <option value="4hr" ${row.status === '4hr' ? 'selected' : ''}>4hr</option>
                                    <option value="5hr" ${row.status === '5hr' ? 'selected' : ''}>5hr</option>
                                    <option value="6hr" ${row.status === '6hr' ? 'selected' : ''}>6hr</option>
                                    <option value="7hr" ${row.status === '7hr' ? 'selected' : ''}>7hr</option>
                                    <option value="8hr" ${row.status === '8hr' ? 'selected' : ''}>8hr</option>
                                    <option value="9hr" ${row.status === '9hr' ? 'selected' : ''}>9hr</option>
                                    <option value="10hr" ${row.status === '10hr' ? 'selected' : ''}>10hr</option>
                                </select>
                                
                                <!-- Delete -->
                                <button onclick="deleteEquipmentRow('${row.id}')" 
                                        class="px-3 py-2 sm:col-span-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors">
                                    <i class="fas fa-trash text-xs"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        /**
         * v6.6: Add a new equipment row
         */
        function addEquipmentRow() {
            const row = {
                id: `eq_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                contractorId: '',
                type: '',
                qty: 1,
                status: 'Idle',
                timestamp: new Date().toISOString()
            };
            if (!report.equipmentRows) report.equipmentRows = [];
            report.equipmentRows.push(row);
            saveReport();
            renderEquipmentSection();
            updateEquipmentPreview();
            updateProgress();
        }

        /**
         * v6.6: Update a field in an equipment row
         */
        function updateEquipmentRow(rowId, field, value) {
            const row = report.equipmentRows?.find(r => r.id === rowId);
            if (!row) return;
            row[field] = value;
            saveReport();
            updateEquipmentPreview();
        }

        /**
         * v6.6: Delete an equipment row
         */
        function deleteEquipmentRow(rowId) {
            if (!report.equipmentRows) return;
            report.equipmentRows = report.equipmentRows.filter(r => r.id !== rowId);
            saveReport();
            renderEquipmentSection();
            updateEquipmentPreview();
            updateProgress();
        }

        /**
         * @deprecated Use structured equipmentRows instead
         */
        function updateEquipmentNotes(value) {
            report.equipmentNotes = value;
            saveReport();
            updateEquipmentPreview();
        }

        /**
         * v6.6: Update equipment preview text based on row count
         */
        function updateEquipmentPreview() {
            const preview = document.getElementById('equipment-preview');
            if (!preview) return;
            const count = (report.equipmentRows || []).length;
            preview.textContent = count > 0 ? `${count} equipment logged` : 'Tap to add';
        }

        /**
         * v6.6: Get equipment preview text for section card
         */
        function getEquipmentPreview() {
            const count = (report.equipmentRows || []).length;
            return count > 0 ? `${count} equipment logged` : 'Tap to add';
        }

        /**
         * v6.6: Check if equipment data exists
         */
        function hasEquipmentData() {
            return (report.equipmentRows || []).length > 0;
        }

        // ============ STORAGE (SUPABASE) ============
        let saveReportTimeout = null;
        let isSaving = false;

        /**
         * Generate a report storage key (kept for legacy/reference)
         */
        function getReportKey(projectId, dateStr) {
            const date = dateStr || getTodayDateString();
            return projectId
                ? `fieldvoice_report_${projectId}_${date}`
                : `fieldvoice_report_${date}`;
        }

        function getTodayKey() {
            return getReportKey(activeProject?.id, null);
        }

        /**
         * Load report from Supabase
         */
        async function getReport() {
            // Clear any stale report ID before loading
            currentReportId = null;

            const todayStr = getTodayDateString();

            if (!activeProject) {
                return createFreshReport();
            }

            try {
                // Query for existing report for this project and date
                const { data: reportRow, error: reportError } = await supabaseClient
                    .from('reports')
                    .select('*')
                    .eq('project_id', activeProject.id)
                    .eq('report_date', todayStr)
                    .maybeSingle();

                if (reportError) {
                    console.error('Error fetching report:', reportError);
                    return createFreshReport();
                }

                if (!reportRow) {
                    return createFreshReport();
                }

                // If report was already submitted, create fresh
                if (reportRow.status === 'submitted') {
                    return createFreshReport();
                }

                // Store the report ID for updates
                currentReportId = reportRow.id;

                // Load raw capture data (includes contractor_work, personnel, equipment_usage in raw_data)
                const { data: rawCapture } = await supabaseClient
                    .from('report_raw_capture')
                    .select('*')
                    .eq('report_id', reportRow.id)
                    .maybeSingle();

                // contractor_work now stored in raw_data.contractor_work
                const contractorWork = rawCapture?.raw_data?.contractor_work || [];

                // personnel now stored in raw_data.personnel
                const personnel = rawCapture?.raw_data?.personnel || [];

                // equipment_usage now stored in raw_data.equipment_usage
                const equipmentUsage = rawCapture?.raw_data?.equipment_usage || [];

                // Load photos
                const { data: photos } = await supabaseClient
                    .from('photos')
                    .select('*')
                    .eq('report_id', reportRow.id)
                    .order('taken_at', { ascending: true });

                // Reconstruct the report object
                const reconstructedReport = reconstructReportFromSupabase(
                    reportRow, rawCapture, contractorWork, personnel, equipmentUsage, photos
                );

                return reconstructedReport;
            } catch (e) {
                console.error('Failed to load report from Supabase:', e);
                return createFreshReport();
            }
        }

        /**
         * Reconstruct report object from Supabase data
         */
        function reconstructReportFromSupabase(reportRow, rawCapture, contractorWork, personnel, equipmentUsage, photos) {
            const report = createFreshReport();

            // Set meta information
            report.meta.createdAt = reportRow.created_at;
            report.meta.status = reportRow.status;
            report.meta.interviewCompleted = reportRow.status === 'refined' || reportRow.status === 'submitted';

            // Restore toggle states from database
            if (reportRow.toggle_states && typeof reportRow.toggle_states === 'object') {
                report.toggleStates = reportRow.toggle_states;
            }
            
            // Restore safety_no_incidents flag
            if (reportRow.safety_no_incidents !== null && reportRow.safety_no_incidents !== undefined) {
                report.safety.noIncidents = reportRow.safety_no_incidents;
            }

            // Set raw capture data
            if (rawCapture) {
                report.meta.captureMode = rawCapture.capture_mode;
                report.fieldNotes.freeformNotes = rawCapture.freeform_notes || '';
                report.guidedNotes.workSummary = rawCapture.work_summary || '';
                report.generalIssues = rawCapture.issues_notes ? rawCapture.issues_notes.split('\n').filter(s => s.trim()) : [];
                if (rawCapture.safety_notes) {
                    report.safety.notes = rawCapture.safety_notes.split('\n').filter(s => s.trim());
                    report.safety.noIncidents = rawCapture.safety_notes.toLowerCase().includes('no incident');
                    report.safety.hasIncidents = !report.safety.noIncidents && report.safety.notes.length > 0;
                }
                if (rawCapture.weather_data) {
                    report.overview.weather = rawCapture.weather_data;
                }
            }

            // Set overview
            report.overview.date = new Date(reportRow.report_date).toLocaleDateString();
            report.overview.completedBy = reportRow.inspector_name || '';

            // Set contractor work/activities
            if (contractorWork && contractorWork.length > 0) {
                report.activities = contractorWork.map(cw => ({
                    contractorId: cw.contractor_id,
                    noWork: cw.no_work_performed,
                    narrative: cw.narrative || '',
                    equipmentUsed: cw.equipment_used || '',
                    crew: cw.crew || ''
                }));
            }

            // Set personnel/operations
            if (personnel && personnel.length > 0) {
                report.operations = personnel.map(p => ({
                    contractorId: p.contractor_id,
                    superintendents: p.superintendents || null,
                    foremen: p.foremen || null,
                    operators: p.operators || null,
                    laborers: p.laborers || null,
                    surveyors: p.surveyors || null,
                    others: p.others || null
                }));
            }

            // Set equipment usage
            if (equipmentUsage && equipmentUsage.length > 0) {
                report.equipment = equipmentUsage.map(eu => ({
                    equipmentId: eu.equipment_id,
                    hoursUtilized: eu.status === 'idle' ? null : (eu.hours_used || 0),
                    quantity: 1
                }));
            }

            // Set photos with public URLs
            if (photos && photos.length > 0) {
                report.photos = photos.map(p => {
                    // Use stored photo_url, or regenerate from storage_path as fallback
                    let url = p.photo_url || '';
                    if (!url && p.storage_path) {
                        const { data } = supabaseClient.storage
                            .from('report-photos')
                            .getPublicUrl(p.storage_path);
                        url = data?.publicUrl || '';
                    }
                    return {
                        id: p.id,
                        url: url,
                        storagePath: p.storage_path,
                        caption: p.caption || '',
                        timestamp: p.taken_at,
                        date: new Date(p.taken_at).toLocaleDateString(),
                        time: new Date(p.taken_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
                        gps: p.location_lat && p.location_lng ? { lat: p.location_lat, lng: p.location_lng } : null,
                        fileName: p.photo_type,
                        fileType: p.photo_type
                    };
                });
            }

            return report;
        }

        function createFreshReport() {
            return {
                meta: {
                    createdAt: new Date().toISOString(),
                    interviewCompleted: false,
                    version: 2,
                    naMarked: {},
                    captureMode: null,
                    status: 'draft'
                },
                reporter: {
                    name: userSettings?.full_name || ""
                },
                project: {
                    projectName: activeProject?.projectName || "",
                    dayNumber: null
                },
                overview: {
                    projectName: activeProject?.projectName || "",
                    date: new Date().toLocaleDateString(),
                    startTime: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
                    completedBy: userSettings?.full_name || "",
                    weather: { highTemp: "--", lowTemp: "--", precipitation: "0.00\"", generalCondition: "Syncing...", jobSiteCondition: "", adverseConditions: "N/A" }
                },
                contractors: [], activities: [], operations: [], equipment: [], generalIssues: [], qaqcNotes: [],
                safety: { hasIncidents: false, noIncidents: false, notes: [] },
                contractorCommunications: "",
                visitorsRemarks: "",
                photos: [],
                additionalNotes: "",
                fieldNotes: { freeformNotes: "" },
                guidedNotes: { workSummary: "" },
                entries: [],           // v6: entry-based notes
                toggleStates: {},      // v6: locked toggle states (section -> true/false/null)
                equipmentRows: []      // v6.6: structured equipment rows
            };
        }

        /**
         * Save report to localStorage (debounced to prevent excessive writes)
         * Data only goes to Supabase when FINISH is clicked
         * v6: Also queues entry backup via sync-manager.js
         */
        let localSaveTimeout = null;

        function saveReport() {
            // Update local UI immediately
            updateAllPreviews();
            updateProgress();

            // Debounce save to localStorage
            if (localSaveTimeout) {
                clearTimeout(localSaveTimeout);
            }
            localSaveTimeout = setTimeout(() => {
                saveToLocalStorage();
                // Entry backup handled by individual entry functions (createEntry, addFreeformEntry, saveFreeformEdit, etc.)
            }, 500); // 500ms debounce for localStorage
        }

        /**
         * Actually save report to Supabase
         */
        async function saveReportToSupabase() {
            if (isSaving || !activeProject) return;
            isSaving = true;

            try {
                const todayStr = getTodayDateString();

                // 1. Upsert the main report record
                let reportId = currentReportId;
                if (!reportId) {
                    // Check if a report already exists for this project+date before generating new ID
                    const { data: existingReport } = await supabaseClient
                        .from('reports')
                        .select('id')
                        .eq('project_id', activeProject.id)
                        .eq('report_date', todayStr)
                        .maybeSingle();

                    reportId = existingReport?.id || generateId();
                }

                const reportData = {
                    id: reportId,
                    project_id: activeProject.id,
                    report_date: todayStr,
                    inspector_name: report.overview?.completedBy || userSettings?.full_name || '',
                    status: report.meta?.status || 'draft',
                    updated_at: new Date().toISOString(),
                    toggle_states: report.toggleStates || {},
                    safety_no_incidents: report.safety?.noIncidents ?? null
                };

                const { error: reportError } = await supabaseClient
                    .from('reports')
                    .upsert(reportData, { onConflict: 'id' });

                if (reportError) {
                    console.error('Error saving report:', reportError);
                    showToast('Failed to save report', 'error');
                    isSaving = false;
                    return;
                }

                currentReportId = reportId;

                // 2. Upsert raw capture data
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
                        status: e.hoursUtilized === null ? 'idle' : 'active',
                        hours_used: e.hoursUtilized || 0,
                        notes: ''
                    }))
                    : [];

                const rawCaptureData = {
                    report_id: reportId,
                    capture_mode: report.meta?.captureMode || 'guided',
                    freeform_notes: report.fieldNotes?.freeformNotes || '',
                    work_summary: report.guidedNotes?.workSummary || '',
                    issues_notes: report.generalIssues?.join('\n') || '',
                    safety_notes: report.safety?.notes?.join('\n') || '',
                    weather_data: report.overview?.weather || {},
                    captured_at: new Date().toISOString(),
                    // Store contractor_work, personnel, and equipment_usage in raw_data JSONB
                    raw_data: {
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

                // Note: Photos are saved separately when uploaded via uploadPhotoToSupabase

                console.log('[SUPABASE] Report saved successfully');
            } catch (err) {
                console.error('[SUPABASE] Save failed:', err);
                showToast('Failed to save report', 'error');
            } finally {
                isSaving = false;
            }
        }

        /**
         * Upload photo to Supabase Storage
         */
        async function uploadPhotoToSupabase(file, photoId) {
            if (!currentReportId) {
                // Create report first if it doesn't exist
                await saveReportToSupabase();
            }

            const fileName = `${currentReportId}/${photoId}_${file.name}`;

            try {
                const { data, error } = await supabaseClient.storage
                    .from('report-photos')
                    .upload(fileName, file, {
                        cacheControl: '3600',
                        upsert: false
                    });

                if (error) {
                    console.error('Error uploading photo:', error);
                    throw error;
                }

                // Get public URL
                const { data: urlData } = supabaseClient.storage
                    .from('report-photos')
                    .getPublicUrl(fileName);

                return {
                    storagePath: fileName,
                    publicUrl: urlData?.publicUrl || ''
                };
            } catch (err) {
                console.error('Photo upload failed:', err);
                throw err;
            }
        }

        /**
         * Save photo to IndexedDB (local-first)
         * Photos are uploaded to Supabase only on explicit Submit
         */
        async function savePhotoToIndexedDB(photo) {
            try {
                const photoRecord = {
                    id: photo.id,
                    reportId: currentReportId || 'pending',
                    base64: photo.base64 || null, // For offline storage
                    url: photo.url || null,
                    storagePath: photo.storagePath || null,
                    caption: photo.caption || '',
                    gps: photo.gps || null,
                    timestamp: photo.timestamp || new Date().toISOString(),
                    fileName: photo.fileName || photo.id,
                    syncStatus: 'pending', // Always pending until metadata saved to photos table
                    createdAt: new Date().toISOString()
                };

                await window.idb.savePhoto(photoRecord);
                console.log('[PHOTO] Saved to IndexedDB:', photo.id);
            } catch (err) {
                console.error('[PHOTO] Failed to save to IndexedDB:', err);
            }
        }

        /**
         * Upload pending photos to Supabase (called on Submit)
         */
        async function uploadPendingPhotos() {
            if (!currentReportId) return;

            const pendingPhotos = await window.idb.getPhotosBySyncStatus('pending');
            const reportPhotos = pendingPhotos.filter(p => p.reportId === currentReportId || p.reportId === 'pending');

            for (const photo of reportPhotos) {
                try {
                    // If we have base64 but no storagePath, need to upload
                    if (photo.base64 && !photo.storagePath) {
                        showToast('Uploading photos...', 'info');
                        const blob = await dataURLtoBlob(photo.base64);
                        const { storagePath, publicUrl } = await uploadPhotoToSupabase(blob, photo.id);

                        photo.storagePath = storagePath;
                        photo.url = publicUrl;
                    }

                    // Save metadata to Supabase
                    if (photo.storagePath) {
                        const photoData = {
                            id: photo.id,
                            report_id: currentReportId,
                            storage_path: photo.storagePath,
                            photo_url: photo.url || null,
                            caption: photo.caption || '',
                            photo_type: photo.fileType || photo.fileName || null,
                            location_lat: photo.gps?.lat || null,
                            location_lng: photo.gps?.lng || null,
                            taken_at: photo.timestamp || new Date().toISOString(),
                            created_at: photo.createdAt || new Date().toISOString()
                        };

                        const { error } = await supabaseClient
                            .from('photos')
                            .upsert(photoData, { onConflict: 'id' });

                        if (error) {
                            console.error('[PHOTO] Supabase metadata error:', error);
                            continue;
                        }
                    }

                    // Update IndexedDB with synced status and reportId
                    photo.reportId = currentReportId;
                    photo.syncStatus = 'synced';
                    await window.idb.savePhoto(photo);
                    console.log('[PHOTO] Synced to Supabase:', photo.id);
                } catch (err) {
                    console.error('[PHOTO] Failed to sync photo:', photo.id, err);
                }
            }
        }

        /**
         * Save photo metadata to Supabase (DEPRECATED - use savePhotoToIndexedDB)
         * Kept for backwards compatibility but now just saves to IndexedDB
         */
        async function savePhotoMetadata(photo) {
            // Redirect to IndexedDB save instead of immediate Supabase
            await savePhotoToIndexedDB(photo);
        }

        /**
         * Delete photo from Supabase
         */
        async function deletePhotoFromSupabase(photoId, storagePath) {
            try {
                // Delete from storage
                if (storagePath) {
                    await supabaseClient.storage
                        .from('report-photos')
                        .remove([storagePath]);
                }

                // Delete metadata
                await supabaseClient
                    .from('photos')
                    .delete()
                    .eq('id', photoId);
            } catch (err) {
                console.error('Failed to delete photo:', err);
            }
        }

        // compressImage() moved to /js/media-utils.js

        function getStorageUsage() {
            let total = 0;
            for (let key in localStorage) {
                if (localStorage.hasOwnProperty(key)) {
                    total += localStorage[key].length * 2; // UTF-16 = 2 bytes per char
                }
            }
            return total;
        }

        // ============ WEATHER ============
        async function fetchWeather() {
            try {
                const position = await new Promise((resolve, reject) => {
                    navigator.geolocation.getCurrentPosition(resolve, reject, {
                        enableHighAccuracy: true,
                        timeout: 15000,
                        maximumAge: 0
                    });
                });
                const { latitude, longitude } = position.coords;
                localStorage.setItem(STORAGE_KEYS.LOC_GRANTED, 'true');
                const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto&temperature_unit=fahrenheit&precipitation_unit=inch`);
                const data = await response.json();
                const weatherCodes = { 0: 'Clear', 1: 'Mostly Clear', 2: 'Partly Cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Fog', 51: 'Light Drizzle', 53: 'Drizzle', 55: 'Heavy Drizzle', 61: 'Light Rain', 63: 'Rain', 65: 'Heavy Rain', 80: 'Showers', 95: 'Thunderstorm' };
                const precip = data.daily.precipitation_sum[0];
                report.overview.weather = {
                    highTemp: `${Math.round(data.daily.temperature_2m_max[0])}°F`,
                    lowTemp: `${Math.round(data.daily.temperature_2m_min[0])}°F`,
                    precipitation: `${precip.toFixed(2)}"`,
                    generalCondition: weatherCodes[data.current_weather.weathercode] || 'Cloudy',
                    jobSiteCondition: report.overview.weather.jobSiteCondition || (precip > 0.1 ? 'Wet' : 'Dry'),
                    adverseConditions: precip > 0.25 ? 'Rain impact possible' : 'N/A'
                };
                saveReport();
                updateWeatherDisplay();
                updateMinimalWeatherDisplay(); // Also update minimal mode weather
            } catch (error) {
                console.error('Weather fetch failed:', error);
            }
        }

        function updateWeatherDisplay() {
            const w = report.overview.weather;
            const conditionEl = document.getElementById('weather-condition');
            const tempEl = document.getElementById('weather-temp');
            const precipEl = document.getElementById('weather-precip');
            const siteCondEl = document.getElementById('site-conditions-input');

            if (conditionEl) conditionEl.textContent = w.generalCondition;
            if (tempEl) tempEl.textContent = `${w.highTemp} / ${w.lowTemp}`;
            if (precipEl) precipEl.textContent = w.precipitation;
            if (siteCondEl) siteCondEl.value = w.jobSiteCondition || '';
        }

        // ============ SECTION TOGGLE ============
        function toggleSection(sectionId) {
            const cards = document.querySelectorAll('.section-card');
            cards.forEach(card => {
                if (card.dataset.section === sectionId) {
                    card.classList.toggle('expanded');
                    const icon = card.querySelector('[id$="-status"] i');
                    if (card.classList.contains('expanded')) {
                        icon.className = 'fas fa-chevron-up text-dot-blue text-xs';
                    } else {
                        icon.className = 'fas fa-chevron-down text-slate-400 text-xs';
                    }
                } else {
                    card.classList.remove('expanded');
                    const icon = card.querySelector('[id$="-status"] i');
                    if (icon) icon.className = 'fas fa-chevron-down text-slate-400 text-xs';
                }
            });
        }

        // ============ DICTATION HINT BANNER ============
        function dismissDictationHint() {
            localStorage.setItem(STORAGE_KEYS.DICTATION_HINT_DISMISSED, 'true');
            const banner = document.getElementById('dictationHintBanner');
            if (banner) banner.classList.add('hidden');
        }

        function checkDictationHintBanner() {
            const dismissed = localStorage.getItem(STORAGE_KEYS.DICTATION_HINT_DISMISSED) === 'true';
            const banner = document.getElementById('dictationHintBanner');
            if (banner && dismissed) {
                banner.classList.add('hidden');
            }
        }

        // ============ MANUAL ADD FUNCTIONS ============
        // Note: addActivity() is replaced by contractor-based work entry system
        // Legacy activities are migrated in initializeContractorActivities()

        function addIssue() {
            const input = document.getElementById('issue-input');
            const text = input.value.trim();
            if (!text) return;
            
            // If auto-save already created an entry for this content, just clear and render
            if (autoSaveState['issues']?.saved) {
                input.value = '';
                delete autoSaveState['issues'];  // Clear state for next entry
                renderSection('issues');
                updateAllPreviews();
                updateProgress();
                return;
            }
            
            // Otherwise create new entry (user clicked "+" before auto-save triggered)
            createEntry('issues', text);
            renderSection('issues');
            input.value = '';
            updateAllPreviews();
            updateProgress();
        }

        function removeIssue(index) {
            // Legacy function for backward compatibility with old array-based issues
            if (report.generalIssues && report.generalIssues[index] !== undefined) {
                report.generalIssues.splice(index, 1);
                saveReport();
                renderSection('issues');
                updateAllPreviews();
                updateProgress();
            }
        }

        function addInspection() {
            const input = document.getElementById('inspection-input');
            const text = input.value.trim();
            if (text) { report.qaqcNotes.push(text); saveReport(); renderSection('inspections'); input.value = ''; }
        }

        function removeInspection(index) { report.qaqcNotes.splice(index, 1); saveReport(); renderSection('inspections'); }

        function addSafetyNote() {
            const input = document.getElementById('safety-input');
            const text = input.value.trim();
            if (!text) return;
            
            // If auto-save already created an entry for this content, just clear and render
            if (autoSaveState['safety']?.saved) {
                input.value = '';
                delete autoSaveState['safety'];  // Clear state for next entry
                renderSection('safety');
                updateAllPreviews();
                updateProgress();
                return;
            }
            
            // Otherwise create new entry (user clicked "+" before auto-save triggered)
            createEntry('safety', text);
            renderSection('safety');
            input.value = '';
            updateAllPreviews();
            updateProgress();
        }

        function removeSafetyNote(index) {
            // Legacy function for backward compatibility with old array-based notes
            if (report.safety?.notes && report.safety.notes[index] !== undefined) {
                report.safety.notes.splice(index, 1);
                saveReport();
                renderSection('safety');
                updateAllPreviews();
                updateProgress();
            }
        }

        // v6: Entry-based add functions for new sections
        function addCommunication() {
            const input = document.getElementById('communications-input');
            const text = input.value.trim();
            if (!text) return;
            
            // If auto-save already created an entry for this content, just clear and render
            if (autoSaveState['communications']?.saved) {
                input.value = '';
                delete autoSaveState['communications'];  // Clear state for next entry
                renderSection('communications');
                updateAllPreviews();
                updateProgress();
                return;
            }
            
            // Otherwise create new entry (user clicked "+" before auto-save triggered)
            createEntry('communications', text);
            renderSection('communications');
            input.value = '';
            updateAllPreviews();
            updateProgress();
        }

        function addQAQC() {
            const input = document.getElementById('qaqc-input');
            const text = input.value.trim();
            if (!text) return;
            
            // If auto-save already created an entry for this content, just clear and render
            if (autoSaveState['qaqc']?.saved) {
                input.value = '';
                delete autoSaveState['qaqc'];  // Clear state for next entry
                renderSection('qaqc');
                updateAllPreviews();
                updateProgress();
                return;
            }
            
            // Otherwise create new entry (user clicked "+" before auto-save triggered)
            createEntry('qaqc', text);
            renderSection('qaqc');
            input.value = '';
            updateAllPreviews();
            updateProgress();
        }

        function addVisitor() {
            const input = document.getElementById('visitors-input');
            const text = input.value.trim();
            if (!text) return;
            
            // If auto-save already created an entry for this content, just clear and render
            if (autoSaveState['visitors']?.saved) {
                input.value = '';
                delete autoSaveState['visitors'];  // Clear state for next entry
                renderSection('visitors');
                updateAllPreviews();
                updateProgress();
                return;
            }
            
            // Otherwise create new entry (user clicked "+" before auto-save triggered)
            createEntry('visitors', text);
            renderSection('visitors');
            input.value = '';
            updateAllPreviews();
            updateProgress();
        }

        // ============ PHOTOS ============
        /**
         * Handle photo input (full mode)
         * Saves to IndexedDB locally, uploads to Supabase on Submit
         */
        async function handlePhotoInput(e) {
            console.log('[PHOTO] handlePhotoInput triggered');

            const files = e.target.files;
            if (!files || files.length === 0) {
                console.warn('[PHOTO] No files selected');
                showToast('No photo selected', 'warning');
                return;
            }

            console.log(`[PHOTO] Processing ${files.length} file(s)`);

            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                console.log(`[PHOTO] File ${i + 1}: ${file.name}, type: ${file.type}, size: ${file.size} bytes`);

                // Validate file type
                if (!file.type.startsWith('image/')) {
                    console.error(`[PHOTO] Invalid file type: ${file.type}`);
                    showToast(`Invalid file type: ${file.type}`, 'error');
                    continue;
                }

                // Validate file size (max 20MB)
                if (file.size > 20 * 1024 * 1024) {
                    console.error(`[PHOTO] File too large: ${file.size} bytes`);
                    showToast('Photo too large (max 20MB)', 'error');
                    continue;
                }

                // Show processing indicator
                showToast('Processing photo...', 'info');

                // Get GPS coordinates (using multi-reading high accuracy)
                let gps = null;
                try {
                    console.log('[PHOTO] Requesting GPS coordinates (multi-reading)...');
                    gps = await getHighAccuracyGPS(true);
                    if (gps) {
                        console.log(`[PHOTO] GPS acquired: ${gps.lat.toFixed(6)}, ${gps.lng.toFixed(6)} (±${gps.accuracy}m)`);
                    }
                } catch (err) {
                    console.warn('[PHOTO] GPS failed:', err);
                    // Continue without GPS - don't block the photo
                }

                try {
                    // Create timestamp
                    const now = new Date();
                    const timestamp = now.toISOString();
                    const date = now.toLocaleDateString();
                    const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });

                    const photoId = crypto.randomUUID();

                    // Compress image
                    showToast('Compressing photo...', 'info');
                    console.log('[PHOTO] Reading file for compression...');
                    const rawDataUrl = await readFileAsDataURL(file);
                    const compressedDataUrl = await compressImage(rawDataUrl, 1200, 0.7);

                    // Try to upload to Supabase if online, otherwise store base64 for later
                    let storagePath = null;
                    let publicUrl = compressedDataUrl; // Use base64 as fallback URL for display

                    if (navigator.onLine) {
                        try {
                            const compressedBlob = await dataURLtoBlob(compressedDataUrl);
                            console.log(`[PHOTO] Compressed: ${Math.round(file.size/1024)}KB -> ${Math.round(compressedBlob.size/1024)}KB`);

                            showToast('Uploading photo...', 'info');
                            console.log('[PHOTO] Uploading to Supabase Storage...');
                            const result = await uploadPhotoToSupabase(compressedBlob, photoId);
                            storagePath = result.storagePath;
                            publicUrl = result.publicUrl;
                        } catch (uploadErr) {
                            console.warn('[PHOTO] Upload failed, saving locally:', uploadErr);
                            // Keep base64 for later upload
                        }
                    } else {
                        console.log('[PHOTO] Offline - saving locally for later upload');
                    }

                    // Create photo object
                    const photoObj = {
                        id: photoId,
                        url: publicUrl,
                        base64: storagePath ? null : compressedDataUrl, // Only store base64 if not uploaded
                        storagePath: storagePath,
                        caption: '',
                        timestamp: timestamp,
                        date: date,
                        time: time,
                        gps: gps,
                        fileName: file.name,
                        fileSize: file.size,
                        fileType: file.type
                    };

                    console.log('[PHOTO] Adding photo to report:', {
                        id: photoObj.id,
                        timestamp: photoObj.timestamp,
                        gps: photoObj.gps,
                        storagePath: storagePath,
                        hasBase64: !!photoObj.base64
                    });

                    // Add to local report
                    report.photos.push(photoObj);

                    // Save photo to IndexedDB (local-first)
                    await savePhotoToIndexedDB(photoObj);

                    // Update UI
                    renderSection('photos');
                    saveReport();
                    showToast(storagePath ? 'Photo saved' : 'Photo saved locally', 'success');

                    console.log(`[PHOTO] Success! Total photos: ${report.photos.length}`);

                } catch (err) {
                    console.error('[PHOTO] Failed to process photo:', err);
                    showToast(`Photo error: ${err.message}`, 'error');
                }
            }

            // Reset the input so the same file can be selected again
            e.target.value = '';
        }

        async function removePhoto(index) {
            console.log(`[PHOTO] Removing photo at index ${index}`);
            const photo = report.photos[index];

            if (photo) {
                // Delete from IndexedDB first
                try {
                    await window.idb.deletePhoto(photo.id);
                    console.log('[PHOTO] Deleted from IndexedDB:', photo.id);
                } catch (err) {
                    console.warn('[PHOTO] Failed to delete from IndexedDB:', err);
                }

                // Delete from Supabase if it was uploaded
                if (photo.storagePath) {
                    await deletePhotoFromSupabase(photo.id, photo.storagePath);
                }
            }

            report.photos.splice(index, 1);
            saveReport();
            renderSection('photos');
            showToast('Photo removed', 'info');
        }

        // Update photo caption - save to localStorage and IndexedDB (Supabase on Submit)
        async function updatePhotoCaption(index, value) {
            const maxLength = 500;
            const caption = value.slice(0, maxLength);
            if (report.photos[index]) {
                report.photos[index].caption = caption;
                saveReport();

                // Also update in IndexedDB
                const photo = report.photos[index];
                if (photo.id) {
                    try {
                        const idbPhoto = await window.idb.getPhoto(photo.id);
                        if (idbPhoto) {
                            idbPhoto.caption = caption;
                            await window.idb.savePhoto(idbPhoto);
                        }
                    } catch (err) {
                        console.warn('[PHOTO] Failed to update caption in IndexedDB:', err);
                    }
                }

                // Update character counter
                const counter = document.getElementById(`caption-counter-${index}`);
                if (counter) {
                    const len = caption.length;
                    if (len > 400) {
                        counter.textContent = `${len}/${maxLength}`;
                        counter.classList.remove('hidden');
                        counter.classList.toggle('warning', len <= 480);
                        counter.classList.toggle('limit', len > 480);
                    } else {
                        counter.classList.add('hidden');
                    }
                }
            }
        }

        // Auto-expand caption textarea
        // Auto-expand caption uses shared autoExpand with smaller max height
        function autoExpandCaption(textarea) {
            autoExpand(textarea, 40, 128);
        }

        // ============ RENDER SECTIONS ============
        function renderSection(section) {
            switch (section) {
                case 'activities':
                    // v6.6: Contractor work cards with timestamped entries
                    renderContractorWorkCards();
                    break;
                case 'operations':
                    // Personnel cards are rendered by renderPersonnelCards()
                    renderPersonnelCards();
                    break;
                case 'issues':
                    // v6: Use entry-based notes
                    const issueEntries = getEntriesForSection('issues');
                    // Also check legacy generalIssues array for backward compatibility
                    const legacyIssues = report.generalIssues || [];

                    let issuesHtml = '';

                    // Render entry-based issues first
                    if (issueEntries.length > 0) {
                        issuesHtml += issueEntries.map(entry => `
                            <div class="bg-red-50 border border-red-200 p-3 flex items-start gap-3 group" data-entry-id="${entry.id}">
                                <i class="fas fa-exclamation-circle text-red-500 mt-0.5"></i>
                                <div class="flex-1">
                                    <p class="entry-content text-sm text-slate-700">${escapeHtml(entry.content)}</p>
                                    <p class="text-[10px] text-slate-400 mt-1">${new Date(entry.timestamp).toLocaleTimeString()}</p>
                                </div>
                                <div class="flex items-center gap-1 opacity-50 group-hover:opacity-100 transition-opacity">
                                    <button onclick="startEditEntry('${entry.id}', 'issues')" class="edit-btn text-slate-400 hover:text-dot-blue p-1">
                                        <i class="fas fa-pencil-alt text-xs"></i>
                                    </button>
                                    <button onclick="deleteEntryById('${entry.id}'); renderSection('issues'); updateAllPreviews(); updateProgress();" class="text-red-400 hover:text-red-600 p-1">
                                        <i class="fas fa-trash text-xs"></i>
                                    </button>
                                </div>
                            </div>
                        `).join('');
                    }

                    // Also render legacy issues (for backward compatibility)
                    if (legacyIssues.length > 0) {
                        issuesHtml += legacyIssues.map((issue, i) => `
                            <div class="bg-red-50 border border-red-200 p-3 flex items-start gap-3">
                                <i class="fas fa-exclamation-circle text-red-500 mt-0.5"></i>
                                <p class="flex-1 text-sm text-slate-700">${escapeHtml(issue)}</p>
                                <button onclick="removeIssue(${i})" class="text-red-400 hover:text-red-600"><i class="fas fa-trash text-xs"></i></button>
                            </div>
                        `).join('');
                    }

                    document.getElementById('issues-list').innerHTML = issuesHtml;
                    break;
                case 'inspections':
                    document.getElementById('inspections-list').innerHTML = report.qaqcNotes.map((note, i) => `
                        <div class="bg-violet-50 border border-violet-200 p-3 flex items-start gap-3">
                            <i class="fas fa-check-circle text-violet-500 mt-0.5"></i>
                            <p class="flex-1 text-sm text-slate-700">${note}</p>
                            <button onclick="removeInspection(${i})" class="text-red-400 hover:text-red-600"><i class="fas fa-trash text-xs"></i></button>
                        </div>
                    `).join('') || '';
                    break;
                case 'safety':
                    // v6: Use entry-based notes
                    const safetyEntries = getEntriesForSection('safety');
                    // Also check legacy safety.notes array for backward compatibility
                    const legacySafetyNotes = report.safety?.notes || [];

                    let safetyEntriesHtml = '';

                    // Render entry-based safety notes
                    if (safetyEntries.length > 0) {
                        safetyEntriesHtml += safetyEntries.map(entry => `
                            <div class="bg-green-50 border border-green-200 p-3 flex items-start gap-3 group" data-entry-id="${entry.id}">
                                <i class="fas fa-shield-alt text-safety-green mt-0.5"></i>
                                <div class="flex-1">
                                    <p class="entry-content text-sm text-slate-700">${escapeHtml(entry.content)}</p>
                                    <p class="text-[10px] text-slate-400 mt-1">${new Date(entry.timestamp).toLocaleTimeString()}</p>
                                </div>
                                <div class="flex items-center gap-1 opacity-50 group-hover:opacity-100 transition-opacity">
                                    <button onclick="startEditEntry('${entry.id}', 'safety')" class="edit-btn text-slate-400 hover:text-dot-blue p-1">
                                        <i class="fas fa-pencil-alt text-xs"></i>
                                    </button>
                                    <button onclick="deleteEntryById('${entry.id}'); renderSection('safety'); updateAllPreviews(); updateProgress();" class="text-red-400 hover:text-red-600 p-1">
                                        <i class="fas fa-trash text-xs"></i>
                                    </button>
                                </div>
                            </div>
                        `).join('');
                    }

                    // Also render legacy safety notes (for backward compatibility)
                    if (legacySafetyNotes.length > 0) {
                        safetyEntriesHtml += legacySafetyNotes.map((note, i) => `
                            <div class="bg-green-50 border border-green-200 p-3 flex items-start gap-3">
                                <i class="fas fa-shield-alt text-safety-green mt-0.5"></i>
                                <p class="flex-1 text-sm text-slate-700">${escapeHtml(note)}</p>
                                <button onclick="removeSafetyNote(${i})" class="text-red-400 hover:text-red-600"><i class="fas fa-trash text-xs"></i></button>
                            </div>
                        `).join('');
                    }

                    document.getElementById('safety-list').innerHTML = safetyEntriesHtml;

                    // Sync checkboxes with report state
                    document.getElementById('has-incidents').checked = report.safety.hasIncidents;
                    document.getElementById('no-incidents').checked = report.safety.noIncidents;
                    break;
                case 'personnel':
                    // Render toggle for contractors on site
                    const personnelToggle = renderToggleButtons('personnel_onsite', 'Any contractors on site today?');
                    const toggleContainer = document.getElementById('personnel-toggle-container');
                    if (toggleContainer) {
                        toggleContainer.innerHTML = personnelToggle;
                    }

                    // Show/hide personnel cards based on toggle state
                    const personnelToggleState = getToggleState('personnel_onsite');
                    if (personnelToggleState === true) {
                        renderPersonnelCards();
                    } else if (personnelToggleState === false) {
                        document.getElementById('personnel-list').innerHTML = `
                            <div class="bg-slate-100 border border-slate-200 p-3 text-center text-sm text-slate-500">
                                <i class="fas fa-ban mr-2"></i>Marked as N/A - No contractors on site
                            </div>
                        `;
                        document.getElementById('no-project-warning-ops').classList.add('hidden');
                        document.getElementById('personnel-totals').classList.add('hidden');
                    } else {
                        // Toggle not set - show cards for input
                        renderPersonnelCards();
                    }
                    break;
                case 'equipment':
                    renderEquipmentSection();
                    break;
                case 'communications':
                    // Render toggle
                    const commsToggle = renderToggleButtons('communications_made', 'Any communications with contractor today?');
                    const commsToggleContainer = document.getElementById('communications-toggle-container');
                    if (commsToggleContainer) {
                        commsToggleContainer.innerHTML = commsToggle;
                    }

                    // v6.6 iOS Safari fix: textarea always in DOM, toggle controls visibility
                    const commsToggleState = getToggleState('communications_made');
                    const commsNaMessage = document.getElementById('communications-na-message');
                    const commsInputArea = document.getElementById('communications-input-area');
                    const commsList = document.getElementById('communications-list');

                    // Always render existing entries
                    const commsEntries = getEntriesForSection('communications');
                    if (commsList) {
                        commsList.innerHTML = commsEntries.map(entry => `
                            <div class="bg-violet-50 border border-violet-200 p-3 flex items-start gap-3 group" data-entry-id="${entry.id}">
                                <i class="fas fa-comment text-violet-500 mt-0.5"></i>
                                <div class="flex-1">
                                    <p class="entry-content text-sm text-slate-700">${escapeHtml(entry.content)}</p>
                                    <p class="text-[10px] text-slate-400 mt-1">${new Date(entry.timestamp).toLocaleTimeString()}</p>
                                </div>
                                <div class="flex items-center gap-1 opacity-50 group-hover:opacity-100 transition-opacity">
                                    <button onclick="startEditEntry('${entry.id}', 'communications')" class="edit-btn text-slate-400 hover:text-dot-blue p-1">
                                        <i class="fas fa-pencil-alt text-xs"></i>
                                    </button>
                                    <button onclick="deleteEntryById('${entry.id}'); renderSection('communications'); updateAllPreviews(); updateProgress();" class="text-red-400 hover:text-red-600 p-1">
                                        <i class="fas fa-trash text-xs"></i>
                                    </button>
                                </div>
                            </div>
                        `).join('');
                    }

                    // Toggle controls N/A message and input area visibility
                    if (commsToggleState === false) {
                        // N/A selected - show message, hide input
                        if (commsNaMessage) commsNaMessage.classList.remove('hidden');
                        if (commsInputArea) commsInputArea.classList.add('hidden');
                    } else {
                        // Yes selected or not yet answered - hide message, show input
                        if (commsNaMessage) commsNaMessage.classList.add('hidden');
                        if (commsInputArea) commsInputArea.classList.remove('hidden');
                    }
                    break;
                case 'qaqc':
                    // Render toggle
                    const qaqcToggle = renderToggleButtons('qaqc_performed', 'Any QA/QC testing or inspections today?');
                    const qaqcToggleContainer = document.getElementById('qaqc-toggle-container');
                    if (qaqcToggleContainer) {
                        qaqcToggleContainer.innerHTML = qaqcToggle;
                    }

                    // v6.6 iOS Safari fix: textarea always in DOM, toggle controls visibility
                    const qaqcToggleState = getToggleState('qaqc_performed');
                    const qaqcNaMessage = document.getElementById('qaqc-na-message');
                    const qaqcInputArea = document.getElementById('qaqc-input-area');
                    const qaqcList = document.getElementById('qaqc-list');

                    // Always render existing entries
                    const qaqcEntries = getEntriesForSection('qaqc');
                    if (qaqcList) {
                        qaqcList.innerHTML = qaqcEntries.map(entry => `
                            <div class="bg-indigo-50 border border-indigo-200 p-3 flex items-start gap-3 group" data-entry-id="${entry.id}">
                                <i class="fas fa-clipboard-check text-indigo-500 mt-0.5"></i>
                                <div class="flex-1">
                                    <p class="entry-content text-sm text-slate-700">${escapeHtml(entry.content)}</p>
                                    <p class="text-[10px] text-slate-400 mt-1">${new Date(entry.timestamp).toLocaleTimeString()}</p>
                                </div>
                                <div class="flex items-center gap-1 opacity-50 group-hover:opacity-100 transition-opacity">
                                    <button onclick="startEditEntry('${entry.id}', 'qaqc')" class="edit-btn text-slate-400 hover:text-dot-blue p-1">
                                        <i class="fas fa-pencil-alt text-xs"></i>
                                    </button>
                                    <button onclick="deleteEntryById('${entry.id}'); renderSection('qaqc'); updateAllPreviews(); updateProgress();" class="text-red-400 hover:text-red-600 p-1">
                                        <i class="fas fa-trash text-xs"></i>
                                    </button>
                                </div>
                            </div>
                        `).join('');
                    }

                    // Toggle controls N/A message and input area visibility
                    if (qaqcToggleState === false) {
                        // N/A selected - show message, hide input
                        if (qaqcNaMessage) qaqcNaMessage.classList.remove('hidden');
                        if (qaqcInputArea) qaqcInputArea.classList.add('hidden');
                    } else {
                        // Yes selected or not yet answered - hide message, show input
                        if (qaqcNaMessage) qaqcNaMessage.classList.add('hidden');
                        if (qaqcInputArea) qaqcInputArea.classList.remove('hidden');
                    }
                    break;
                case 'visitors':
                    // Render toggle
                    const visitorsToggle = renderToggleButtons('visitors_present', 'Any visitors, deliveries, or other activity today?');
                    const visitorsToggleContainer = document.getElementById('visitors-toggle-container');
                    if (visitorsToggleContainer) {
                        visitorsToggleContainer.innerHTML = visitorsToggle;
                    }

                    // v6.6 iOS Safari fix: textarea always in DOM, toggle controls visibility
                    const visitorsToggleState = getToggleState('visitors_present');
                    const visitorsNaMessage = document.getElementById('visitors-na-message');
                    const visitorsInputArea = document.getElementById('visitors-input-area');
                    const visitorsList = document.getElementById('visitors-list');

                    // Always render existing entries
                    const visitorsEntries = getEntriesForSection('visitors');
                    if (visitorsList) {
                        visitorsList.innerHTML = visitorsEntries.map(entry => `
                            <div class="bg-teal-50 border border-teal-200 p-3 flex items-start gap-3 group" data-entry-id="${entry.id}">
                                <i class="fas fa-truck-loading text-teal-500 mt-0.5"></i>
                                <div class="flex-1">
                                    <p class="entry-content text-sm text-slate-700">${escapeHtml(entry.content)}</p>
                                    <p class="text-[10px] text-slate-400 mt-1">${new Date(entry.timestamp).toLocaleTimeString()}</p>
                                </div>
                                <div class="flex items-center gap-1 opacity-50 group-hover:opacity-100 transition-opacity">
                                    <button onclick="startEditEntry('${entry.id}', 'visitors')" class="edit-btn text-slate-400 hover:text-dot-blue p-1">
                                        <i class="fas fa-pencil-alt text-xs"></i>
                                    </button>
                                    <button onclick="deleteEntryById('${entry.id}'); renderSection('visitors'); updateAllPreviews(); updateProgress();" class="text-red-400 hover:text-red-600 p-1">
                                        <i class="fas fa-trash text-xs"></i>
                                    </button>
                                </div>
                            </div>
                        `).join('');
                    }

                    // Toggle controls N/A message and input area visibility
                    if (visitorsToggleState === false) {
                        // N/A selected - show message, hide input
                        if (visitorsNaMessage) visitorsNaMessage.classList.remove('hidden');
                        if (visitorsInputArea) visitorsInputArea.classList.add('hidden');
                    } else {
                        // Yes selected or not yet answered - hide message, show input
                        if (visitorsNaMessage) visitorsNaMessage.classList.add('hidden');
                        if (visitorsInputArea) visitorsInputArea.classList.remove('hidden');
                    }
                    break;
                case 'photos':
                    document.getElementById('photos-grid').innerHTML = report.photos.map((p, i) => `
                        <div class="border-2 border-slate-300 overflow-hidden bg-slate-100">
                            <div class="relative">
                                <img src="${p.url}" class="w-full aspect-square object-cover" onerror="this.onerror=null; this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%23cbd5e1%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2250%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%2364748b%22 font-size=%2212%22>Error</text></svg>';">
                                <button onclick="removePhoto(${i})" class="absolute top-2 right-2 w-7 h-7 bg-red-600 text-white text-xs flex items-center justify-center shadow-lg"><i class="fas fa-times"></i></button>
                                <div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-2 pt-6">
                                    <div class="flex items-center gap-1 text-white/90 mb-1">
                                        <i class="fas fa-clock text-[8px]"></i>
                                        <p class="text-[10px] font-medium">${p.date} ${p.time}</p>
                                    </div>
                                    ${p.gps ? `
                                        <div class="flex items-center gap-1 text-safety-green">
                                            <i class="fas fa-map-marker-alt text-[8px]"></i>
                                            <p class="text-[9px] font-mono">${p.gps.lat.toFixed(5)}, ${p.gps.lng.toFixed(5)}</p>
                                            <span class="text-[8px] text-white/60">(±${p.gps.accuracy}m)</span>
                                        </div>
                                    ` : `
                                        <div class="flex items-center gap-1 text-dot-orange">
                                            <i class="fas fa-location-crosshairs text-[8px]"></i>
                                            <p class="text-[9px]">No GPS</p>
                                        </div>
                                    `}
                                </div>
                            </div>
                            <div class="p-2 bg-white">
                                <textarea
                                    id="caption-input-${i}"
                                    class="caption-textarea w-full text-xs border border-slate-200 rounded p-2 bg-slate-50 focus:bg-white focus:border-dot-blue focus:outline-none"
                                    placeholder="Add caption..."
                                    maxlength="500"
                                    oninput="updatePhotoCaption(${i}, this.value); autoExpandCaption(this);"
                                    onblur="updatePhotoCaption(${i}, this.value)"
                                >${p.caption || ''}</textarea>
                                <div id="caption-counter-${i}" class="caption-counter hidden mt-1"></div>
                            </div>
                        </div>
                    `).join('') || '<p class="col-span-2 text-center text-slate-400 text-sm py-4">No photos yet</p>';
                    break;
            }
        }

        function renderAllSections() {
            // v6: All guided mode sections
            ['activities', 'personnel', 'equipment', 'issues', 'communications', 'qaqc', 'safety', 'visitors', 'photos'].forEach(renderSection);
            updateWeatherDisplay();
            updateEquipmentPreview();
        }

        // ============ PREVIEWS & PROGRESS ============
        function updateAllPreviews() {
            // v6: All guided mode sections
            const w = report.overview.weather;
            document.getElementById('weather-preview').textContent = w.jobSiteCondition || `${w.generalCondition}, ${w.highTemp}`;

            // v6.6: Work Summary preview - contractor-based format
            updateActivitiesPreview();

            const naMarked = report.meta.naMarked || {};

            // v6: Personnel preview - check toggle and data
            const personnelToggleVal = getToggleState('personnel_onsite');
            const personnelPreviewEl = document.getElementById('personnel-preview');
            if (personnelPreviewEl) {
                if (personnelToggleVal === false) {
                    personnelPreviewEl.textContent = 'N/A - No contractors';
                } else if (personnelToggleVal === true) {
                    const totalPersonnel = getTotalPersonnelCount();
                    personnelPreviewEl.textContent = totalPersonnel > 0 ? `${totalPersonnel} personnel` : 'Tap to add counts';
                } else {
                    personnelPreviewEl.textContent = 'Tap to add';
                }
            }

            // v6: Equipment preview
            updateEquipmentPreview();

            // v6: Issues preview - count both entry-based and legacy issues
            const issueEntries = getEntriesForSection('issues');
            const legacyIssueCount = (report.generalIssues || []).length;
            const totalIssues = issueEntries.length + legacyIssueCount;
            document.getElementById('issues-preview').textContent =
                naMarked.issues ? 'N/A - No issues' :
                totalIssues > 0 ? `${totalIssues} issue${totalIssues > 1 ? 's' : ''}` :
                'None reported';

            // v6: Communications preview
            const commsToggleVal = getToggleState('communications_made');
            const commsPreviewEl = document.getElementById('communications-preview');
            if (commsPreviewEl) {
                if (commsToggleVal === false) {
                    commsPreviewEl.textContent = 'N/A - None';
                } else if (commsToggleVal === true) {
                    const commsCount = getEntriesForSection('communications').length;
                    commsPreviewEl.textContent = commsCount > 0 ? `${commsCount} logged` : 'Tap to add';
                } else {
                    commsPreviewEl.textContent = 'None recorded';
                }
            }

            // v6: QA/QC preview
            const qaqcToggleVal = getToggleState('qaqc_performed');
            const qaqcPreviewEl = document.getElementById('qaqc-preview');
            if (qaqcPreviewEl) {
                if (qaqcToggleVal === false) {
                    qaqcPreviewEl.textContent = 'N/A - None';
                } else if (qaqcToggleVal === true) {
                    const qaqcCount = getEntriesForSection('qaqc').length;
                    qaqcPreviewEl.textContent = qaqcCount > 0 ? `${qaqcCount} logged` : 'Tap to add';
                } else {
                    qaqcPreviewEl.textContent = 'None recorded';
                }
            }

            // v6: Safety preview - check report state and entries
            const safetyEntryCount = getEntriesForSection('safety').length;
            const legacySafetyCount = (report.safety?.notes || []).length;
            document.getElementById('safety-preview').textContent =
                report.safety.hasIncidents ? 'INCIDENT REPORTED' :
                report.safety.noIncidents ? 'No incidents (confirmed)' :
                (safetyEntryCount + legacySafetyCount) > 0 ? 'Notes added' :
                'Tap to confirm';

            // v6: Visitors preview
            const visitorsToggleVal = getToggleState('visitors_present');
            const visitorsPreviewEl = document.getElementById('visitors-preview');
            if (visitorsPreviewEl) {
                if (visitorsToggleVal === false) {
                    visitorsPreviewEl.textContent = 'N/A - None';
                } else if (visitorsToggleVal === true) {
                    const visitorsCount = getEntriesForSection('visitors').length;
                    visitorsPreviewEl.textContent = visitorsCount > 0 ? `${visitorsCount} logged` : 'Tap to add';
                } else {
                    visitorsPreviewEl.textContent = 'None recorded';
                }
            }

            document.getElementById('photos-preview').textContent = naMarked.photos ? 'N/A - No photos' : report.photos.length > 0 ? `${report.photos.length} photos` : 'No photos';

            updateStatusIcons();
        }

        function updateStatusIcons() {
            const naMarked = report.meta.naMarked || {};
            // Check if equipment has any rows (v6.6: check equipmentRows)
            const hasEquipmentData = (report.equipmentRows && report.equipmentRows.length > 0) ||
                                     report.equipment?.some(e => e.hoursUtilized !== null && e.hoursUtilized > 0) || false;
            // v6: Check toggle states and entries for new sections
            const personnelToggle = getToggleState('personnel_onsite');
            const commsToggle = getToggleState('communications_made');
            const qaqcToggle = getToggleState('qaqc_performed');
            const visitorsToggle = getToggleState('visitors_present');

            // v6.6: Check if any contractor has work logged
            const hasContractorWork = projectContractors?.some(contractor => {
                const activity = getContractorActivity(contractor.id);
                const entries = getContractorWorkEntries(contractor.id);
                return (activity?.noWork) || entries.length > 0;
            }) || false;

            // Sections with status icons
            const sections = {
                'weather': report.overview.weather.jobSiteCondition,
                'activities': hasContractorWork,
                'personnel': personnelToggle !== null || hasOperationsData(),
                'equipment': hasEquipmentData,
                'issues': getEntriesForSection('issues').length > 0 || report.generalIssues.length > 0 || naMarked.issues,
                'communications': commsToggle !== null || getEntriesForSection('communications').length > 0,
                'qaqc': qaqcToggle !== null || getEntriesForSection('qaqc').length > 0,
                'safety': report.safety.noIncidents || report.safety.hasIncidents || report.safety.notes.length > 0 || getEntriesForSection('safety').length > 0,
                'visitors': visitorsToggle !== null || getEntriesForSection('visitors').length > 0,
                'photos': report.photos.length > 0 || naMarked.photos
            };
            Object.entries(sections).forEach(([section, hasData]) => {
                const statusEl = document.getElementById(`${section}-status`);
                if (!statusEl) return;
                const card = document.querySelector(`[data-section="${section}"]`);
                const isExpanded = card?.classList.contains('expanded');
                if (hasData && !isExpanded) {
                    statusEl.innerHTML = '<i class="fas fa-check text-safety-green text-xs"></i>';
                    statusEl.className = 'w-8 h-8 bg-safety-green/20 border-2 border-safety-green flex items-center justify-center';
                } else if (!isExpanded) {
                    statusEl.innerHTML = '<i class="fas fa-chevron-down text-slate-400 text-xs"></i>';
                    statusEl.className = 'w-8 h-8 border border-slate-300 flex items-center justify-center';
                }
            });
        }

        function updateProgress() {
            const naMarked = report.meta.naMarked || {};
            let filled = 0;
            let total = 10; // v6: All guided mode sections

            // Weather - has site condition text
            if (report.overview.weather.jobSiteCondition) filled++;

            // v6.6: Work Summary - contractor work entries or all marked no work
            if (projectContractors && projectContractors.length > 0) {
                const anyAccountedFor = projectContractors.some(contractor => {
                    const activity = getContractorActivity(contractor.id);
                    const entries = getContractorWorkEntries(contractor.id);
                    return (activity?.noWork) || entries.length > 0;
                });
                if (anyAccountedFor) filled++;
            }

            // v6: Personnel - toggle answered OR has data
            const personnelToggleVal = getToggleState('personnel_onsite');
            if (personnelToggleVal !== null || hasOperationsData()) filled++;

            // v6.6: Equipment - has equipment rows
            if ((report.equipmentRows || []).length > 0) filled++;

            // v6: Issues - has entries OR legacy issues OR marked N/A
            const issueEntryCount = getEntriesForSection('issues').length;
            const legacyIssueCount = (report.generalIssues || []).length;
            if (issueEntryCount > 0 || legacyIssueCount > 0 || naMarked.issues) filled++;

            // v6: Communications - toggle answered OR has entries
            const commsToggleVal = getToggleState('communications_made');
            if (commsToggleVal !== null || getEntriesForSection('communications').length > 0) filled++;

            // v6: QA/QC - toggle answered OR has entries
            const qaqcToggleVal = getToggleState('qaqc_performed');
            if (qaqcToggleVal !== null || getEntriesForSection('qaqc').length > 0) filled++;

            // v6: Safety - checkbox answered OR has entries OR legacy notes
            const safetyEntryCount = getEntriesForSection('safety').length;
            const legacySafetyCount = (report.safety?.notes || []).length;
            if (report.safety.noIncidents === true ||
                report.safety.hasIncidents === true ||
                safetyEntryCount > 0 ||
                legacySafetyCount > 0) filled++;

            // v6: Visitors - toggle answered OR has entries
            const visitorsToggleVal = getToggleState('visitors_present');
            if (visitorsToggleVal !== null || getEntriesForSection('visitors').length > 0) filled++;

            // Photos - has photos OR marked N/A
            if (report.photos.length > 0 || naMarked.photos) filled++;

            const percent = Math.round((filled / total) * 100);
            document.getElementById('progressBar').style.width = `${percent}%`;
            document.getElementById('progressText').textContent = `${percent}%`;
        }

        // ============ N/A MARKING ============
        function markNA(section) {
            if (!report.meta.naMarked) report.meta.naMarked = {};
            report.meta.naMarked[section] = true;
            const btn = document.getElementById(`${section}-na-btn`);
            if (btn) {
                btn.innerHTML = '<i class="fas fa-check mr-2"></i>Marked as N/A';
                btn.className = 'w-full p-3 bg-safety-green/20 border-2 border-safety-green text-safety-green text-sm font-medium uppercase cursor-default';
                btn.onclick = () => clearNA(section);
            }
            // Hide photo upload if photos section is marked N/A
            if (section === 'photos') {
                const uploadLabel = document.getElementById('photos-upload-label');
                if (uploadLabel) uploadLabel.classList.add('hidden');
            }
            saveReport();
            updateAllPreviews();
            showToast('Marked as N/A');
        }

        function clearNA(section) {
            if (report.meta.naMarked) { delete report.meta.naMarked[section]; }
            const btn = document.getElementById(`${section}-na-btn`);
            if (btn) {
                const labels = { issues: 'No Issues - Mark as N/A', inspections: 'No Inspections - Mark as N/A', communications: 'No Communications - Mark as N/A', visitors: 'Nothing to Report - Mark as N/A', photos: 'No Photos - Mark as N/A' };
                btn.innerHTML = `<i class="fas fa-ban mr-2"></i>${labels[section] || 'Mark as N/A'}`;
                btn.className = 'w-full p-3 bg-slate-100 border border-slate-300 text-slate-600 hover:bg-slate-200 transition-colors text-sm font-medium uppercase';
                btn.onclick = () => markNA(section);
            }
            // Show photo upload if photos section is cleared
            if (section === 'photos') {
                const uploadLabel = document.getElementById('photos-upload-label');
                if (uploadLabel) uploadLabel.classList.remove('hidden');
            }
            saveReport();
            updateAllPreviews();
            showToast('N/A cleared');
        }

        function updateNAButtons() {
            const naMarked = report.meta.naMarked || {};
            Object.keys(naMarked).forEach(section => {
                if (naMarked[section]) {
                    const btn = document.getElementById(`${section}-na-btn`);
                    if (btn) {
                        btn.innerHTML = '<i class="fas fa-check mr-2"></i>Marked as N/A';
                        btn.className = 'w-full p-3 bg-safety-green/20 border-2 border-safety-green text-safety-green text-sm font-medium uppercase cursor-default';
                        btn.onclick = () => clearNA(section);
                    }
                    // Hide photo upload if photos is marked N/A
                    if (section === 'photos') {
                        const uploadLabel = document.getElementById('photos-upload-label');
                        if (uploadLabel) uploadLabel.classList.add('hidden');
                    }
                }
            });
        }

        // ============ UTILITIES ============
        // getHighAccuracyGPS() moved to /js/media-utils.js

        function dismissWarningBanner() { document.getElementById('permissionsWarningBanner').classList.add('hidden'); }

        function checkAndShowWarningBanner() {
            const micGranted = localStorage.getItem(STORAGE_KEYS.MIC_GRANTED) === 'true';
            const locGranted = localStorage.getItem(STORAGE_KEYS.LOC_GRANTED) === 'true';
            if (isMobile && (!micGranted || !locGranted)) {
                document.getElementById('permissionsWarningBanner').classList.remove('hidden');
            }
        }

        // ============ PERMISSIONS ============
        async function requestMicrophonePermission() {
            const btn = document.getElementById('micPermissionBtn');
            const status = document.getElementById('micPermissionStatus');
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            status.textContent = 'Testing...';
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                stream.getTracks().forEach(track => track.stop());
                localStorage.setItem(STORAGE_KEYS.MIC_GRANTED, 'true');
                updatePermissionUI('mic', 'granted');
                showToast('Microphone enabled!', 'success');
            } catch (err) {
                console.error('Microphone permission error:', err);
                updatePermissionUI('mic', 'denied');
                status.textContent = 'Blocked - check settings';
            }
        }

        async function requestLocationPermission() {
            const btn = document.getElementById('locPermissionBtn');
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            try {
                await new Promise((resolve, reject) => {
                    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
                });
                localStorage.setItem(STORAGE_KEYS.LOC_GRANTED, 'true');
                updatePermissionUI('loc', 'granted');
                showToast('Location enabled!');
                fetchWeather();
            } catch (err) {
                console.error('Location permission error:', err);
                if (err.code === 1) { updatePermissionUI('loc', 'denied'); }
            }
        }

        function updatePermissionUI(type, state) {
            const btn = document.getElementById(`${type}PermissionBtn`);
            const status = document.getElementById(`${type}PermissionStatus`);
            const row = document.getElementById(`${type}PermissionRow`);
            if (state === 'granted') {
                btn.innerHTML = '<i class="fas fa-check"></i>';
                btn.className = 'px-4 py-2 bg-safety-green text-white text-xs font-bold cursor-default';
                btn.disabled = true;
                status.textContent = type === 'mic' ? 'Verified Working' : 'Enabled';
                status.className = 'text-xs text-safety-green';
                row.className = 'bg-safety-green/10 border-2 border-safety-green p-4';
            } else if (state === 'denied') {
                btn.textContent = 'Denied';
                btn.className = 'px-4 py-2 bg-red-500/50 text-white text-xs font-bold';
                btn.disabled = true;
                status.textContent = 'Blocked - check settings';
                status.className = 'text-xs text-red-500';
                row.className = 'bg-red-50 border-2 border-red-500 p-4';
            }
        }

        function closePermissionsModal() {
            document.getElementById('permissionsModal').classList.add('hidden');
            localStorage.setItem(STORAGE_KEYS.PERMISSIONS_DISMISSED, 'true');
        }

        async function finishReport() {
            // Early offline check - show modal when offline
            if (!navigator.onLine) {
                showNetworkErrorModal(
                    'No Internet Connection',
                    'You appear to be offline. Your report data is saved locally.',
                    () => finishReport(),  // Retry
                    () => {
                        showToast('Report saved to drafts', 'info');
                        window.location.href = 'drafts.html';
                    }
                );
                return;
            }

            // v6.6: Validate required fields - check contractor work entries
            let hasWorkSummary = false;
            if (projectContractors && projectContractors.length > 0) {
                // Check if any contractor has work logged OR all marked as no work
                const allAccountedFor = projectContractors.every(contractor => {
                    const activity = getContractorActivity(contractor.id);
                    const entries = getContractorWorkEntries(contractor.id);
                    return (activity?.noWork && entries.length === 0) || entries.length > 0;
                });
                // Check if at least one has entries OR all are marked no work
                const anyWork = projectContractors.some(contractor => {
                    return getContractorWorkEntries(contractor.id).length > 0;
                });
                const allNoWork = projectContractors.every(contractor => {
                    const activity = getContractorActivity(contractor.id);
                    return activity?.noWork;
                });
                hasWorkSummary = allAccountedFor && (anyWork || allNoWork);
            }
            const safetyAnswered = report.safety.noIncidents === true || report.safety.hasIncidents === true;

            if (!hasWorkSummary) {
                showToast('Work Summary is required - log work for each contractor or mark "No work"', 'error');
                // Open the activities section to show user where to fill
                const activitiesCard = document.querySelector('[data-section="activities"]');
                if (activitiesCard && !activitiesCard.classList.contains('expanded')) {
                    toggleSection('activities');
                }
                return;
            }

            if (!safetyAnswered) {
                showToast('Please answer the Safety question', 'error');
                // Open the safety section
                const safetyCard = document.querySelector('[data-section="safety"]');
                if (safetyCard && !safetyCard.classList.contains('expanded')) {
                    toggleSection('safety');
                }
                return;
            }

            // Get button reference for loading state
            const finishBtn = document.querySelector('button[onclick="finishReport()"]');
            const originalBtnHtml = finishBtn ? finishBtn.innerHTML : '';

            // Show loading state
            if (finishBtn) {
                finishBtn.disabled = true;
                finishBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Processing...';
            }
            showToast('Processing with AI...', 'info');

            // Set up report data
            report.overview.endTime = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
            report.meta.interviewCompleted = true;
            if (report.overview.startTime) {
                const start = new Date(`2000/01/01 ${report.overview.startTime}`);
                const end = new Date(`2000/01/01 ${report.overview.endTime}`);
                const diffMs = end - start;
                const hours = Math.floor(diffMs / (1000 * 60 * 60));
                const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
                report.overview.shiftDuration = `${hours}.${String(mins).padStart(2, '0')} hours`;
            }
            if (report.safety.notes.length === 0) { report.safety.notes.push('No safety incidents reported.'); }

            // Store guided notes for AI processing
            report.guidedNotes.issues = report.generalIssues?.join('\n') || '';
            report.guidedNotes.safety = report.safety.noIncidents ? 'No incidents reported' : (report.safety.hasIncidents ? 'INCIDENT REPORTED: ' + report.safety.notes.join('; ') : '');

            // Upload any pending photos from IndexedDB before saving report
            if (navigator.onLine) {
                await uploadPendingPhotos();
            }

            // Ensure report is saved to Supabase first
            await saveReportToSupabase();

            // Build payload
            const payload = buildProcessPayload();

            // Check if online
            if (!navigator.onLine) {
                handleOfflineProcessing(payload, true);
                return;
            }

            // Save AI request to Supabase
            await saveAIRequest(payload);

            const startTime = Date.now();

            // Call webhook
            try {
                const result = await callProcessWebhook(payload);
                const processingTime = Date.now() - startTime;

                // Save AI response to Supabase
                await saveAIResponse(result.aiGenerated, processingTime);

                // Save AI response to local report
                if (result.aiGenerated) {
                    report.aiGenerated = result.aiGenerated;
                }
                report.meta.status = 'refined';
                await saveReportToSupabase();

                // v6.6.2: Save complete report package to single localStorage key
                // This is the source of truth for report.html
                const todayStr = getTodayDateString();
                const reportDataPackage = {
                    reportId: currentReportId,
                    projectId: activeProject?.id,
                    reportDate: todayStr,
                    status: 'refined',

                    // From n8n webhook response
                    aiGenerated: result.aiGenerated || {},
                    captureMode: result.captureMode || report.meta?.captureMode || 'guided',

                    // Original field notes (for "Original Notes" tab)
                    originalInput: result.originalInput || payload,

                    // User edits - initialize empty (will be populated on report.html)
                    userEdits: {},

                    // Metadata
                    createdAt: report.meta?.createdAt || new Date().toISOString(),
                    lastSaved: new Date().toISOString()
                };

                const saveSuccess = saveReportData(currentReportId, reportDataPackage);
                if (saveSuccess) {
                    console.log('[LOCAL] Complete report package saved to localStorage:', currentReportId);
                } else {
                    console.warn('[LOCAL] Failed to save report package to localStorage');
                }

                // v6.6.3: Update fvp_current_reports so dashboard can find this refined report
                const currentReports = JSON.parse(localStorage.getItem('fvp_current_reports') || '{}');
                currentReports[currentReportId] = {
                    id: currentReportId,
                    project_id: activeProject?.id,
                    project_name: activeProject?.projectName || activeProject?.project_name,
                    date: todayStr,
                    report_date: todayStr,
                    status: 'refined',
                    created_at: report.meta?.createdAt ? new Date(report.meta.createdAt).getTime() : Date.now(),
                    lastSaved: new Date().toISOString()
                };
                localStorage.setItem('fvp_current_reports', JSON.stringify(currentReports));
                console.log('[LOCAL] Updated fvp_current_reports with refined status:', currentReportId);

                // Clean up old draft key if we have a real Supabase ID
                const draftKey = `draft_${activeProject?.id}_${todayStr}`;
                if (currentReportId && currentReportId !== draftKey) {
                    deleteCurrentReport(draftKey);
                    console.log('[LOCAL] Cleaned up old draft key:', draftKey);
                }

                // Release the lock before navigating away
                if (window.lockManager) {
                    await window.lockManager.releaseCurrentLock();
                }

                // Navigate to report with date and reportId parameters
                window.location.href = `report.html?date=${todayStr}&reportId=${currentReportId}`;
            } catch (error) {
                console.error('AI processing failed:', error);

                // Restore button state
                if (finishBtn) {
                    finishBtn.disabled = false;
                    finishBtn.innerHTML = originalBtnHtml;
                }

                // Show modal with retry/drafts options
                showNetworkErrorModal(
                    'Submission Failed',
                    'Could not reach the server. Your report data is safe.',
                    () => finishReport(),  // Retry
                    () => {
                        handleOfflineProcessing(payload, true);
                    }
                );
            }
        }

        // ============ EVENT LISTENERS ============
        // Site conditions input (Weather section)
        document.getElementById('site-conditions-input').addEventListener('change', (e) => {
            report.overview.weather.jobSiteCondition = e.target.value;
            saveReport();
        });

        // Safety checkboxes
        document.getElementById('no-incidents').addEventListener('change', (e) => {
            if (e.target.checked) { report.safety.hasIncidents = false; report.safety.noIncidents = true; document.getElementById('has-incidents').checked = false; }
            else { report.safety.noIncidents = false; }
            saveReport();
            updateAllPreviews();
            updateProgress();
        });

        document.getElementById('has-incidents').addEventListener('change', (e) => {
            report.safety.hasIncidents = e.target.checked;
            if (e.target.checked) { report.safety.noIncidents = false; document.getElementById('no-incidents').checked = false; }
            saveReport();
            updateAllPreviews();
            updateProgress();
        });

        // Photo input
        document.getElementById('photoInput').addEventListener('change', handlePhotoInput);

        // ============ INIT ============
        function updateLoadingStatus(message) {
            const statusEl = document.getElementById('loadingStatus');
            if (statusEl) statusEl.textContent = message;
        }

        function hideLoadingOverlay() {
            const overlay = document.getElementById('loadingOverlay');
            if (overlay) {
                overlay.style.transition = 'opacity 0.3s ease-out';
                overlay.style.opacity = '0';
                setTimeout(() => {
                    overlay.style.display = 'none';
                }, 300);
            }
        }

        document.addEventListener('DOMContentLoaded', async () => {
            try {
                // STATE PROTECTION: Check if report is already refined BEFORE any other initialization
                // This must run first to redirect users away from editing refined reports
                updateLoadingStatus('Checking report state...');
                const canEdit = await checkReportState();
                if (!canEdit) {
                    return; // Stop initialization if redirecting
                }

                // Load user settings from Supabase
                updateLoadingStatus('Loading user settings...');
                userSettings = await window.dataLayer.loadUserSettings();

                // v6: Initialize sync manager for real-time backup
                initSyncManager();

                // Load active project and contractors from Supabase
                updateLoadingStatus('Loading project data...');
                activeProject = await window.dataLayer.loadActiveProject();
                if (activeProject) {
                    projectContractors = activeProject.contractors || [];
                }

                // Check for report lock before loading
                if (activeProject && navigator.onLine) {
                    updateLoadingStatus('Checking for active editors...');
                    const todayStr = getTodayDateString();
                    const lockInfo = await window.lockManager.checkLock(activeProject.id, todayStr);
                    if (lockInfo) {
                        hideLoadingOverlay();
                        showLockWarningModal(lockInfo);
                        return; // Stop initialization
                    }
                }

                // Load report from Supabase (baseline)
                updateLoadingStatus('Loading report data...');
                report = await getReport();

                // LOCALSTORAGE-FIRST: Check if we have a localStorage draft with unsaved changes
                // This recovers data if user swiped away the app without clicking FINISH
                updateLoadingStatus('Checking for saved draft...');
                const localDraft = loadFromLocalStorage();
                if (localDraft) {
                    console.log('[INIT] Found localStorage draft, restoring...');
                    restoreFromLocalStorage(localDraft);
                }

                // If user came back to edit a draft report that was marked completed but not yet refined,
                // mark it as in-progress again. Note: Refined/submitted/finalized reports are blocked
                // by checkReportState() above, so we only get here for draft status.
                if (report.meta?.interviewCompleted && report.meta?.status === 'draft') {
                    report.meta.interviewCompleted = false;
                    // Don't need to save here - we're just resetting local state
                }

                // Auto-populate project info from active project if not already set
                if (activeProject && !report.project?.projectName) {
                    report.project.projectName = activeProject.projectName || '';
                    report.overview.projectName = activeProject.projectName || '';
                    // Don't save here - let regular auto-save handle it
                }

                // Auto-populate reporter name from user settings
                if (userSettings && !report.reporter?.name) {
                    report.reporter.name = userSettings.full_name || '';
                    report.overview.completedBy = userSettings.full_name || '';
                    // Don't save here - let regular auto-save handle it
                }

                // Hide loading overlay
                hideLoadingOverlay();

                // Check if we need to show mode selection or jump to a specific mode
                if (shouldShowModeSelection()) {
                    showModeSelectionScreen();
                    // Fetch weather in background for when user selects a mode
                    if (report.overview.weather.generalCondition === 'Syncing...' || report.overview.weather.generalCondition === '--') {
                        fetchWeather();
                    }
                } else {
                    // Show the appropriate mode UI
                    const mode = report.meta?.captureMode || 'guided';
                    showModeUI(mode);

                    // Fetch weather if needed
                    if (report.overview.weather.generalCondition === 'Syncing...' || report.overview.weather.generalCondition === '--') {
                        await fetchWeather();
                        // Update weather display in minimal mode if active
                        if (mode === 'minimal') {
                            updateMinimalWeatherDisplay();
                        }
                    }
                }

                checkAndShowWarningBanner();
                checkDictationHintBanner();

                // Acquire lock on this report (if online)
                if (activeProject && navigator.onLine) {
                    const todayStr = getTodayDateString();
                    const inspectorName = userSettings?.full_name || '';
                    const lockAcquired = await window.lockManager.acquireLock(activeProject.id, todayStr, inspectorName);
                    if (!lockAcquired) {
                        console.warn('[INIT] Failed to acquire lock - may have been taken by another device');
                    }
                }
            } catch (error) {
                console.error('Initialization failed:', error);
                hideLoadingOverlay();
                showToast('Failed to load data. Please refresh.', 'error');
            }
        });
