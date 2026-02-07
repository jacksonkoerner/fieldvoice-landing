// ============ CONSTANTS ============
const EXTRACT_WEBHOOK_URL = 'https://advidere.app.n8n.cloud/webhook/fieldvoice-project-extractor-6.5';

// ============ STATE ============
let currentProject = null;
let deleteCallback = null;
let selectedFiles = [];
let isLoading = false;
let isDirty = false;

// ============ INITIALIZATION ============
// Note: Initialization moved to end of script with setupDropZone()

// ============ DIRTY STATE MANAGEMENT ============
function markDirty() {
    if (!isDirty) {
        isDirty = true;
        updateDirtyBanner();
    }
}

function clearDirty() {
    isDirty = false;
    updateDirtyBanner();
}

function updateDirtyBanner() {
    const banner = document.getElementById('dirtyBanner');
    if (banner) {
        if (isDirty) {
            banner.classList.remove('hidden');
        } else {
            banner.classList.add('hidden');
        }
    }
}

function setupDirtyTracking() {
    // Track all form inputs
    const formInputs = document.querySelectorAll('#projectFormContainer input, #projectFormContainer select');
    formInputs.forEach(input => {
        input.addEventListener('input', markDirty);
        input.addEventListener('change', markDirty);
    });

    // Add beforeunload warning
    window.addEventListener('beforeunload', (e) => {
        if (isDirty) {
            e.preventDefault();
            e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
            return e.returnValue;
        }
    });
}

// ============ PROJECT MANAGEMENT ============
/* DEPRECATED — now using window.dataLayer.loadProjects()
async function getProjects() {
    try {
        // Get current user's ID
        const userId = getStorageItem(STORAGE_KEYS.USER_ID);

        if (!userId) {
            console.warn('[getProjects] No user_id found - user needs to set up profile first');
            return [];
        }

        // LOCAL-FIRST: Try IndexedDB first
        let localProjects = [];
        try {
            const allLocalProjects = await window.idb.getAllProjects();
            // Filter by user_id (same as Supabase query)
            localProjects = allLocalProjects.filter(p => p.user_id === userId);
            // Sort by created_at descending
            localProjects.sort((a, b) => {
                const dateA = a.created_at ? new Date(a.created_at) : new Date(0);
                const dateB = b.created_at ? new Date(b.created_at) : new Date(0);
                return dateB - dateA;
            });
        } catch (idbError) {
            console.warn('[getProjects] IndexedDB error:', idbError);
        }

        // If we have local projects, return them
        if (localProjects.length > 0) {
            console.log('[getProjects] Returning', localProjects.length, 'projects from IndexedDB');
            return localProjects;
        }

        // Fall back to Supabase if IndexedDB is empty
        console.log('[getProjects] IndexedDB empty, fetching from Supabase...');
        const { data: projectRows, error: projectError } = await supabaseClient
            .from('projects')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (projectError) {
            console.error('Error fetching projects:', projectError);
            showToast('Failed to load projects', 'error');
            return [];
        }

        if (!projectRows || projectRows.length === 0) {
            return [];
        }

        // Fetch all contractors
        const { data: contractorRows, error: contractorError } = await supabaseClient
            .from('contractors')
            .select('*');

        if (contractorError) {
            console.error('Error fetching contractors:', contractorError);
        }

        // Build the nested structure
        const projects = projectRows.map(projectRow => {
            const project = fromSupabaseProject(projectRow);

            // Add contractors for this project
            if (contractorRows) {
                project.contractors = contractorRows
                    .filter(c => c.project_id === project.id)
                    .map(fromSupabaseContractor);
            }

            return project;
        });

        // Cache projects to IndexedDB for future offline use
        console.log('[getProjects] Caching', projects.length, 'projects to IndexedDB');
        for (const project of projects) {
            try {
                await window.idb.saveProject(project);
            } catch (cacheError) {
                console.warn('[getProjects] Failed to cache project:', project.id, cacheError);
            }
        }

        return projects;
    } catch (error) {
        console.error('Error in getProjects:', error);
        showToast('Failed to load projects', 'error');
        return [];
    }
}
*/

