// FieldVoice Pro - Drafts Page Logic
// Local draft management (localStorage only, no Supabase)

// ============ STATE ============
let pendingDeleteKey = null;

// ============ DRAFT LOADING (localStorage CURRENT_REPORTS) ============
function getAllDrafts() {
    try {
        const stored = localStorage.getItem(STORAGE_KEYS.CURRENT_REPORTS);
        if (!stored) return [];

        const reportsObj = JSON.parse(stored);
        // CURRENT_REPORTS is an object keyed by report key (projectId_date)
        const drafts = [];

        for (const [key, report] of Object.entries(reportsObj)) {
            if (report && typeof report === 'object') {
                drafts.push({
                    key: key,
                    projectId: report.project?.id || report.projectId || null,
                    projectName: report.project?.projectName || report.projectName || 'Unknown Project',
                    reportDate: report.overview?.date || report.reportDate || key.split('_').pop(),
                    captureMode: report.meta?.captureMode || 'guided',
                    lastSaved: report.meta?.lastSaved || report.lastSaved || new Date().toISOString(),
                    status: report.meta?.status || 'draft',
                    data: report
                });
            }
        }

        // Sort by lastSaved descending
        drafts.sort((a, b) => new Date(b.lastSaved) - new Date(a.lastSaved));

        console.log('[DRAFTS] Loaded drafts:', drafts.length);
        return drafts;
    } catch (e) {
        console.error('[DRAFTS] Failed to parse drafts:', e);
        return [];
    }
}

function deleteDraftByKey(key) {
    try {
        const stored = localStorage.getItem(STORAGE_KEYS.CURRENT_REPORTS);
        if (!stored) return;

        const reportsObj = JSON.parse(stored);
        if (reportsObj[key]) {
            delete reportsObj[key];
            localStorage.setItem(STORAGE_KEYS.CURRENT_REPORTS, JSON.stringify(reportsObj));
            console.log('[DRAFTS] Deleted draft:', key);
        }
    } catch (e) {
        console.error('[DRAFTS] Failed to delete draft:', e);
    }
}

// ============ UI HELPERS ============
function getStatusBadge(status) {
    switch (status) {
        case 'draft':
            return {
                text: 'Draft',
                bgColor: 'bg-dot-slate',
                borderColor: 'border-dot-slate'
            };
        case 'in_progress':
            return {
                text: 'In Progress',
                bgColor: 'bg-dot-blue',
                borderColor: 'border-dot-blue'
            };
        case 'pending':
            return {
                text: 'Pending',
                bgColor: 'bg-dot-orange',
                borderColor: 'border-dot-orange'
            };
        default:
            return {
                text: status || 'Draft',
                bgColor: 'bg-slate-400',
                borderColor: 'border-slate-400'
            };
    }
}

function formatRelativeTime(dateStr) {
    try {
        const date = new Date(dateStr);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return date.toLocaleDateString();
    } catch (e) {
        return dateStr;
    }
}

// ============ RENDER FUNCTIONS ============
function renderDrafts() {
    const drafts = getAllDrafts();
    const container = document.getElementById('draftsList');
    const countEl = document.getElementById('queueCount');

    // Update count
    if (drafts.length === 0) {
        countEl.textContent = 'No drafts';
    } else if (drafts.length === 1) {
        countEl.textContent = '1 draft';
    } else {
        countEl.textContent = `${drafts.length} drafts`;
    }

    // Render empty state or drafts
    if (drafts.length === 0) {
        container.innerHTML = `
            <div class="bg-white border-2 border-slate-200 p-8 text-center">
                <div class="w-20 h-20 bg-slate-100 border-2 border-slate-300 flex items-center justify-center mx-auto mb-4">
                    <i class="fas fa-inbox text-slate-400 text-3xl"></i>
                </div>
                <p class="text-lg font-bold text-slate-700 mb-2">No Drafts</p>
                <p class="text-sm text-slate-500 mb-6">Start a new report to create a draft.</p>
                <a href="index.html" class="inline-block bg-dot-navy hover:bg-dot-blue text-white px-6 py-3 font-bold uppercase tracking-wide transition-colors">
                    <i class="fas fa-arrow-left mr-2"></i>Back to Dashboard
                </a>
            </div>
        `;
        return;
    }

    // Render draft cards
    container.innerHTML = drafts.map((draft) => {
        const status = getStatusBadge(draft.status);

        return `
            <div class="bg-white border-l-4 ${status.borderColor} p-4 mb-4">
                <div class="flex items-start justify-between mb-3">
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 mb-1">
                            <span class="text-[10px] font-bold ${status.bgColor} text-white px-2 py-0.5 uppercase">${status.text}</span>
                            <span class="text-[10px] font-bold text-slate-400 uppercase">${escapeHtml(draft.captureMode)} mode</span>
                        </div>
                        <p class="font-bold text-slate-800 truncate">${escapeHtml(draft.projectName)}</p>
                        <p class="text-sm text-slate-600">${formatDate(draft.reportDate)}</p>
                    </div>
                    <div class="text-right shrink-0 ml-4">
                        <p class="text-xs text-slate-400">Last saved</p>
                        <p class="text-sm text-slate-600">${formatRelativeTime(draft.lastSaved)}</p>
                    </div>
                </div>

                <div class="flex gap-2">
                    <button onclick="continueEditing('${escapeHtml(draft.key)}')" class="flex-1 p-3 bg-dot-navy hover:bg-dot-blue text-white text-sm font-bold uppercase transition-colors">
                        <i class="fas fa-edit mr-1"></i>Continue
                    </button>
                    <button onclick="confirmDelete('${escapeHtml(draft.key)}')" class="p-3 border-2 border-red-300 text-red-600 hover:bg-red-50 transition-colors">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// ============ ACTIONS ============
function continueEditing(key) {
    const drafts = getAllDrafts();
    const draft = drafts.find(d => d.key === key);

    if (!draft) {
        showToast('Draft not found', 'error');
        return;
    }

    // Set active project
    if (draft.projectId) {
        setStorageItem(STORAGE_KEYS.ACTIVE_PROJECT_ID, draft.projectId);
    }

    // Navigate to quick-interview - it will load from CURRENT_REPORTS automatically
    window.location.href = 'quick-interview.html';
}

// ============ DELETE MODAL ============
function confirmDelete(key) {
    const drafts = getAllDrafts();
    const draft = drafts.find(d => d.key === key);

    if (!draft) return;

    pendingDeleteKey = key;
    document.getElementById('deleteModalProject').textContent = draft.projectName || 'Unknown Project';
    document.getElementById('deleteModal').classList.remove('hidden');

    // Set up confirm button
    document.getElementById('confirmDeleteBtn').onclick = () => {
        deleteDraft(pendingDeleteKey);
        closeDeleteModal();
    };
}

function closeDeleteModal() {
    document.getElementById('deleteModal').classList.add('hidden');
    pendingDeleteKey = null;
}

function deleteDraft(key) {
    deleteDraftByKey(key);
    renderDrafts();
    showToast('Draft deleted', 'success');
}

// ============ INIT ============
document.addEventListener('DOMContentLoaded', () => {
    renderDrafts();
});

// ============ EXPOSE TO WINDOW FOR ONCLICK HANDLERS ============
window.continueEditing = continueEditing;
window.confirmDelete = confirmDelete;
window.closeDeleteModal = closeDeleteModal;
window.renderDrafts = renderDrafts;
