# FieldVoice Pro - Shared JavaScript Modules

> Quick reference for AI-assisted development. Before adding a function to an HTML file, check if it exists here.

## Module Overview

| File | Purpose | Import After |
|------|---------|--------------|
| config.js | Supabase client + constants | Supabase CDN |
| storage-keys.js | localStorage keys + helpers (v6) | (standalone) |
| report-rules.js | Business logic validation (v6) | storage-keys.js |
| supabase-utils.js | Data converters (v6 schema) | config.js |
| sync-manager.js | Real-time entry backup and offline sync | supabase-utils.js |
| pwa-utils.js | Offline/PWA features | (standalone) |
| ui-utils.js | UI helpers | (standalone) |
| media-utils.js | Photo/GPS utilities | (standalone) |
| indexeddb-utils.js | IndexedDB operations | (standalone) |
| project-config.js | Project config page logic | All shared modules |
| sw.js | Service worker | (loaded by pwa-utils.js) |

---

## config.js

**Exports:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `supabaseClient`, `ACTIVE_PROJECT_KEY`

**Used by:** All pages with Supabase

**Import:**
```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="./js/config.js"></script>
```

---

## storage-keys.js

**Exports:**
- `STORAGE_KEYS` constant (USER_PROFILE, PROJECTS, ACTIVE_PROJECT_ID, CURRENT_REPORTS, AI_REPORTS, DRAFTS, SYNC_QUEUE, LAST_SYNC, DEVICE_ID)
- `getDeviceId()` - Get or create unique device identifier
- `getStorageItem(key)` - Read from localStorage with JSON parsing
- `setStorageItem(key, value)` - Write to localStorage with JSON stringify
- `removeStorageItem(key)` - Remove from localStorage
- `getCurrentReport(reportId)` - Get a report in progress
- `saveCurrentReport(reportId, data)` - Save a report in progress
- `deleteCurrentReport(reportId)` - Remove a report from current reports
- `getActiveProject()` - Get the currently active project
- `addToSyncQueue(operation)` - Add operation to offline sync queue
- `getSyncQueue()` - Get all pending sync operations
- `clearSyncQueue()` - Clear all pending sync operations

**Used by:** report-rules.js, and will be used by page modules

**Import:**
```html
<script src="./js/storage-keys.js"></script>
```

---

## report-rules.js

**Exports:**

*Constants:*
- `REPORT_STATUS` - Status enum (draft, submitted, finalized)
- `CAPTURE_MODE` - Capture mode enum (quick, guided)
- `GUIDED_SECTIONS` - Array of guided section identifiers
- `TOGGLE_SECTIONS` - Sections that can be toggled on/off

*Project eligibility:*
- `canStartNewReport(project)` - Check if project allows new reports
- `getProjectsEligibleForNewReport(projects)` - Filter projects that can have new reports
- `getReportsByUrgency(reports)` - Sort reports by urgency

*Status flow:*
- `canTransitionStatus(from, to)` - Validate status transitions
- `getNextValidStatus(currentStatus)` - Get next valid status
- `isReportEditable(report)` - Check if report can be edited
- `canReturnToNotes(report)` - Check if can go back to quick-interview

*Toggle rules:*
- `canChangeToggle(section, report)` - Check if toggle can be changed
- `getSectionToggleState(section, report)` - Get current toggle state

*Mode switching:*
- `canSwitchCaptureMode(report)` - Check if mode switch is allowed

*Date/time:*
- `getTodayDateString()` - Get today's date as string
- `isReportFromToday(report)` - Check if report is from today
- `isReportLate(report)` - Check if report is past due

*Validation:*
- `validateReportForAI(report)` - Validate before AI processing
- `validateReportForSubmit(report)` - Validate before final submission

**Used by:** Will be used by index.html, quick-interview.html

**Import:**
```html
<script src="./js/storage-keys.js"></script>
<script src="./js/report-rules.js"></script>
```

---

## supabase-utils.js

**Exports:**
- `fromSupabaseProject(row)` - Convert DB row → JS project object
- `toSupabaseProject(project)` - Convert JS project → DB row
- `fromSupabaseContractor(row)` - Convert DB row → JS contractor object
- `toSupabaseContractor(contractor, projectId)` - Convert JS contractor → DB row
- `fromSupabaseReport(row)` - Convert DB row → JS report object
- `toSupabaseReport(report, projectId, userSettings)` - Convert JS report → DB row
- `fromSupabaseEntry(row)` - Convert DB row → JS entry object
- `toSupabaseEntry(entry, reportId)` - Convert JS entry → DB row
- `fromSupabaseRawCapture(row)` - Convert DB row → JS raw capture object
- `toSupabaseRawCapture(report, reportId)` - Convert JS raw capture → DB row
- `fromSupabaseAIResponse(row)` - Convert DB row → JS AI response object
- `toSupabaseAIResponse(aiResponse, reportId)` - Convert JS AI response → DB row
- `fromSupabaseFinal(row)` - Convert DB row → JS final report object
- `toSupabaseFinal(final, reportId)` - Convert JS final report → DB row
- `fromSupabasePhoto(row)` - Convert DB row → JS photo object
- `toSupabasePhoto(photo, reportId)` - Convert JS photo → DB row