async function saveProjectToSupabase(project) {
    try {
        // 1. Upsert the project
        const projectData = toSupabaseProject(project);

        // Add user_id from localStorage
        const userId = getStorageItem(STORAGE_KEYS.USER_ID);
        if (userId) {
            projectData.user_id = userId;
        }

        const { error: projectError } = await supabaseClient
            .from('projects')
            .upsert(projectData, { onConflict: 'id' });

        if (projectError) {
            console.error('Error saving project:', projectError);
            throw new Error('Failed to save project');
        }

        // 2. Handle contractors - get existing ones first
        const { data: existingContractors } = await supabaseClient
            .from('contractors')
            .select('id')
            .eq('project_id', project.id);

        const existingContractorIds = new Set((existingContractors || []).map(c => c.id));
        const currentContractorIds = new Set((project.contractors || []).map(c => c.id));

        // Delete removed contractors
        const contractorsToDelete = [...existingContractorIds].filter(id => !currentContractorIds.has(id));
        if (contractorsToDelete.length > 0) {
            const { error: deleteContractorError } = await supabaseClient
                .from('contractors')
                .delete()
                .in('id', contractorsToDelete);

            if (deleteContractorError) {
                console.error('Error deleting contractors:', deleteContractorError);
            }
        }

        // Upsert current contractors
        if (project.contractors && project.contractors.length > 0) {
            const contractorData = project.contractors.map(c => toSupabaseContractor(c, project.id));
            const { error: contractorError } = await supabaseClient
                .from('contractors')
                .upsert(contractorData, { onConflict: 'id' });

            if (contractorError) {
                console.error('Error saving contractors:', contractorError);
                throw new Error('Failed to save contractors');
            }
        }

        return true;
    } catch (error) {
        console.error('Error in saveProjectToSupabase:', error);
        throw error;
    }
}

async function deleteProjectFromSupabase(projectId) {
    try {
        // Delete the project - contractors cascade automatically
        const { error } = await supabaseClient
            .from('projects')
            .delete()
            .eq('id', projectId);

        if (error) {
            console.error('Error deleting project:', error);
            throw new Error('Failed to delete project');
        }

        return true;
    } catch (error) {
        console.error('Error in deleteProjectFromSupabase:', error);
        throw error;
    }
}

function getActiveProjectId() {
    return getStorageItem(STORAGE_KEYS.ACTIVE_PROJECT_ID);
}

function setActiveProjectId(projectId) {
    setStorageItem(STORAGE_KEYS.ACTIVE_PROJECT_ID, projectId);
}

function createNewProject() {
    currentProject = {
        id: generateId(),
        projectName: '',
        logoThumbnail: null,
        logoUrl: null,
        noabProjectNo: '',
        cnoSolicitationNo: 'N/A',
        location: '',
        engineer: '',
        primeContractor: '',
        noticeToProceed: '',
        reportDate: '',
        contractDuration: '',
        expectedCompletion: '',
        defaultStartTime: '06:00',
        defaultEndTime: '16:00',
        weatherDays: 0,
        contractDayNo: '',
        contractors: []
    };
    populateForm();
    showProjectForm();
}

async function loadProject(projectId) {
    try {
        let project = null;

        // LOCAL-FIRST: Try IndexedDB first for faster loading
        try {
            project = await window.idb.getProject(projectId);
            if (project) {
                console.log('[loadProject] Found in IndexedDB:', projectId);
            }
        } catch (idbError) {
            console.warn('[loadProject] IndexedDB error:', idbError);
        }

        // Fall back to getProjects() if not found in IndexedDB
        if (!project) {
            console.log('[loadProject] Not in IndexedDB, falling back to getProjects()');
            const projects = await window.dataLayer.loadProjects();
            project = projects.find(p => p.id === projectId);
        }

        if (project) {
            currentProject = JSON.parse(JSON.stringify(project)); // Deep copy
            populateForm();
            showProjectForm();
        }
    } catch (error) {
        console.error('Error loading project:', error);
        showToast('Failed to load project', 'error');
    }
}

async function saveProject() {
    if (!currentProject) return;

    // Validate required fields
    const name = document.getElementById('projectName').value.trim();
    if (!name) {
        showToast('Project name is required', 'error');
        document.getElementById('projectName').focus();
        return;
    }

    // Update current project from form
    currentProject.projectName = name;
    // Logo fields are set by handleLogoSelect/removeLogo, preserve them
    currentProject.logoThumbnail = currentProject.logoThumbnail || null;
    currentProject.logoUrl = currentProject.logoUrl || null;
    currentProject.noabProjectNo = document.getElementById('noabProjectNo').value.trim();
    currentProject.cnoSolicitationNo = document.getElementById('cnoSolicitationNo').value.trim() || 'N/A';
    currentProject.location = document.getElementById('location').value.trim();
    currentProject.engineer = document.getElementById('engineer').value.trim();
    currentProject.primeContractor = document.getElementById('primeContractor').value.trim();
    currentProject.noticeToProceed = document.getElementById('noticeToProceed').value;
    currentProject.reportDate = document.getElementById('reportDate').value;
    currentProject.contractDuration = parseInt(document.getElementById('contractDuration').value) || null;
    currentProject.expectedCompletion = document.getElementById('expectedCompletion').value;
    currentProject.defaultStartTime = document.getElementById('defaultStartTime').value || '06:00';
    currentProject.defaultEndTime = document.getElementById('defaultEndTime').value || '16:00';
    currentProject.weatherDays = parseInt(document.getElementById('weatherDays').value) || 0;
    currentProject.contractDayNo = parseInt(document.getElementById('contractDayNo').value) || '';

    // Ensure user_id is set for IndexedDB filtering
    const userId = getStorageItem(STORAGE_KEYS.USER_ID);
    if (userId && !currentProject.user_id) {
        currentProject.user_id = userId;
    }

    // Ensure created_at is set for sorting
    if (!currentProject.created_at) {
        currentProject.created_at = new Date().toISOString();
    }

    // LOCAL-FIRST: Save to IndexedDB first
    try {
        await window.idb.saveProject(currentProject);
        console.log('[saveProject] Saved to IndexedDB:', currentProject.id);
    } catch (idbError) {
        console.error('[saveProject] IndexedDB save failed:', idbError);
        // Continue to try Supabase anyway
    }

    // Then sync to Supabase (backup)
    try {
        await saveProjectToSupabase(currentProject);
        console.log('[saveProject] Synced to Supabase:', currentProject.id);
        clearDirty();
        showToast('Project saved successfully');
    } catch (supabaseError) {
        // Offline or Supabase error - local save succeeded, warn user
        console.warn('[saveProject] Supabase sync failed (offline?):', supabaseError);
        clearDirty();
        showToast('Project saved locally (offline)', 'warning');
    }

    // Navigate to projects.html after save
    setTimeout(() => {
        window.location.href = 'projects.html';
    }, 800);
}

