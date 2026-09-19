// Jira Cloud REST API v3 integration. Credentials stay server-side only
// (section: "The browser must NEVER directly communicate with Jira or
// Confluence using credentials or API tokens").

function authHeader() {
    const pair = `${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`;
    return `Basic ${Buffer.from(pair).toString('base64')}`;
}

function baseUrl() {
    return (process.env.JIRA_BASE_URL || '').replace(/\/$/, '');
}

function isConfigured() {
    return Boolean(process.env.JIRA_BASE_URL && process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN && process.env.JIRA_PROJECT_KEY);
}

async function jiraFetch(path, options = {}) {
    const res = await fetch(`${baseUrl()}${path}`, {
        ...options,
        headers: {
            Authorization: authHeader(),
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...(options.headers || {}),
        },
    });
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    if (!res.ok) {
        const message = body?.errorMessages?.join('; ') || body?.errors ? JSON.stringify(body.errors) : `Jira API error (${res.status})`;
        throw new Error(message);
    }
    return body;
}

// Plain text -> Atlassian Document Format paragraph, the body format Jira
// Cloud v3 issue descriptions and comments require.
function toAdf(text) {
    return {
        type: 'doc',
        version: 1,
        content: text.split('\n').filter(Boolean).map((line) => ({
            type: 'paragraph',
            content: [{ type: 'text', text: line }],
        })),
    };
}

// Creates a Task issue in the configured Jira project for a mini-project.
// Returns { key, id }.
async function createJiraIssue(project) {
    const summary = `[${project.project_code}] ${project.title}`;
    const description = toAdf(
        `ApniLeap Mini-Project: ${project.title}\n` +
        `Project ID: ${project.project_code}\n` +
        `Team ID: ${project.team_id || ''}\n` +
        `Artefact: ${project.artefact_id || ''} ${project.artefact_title || ''}\n` +
        `Theme: ${project.theme_name || ''}\n` +
        `Institute: ${project.institute_name}\n` +
        `Department: ${project.department_name}\n` +
        `Faculty Mentor: ${project.mentor_name || 'Unassigned'}
` +
        `Project Coordinator: ${project.coordinator_name || 'Unassigned'}
` +
        `Reviewer: ${project.reviewer_name || 'Unassigned'}
` +
        `RAG Status: ${project.rag_status}\n` +
        `This issue is synced from the ApniLeap Portfolio Monitoring Portal.`
    );

    const body = await jiraFetch('/rest/api/3/issue', {
        method: 'POST',
        body: JSON.stringify({
            fields: {
                project: { key: process.env.JIRA_PROJECT_KEY },
                summary,
                description,
                issuetype: { name: 'Task' },
            },
        }),
    });

    return { key: body.key, id: body.id };
}

async function addJiraComment(issueKey, text) {
    return jiraFetch(`/rest/api/3/issue/${issueKey}/comment`, {
        method: 'POST',
        body: JSON.stringify({ body: toAdf(text) }),
    });
}

async function updateJiraIssue(issueKey, { summary, description }) {
    const fields = {};
    if (summary) fields.summary = summary;
    if (description) fields.description = toAdf(description);
    return jiraFetch(`/rest/api/3/issue/${issueKey}`, {
        method: 'PUT',
        body: JSON.stringify({ fields }),
    });
}

async function getJiraIssue(issueKey) {
    return jiraFetch(`/rest/api/3/issue/${issueKey}`);
}

module.exports = { isConfigured, createJiraIssue, addJiraComment, updateJiraIssue, getJiraIssue };
