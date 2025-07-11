document.addEventListener('DOMContentLoaded', () => {
    // --- Get references to ALL HTML elements ---
    const jiraUrlInput = document.getElementById('jira-url');
    const projectSelect = document.getElementById('project-select');
    const refreshBtn = document.getElementById('refresh-projects-btn');
    const sprintNumberInput = document.getElementById('sprint-number');
    const getListBtn = document.getElementById('get-list-btn');
    const errorMessageDiv = document.getElementById('error-message');
    const resultsContainer = document.getElementById('results-container');
    const resultsTableBody = document.querySelector('#results-table tbody');
    const extractBtn = document.getElementById('extract-btn');
    const timeTable = document.getElementById('time-results-table');
    const timeTableBody = timeTable.querySelector('tbody');
    const timeTableFooter = timeTable.querySelector('tfoot');
    const exportBtn = document.getElementById('export-btn');
    const manualQueryRadio = document.getElementById('manual-query-radio');
    const buildQueryRadio = document.getElementById('build-query-radio');
    const manualQueryContainer = document.getElementById('manual-query-container');
    const buildQueryContainer = document.getElementById('build-query-container');
    const jqlInput = document.getElementById('jql-input');
    const runManualQueryBtn = document.getElementById('run-manual-query-btn');
    const developerInput = document.getElementById('developer-input');
    const developerSuggestionsContainer = document.getElementById('developer-suggestions-container');

    let queriedIssues = [];
    let allUsers = [];
    let selectedDeveloper = null;

    // --- Load and Save Jira URL ---
    chrome.storage.local.get(['jiraUrl'], (result) => { if (result.jiraUrl) jiraUrlInput.value = result.jiraUrl; });
    jiraUrlInput.addEventListener('change', () => { chrome.storage.local.set({ jiraUrl: jiraUrlInput.value }); });

    // --- Helper function to fetch data ---
    async function fetchFromJira(endpoint) {
        const JIRA_BASE_URL = jiraUrlInput.value;
        if (!JIRA_BASE_URL) {
            errorMessageDiv.textContent = 'Error: Please enter your Jira URL.';
            return null;
        }
        try {
            const response = await fetch(`${JIRA_BASE_URL}/rest/api/3/${endpoint}`);
            if (!response.ok) throw new Error(`Jira API Error: ${response.status}`);
            return await response.json();
        } catch (error) {
            errorMessageDiv.textContent = `Error: ${error.message}. Are you logged into Jira?`;
            return null;
        }
    }

    // --- Function to load projects ---
    async function loadProjects() {
        errorMessageDiv.textContent = '';
        projectSelect.innerHTML = '<option>Loading...</option>';
        developerInput.value = '';
        developerInput.disabled = true;
        developerInput.placeholder = 'Select a project first';
        allUsers = [];
        const projects = await fetchFromJira('project');
        if (projects) {
            projectSelect.innerHTML = '<option value="">-- Select a project --</option>';
            projects.sort((a, b) => a.name.localeCompare(b.name)).forEach(project => {
                const option = document.createElement('option');
                option.value = project.key;
                option.textContent = `${project.name} (${project.key})`;
                projectSelect.appendChild(option);
            });
        }
    }

    // --- Function to load users ---
    async function loadUsers(projectKey) {
        allUsers = [];
        selectedDeveloper = null;
        developerInput.value = '';
        developerSuggestionsContainer.classList.add('hidden');

        if (!projectKey) {
            developerInput.placeholder = 'Select a project first...';
            developerInput.disabled = true;
            return;
        }
        developerInput.placeholder = 'Loading users...';
        developerInput.disabled = true;
        const users = await fetchFromJira(`users/search?maxResults=1000`);
        if (users && Array.isArray(users)) {
            allUsers = users.filter(user => user.active).sort((a, b) => a.displayName.localeCompare(b.displayName));
            developerInput.placeholder = 'Start typing a name...';
        } else {
            developerInput.placeholder = 'Could not load users';
        }
        developerInput.disabled = false;
    }

    // --- Event listener for the autocomplete input ---
    developerInput.addEventListener('input', () => {
        const inputText = developerInput.value.toLowerCase();
        developerSuggestionsContainer.innerHTML = '';
        selectedDeveloper = null;

        if (!inputText) {
            developerSuggestionsContainer.classList.add('hidden');
            return;
        }
        const filteredUsers = allUsers.filter(user =>
            user.displayName.toLowerCase().includes(inputText)
        );
        if (filteredUsers.length > 0) {
            filteredUsers.forEach(user => {
                const item = document.createElement('div');
                item.classList.add('suggestion-item');
                item.textContent = user.displayName;
                item.addEventListener('click', () => {
                    selectedDeveloper = user;
                    developerInput.value = user.displayName;
                    developerSuggestionsContainer.innerHTML = '';
                    developerSuggestionsContainer.classList.add('hidden');
                });
                developerSuggestionsContainer.appendChild(item);
            });
            developerSuggestionsContainer.classList.remove('hidden');
        } else {
            developerSuggestionsContainer.classList.add('hidden');
        }
    });

    // --- Hide suggestions if user clicks elsewhere ---
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.autocomplete-container')) {
            developerSuggestionsContainer.classList.add('hidden');
        }
    });
    
    // --- Central function to execute any JQL query ---
    async function executeJqlQuery(jql, buttonToUpdate) {
        resultsTableBody.innerHTML = ''; timeTableBody.innerHTML = ''; timeTableFooter.innerHTML = ''; errorMessageDiv.textContent = ''; resultsContainer.classList.add('hidden'); queriedIssues = [];
        const projectKey = projectSelect.value;
        if (!projectKey) {
            errorMessageDiv.textContent = 'Please select a project first.';
            return;
        }
        const fullJql = `project = "${projectKey}" AND (${jql})`;
        buttonToUpdate.textContent = 'Getting list...';
        buttonToUpdate.disabled = true;
        const fields = 'summary,assignee,parent';
        const expand = 'changelog';
        const endpoint = `search?jql=${encodeURIComponent(fullJql)}&fields=${fields}&expand=${expand}&maxResults=100`;
        const data = await fetchFromJira(endpoint);
        if (data && data.issues) {
            queriedIssues = data.issues;
            queriedIssues.forEach(issue => {
                const row = resultsTableBody.insertRow();
                row.innerHTML = `<td><a href="${jiraUrlInput.value}/browse/${issue.key}" target="_blank">${issue.key}</a></td><td>${issue.fields.summary}</td><td>${issue.fields.parent ? issue.fields.parent.fields.summary : 'N/A'}</td><td>${issue.fields.assignee ? issue.fields.assignee.displayName : 'Unassigned'}</td>`;
            });
            resultsContainer.classList.remove('hidden');
        } else if (data) {
            errorMessageDiv.textContent = "Query ran successfully, but returned 0 issues.";
        }
        buttonToUpdate.textContent = "Show Ticket List";
        buttonToUpdate.disabled = false;
    }

    // --- Handler for the builder button ---
    function handleBuildQuery() {
        const sprintNumber = sprintNumberInput.value;
        if (!sprintNumber || !selectedDeveloper) {
            errorMessageDiv.textContent = 'Please enter a sprint number and choose a developer from the list.';
            return;
        }
        const customFieldName = "Primary Developer";
        const generatedJql = `sprint = "Dev Team Sprint ${sprintNumber}" AND "${customFieldName}" = "${selectedDeveloper.accountId}"`;
        executeJqlQuery(generatedJql, getListBtn);
    }

    // --- Handler for the manual query button ---
    function handleManualQuery() {
        const manualJql = jqlInput.value;
        if (!manualJql) {
            errorMessageDiv.textContent = 'Please enter a JQL query.';
            return;
        }
        executeJqlQuery(manualJql, runManualQueryBtn);
    }

    // --- Function to toggle between UI modes ---
    function toggleQueryMode() {
        if (manualQueryRadio.checked) {
            manualQueryContainer.classList.remove('hidden');
            buildQueryContainer.classList.add('hidden');
        } else {
            manualQueryContainer.classList.add('hidden');
            buildQueryContainer.classList.remove('hidden');
        }
    }

    // --- Time Extraction Logic ---
    function extractTime() {
        const PRE_STATUS = 'To Do';
        const START_STATUS = 'In Progress';
        const END_STATUS = 'To Review';
        timeTableBody.innerHTML = '';
        timeTableFooter.innerHTML = '';
        let grandTotalMs = 0;
        queriedIssues.forEach(issue => {
            let timeSegments = [];
            let currentStartTime = null;
            if (!issue.changelog || !issue.changelog.histories) return;
            const historyInOrder = issue.changelog.histories.slice().reverse();
            for (const change of historyInOrder) {
                const statusChange = change.items.find(item => item.field === 'status');
                if (statusChange) {
                    const from = statusChange.fromString;
                    const to = statusChange.toString;
                    const timestamp = new Date(change.created);
                    if (from === PRE_STATUS && to === START_STATUS) {
                        currentStartTime = timestamp;
                    } else if (from === START_STATUS && to === END_STATUS && currentStartTime !== null) {
                        timeSegments.push({ startTime: currentStartTime, endTime: timestamp });
                        currentStartTime = null;
                    }
                }
            }
            if (timeSegments.length > 0) {
                const assigneeName = issue.fields.assignee ? issue.fields.assignee.displayName : 'Unassigned';
                timeSegments.forEach(segment => {
                    const businessMs = calculateBusinessDurationMs(segment.startTime, segment.endTime);
                    if (businessMs >= 0) {
                        grandTotalMs += businessMs;
                        const row = timeTableBody.insertRow();
                        
                        // ================== THE FIX IS HERE ==================
                        row.innerHTML = `
                            <td><a href="${jiraUrlInput.value}/browse/${issue.key}" target="_blank">${issue.key}</a></td>
                            <td>${issue.fields.summary}</td>
                            <td>${assigneeName}</td>
                            <td>${segment.startTime.toLocaleString()}</td>
                            <td>${segment.endTime.toLocaleString()}</td>
                            <td>${formatDuration(businessMs)}</td>
                        `;
                        // =======================================================
                    }
                });
            }
        });
        if (timeTableBody.rows.length === 0) {
            const row = timeTableBody.insertRow();
            row.innerHTML = `<td colspan="6">No matching time segments ('To Do' -> 'In Progress' -> 'To Review') were found.</td>`;
        } else {
            const totalRow = timeTableFooter.insertRow();
            totalRow.innerHTML = `<td colspan="5" style="text-align: right;">Total time:</td><td>${formatDuration(grandTotalMs)}</td>`;
        }
    }

    // --- Export to Excel ---
    function exportToExcel() {
        const fileName = prompt("Please enter a name for your Excel file:", "Jira_In_Progress_Time");
        if (!fileName || fileName.trim() === "") { return; }
        const worksheet = XLSX.utils.table_to_sheet(timeTable);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "In Progress Time");
        const finalFileName = `${fileName.trim()}.xlsx`;
        XLSX.writeFile(workbook, finalFileName);
    }

    // --- Business Time Calculation ---
    function calculateBusinessDurationMs(start, end) {
        let totalMs = 0;
        let current = new Date(start);
        const WORK_START_HOUR = 9;
        const WORK_END_HOUR = 18;
        const LUNCH_START_HOUR = 12;
        const LUNCH_END_HOUR = 13;
        while (current < end) {
            const dayOfWeek = current.getDay();
            if (dayOfWeek !== 0 && dayOfWeek !== 6) {
                const dayWorkStart = new Date(current).setHours(WORK_START_HOUR, 0, 0, 0);
                const dayWorkEnd = new Date(current).setHours(WORK_END_HOUR, 0, 0, 0);
                const dayLunchStart = new Date(current).setHours(LUNCH_START_HOUR, 0, 0, 0);
                const dayLunchEnd = new Date(current).setHours(LUNCH_END_HOUR, 0, 0, 0);
                const effectiveStart = Math.max(current.getTime(), dayWorkStart);
                const effectiveEnd = Math.min(end.getTime(), dayWorkEnd);
                let dailyMs = 0;
                if (effectiveEnd > effectiveStart) { dailyMs = effectiveEnd - effectiveStart; }
                if (dailyMs > 0) {
                    const lunchOverlapStart = Math.max(effectiveStart, dayLunchStart);
                    const lunchOverlapEnd = Math.min(effectiveEnd, dayLunchEnd);
                    const lunchMs = lunchOverlapEnd - lunchOverlapStart;
                    if (lunchMs > 0) { dailyMs -= lunchMs; }
                }
                totalMs += dailyMs;
            }
            current.setDate(current.getDate() + 1);
            current.setHours(0, 0, 0, 0);
        }
        return totalMs;
    }

    // --- Format Duration ---
    function formatDuration(ms) {
        if (ms <= 0) return '0.00 hours (0.00 days)';
        const HOURS_PER_DAY = 8;
        const totalHours = ms / (1000 * 60 * 60);
        const totalBusinessDays = totalHours / HOURS_PER_DAY;
        return `${totalHours.toFixed(2)} hours (${totalBusinessDays.toFixed(2)} days)`;
    }

    // --- Event Listeners ---
    refreshBtn.addEventListener('click', loadProjects);
    projectSelect.addEventListener('change', () => loadUsers(projectSelect.value));
    getListBtn.addEventListener('click', handleBuildQuery);
    runManualQueryBtn.addEventListener('click', handleManualQuery);
    manualQueryRadio.addEventListener('change', toggleQueryMode);
    buildQueryRadio.addEventListener('change', toggleQueryMode);
    extractBtn.addEventListener('click', extractTime);
    exportBtn.addEventListener('click', exportToExcel);

});