// ============ PROJECT DELETION ============

/**
 * Show the delete project confirmation modal
 */
function showDeleteProjectModal() {
    if (!currentProject) return;

    // Set project name in modal
    const projectName = currentProject.projectName || 'Unnamed Project';
    document.getElementById('deleteProjectName').textContent = `"${projectName}"`;

    // Show modal
    document.getElementById('deleteProjectModal').classList.remove('hidden');
}

/**
 * Close the delete project modal
 */
function closeDeleteProjectModal() {
    document.getElementById('deleteProjectModal').classList.add('hidden');
    // Reset button state
    const btn = document.getElementById('confirmDeleteProjectBtn');
    const icon = document.getElementById('deleteProjectBtnIcon');
    const text = document.getElementById('deleteProjectBtnText');
    btn.disabled = false;
    icon.className = 'fas fa-trash-alt';
    text.textContent = 'Delete';
}

/**
 * Confirm and execute project deletion
 * Order: Check offline → Delete from Supabase → Delete from IndexedDB
 */
async function confirmDeleteProject() {
    // MUST be first check - block deletion when offline
    if (!navigator.onLine) {
        showToast('Cannot delete project while offline. Please connect to the internet and try again.', 'error');
        closeDeleteProjectModal();
        return;
    }

    if (!currentProject) {
        closeDeleteProjectModal();
        return;
    }

    const projectId = currentProject.id;

    // Show loading state
    const btn = document.getElementById('confirmDeleteProjectBtn');
    const icon = document.getElementById('deleteProjectBtnIcon');
    const text = document.getElementById('deleteProjectBtnText');
    btn.disabled = true;
    icon.className = 'fas fa-spinner spin-animation';
    text.textContent = 'Deleting...';

    try {
        // 2. Delete from Supabase FIRST (contractors, then project)
        // Delete contractors first
        const { error: contractorError } = await supabaseClient
            .from('contractors')
            .delete()
            .eq('project_id', projectId);

        if (contractorError) {
            console.error('[deleteProject] Failed to delete contractors from Supabase:', contractorError);
            throw new Error('Failed to delete project contractors');
        }
        console.log('[deleteProject] Deleted contractors from Supabase for project:', projectId);

        // Then delete the project
        const { error: projectError } = await supabaseClient
            .from('projects')
            .delete()
            .eq('id', projectId);

        if (projectError) {
            console.error('[deleteProject] Failed to delete project from Supabase:', projectError);
            throw new Error('Failed to delete project');
        }
        console.log('[deleteProject] Deleted project from Supabase:', projectId);

        // 3. Supabase succeeded - now delete from IndexedDB
        try {
            await window.idb.deleteProject(projectId);
            console.log('[deleteProject] Deleted from IndexedDB:', projectId);
        } catch (idbError) {
            // Log but don't fail - Supabase deletion was successful
            console.warn('[deleteProject] IndexedDB delete failed (non-critical):', idbError);
        }

        // 4. Clear from localStorage if cached there
        try {
            const cachedProjects = getStorageItem(STORAGE_KEYS.PROJECTS);
            if (cachedProjects && cachedProjects[projectId]) {
                delete cachedProjects[projectId];
                setStorageItem(STORAGE_KEYS.PROJECTS, cachedProjects);
                console.log('[deleteProject] Cleared from localStorage cache');
            }
        } catch (lsError) {
            console.warn('[deleteProject] localStorage cleanup failed (non-critical):', lsError);
        }

        // 5. Clear active project if it was deleted
        if (getActiveProjectId() === projectId) {
            removeStorageItem(STORAGE_KEYS.ACTIVE_PROJECT_ID);
            console.log('[deleteProject] Cleared active project ID');
        }

        // 6. Success - close modal and redirect
        closeDeleteProjectModal();
        showToast('Project deleted successfully');
        currentProject = null;

        // Navigate to projects list
        setTimeout(() => {
            window.location.href = 'projects.html';
        }, 800);

    } catch (error) {
        console.error('[deleteProject] Deletion failed:', error);
        closeDeleteProjectModal();
        showToast(error.message || 'Failed to delete project. Please try again.', 'error');
    }
}

