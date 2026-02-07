// FieldVoice Pro - UI Utility Functions
// Shared helpers for escaping, ID generation, formatting, and notifications
// Single source of truth - do not duplicate in HTML files

/**
 * Escape HTML to prevent XSS
 * @param {string} str - Raw string
 * @returns {string} HTML-safe string
 */
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Generate unique ID using crypto API
 * @returns {string} UUID string
 */
function generateId() {
    return crypto.randomUUID();
}

/**
 * Show toast notification
 * @param {string} message - Message to display
 * @param {string} type - 'success', 'warning', 'error', or 'info'
 */
function showToast(message, type = 'success') {
    // Remove existing toast if any
    const existing = document.querySelector('.toast-msg');
    if (existing) existing.remove();

    const colors = {
        success: 'bg-safety-green',
        warning: 'bg-dot-orange',
        error: 'bg-red-600',
        info: 'bg-dot-blue'
    };

    const icons = {
        success: 'fa-check',
        warning: 'fa-exclamation-triangle',
        error: 'fa-times-circle',
        info: 'fa-info-circle'
    };

    const toast = document.createElement('div');
    toast.className = `toast-msg fixed bottom-24 left-1/2 -translate-x-1/2 ${colors[type] || colors.success} text-white px-6 py-3 font-bold text-sm shadow-lg z-50 flex items-center gap-2 uppercase`;
    toast.innerHTML = `<i class="fas ${icons[type] || icons.success}"></i>${escapeHtml(message)}`;
    document.body.appendChild(toast);

    setTimeout(() => toast.remove(), 3000);
}

/**
 * Format date for display
 * @param {string} dateStr - Date string (ISO format or date-only)
 * @param {string} format - 'short' (Mon, Jan 1, 2026), 'long' (Monday, Jan 1, 2026), or 'numeric' (01/01/2026)
 * @returns {string} Formatted date string
 */
function formatDate(dateStr, format = 'short') {
    if (!dateStr) return 'Unknown date';

    // Add time component to avoid timezone issues with date-only strings
    const date = dateStr.includes('T') ? new Date(dateStr) : new Date(dateStr + 'T12:00:00');

    if (isNaN(date.getTime())) return dateStr;

    const options = {
        short: { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' },
        long: { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' },
        numeric: { month: '2-digit', day: '2-digit', year: 'numeric' }
    };

    return date.toLocaleDateString('en-US', options[format] || options.short);
}

/**
 * Format time for display
 * @param {string} timeStr - Time string (ISO format or HH:MM format)
 * @returns {string} Formatted time string (e.g., "6:00 AM")
 */
function formatTime(timeStr) {
    if (!timeStr) return '';

    // Handle already formatted time (e.g., "6:00 AM")
    if (timeStr.includes('AM') || timeStr.includes('PM')) {
        return timeStr;
    }

    // Handle ISO format
    if (timeStr.includes('T')) {
        const date = new Date(timeStr);
        return date.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    }

    // Handle 24-hour format (e.g., "06:00")
    const parts = timeStr.split(':');
    if (parts.length < 2) return timeStr;

    const hours = parseInt(parts[0], 10);
    const minutes = parts[1];
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;

    return `${displayHours}:${minutes} ${ampm}`;
}

// ============ AUTO-EXPAND TEXTAREAS ============

/**
 * Auto-expand textarea to fit content
 * @param {HTMLTextAreaElement} textarea - The textarea element
 * @param {number} minHeight - Minimum height in pixels (default 72, ~3 lines)
 * @param {number} maxHeight - Maximum height in pixels (default 400)
 */
function autoExpand(textarea, minHeight = 72, maxHeight = 400) {
    if (!textarea) return;

    // Reset height to recalculate
    textarea.style.height = 'auto';

    // Calculate new height
    const newHeight = Math.max(minHeight, Math.min(textarea.scrollHeight, maxHeight));
    textarea.style.height = newHeight + 'px';

    // Toggle scrollable class based on whether content exceeds max
    if (textarea.scrollHeight > maxHeight) {
        textarea.classList.add('scrollable');
    } else {
        textarea.classList.remove('scrollable');
    }
}

/**
 * Initialize auto-expand behavior on a textarea
 * @param {HTMLTextAreaElement} textarea - The textarea element
 * @param {number} minHeight - Minimum height in pixels (default 72)
 * @param {number} maxHeight - Maximum height in pixels (default 400)
 */
function initAutoExpand(textarea, minHeight = 72, maxHeight = 400) {
    if (!textarea || textarea.dataset.autoExpandInit) return;

    textarea.dataset.autoExpandInit = 'true';

    // Add the auto-expand class if not already present
    if (!textarea.classList.contains('auto-expand')) {
        textarea.classList.add('auto-expand');
    }

    // Create bound resize function with the specified dimensions
    const resize = () => autoExpand(textarea, minHeight, maxHeight);

    // Listen for input events (typing, dictation, paste)
    textarea.addEventListener('input', resize);

    // Listen for change events (programmatic changes)
    textarea.addEventListener('change', resize);

    // On focus, expand to fit content
    textarea.addEventListener('focus', resize);

    // On blur, collapse to content size (remove empty space)
    textarea.addEventListener('blur', () => {
        // Small delay to ensure content is finalized
        setTimeout(resize, 10);
    });

    // Initial sizing
    resize();
}

/**
 * Initialize auto-expand on all textareas with .auto-expand class
 * @param {number} minHeight - Minimum height in pixels (default 72)
 * @param {number} maxHeight - Maximum height in pixels (default 400)
 */
function initAllAutoExpandTextareas(minHeight = 72, maxHeight = 400) {
    document.querySelectorAll('textarea.auto-expand').forEach(textarea => {
        initAutoExpand(textarea, minHeight, maxHeight);
    });
}
