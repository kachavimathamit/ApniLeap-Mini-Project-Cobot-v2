// Confluence Cloud REST API integration. Credentials stay server-side only.

function authHeader() {
    const pair = `${process.env.CONFLUENCE_EMAIL}:${process.env.CONFLUENCE_API_TOKEN}`;
    return `Basic ${Buffer.from(pair).toString('base64')}`;
}

function baseUrl() {
    return (process.env.CONFLUENCE_BASE_URL || '').replace(/\/$/, '');
}

function isConfigured() {
    return Boolean(process.env.CONFLUENCE_BASE_URL && process.env.CONFLUENCE_EMAIL && process.env.CONFLUENCE_API_TOKEN && process.env.CONFLUENCE_SPACE_KEY);
}

async function confluenceFetch(path, options = {}) {
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
        const message = body?.message || `Confluence API error (${res.status})`;
        throw new Error(message);
    }
    return body;
}

function escapeHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Storage-format (Confluence's HTML-like body format) page body for a
// project's standard documentation template (section 25).
function projectPageBody(project, jiraKey) {
    return `
      <h2>Project Overview</h2>
      <p><strong>Project ID:</strong> ${escapeHtml(project.project_code)}</p>
      <p><strong>Team ID:</strong> ${escapeHtml(project.team_id || '')}</p>
      <p><strong>Artefact:</strong> ${escapeHtml(project.artefact_id || '')} ${escapeHtml(project.artefact_title || '')}</p>
      <p><strong>Theme:</strong> ${escapeHtml(project.theme_name || '')}</p>
      <p><strong>Institute:</strong> ${escapeHtml(project.institute_name)}</p>
      <p><strong>Department:</strong> ${escapeHtml(project.department_name)}</p>
      <p><strong>Faculty Mentor:</strong> ${escapeHtml(project.mentor_name || 'Unassigned')}</p>
      <p><strong>Project Coordinator:</strong> ${escapeHtml(project.coordinator_name || 'Unassigned')}</p>
      <p><strong>Reviewer:</strong> ${escapeHtml(project.reviewer_name || 'Unassigned')}</p>
      <p><strong>RAG Status:</strong> ${escapeHtml(project.rag_status)}</p>
      ${jiraKey ? `<p><strong>Jira Issue:</strong> ${escapeHtml(jiraKey)}</p>` : ''}
      <h2>Requirements</h2>
      <p>${escapeHtml(project.problem_statement || 'Not documented yet.')}</p>
      <h2>Architecture</h2>
      <p>Not documented yet.</p>
      <h2>Milestones &amp; KPIs</h2>
      <p>Tracked in the ApniLeap Portfolio Monitoring Portal.</p>
      <h2>Challenges</h2>
      <p>Tracked in the ApniLeap Portfolio Monitoring Portal.</p>
      <h2>Reviews &amp; Decisions</h2>
      <p>Tracked in the ApniLeap Portfolio Monitoring Portal.</p>
      <h2>Evidence</h2>
      <p>Not documented yet.</p>
    `.trim();
}

// Creates the standard project documentation page. Returns { id, url }.
async function createConfluencePage(project, jiraKey) {
    const body = await confluenceFetch('/rest/api/content', {
        method: 'POST',
        body: JSON.stringify({
            type: 'page',
            title: `${project.project_code} - ${project.title}`,
            space: { key: process.env.CONFLUENCE_SPACE_KEY },
            body: {
                storage: { value: projectPageBody(project, jiraKey), representation: 'storage' },
            },
        }),
    });

    const url = `${baseUrl()}${body._links.webui}`;
    return { id: body.id, url };
}

async function updateConfluencePage(pageId, project, jiraKey) {
    const current = await confluenceFetch(`/rest/api/content/${pageId}?expand=version`);
    return confluenceFetch(`/rest/api/content/${pageId}`, {
        method: 'PUT',
        body: JSON.stringify({
            id: pageId,
            type: 'page',
            title: current.title,
            version: { number: current.version.number + 1 },
            body: {
                storage: { value: projectPageBody(project, jiraKey), representation: 'storage' },
            },
        }),
    });
}

module.exports = { isConfigured, createConfluencePage, updateConfluencePage };