/**
 * Legacy deleteProject function (for backwards compatibility)
 * @deprecated Use showDeleteProjectModal() instead
 */
function deleteProject(projectId) {
    // Set currentProject if not already set (for calls from other pages)
    if (!currentProject || currentProject.id !== projectId) {
        // This function is primarily for internal use
        console.warn('[deleteProject] Called with projectId directly - use showDeleteProjectModal() instead');
    }
    showDeleteProjectModal();
}

function cancelEdit() {
    currentProject = null;
    window.location.href = 'projects.html';
}

// ============ UI RENDERING ============
function populateForm() {
    if (!currentProject) return;

    document.getElementById('projectName').value = currentProject.projectName || '';
    document.getElementById('noabProjectNo').value = currentProject.noabProjectNo || '';
    document.getElementById('cnoSolicitationNo').value = currentProject.cnoSolicitationNo || 'N/A';
    document.getElementById('location').value = currentProject.location || '';
    document.getElementById('engineer').value = currentProject.engineer || '';
    document.getElementById('primeContractor').value = currentProject.primeContractor || '';
    document.getElementById('noticeToProceed').value = currentProject.noticeToProceed || '';
    document.getElementById('reportDate').value = currentProject.reportDate || '';
    document.getElementById('contractDuration').value = currentProject.contractDuration || '';
    document.getElementById('expectedCompletion').value = currentProject.expectedCompletion || '';
    document.getElementById('defaultStartTime').value = currentProject.defaultStartTime || '06:00';
    document.getElementById('defaultEndTime').value = currentProject.defaultEndTime || '16:00';
    document.getElementById('weatherDays').value = currentProject.weatherDays || 0;
    document.getElementById('contractDayNo').value = currentProject.contractDayNo || '';

    // Handle logo preview
    // Priority: logoUrl (full quality) > logoThumbnail (compressed) > logo (legacy)
    const logoUploadZone = document.getElementById('logoUploadZone');
    const logoPreviewArea = document.getElementById('logoPreviewArea');
    const logoPreviewImg = document.getElementById('logoPreviewImg');

    const logoSrc = currentProject.logoUrl || currentProject.logoThumbnail || currentProject.logo;
    if (logoSrc) {
        logoPreviewImg.src = logoSrc;
        logoUploadZone.classList.add('hidden');
        logoPreviewArea.classList.remove('hidden');
    } else {
        logoUploadZone.classList.remove('hidden');
        logoPreviewArea.classList.add('hidden');
        logoPreviewImg.src = '';
    }

    renderContractors();
    updateActiveProjectBadge();
}

function showProjectForm() {
    // Scroll to top of form
    document.getElementById('projectFormContainer').scrollIntoView({ behavior: 'smooth' });
}

function updateActiveProjectBadge() {
    const badge = document.getElementById('activeProjectBadge');
    const setActiveBtn = document.getElementById('setActiveBtn');

    if (!badge) return; // Guard if badge doesn't exist

    if (currentProject && getActiveProjectId() === currentProject.id) {
        badge.classList.remove('hidden');
        if (setActiveBtn) {
            setActiveBtn.innerHTML = '<i class="fas fa-check mr-2"></i>Currently Active';
            setActiveBtn.disabled = true;
            setActiveBtn.classList.add('opacity-50', 'cursor-not-allowed');
        }
    } else {
        badge.classList.add('hidden');
        if (setActiveBtn) {
            setActiveBtn.innerHTML = '<i class="fas fa-star mr-2"></i>Set as Active Project';
            setActiveBtn.disabled = false;
            setActiveBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        }
    }
}

