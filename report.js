document.addEventListener('DOMContentLoaded', () => {
    // --- Get references to ALL HTML elements ---
    const jiraUrlInput = document.getElementById('jira-url');
    const projectSelect = document.getElementById('project-select');
    const refreshBtn = document.getElementById('refresh-projects-btn');
    const jqlInput = document.getElementById('jql-query');
    const queryBtn = document.getElementById('query-btn');
    const errorMessageDiv = document.getElementById('error-message');
    const resultsContainer = document.getElementById('results-container');
    const resultsTableBody = document.querySelector('#results-table tbody');
    const extractBtn = document.getElementById('extract-btn');
    const timeTable = document.getElementById('time-results-table');
    const timeTableBody = timeTable.querySelector('tbody');
    const timeTableFooter = timeTable.querySelector('tfoot');
    const exportBtn = document.getElementById('export-btn');

    let queriedIssues = [];

    // --- (No changes below this line until the exportToExcel function) ---
    chrome.storage.local.get(['jiraUrl'], (result) => { if (result.jiraUrl) jiraUrlInput.value = result.jiraUrl; });
    jiraUrlInput.addEventListener('change', () => { chrome.storage.local.set({ jiraUrl: jiraUrlInput.value }); });
    // ... all other functions are the same ...

    // --- NEW: Function to export the Time Analysis table to an Excel file ---
    function exportToExcel() {
        // 1. Get user input for the filename using a prompt dialog
        const fileName = prompt("Please enter a name for your Excel file:", "Jira_In_Progress_Time");

        // 2. Validate the input. If user cancels or enters nothing, stop.
        if (!fileName || fileName.trim() === "") {
            return; // Exit the function gracefully
        }
        
        // 3. Prepare the Excel data
        const worksheet = XLSX.utils.table_to_sheet(timeTable);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "In Progress Time");
        
        // 4. Create the final filename with the .xlsx extension
        const finalFileName = `${fileName.trim()}.xlsx`;

        // 5. Trigger the file download with the user-provided name
        XLSX.writeFile(workbook, finalFileName);
    }


    // --- Hiding the full implementation of unchanged functions for brevity ---
    async function fetchFromJira(endpoint) { const JIRA_BASE_URL = jiraUrlInput.value; if (!JIRA_BASE_URL) { errorMessageDiv.textContent = 'Error: Please enter your Jira URL.'; return null; } try { const response = await fetch(`${JIRA_BASE_URL}/rest/api/3/${endpoint}`); if (!response.ok) throw new Error(`Jira API Error: ${response.status}`); return await response.json(); } catch (error) { errorMessageDiv.textContent = `Error: ${error.message}. Are you logged into Jira?`; return null; } }
    async function loadProjects() { errorMessageDiv.textContent = ''; projectSelect.innerHTML = '<option>Loading...</option>'; const projects = await fetchFromJira('project'); if (projects) { projectSelect.innerHTML = '<option value="">-- Select Project --</option>'; projects.sort((a, b) => a.name.localeCompare(b.name)).forEach(project => { const option = document.createElement('option'); option.value = project.key; option.textContent = `${project.name} (${project.key})`; projectSelect.appendChild(option); }); } }
    async function runQuery() { resultsTableBody.innerHTML = ''; timeTableBody.innerHTML = ''; timeTableFooter.innerHTML = ''; errorMessageDiv.textContent = ''; resultsContainer.classList.add('hidden'); queriedIssues = []; const projectKey = projectSelect.value; const userJql = jqlInput.value; if (!projectKey || !userJql) { errorMessageDiv.textContent = 'Please select a project and enter a JQL query.'; return; } queryBtn.textContent = 'Querying...'; queryBtn.disabled = true; const fullJql = `project = "${projectKey}" AND (${userJql})`; const fields = 'summary,assignee,parent'; const expand = 'changelog'; const endpoint = `search?jql=${encodeURIComponent(fullJql)}&fields=${fields}&expand=${expand}&maxResults=100`; const data = await fetchFromJira(endpoint); if (data && data.issues) { queriedIssues = data.issues; queriedIssues.forEach(issue => { const row = resultsTableBody.insertRow(); row.innerHTML = `<td><a href="${jiraUrlInput.value}/browse/${issue.key}" target="_blank">${issue.key}</a></td><td>${issue.fields.summary}</td><td>${issue.fields.parent ? issue.fields.parent.fields.summary : 'N/A'}</td><td>${issue.fields.assignee ? issue.fields.assignee.displayName : 'Unassigned'}</td>`; }); resultsContainer.classList.remove('hidden'); } queryBtn.textContent = 'Query'; queryBtn.disabled = false; }
    function extractTime() { const PRE_STATUS = 'To Do'; const START_STATUS = 'In Progress'; const END_STATUS = 'To Review'; timeTableBody.innerHTML = ''; timeTableFooter.innerHTML = ''; let grandTotalMs = 0; queriedIssues.forEach(issue => { let timeSegments = []; let currentStartTime = null; if (!issue.changelog || !issue.changelog.histories) return; const historyInOrder = issue.changelog.histories.slice().reverse(); for (const change of historyInOrder) { const statusChange = change.items.find(item => item.field === 'status'); if (statusChange) { const from = statusChange.fromString; const to = statusChange.toString; const timestamp = new Date(change.created); if (from === PRE_STATUS && to === START_STATUS) { currentStartTime = timestamp; } else if (from === START_STATUS && to === END_STATUS && currentStartTime !== null) { timeSegments.push({ startTime: currentStartTime, endTime: timestamp }); currentStartTime = null; } } } if (timeSegments.length > 0) { const assigneeName = issue.fields.assignee ? issue.fields.assignee.displayName : 'Unassigned'; timeSegments.forEach(segment => { const businessMs = calculateBusinessDurationMs(segment.startTime, segment.endTime); if (businessMs >= 0) { grandTotalMs += businessMs; const row = timeTableBody.insertRow(); row.innerHTML = `<td>${issue.key}</td><td>${issue.fields.summary}</td><td>${assigneeName}</td><td>${segment.startTime.toLocaleString()}</td><td>${segment.endTime.toLocaleString()}</td><td>${formatDuration(businessMs)}</td>`; } }); } }); if (timeTableBody.rows.length === 0) { const row = timeTableBody.insertRow(); row.innerHTML = `<td colspan="6">No matching time segments ('To Do' -> 'In Progress' -> 'To Review') were found.</td>`; } else { const totalRow = timeTableFooter.insertRow(); totalRow.innerHTML = `<td colspan="5" style="text-align: right;">Total time:</td><td>${formatDuration(grandTotalMs)}</td>`; } }
    function calculateBusinessDurationMs(start, end) { let totalMs = 0; let current = new Date(start); const WORK_START_HOUR = 9; const WORK_END_HOUR = 18; const LUNCH_START_HOUR = 12; const LUNCH_END_HOUR = 13; while (current < end) { const dayOfWeek = current.getDay(); if (dayOfWeek !== 0 && dayOfWeek !== 6) { const dayWorkStart = new Date(current).setHours(WORK_START_HOUR, 0, 0, 0); const dayWorkEnd = new Date(current).setHours(WORK_END_HOUR, 0, 0, 0); const dayLunchStart = new Date(current).setHours(LUNCH_START_HOUR, 0, 0, 0); const dayLunchEnd = new Date(current).setHours(LUNCH_END_HOUR, 0, 0, 0); const effectiveStart = Math.max(current.getTime(), dayWorkStart); const effectiveEnd = Math.min(end.getTime(), dayWorkEnd); let dailyMs = 0; if (effectiveEnd > effectiveStart) { dailyMs = effectiveEnd - effectiveStart; } if (dailyMs > 0) { const lunchOverlapStart = Math.max(effectiveStart, dayLunchStart); const lunchOverlapEnd = Math.min(effectiveEnd, dayLunchEnd); const lunchMs = lunchOverlapEnd - lunchOverlapStart; if (lunchMs > 0) { dailyMs -= lunchMs; } } totalMs += dailyMs; } current.setDate(current.getDate() + 1); current.setHours(0, 0, 0, 0); } return totalMs; }
    function formatDuration(ms) { if (ms <= 0) return '0.00 hours (0.00 days)'; const HOURS_PER_DAY = 8; const totalHours = ms / (1000 * 60 * 60); const totalBusinessDays = totalHours / HOURS_PER_DAY; return `${totalHours.toFixed(2)} hours (${totalBusinessDays.toFixed(2)} days)`; }
    
    // --- Event Listeners ---
    refreshBtn.addEventListener('click', loadProjects);
    queryBtn.addEventListener('click', runQuery);
    extractBtn.addEventListener('click', extractTime);
    exportBtn.addEventListener('click', exportToExcel);
});