**Note:** Equipment converters removed in v6 — equipment now entered per-report

**Used by:** index, quick-interview, report, finalreview, project-config

**Import:** After config.js
```html
<script src="./js/supabase-utils.js"></script>
```

---

## sync-manager.js

**Purpose:** Real-time entry backup and offline sync

**Exports:**
- `queueEntryBackup(reportId, entry)` - Debounced entry backup
- `backupEntry(reportId, entry)` - Immediate entry backup
- `backupAllEntries(reportId, entries)` - Batch backup
- `deleteEntry(reportId, localId)` - Soft delete entry
- `syncReport(report, projectId)` - Create/update report in Supabase
- `syncRawCapture(captureData, reportId)` - Sync raw capture
- `processOfflineQueue()` - Process pending operations
- `initSyncManager()` - Initialize listeners
- `destroySyncManager()` - Cleanup
- `getPendingSyncCount()` - Get queue length

**Used by:** quick-interview.js, report.js

**Import:** After storage-keys.js and supabase-utils.js
```html
<script src="./js/sync-manager.js"></script>
```

---

## pwa-utils.js

**Exports:**
- `initPWA(options)` - Initialize all PWA features

**Options:**
```javascript
initPWA();                                    // Basic usage
initPWA({ onOnline: callback });              // Custom online handler
initPWA({ onOffline: callback });             // Custom offline handler
initPWA({ skipServiceWorker: true });         // Skip SW registration
```

**Used by:** Most pages (9 total)

**Import:**
```html
<script src="./js/pwa-utils.js"></script>
<script>initPWA();</script>
```

---

## ui-utils.js

**Exports:**
- `escapeHtml(str)` - XSS-safe HTML escaping
- `generateId()` - UUID generation
- `showToast(message, type)` - Toast notifications (success/warning/error/info)
- `formatDate(dateStr, format)` - Date formatting (short/long/numeric)
- `formatTime(timeStr)` - Time formatting
- `autoExpand(textarea, minHeight, maxHeight)` - Auto-resize textarea
- `initAutoExpand(textarea, minHeight, maxHeight)` - Setup auto-expand listeners
- `initAllAutoExpandTextareas(minHeight, maxHeight)` - Init all .auto-expand textareas

**Used by:** Most pages

**Import:**
```html
<script src="./js/ui-utils.js"></script>
```

---

## media-utils.js

**Exports:**
- `readFileAsDataURL(file)` - Read file as base64
- `dataURLtoBlob(dataURL)` - Convert data URL to Blob
- `compressImage(dataUrl, maxWidth, quality)` - Compress image
- `compressImageToThumbnail(dataUrl, maxWidth, quality)` - Compress image to thumbnail size
- `uploadLogoToStorage(projectId, imageDataUrl)` - Upload logo to Supabase storage
- `deleteLogoFromStorage(projectId)` - Delete logo from Supabase storage
- `getHighAccuracyGPS(onWeakSignal)` - Get GPS coordinates

**Used by:** quick-interview.html, project-config.html

**Import:**
```html
<script src="./js/media-utils.js"></script>
```

---

## project-config.js

**Purpose:** Page-specific logic for project-config.html

**Exports:** None (page-specific, attaches to DOM)

**Contains:**
- Project CRUD operations
- Contractor CRUD operations
- File import (PDF/DOCX extraction)
- Logo upload
- Drag-drop file handling

**Note:** Equipment management removed in v6 — equipment entered per-report

**Import:**
```html
<script src="./js/project-config.js"></script>
```

---

## sw.js (Service Worker)

**Purpose:** Handles offline caching and network requests.

**Not imported directly** - Loaded via `pwa-utils.js` → `initPWA()`

**Cache version:** Check `CACHE_VERSION` constant when debugging cache issues.

---

## Rules for Claude Code

1. **Before adding a function to HTML** → Check if it exists here
2. **Function needed in 2+ files** → It belongs in /js/
3. **Never duplicate** → Supabase config, converters, or utilities
4. **New shared function?** → Add to appropriate module, update this README
5. **New modules (storage-keys.js, report-rules.js) are foundational** → Import them when needed
6. **Page-specific modules (project-config.js) don't export** → They attach to window/DOM
7. **Equipment is no longer stored at project level** → Equipment entered per-report in quick-interview