// ============ CONTRACTOR MANAGEMENT ============
function renderContractors() {
    const container = document.getElementById('contractorList');

    if (!currentProject || currentProject.contractors.length === 0) {
        container.innerHTML = `
            <div class="p-6 text-center">
                <i class="fas fa-hard-hat text-slate-300 text-2xl mb-2"></i>
                <p class="text-sm text-slate-500">No contractors added</p>
            </div>
        `;
        return;
    }

    // Sort: prime contractors first
    const sortedContractors = [...currentProject.contractors].sort((a, b) => {
        if (a.type === 'prime' && b.type !== 'prime') return -1;
        if (a.type !== 'prime' && b.type === 'prime') return 1;
        return 0;
    });

    container.innerHTML = sortedContractors.map((contractor, index) => `
        <div class="p-4 flex items-start gap-3" data-contractor-id="${contractor.id}" draggable="true">
            <div class="drag-handle w-8 h-8 bg-slate-100 flex items-center justify-center text-slate-400 shrink-0">
                <i class="fas fa-grip-vertical"></i>
            </div>
            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                    <p class="font-bold text-slate-800">${escapeHtml(contractor.name)}</p>
                    <span class="text-xs bg-slate-200 text-slate-600 px-2 py-0.5 font-mono">${escapeHtml(contractor.abbreviation)}</span>
                </div>
                <p class="text-xs mt-1">
                    <span class="${contractor.type === 'prime' ? 'text-safety-green font-bold' : 'text-slate-500'}">${contractor.type === 'prime' ? 'PRIME' : 'Subcontractor'}</span>
                    ${contractor.trades ? ` • ${escapeHtml(contractor.trades)}` : ''}
                </p>
            </div>
            <div class="flex items-center gap-1 shrink-0">
                <button onclick="editContractor('${contractor.id}')" class="w-8 h-8 text-dot-blue hover:bg-dot-blue/10 flex items-center justify-center transition-colors" title="Edit">
                    <i class="fas fa-edit text-sm"></i>
                </button>
                <button onclick="deleteContractor('${contractor.id}')" class="w-8 h-8 text-red-600 hover:bg-red-50 flex items-center justify-center transition-colors" title="Delete">
                    <i class="fas fa-trash text-sm"></i>
                </button>
            </div>
        </div>
    `).join('');

    // Setup drag and drop
    setupContractorDragDrop();
}

function showAddContractorForm() {
    document.getElementById('addContractorForm').classList.remove('hidden');
    document.getElementById('contractorFormTitle').textContent = 'Add New Contractor';
    document.getElementById('editContractorId').value = '';
    document.getElementById('contractorName').value = '';
    document.getElementById('contractorAbbr').value = '';
    document.getElementById('contractorType').value = 'subcontractor';
    document.getElementById('contractorTrades').value = '';
    document.getElementById('addContractorForm').scrollIntoView({ behavior: 'smooth' });
}

function hideAddContractorForm() {
    document.getElementById('addContractorForm').classList.add('hidden');
}

function editContractor(contractorId) {
    const contractor = currentProject.contractors.find(c => c.id === contractorId);
    if (!contractor) return;

    document.getElementById('addContractorForm').classList.remove('hidden');
    document.getElementById('contractorFormTitle').textContent = 'Edit Contractor';
    document.getElementById('editContractorId').value = contractorId;
    document.getElementById('contractorName').value = contractor.name;
    document.getElementById('contractorAbbr').value = contractor.abbreviation;
    document.getElementById('contractorType').value = contractor.type;
    document.getElementById('contractorTrades').value = contractor.trades || '';
    document.getElementById('addContractorForm').scrollIntoView({ behavior: 'smooth' });
}

function saveContractor() {
    const name = document.getElementById('contractorName').value.trim();
    const abbr = document.getElementById('contractorAbbr').value.trim().toUpperCase();
    const type = document.getElementById('contractorType').value;
    const trades = document.getElementById('contractorTrades').value.trim();
    const editId = document.getElementById('editContractorId').value;

    if (!name || !abbr) {
        showToast('Name and abbreviation are required', 'error');
        return;
    }

    if (editId) {
        // Edit existing
        const contractor = currentProject.contractors.find(c => c.id === editId);
        if (contractor) {
            contractor.name = name;
            contractor.abbreviation = abbr;
            contractor.type = type;
            contractor.trades = trades;
        }
    } else {
        // Add new
        currentProject.contractors.push({
            id: generateId(),
            name,
            abbreviation: abbr,
            type,
            trades
        });
    }

    hideAddContractorForm();
    renderContractors();
    markDirty();
    showToast(editId ? 'Contractor updated' : 'Contractor added');
}

function deleteContractor(contractorId) {
    showDeleteModal('Delete this contractor?', () => {
        currentProject.contractors = currentProject.contractors.filter(c => c.id !== contractorId);
        renderContractors();
        markDirty();
        showToast('Contractor deleted');
    });
}

function setupContractorDragDrop() {
    const container = document.getElementById('contractorList');
    const items = container.querySelectorAll('[data-contractor-id]');

    items.forEach(item => {
        item.addEventListener('dragstart', handleDragStart);
        item.addEventListener('dragend', handleDragEnd);
        item.addEventListener('dragover', handleDragOver);
        item.addEventListener('drop', handleContractorDrop);
        item.addEventListener('dragleave', handleDragLeave);
    });
}

let draggedItem = null;

function handleDragStart(e) {
    draggedItem = this;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragEnd(e) {
    this.classList.remove('dragging');
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
}

function handleDragOver(e) {
    e.preventDefault();
    if (this !== draggedItem) {
        this.classList.add('drag-over');
    }
}

function handleDragLeave(e) {
    this.classList.remove('drag-over');
}

function handleContractorDrop(e) {
    e.preventDefault();
    this.classList.remove('drag-over');

    if (this !== draggedItem) {
        const draggedId = draggedItem.getAttribute('data-contractor-id');
        const targetId = this.getAttribute('data-contractor-id');

        const draggedIndex = currentProject.contractors.findIndex(c => c.id === draggedId);
        const targetIndex = currentProject.contractors.findIndex(c => c.id === targetId);

        if (draggedIndex > -1 && targetIndex > -1) {
            const [removed] = currentProject.contractors.splice(draggedIndex, 1);
            currentProject.contractors.splice(targetIndex, 0, removed);
            renderContractors();
            markDirty();
        }
    }
}

// ============ MODAL ============
function showDeleteModal(message, callback) {
    document.getElementById('deleteModalMessage').textContent = message;
    document.getElementById('deleteModal').classList.remove('hidden');
    deleteCallback = callback;
}

function closeDeleteModal() {
    document.getElementById('deleteModal').classList.add('hidden');
    deleteCallback = null;
}

function confirmDelete() {
    if (deleteCallback) {
        deleteCallback();
    }
    closeDeleteModal();
}

// ============ FILE IMPORT FUNCTIONS ============
function setupDropZone() {
    const dropZone = document.getElementById('dropZone');
    if (!dropZone) return;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
        document.body.addEventListener(eventName, preventDefaults, false);
    });

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.add('drag-active'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.remove('drag-active'), false);
    });

    dropZone.addEventListener('drop', handleFileDrop, false);
}

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

function handleFileDrop(e) {
    const dt = e.dataTransfer;
    const files = dt.files;
    handleFiles(files);
}

function handleFileSelect(e) {
    const files = e.target.files;
    handleFiles(files);
}

function handleFiles(files) {
    const validExtensions = ['.pdf', '.docx'];
    const newFiles = Array.from(files).filter(file => {
        const ext = '.' + file.name.split('.').pop().toLowerCase();
        if (!validExtensions.includes(ext)) {
            showToast(`Invalid file type: ${file.name}. Only PDF and DOCX allowed.`, 'error');
            return false;
        }
        // Check for duplicates
        if (selectedFiles.some(f => f.name === file.name && f.size === file.size)) {
            showToast(`File already added: ${file.name}`, 'warning');
            return false;
        }
        return true;
    });

    selectedFiles = [...selectedFiles, ...newFiles];
    renderFileList();
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    if (ext === 'pdf') {
        return '<i class="fas fa-file-pdf text-red-500"></i>';
    } else if (ext === 'docx' || ext === 'doc') {
        return '<i class="fas fa-file-word text-blue-500"></i>';
    }
    return '<i class="fas fa-file text-slate-400"></i>';
}

function renderFileList() {
    const listContainer = document.getElementById('selectedFilesList');
    const filesContainer = document.getElementById('filesContainer');
    const extractBtn = document.getElementById('extractBtn');

    if (selectedFiles.length === 0) {
        listContainer.classList.add('hidden');
        extractBtn.classList.add('hidden');
        return;
    }

    listContainer.classList.remove('hidden');
    extractBtn.classList.remove('hidden');

    filesContainer.innerHTML = selectedFiles.map((file, index) => `
        <div class="file-item flex items-center gap-3 bg-white p-3 rounded border border-slate-200">
            <span class="text-lg">${getFileIcon(file.name)}</span>
            <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-slate-800 truncate">${escapeHtml(file.name)}</p>
                <p class="text-xs text-slate-500">${formatFileSize(file.size)}</p>
            </div>
            <button onclick="removeFile(${index})" class="w-8 h-8 text-red-500 hover:bg-red-50 flex items-center justify-center rounded transition-colors" title="Remove file">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `).join('');
}

function removeFile(index) {
    selectedFiles.splice(index, 1);
    renderFileList();
}

function clearSelectedFiles() {
    selectedFiles = [];
    document.getElementById('fileInput').value = '';
    renderFileList();
}

// ============ LOGO UPLOAD FUNCTIONS ============
async function handleLogoSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Validate it's an image
    const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml', 'image/gif'];
    if (!validTypes.includes(file.type)) {
        showToast('Please select a valid image file (PNG, JPG, SVG, GIF)', 'error');
        event.target.value = '';
        return;
    }

    try {
        // 1. Compress image for local storage (thumbnail)
        const thumbnailBase64 = await compressImageToThumbnail(file);
        currentProject.logoThumbnail = thumbnailBase64;

        // Show preview immediately with thumbnail
        const logoUploadZone = document.getElementById('logoUploadZone');
        const logoPreviewArea = document.getElementById('logoPreviewArea');
        const logoPreviewImg = document.getElementById('logoPreviewImg');

        logoPreviewImg.src = thumbnailBase64;
        logoUploadZone.classList.add('hidden');
        logoPreviewArea.classList.remove('hidden');

        // 2. Upload original to Supabase Storage (async, non-blocking)
        const logoUrl = await uploadLogoToStorage(file, currentProject.id);
        if (logoUrl) {
            currentProject.logoUrl = logoUrl;
            showToast('Logo uploaded');
        } else {
            // Upload failed (offline) - still works with thumbnail
            currentProject.logoUrl = null;
            showToast('Logo saved locally (will sync when online)', 'warning');
        }

        // Clear old logo field if it exists
        delete currentProject.logo;

        markDirty();
    } catch (err) {
        console.error('[LOGO] Error processing logo:', err);
        showToast('Error processing logo', 'error');
    }

    // Clear the input so the same file can be selected again
    event.target.value = '';
}

async function removeLogo() {
    if (!currentProject) return;

    // Delete from Supabase Storage (async, non-blocking)
    deleteLogoFromStorage(currentProject.id);

    // Clear logo fields
    currentProject.logoThumbnail = null;
    currentProject.logoUrl = null;
    delete currentProject.logo; // Clean up old field if present

    const logoUploadZone = document.getElementById('logoUploadZone');
    const logoPreviewArea = document.getElementById('logoPreviewArea');
    const logoPreviewImg = document.getElementById('logoPreviewImg');

    logoPreviewImg.src = '';
    logoPreviewArea.classList.add('hidden');
    logoUploadZone.classList.remove('hidden');

    // Clear the file input
    document.getElementById('logoInput').value = '';

    markDirty();
    showToast('Logo removed');
}

function setupLogoDropZone() {
    const logoDropZone = document.getElementById('logoUploadZone');
    if (!logoDropZone) return;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        logoDropZone.addEventListener(eventName, preventDefaults, false);
    });

    ['dragenter', 'dragover'].forEach(eventName => {
        logoDropZone.addEventListener(eventName, () => logoDropZone.classList.add('drag-active'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        logoDropZone.addEventListener(eventName, () => logoDropZone.classList.remove('drag-active'), false);
    });

    logoDropZone.addEventListener('drop', handleLogoDrop, false);
}

function handleLogoDrop(e) {
    const dt = e.dataTransfer;
    const files = dt.files;

    if (files.length > 0) {
        // Create a fake event to reuse handleLogoSelect
        const fakeEvent = {
            target: {
                files: files,
                value: ''
            }
        };
        handleLogoSelect(fakeEvent);
    }
}

// ============ EXTRACTION FUNCTIONS ============
async function extractProjectData() {
    if (selectedFiles.length === 0) {
        showToast('Please select at least one file', 'error');
        return;
    }

    // Hide any previous banners
    hideExtractionBanners();

    // Show loading state
    setExtractButtonLoading(true);

    try {
        const formData = new FormData();
        selectedFiles.forEach(file => {
            formData.append('documents', file);
        });

        const response = await fetch(EXTRACT_WEBHOOK_URL, {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (result.success && result.data) {
            // Populate form with extracted data
            populateFormWithExtractedData(result.data);

            // Show success banner
            document.getElementById('extractionSuccessBanner').classList.remove('hidden');

            // Show extraction notes if any
            if (result.extractionNotes && result.extractionNotes.length > 0) {
                showExtractionNotes(result.extractionNotes);
            }

            // Clear selected files
            clearSelectedFiles();

            // Scroll to top of form
            document.getElementById('projectFormContainer').scrollIntoView({ behavior: 'smooth' });
        } else {
            // Show error banner
            const errorMsg = result.error || 'Failed to extract project data. Please try again.';
            document.getElementById('extractionErrorMessage').textContent = errorMsg;
            document.getElementById('extractionErrorBanner').classList.remove('hidden');
        }
    } catch (error) {
        console.error('Extraction error:', error);
        document.getElementById('extractionErrorMessage').textContent = 'Network error. Please check your connection and try again.';
        document.getElementById('extractionErrorBanner').classList.remove('hidden');
    } finally {
        setExtractButtonLoading(false);
    }
}

function setExtractButtonLoading(isLoading) {
    const btn = document.getElementById('extractBtn');
    const icon = document.getElementById('extractBtnIcon');
    const text = document.getElementById('extractBtnText');

    if (isLoading) {
        btn.disabled = true;
        icon.className = 'fas fa-spinner spin-animation';
        text.textContent = 'Extracting...';
    } else {
        btn.disabled = false;
        icon.className = 'fas fa-magic';
        text.textContent = 'Extract Project Data';
    }
}

function hideExtractionBanners() {
    document.getElementById('extractionSuccessBanner').classList.add('hidden');
    document.getElementById('extractionErrorBanner').classList.add('hidden');
}

function showExtractionNotes(notes) {
    const section = document.getElementById('extractionNotesSection');
    const list = document.getElementById('extractionNotesList');

    list.innerHTML = notes.map(note => `<li>${escapeHtml(note)}</li>`).join('');
    section.classList.remove('hidden');
}

function toggleExtractionNotes() {
    const content = document.getElementById('extractionNotesContent');
    const icon = document.getElementById('notesToggleIcon');

    content.classList.toggle('hidden');
    icon.style.transform = content.classList.contains('hidden') ? 'rotate(0deg)' : 'rotate(180deg)';
}

// ============ FORM POPULATION FROM EXTRACTED DATA ============
function populateFormWithExtractedData(data) {
    if (!currentProject) return;

    // Define field mappings: formFieldId -> dataFieldPath
    const fieldMappings = {
        'projectName': 'projectName',
        'noabProjectNo': 'noabProjectNo',
        'cnoSolicitationNo': 'cnoSolicitationNo',
        'location': 'location',
        'engineer': 'engineer',
        'primeContractor': 'primeContractor',
        'noticeToProceed': 'noticeToProceed',
        'reportDate': 'reportDate',
        'contractDuration': 'contractDuration',
        'expectedCompletion': 'expectedCompletion',
        'defaultStartTime': 'defaultStartTime',
        'defaultEndTime': 'defaultEndTime',
        'weatherDays': 'weatherDays',
        'contractDayNo': 'contractDayNo'
    };

    // Track missing fields
    const missingFields = [];

    // Populate each field
    Object.entries(fieldMappings).forEach(([fieldId, dataKey]) => {
        const input = document.getElementById(fieldId);
        if (!input) return;

        const value = data[dataKey];

        // Clear any previous missing field indicators
        clearMissingFieldIndicator(input);

        if (value === null || value === undefined || value === '') {
            // Mark as missing
            markFieldAsMissing(input);
            missingFields.push(fieldId);
            input.value = '';
        } else {
            input.value = value;
            // Update currentProject
            currentProject[dataKey] = value;
        }
    });

    // Process contractors
    if (data.contractors && Array.isArray(data.contractors)) {
        currentProject.contractors = data.contractors.map(contractor => {
            return {
                id: generateId(),
                name: contractor.name || '',
                abbreviation: contractor.abbreviation || generateAbbreviation(contractor.name),
                type: contractor.type || 'subcontractor',
                trades: contractor.trades || ''
            };
        });

        renderContractors();
    }

    // Setup input listeners to clear missing indicators when user types
    setupMissingFieldListeners();

    // Mark form as dirty after extraction
    markDirty();
}

function generateAbbreviation(name) {
    if (!name) return '';
    // Take first letter of each word, max 4 characters
    const words = name.split(/\s+/);
    if (words.length === 1) {
        return name.substring(0, 3).toUpperCase();
    }
    return words.map(w => w[0]).join('').substring(0, 4).toUpperCase();
}

function markFieldAsMissing(input) {
    input.classList.add('missing-field');

    // Create missing indicator if it doesn't exist
    const parent = input.parentElement;
    let indicator = parent.querySelector('.missing-indicator');
    if (!indicator) {
        indicator = document.createElement('p');
        indicator.className = 'missing-indicator mt-1';
        indicator.innerHTML = '<i class="fas fa-exclamation-circle mr-1"></i>Missing - please fill in';
        parent.appendChild(indicator);
    }
}

function clearMissingFieldIndicator(input) {
    input.classList.remove('missing-field');
    const parent = input.parentElement;
    const indicator = parent.querySelector('.missing-indicator');
    if (indicator) {
        indicator.remove();
    }
}

function setupMissingFieldListeners() {
    const inputs = document.querySelectorAll('.missing-field');
    inputs.forEach(input => {
        // Remove existing listener if any to avoid duplicates
        input.removeEventListener('input', handleMissingFieldInput);
        input.addEventListener('input', handleMissingFieldInput);
    });
}

function handleMissingFieldInput(e) {
    const input = e.target;
    if (input.value.trim() !== '') {
        clearMissingFieldIndicator(input);
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    // Initialize IndexedDB first for local-first storage
    try {
        await window.idb.initDB();
        console.log('[project-config] IndexedDB initialized');
    } catch (error) {
        console.error('[project-config] Failed to initialize IndexedDB:', error);
    }

    setupDropZone();
    setupLogoDropZone();

    // Check URL for project ID to edit, otherwise create new project
    const urlParams = new URLSearchParams(window.location.search);
    const projectId = urlParams.get('id');

    if (projectId) {
        // Edit existing project
        await loadProject(projectId);
        // Show delete button for existing projects
        const deleteBtn = document.getElementById('deleteProjectBtn');
        if (deleteBtn) {
            deleteBtn.classList.remove('hidden');
        }
    } else {
        // Create new project
        createNewProject();
    }

    // Setup dirty tracking after form is populated
    setupDirtyTracking();
});
