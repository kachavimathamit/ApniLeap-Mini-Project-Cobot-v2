const APPROVER_ROLES = ['PLATFORM_ADMIN', 'GLOBAL_PROGRAMME_LEADER', 'INSTITUTE_ADMIN', 'DEAN_PRINCIPAL', 'DEPARTMENT_HEAD', 'REVIEWER'];
const MENTOR_UP_ROLES = ['PLATFORM_ADMIN', 'FACULTY_MENTOR', 'DEPARTMENT_HEAD', 'INSTITUTE_ADMIN', 'DEAN_PRINCIPAL', 'GLOBAL_PROGRAMME_LEADER'];
const REVIEWER_UP_ROLES = ['PLATFORM_ADMIN', 'REVIEWER', 'DEPARTMENT_HEAD', 'INSTITUTE_ADMIN', 'DEAN_PRINCIPAL', 'GLOBAL_PROGRAMME_LEADER'];
const ALLOWED_TRANSITIONS = { GREEN: ['YELLOW'], YELLOW: ['GREEN', 'RED'], RED: ['YELLOW', 'GREEN'] };

let projectId;
let currentProject;
let currentUser;
let statusModal, issueModal, actionModal, reviewModal, milestoneModal, kpiModal, measurementModal, completeActionModal, linkModal, teamModal, detailsModal;

function getProjectId() {
  return new URLSearchParams(window.location.search).get('id');
}

function formatDate(iso) {
  if (!iso) return '<span class="text-muted">&ndash;</span>';
  // A date without a time (2026-10-05) is shown as that calendar day in any time zone.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  if (dateOnly) return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(iso) {
  if (!iso) return '<span class="text-muted">&ndash;</span>';
  return new Date(iso).toLocaleString();
}

function isAuthorizedApprover() {
  return (currentUser?.roles || []).some((r) => APPROVER_ROLES.includes(r));
}
function isMentorUp() {
  return (currentUser?.roles || []).some((r) => MENTOR_UP_ROLES.includes(r));
}
function isReviewerUp() {
  return (currentUser?.roles || []).some((r) => REVIEWER_UP_ROLES.includes(r));
}
// A Read-only Stakeholder must not modify any record (section 4), including
// raising an issue - the one write everyone else (even Students) may do.
function isReadOnlyOnly() {
  const roles = currentUser?.roles || [];
  // Students see their own team's project read-only, like a Read-only Stakeholder.
  return roles.length > 0 && roles.every((r) => r === 'READ_ONLY_STAKEHOLDER' || r === 'STUDENT');
}

// Client-side hiding is a UX convenience only - the backend re-checks role
// on every write, so this never substitutes for the real boundary.
function applyRoleVisibility() {
  const mentorUp = isMentorUp();
  const reviewerUp = isReviewerUp();
  const canAddIssue = !isReadOnlyOnly();
  document.getElementById('btnAddIssue').classList.toggle('d-none', !canAddIssue);
  document.getElementById('btnAddIssue2').classList.toggle('d-none', !canAddIssue);
  document.getElementById('btnUpdateStatus').classList.toggle('d-none', !mentorUp);
  document.getElementById('btnAddAction').classList.toggle('d-none', !mentorUp);
  document.getElementById('btnAddReview').classList.toggle('d-none', !reviewerUp);
  document.getElementById('btnAddAction2').classList.toggle('d-none', !mentorUp);
  document.getElementById('btnAddReview2').classList.toggle('d-none', !reviewerUp);
  document.getElementById('btnAddMilestone').classList.toggle('d-none', !mentorUp);
  document.getElementById('btnAddKpi').classList.toggle('d-none', !mentorUp);
  document.getElementById('btnEditDefinition').classList.toggle('d-none', !mentorUp);
  document.getElementById('btnAddLink').classList.toggle('d-none', !mentorUp);
  document.getElementById('btnAddLink2').classList.toggle('d-none', !mentorUp);
  document.getElementById('btnEditTeam').classList.toggle('d-none', !mentorUp);
  document.getElementById('btnEditDetails').classList.toggle('d-none', !mentorUp);
}

// Overview | Cobot | Project Tracking. Project Tracking holds seven sections
// (Definition, Milestones, KPIs, Challenges, Actions, Reviews, Documentation)
// as a second row of tabs on the same page.
const TRACKING_SECTIONS = ['definition', 'milestones', 'kpis', 'challenges', 'actions', 'reviews', 'documentation'];
let currentSection = 'definition';

function switchSection(name) {
  if (!TRACKING_SECTIONS.includes(name)) name = 'definition';
  currentSection = name;
  document.querySelectorAll('#trackingTabs .nav-link').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.sub === name);
  });
  document.querySelectorAll('.sub-pane').forEach((pane) => {
    pane.classList.toggle('d-none', pane.id !== `tab-${name}`);
  });
}

function switchTab(tabName) {
  // A section name opens Project Tracking on that section.
  if (TRACKING_SECTIONS.includes(tabName)) {
    switchSection(tabName);
    tabName = 'tracking';
  }
  document.querySelectorAll('#projectTabs .nav-link').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-pane').forEach((pane) => {
    pane.classList.toggle('d-none', pane.id !== `tab-${tabName}`);
  });
}

function showFormError(id, message) {
  const el = document.getElementById(id);
  el.textContent = message;
  el.style.display = 'block';
}
function clearFormError(id) {
  const el = document.getElementById(id);
  el.textContent = '';
  el.style.display = 'none';
}

// ---------- Header / Overview ----------

function renderHeader() {
  // A student cannot open the institute or department pages, so no links for them.
  if (Student.isStudent()) {
    document.getElementById('breadcrumb').textContent =
      [currentProject.institute_name, currentProject.department_name, currentProject.title].filter(Boolean).join(' / ');
  } else document.getElementById('breadcrumb').innerHTML =
    `<a href="institutes.html">Institutes</a> / ` +
    `<a href="institute-dashboard.html?id=${esc(currentProject.institute_id)}">${esc(currentProject.institute_name)}</a> / ` +
    `<a href="department-dashboard.html?id=${esc(currentProject.department_id)}">${esc(currentProject.department_name)}</a> / ` +
    `${esc(currentProject.title)}`;

  document.getElementById('projectTitle').textContent = currentProject.title;
  document.getElementById('projectMeta').innerHTML = `
    <span><strong>${esc(currentProject.project_code)}</strong></span>
    <span class="text-muted">Team ID: <strong>${esc(currentProject.team_id)}</strong></span>
    <span class="text-muted">Artefact ID: <strong>${esc(currentProject.artefact_id)}</strong></span>
    <span class="text-muted">Faculty Mentor: ${esc(currentProject.mentor_name) || 'Unassigned'}</span>
    <span class="text-muted">Next review: ${formatDate(currentProject.next_review_at)}</span>
  `;
  document.getElementById('ragBadgeWrap').innerHTML = ragDot(currentProject.rag_status, 'lg');
  document.getElementById('completionLabel').textContent = `${currentProject.completion_pct}%`;
  document.getElementById('completionBar').style.width = `${esc(currentProject.completion_pct)}%`;

  document.getElementById('overviewExecutionTable').innerHTML = `
    <tr><th>Team ID</th><td>${esc(currentProject.team_id)}</td></tr>
    <tr><th>Artefact ID</th><td>${esc(currentProject.artefact_id)}</td></tr>
    <tr><th>Theme Name</th><td>${esc(currentProject.theme_name) || 'Not set'}</td></tr>
    <tr><th>Artefact Title</th><td>${esc(currentProject.artefact_title) || 'Not set'}</td></tr>
    <tr><th>Institute</th><td>${esc(currentProject.institute_name)}</td></tr>
    <tr><th>Department</th><td>${esc(currentProject.department_name)}</td></tr>
    <tr><th>Faculty Mentor</th><td>${esc(currentProject.mentor_name) || 'Unassigned'}</td></tr>
    <tr><th>Project Coordinator</th><td>${esc(currentProject.coordinator_name) || 'Unassigned'}</td></tr>
    <tr><th>Reviewer</th><td>${esc(currentProject.reviewer_name) || 'Unassigned'}</td></tr>
    <tr><th>Academic Year</th><td>${esc(currentProject.academic_year) || 'Not set'}</td></tr>
    <tr><th>Semester</th><td>${esc(currentProject.semester) || 'Not set'}</td></tr>
    <tr><th>Phase</th><td>${esc(currentProject.project_phase)}</td></tr>
  `;
}

// ---------- Definition tab ----------

const DEFINITION_FIELDS = [
  ['need_statement', 'Need Statement'],
  ['problem_statement', 'Problem Statement'],
  ['objective', 'Objective'],
  ['learning_outcomes', 'Learning Outcomes'],
  ['foundation_courses', 'Foundation Courses Anchored'],
  ['functional_blocks', 'Functional Blocks'],
  ['interfaces', 'Interfaces'],
  ['dependencies', 'Dependencies'],
  ['expected_deliverables', 'Expected Deliverables'],
];

function renderDefinitionView() {
  const dl = document.createElement('dl');
  dl.className = 'al-definition-row mb-0';
  dl.innerHTML = DEFINITION_FIELDS.map(([field, label]) => `
    <dt>${label}</dt>
    <dd>${esc(currentProject[field]) || '<span class="text-muted">Not documented</span>'}</dd>
  `).join('');
  const view = document.getElementById('definitionView');
  view.innerHTML = '';
  view.appendChild(dl);
}

function renderDefinitionForm() {
  const form = document.getElementById('definitionForm');
  form.innerHTML = DEFINITION_FIELDS.map(([field, label]) => `
    <div class="mb-2">
      <label class="form-label">${label}</label>
      <textarea class="form-control" data-field="${field}" rows="2">${esc(currentProject[field]) || ''}</textarea>
    </div>
  `).join('') + `
    <div class="al-login-error" id="definitionError"></div>
    <div class="d-flex gap-2 mt-2">
      <button type="button" class="btn btn-al-primary btn-sm" id="btnSaveDefinition">Save</button>
      <button type="button" class="btn btn-outline-secondary btn-sm" id="btnCancelDefinition">Cancel</button>
    </div>
  `;

  document.getElementById('btnSaveDefinition').addEventListener('click', async () => {
    const payload = {};
    form.querySelectorAll('[data-field]').forEach((el) => { payload[el.dataset.field] = el.value; });
    try {
      const { project } = await Api.put(`/projects/${projectId}`, payload);
      currentProject = Object.assign(currentProject, project);
      renderDefinitionView();
      form.classList.add('d-none');
      document.getElementById('definitionView').classList.remove('d-none');
    } catch (err) {
      showFormError('definitionError', err.message);
    }
  });
  document.getElementById('btnCancelDefinition').addEventListener('click', () => {
    form.classList.add('d-none');
    document.getElementById('definitionView').classList.remove('d-none');
  });
}

// ---------- Milestones ----------

async function loadMilestones() {
  const tbody = document.getElementById('milestonesBody');
  try {
    const { milestones } = await Api.get(`/projects/${projectId}/milestones`);
    if (!milestones.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-muted">No milestones recorded yet.</td></tr>';
      return;
    }
    tbody.innerHTML = milestones.map((m) => `
      <tr>
        <td><strong>${esc(m.title)}</strong>${m.description ? `<br><span class="text-muted" style="font-size:13px">${esc(m.description)}</span>` : ''}</td>
        <td>${formatDate(m.due_date)}</td>
        <td>${esc(m.status.replace('_', ' '))}</td>
        <td>${m.status !== 'COMPLETED' ? `<button class="btn btn-sm btn-outline-secondary" data-complete-milestone="${esc(m.id)}">Mark Complete</button>` : ''}</td>
      </tr>
    `).join('');
    tbody.querySelectorAll('[data-complete-milestone]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await Api.put(`/milestones/${btn.dataset.completeMilestone}`, { status: 'COMPLETED' });
        loadMilestones();
      });
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-danger">${esc(err.message)}</td></tr>`;
  }
}

// ---------- KPIs ----------

async function loadKpis() {
  const tbody = document.getElementById('kpisBody');
  try {
    const { kpis } = await Api.get(`/projects/${projectId}/kpis`);
    if (!kpis.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-muted">No KPIs recorded yet.</td></tr>';
      return;
    }
    tbody.innerHTML = kpis.map((k) => `
      <tr>
        <td><strong>${esc(k.name)}</strong></td>
        <td>${esc(k.target_value) || '<span class="text-muted">&ndash;</span>'} ${esc(k.unit) || ''}</td>
        <td>${k.latest_measurement ? `${esc(k.latest_measurement.measured_value)} <span class="text-muted" style="font-size:12.5px">(${formatDate(k.latest_measurement.measured_at)})</span>` : '<span class="text-muted">No measurements</span>'}</td>
        <td>${esc(k.owner_name) || '<span class="text-muted">&ndash;</span>'}</td>
        <td><button class="btn btn-sm btn-outline-secondary" data-add-measurement="${esc(k.id)}">Add Measurement</button></td>
      </tr>
    `).join('');
    tbody.querySelectorAll('[data-add-measurement]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.getElementById('measurementKpiId').value = btn.dataset.addMeasurement;
        document.getElementById('measurementForm').reset();
        document.getElementById('measurementKpiId').value = btn.dataset.addMeasurement;
        clearFormError('measurementError');
        measurementModal.show();
      });
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-danger">${esc(err.message)}</td></tr>`;
  }
}

// ---------- Issues (Challenges) ----------

async function loadIssues() {
  const tbody = document.getElementById('issuesBody');
  try {
    const { issues } = await Api.get(`/projects/${projectId}/issues`);
    if (!issues.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-muted">No issues raised yet.</td></tr>';
      return;
    }
    tbody.innerHTML = issues.map((i) => `
      <tr>
        <td><strong>${esc(i.title)}</strong><br><span class="text-muted" style="font-size:12.5px">Raised by ${esc(i.raised_by_name) || 'Unknown'} on ${formatDate(i.created_at)}</span></td>
        <td>${esc(i.root_cause) || '<span class="text-muted">&ndash;</span>'}${i.impact ? `<br><span class="text-muted" style="font-size:13px">Impact: ${esc(i.impact)}</span>` : ''}</td>
        <td>${esc(i.escalation_level)}${i.escalation_owner_name ? `<br><span class="text-muted" style="font-size:12.5px">Owner: ${esc(i.escalation_owner_name)}</span>` : ''}</td>
        <td>${esc(i.status.replace('_', ' '))}</td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-danger">${esc(err.message)}</td></tr>`;
  }
}

// ---------- Corrective actions ----------

async function loadActions() {
  const tbody = document.getElementById('actionsBody');
  try {
    const { actions } = await Api.get(`/projects/${projectId}/actions`);
    if (!actions.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-muted">No corrective actions recorded yet.</td></tr>';
      return;
    }
    tbody.innerHTML = actions.map((a) => {
      const canVerify = isAuthorizedApprover() && a.status === 'COMPLETED';
      const canComplete = a.status === 'OPEN' || a.status === 'IN_PROGRESS';
      return `
      <tr>
        <td><strong>${esc(a.description)}</strong>${a.evidence ? `<br><span class="text-muted" style="font-size:12.5px">Evidence: ${esc(a.evidence)}</span>` : ''}</td>
        <td>${esc(a.owner_name) || '<span class="text-muted">Unassigned</span>'}</td>
        <td>${formatDate(a.due_date)}</td>
        <td>${esc(a.status)}${a.verified_by_name ? `<br><span class="text-muted" style="font-size:12px">Verified by ${esc(a.verified_by_name)}</span>` : ''}</td>
        <td class="d-flex gap-1">
          ${canComplete ? `<button class="btn btn-sm btn-outline-secondary" data-complete-action="${esc(a.id)}">Mark Completed</button>` : ''}
          ${canVerify ? `<button class="btn btn-sm btn-outline-secondary" data-verify-action="${esc(a.id)}">Verify</button>` : ''}
        </td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('[data-complete-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.getElementById('completeActionId').value = btn.dataset.completeAction;
        document.getElementById('completeActionForm').reset();
        document.getElementById('completeActionId').value = btn.dataset.completeAction;
        clearFormError('completeActionError');
        completeActionModal.show();
      });
    });
    tbody.querySelectorAll('[data-verify-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await Api.post(`/actions/${btn.dataset.verifyAction}/verify`, {});
          loadActions();
        } catch (err) {
          alert(err.message);
        }
      });
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-danger">${esc(err.message)}</td></tr>`;
  }
}

// ---------- Reviews + status history ----------

async function loadReviews() {
  const tbody = document.getElementById('reviewsBody');
  try {
    const { reviews } = await Api.get(`/projects/${projectId}/reviews`);
    tbody.innerHTML = reviews.length
      ? reviews.map((r) => `
        <tr>
          <td>${formatDate(r.review_date)}</td>
          <td>${esc(r.reviewer_name) || 'Unknown'}</td>
          <td>${esc(r.comments)}</td>
          <td>${esc(r.decision) || '<span class="text-muted">&ndash;</span>'}</td>
          <td>${r.recommended_status ? ragBadge(r.recommended_status) : '<span class="text-muted">&ndash;</span>'}</td>
        </tr>
      `).join('')
      : '<tr><td colspan="5" class="text-muted">No reviews recorded yet.</td></tr>';
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-danger">${esc(err.message)}</td></tr>`;
  }
}

async function loadHistory() {
  const tbody = document.getElementById('historyBody');
  try {
    const { statusHistory } = await Api.get(`/projects/${projectId}/history`);
    tbody.innerHTML = statusHistory.length
      ? statusHistory.map((h) => `
        <tr>
          <td>${formatDateTime(h.created_at)}</td>
          <td>${h.previous_status ? ragBadge(h.previous_status) : '<span class="text-muted">New</span>'} &rarr; ${ragBadge(h.new_status)}</td>
          <td>${esc(h.reason) || ''}</td>
          <td>${esc(h.changed_by_name) || 'Unknown'}</td>
          <td>${esc(h.approved_by_name) || '<span class="text-muted">&ndash;</span>'}</td>
        </tr>
      `).join('')
      : '<tr><td colspan="5" class="text-muted">No status changes recorded yet.</td></tr>';
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-danger">${esc(err.message)}</td></tr>`;
  }
}

// ---------- Team (four students) ----------

let currentTeam = [];

async function loadTeam() {
  const tbody = document.getElementById('teamBody');
  const note = document.getElementById('teamNote');
  try {
    const { students } = await Api.get(`/projects/${projectId}/students`);
    currentTeam = students;
    if (students.length < 4) {
      const msg = `This project's team is incomplete (${students.length} of 4 students). ${isMentorUp() ? 'Use Edit Team to enter at least four.' : ''}`;
      tbody.innerHTML = `<tr><td colspan="3" class="text-muted">${esc(msg)}</td></tr>`;
    } else {
      tbody.innerHTML = students.map((s) => `
        <tr>
          <td>${esc(s.slot)}</td>
          <td><strong>${esc(s.name)}</strong></td>
          <td>${esc(s.srn)}</td>
        </tr>`).join('');
    }
    note.textContent = '';
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="3" class="text-danger">${esc(err.message)}</td></tr>`;
  }
}

function openTeamModal() {
  clearFormError('teamError');
  TeamForm.render(document.getElementById('teamFormBody'), currentTeam);
  teamModal.show();
}

async function submitTeam() {
  clearFormError('teamError');
  try {
    await Api.put(`/projects/${projectId}/students`, { students: TeamForm.read(document.getElementById('teamFormBody')) });
    teamModal.hide();
    loadTeam();
  } catch (err) {
    showFormError('teamError', err.message);
  }
}

// ---------- Project details (mentor, coordinator, reviewer, term) ----------

async function openDetailsModal() {
  clearFormError('detailsError');
  document.getElementById('detailsTeamId').value = currentProject.team_id || '';
  document.getElementById('detailsArtefactId').value = currentProject.artefact_id || '';
  document.getElementById('detailsTheme').value = currentProject.theme_name || '';
  document.getElementById('detailsArtefactTitle').value = currentProject.artefact_title || '';
  document.getElementById('detailsMentor').value = currentProject.mentor_name || '';
  document.getElementById('detailsCoordinator').value = currentProject.coordinator_name || '';
  document.getElementById('detailsReviewer').value = currentProject.reviewer_name || '';
  document.getElementById('detailsYear').innerHTML = Academic.yearOptions(currentProject.academic_year);
  document.getElementById('detailsSemester').innerHTML = Academic.semesterOptions(currentProject.semester);
  try {
    const { staff } = await Api.get(`/institutes/${currentProject.institute_id}/staff`);
    Academic.fillNameList('detailsStaffNames', staff.map((s) => s.full_name));
  } catch (e) { /* names can still be typed */ }
  detailsModal.show();
}

async function submitDetails() {
  clearFormError('detailsError');
  try {
    await Api.put(`/projects/${projectId}`, {
      theme_name: document.getElementById('detailsTheme').value,
      artefact_title: document.getElementById('detailsArtefactTitle').value,
      faculty_mentor_name: document.getElementById('detailsMentor').value,
      coordinator_name: document.getElementById('detailsCoordinator').value,
      reviewer_name: document.getElementById('detailsReviewer').value,
      academic_year: document.getElementById('detailsYear').value,
      semester: document.getElementById('detailsSemester').value,
    });
    detailsModal.hide();
    await reloadProject();
  } catch (err) {
    showFormError('detailsError', err.message);
  }
}

// ---------- Links (Documentation tab + Overview) ----------

const LINK_TYPE_LABELS = { GITHUB: 'GitHub', CONFLUENCE: 'Confluence', JIRA: 'Jira', REPORT: 'Report', DEMO: 'Demo', OTHER: 'Other' };

async function loadLinks() {
  const overviewList = document.getElementById('linksList');
  const docBody = document.getElementById('documentationLinksBody');
  try {
    const { links } = await Api.get(`/projects/${projectId}/links`);
    if (!links.length) {
      overviewList.innerHTML = '<span class="text-muted">No linked artefacts yet.</span>';
      docBody.innerHTML = '<tr><td colspan="4" class="text-muted">No links recorded yet.</td></tr>';
      return;
    }
    overviewList.innerHTML = links.map((l) => `
      <div class="mb-1"><span class="text-muted" style="font-size:12px">${esc(LINK_TYPE_LABELS[l.link_type] || l.link_type)}</span><br>
      <a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)}</a></div>
    `).join('');
    docBody.innerHTML = links.map((l) => `
      <tr>
        <td>${esc(LINK_TYPE_LABELS[l.link_type] || l.link_type)}</td>
        <td>${esc(l.label)}</td>
        <td><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.url)}</a></td>
        <td>${formatDate(l.created_at)}</td>
      </tr>
    `).join('');
  } catch (err) {
    overviewList.innerHTML = `<span class="text-danger">${esc(err.message)}</span>`;
    docBody.innerHTML = `<tr><td colspan="4" class="text-danger">${esc(err.message)}</td></tr>`;
  }
}

// ---------- Status update modal (RAG workflow + Red intervention) ----------

function openStatusModal() {
  clearFormError('statusError');
  document.getElementById('statusForm').reset();
  document.getElementById('redIntervention').classList.add('d-none');
  document.getElementById('redToGreen').classList.add('d-none');

  const select = document.getElementById('statusNewStatus');
  const options = ALLOWED_TRANSITIONS[currentProject.rag_status] || [];
  // The last choice updates only the completion percentage.
  select.innerHTML = options.map((s) => `<option value="${s}">${s}</option>`).join('') +
    '<option value="">No status change (update completion only)</option>';
  select.value = options[0] || '';
  document.getElementById('statusCompletion').value = currentProject.completion_pct;
  toggleStatusSections();
  statusModal.show();
}

function toggleStatusSections() {
  const newStatus = document.getElementById('statusNewStatus').value;
  const isRedToGreen = currentProject.rag_status === 'RED' && newStatus === 'GREEN';
  document.getElementById('redIntervention').classList.toggle('d-none', newStatus !== 'RED');
  document.getElementById('redToGreen').classList.toggle('d-none', !isRedToGreen);
  document.getElementById('statusReasonHint').textContent = newStatus ? '(required for a status change)' : '(optional)';
}

async function submitStatus() {
  clearFormError('statusError');
  const newStatus = document.getElementById('statusNewStatus').value;
  const reason = document.getElementById('statusReason').value.trim();
  const completion = document.getElementById('statusCompletion').value.trim();
  const pct = Number(completion);
  if (completion === '' || !Number.isInteger(pct) || pct < 0 || pct > 100) {
    showFormError('statusError', 'Completion must be a whole number from 0 to 100.');
    return;
  }
  if (newStatus && !reason) {
    showFormError('statusError', 'A reason is required for a status change.');
    return;
  }
  if (!newStatus && pct === Number(currentProject.completion_pct)) {
    showFormError('statusError', 'Nothing to update: pick a new status or change the completion percentage.');
    return;
  }

  const payload = { newStatus, reason, completionPct: pct };
  if (newStatus === 'RED') {
    payload.blocker = document.getElementById('statusBlocker').value;
    payload.rootCause = document.getElementById('statusRootCause').value;
    payload.impact = document.getElementById('statusImpact').value;
    payload.supportRequired = document.getElementById('statusSupportRequired').value;
    payload.correctiveActionTaken = document.getElementById('statusCorrectiveAction').value;
    payload.actionOwnerName = document.getElementById('statusActionOwner').value.trim();
    payload.dueDate = document.getElementById('statusDueDate').value || null;
    payload.escalationOwnerName = document.getElementById('statusEscalationOwner').value.trim();
    payload.nextReviewAt = document.getElementById('statusNextReview').value || null;
  }
  if (currentProject.rag_status === 'RED' && newStatus === 'GREEN') {
    payload.evidence = document.getElementById('statusEvidence').value;
    payload.reviewerApproval = document.getElementById('statusReviewerApproval').checked;
  }

  try {
    await Api.post(`/projects/${projectId}/status`, payload);
    statusModal.hide();
    await reloadProject();
    loadHistory();
    loadActions();
    loadIssues();
  } catch (err) {
    showFormError('statusError', err.message);
  }
}

// ---------- Simple create modals ----------

function wireSimpleModal({ modal, formId, errorId, submitId, fields, endpoint, onSuccess }) {
  document.getElementById(submitId).addEventListener('click', async () => {
    clearFormError(errorId);
    const payload = {};
    let missingRequired = false;
    fields.forEach(({ id, key, required }) => {
      const val = document.getElementById(id).value.trim();
      if (required && !val) missingRequired = true;
      payload[key] = val || null;
    });
    if (missingRequired) {
      showFormError(errorId, 'Please fill in the required fields.');
      return;
    }
    try {
      await Api.post(endpoint(), payload);
      modal.hide();
      document.getElementById(formId).reset();
      onSuccess();
    } catch (err) {
      showFormError(errorId, err.message);
    }
  });
}

// ---------- Init ----------

async function reloadProject() {
  const { project, jiraLink, confluenceLink } = await Api.get(`/projects/${projectId}`);
  currentProject = project;
  currentJiraLink = jiraLink;
  currentConfluenceLink = confluenceLink;
  renderHeader();
  renderDefinitionView();
  renderIntegrationStatus();
}

let currentJiraLink = null;
let currentConfluenceLink = null;

function renderIntegrationStatus() {
  const el = document.getElementById('integrationStatus');
  const syncBtn = document.getElementById('btnSyncIntegrations');
  const mentorUp = isMentorUp();

  const parts = [];
  parts.push(currentJiraLink
    ? `<div class="mb-1">Jira: <a href="${esc(currentJiraLink.url)}" target="_blank" rel="noopener noreferrer">${esc(currentJiraLink.key)}</a></div>`
    : `<div class="mb-1">Jira: <span class="text-muted">Not linked</span>${mentorUp ? ' <button class="btn btn-link btn-sm p-0" id="btnCreateJira">Create Issue</button>' : ''}</div>`);
  parts.push(currentConfluenceLink
    ? `<div>Confluence: <a href="${esc(currentConfluenceLink.url)}" target="_blank" rel="noopener noreferrer">View Page</a></div>`
    : `<div>Confluence: <span class="text-muted">Not linked</span>${mentorUp ? ' <button class="btn btn-link btn-sm p-0" id="btnCreateConfluence">Create Page</button>' : ''}</div>`);
  el.innerHTML = parts.join('');

  const docEl = document.getElementById('documentationIntegration');
  if (docEl) {
    const docParts = [];
    docParts.push(currentConfluenceLink
      ? `Confluence page: <a href="${esc(currentConfluenceLink.url)}" target="_blank" rel="noopener noreferrer">Open project documentation</a>`
      : 'Confluence page: not created yet (use the Overview tab to create one).');
    docParts.push(currentJiraLink
      ? `Jira issue: <a href="${esc(currentJiraLink.url)}" target="_blank" rel="noopener noreferrer">${esc(currentJiraLink.key)}</a>`
      : 'Jira issue: not created yet.');
    docEl.innerHTML = docParts.join('<br>');
  }

  syncBtn.classList.toggle('d-none', !mentorUp || (!currentJiraLink && !currentConfluenceLink));

  const jiraBtn = document.getElementById('btnCreateJira');
  if (jiraBtn) jiraBtn.addEventListener('click', async () => {
    jiraBtn.disabled = true;
    try {
      await Api.post(`/projects/${projectId}/jira`, {});
      await reloadProject();
    } catch (err) {
      alert(err.message);
      jiraBtn.disabled = false;
    }
  });
  const confluenceBtn = document.getElementById('btnCreateConfluence');
  if (confluenceBtn) confluenceBtn.addEventListener('click', async () => {
    confluenceBtn.disabled = true;
    try {
      await Api.post(`/projects/${projectId}/confluence`, {});
      await reloadProject();
    } catch (err) {
      alert(err.message);
      confluenceBtn.disabled = false;
    }
  });
}

async function init() {
  if (!Api.token()) {
    window.location.href = '../index.html';
    return;
  }

  projectId = getProjectId();
  if (!projectId) {
    window.location.href = 'institutes.html';
    return;
  }

  currentUser = JSON.parse(localStorage.getItem('al_user') || 'null');
  const userChip = document.getElementById('userChip');
  if (currentUser) {
    userChip.textContent = `${currentUser.fullName} · ${currentUser.roleNames?.[0] || currentUser.roles?.[0] || ''}`;
    if ((currentUser.roles || []).some((r) => ['PLATFORM_ADMIN', 'INSTITUTE_ADMIN'].includes(r))) {
      document.getElementById('navAdmin').classList.remove('d-none');
    }
  }

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    try { await Api.post('/auth/logout', {}); } catch (e) { /* ignore */ }
    Api.setToken(null);
    localStorage.removeItem('al_user');
    window.location.href = '../index.html';
  });

  statusModal = new bootstrap.Modal(document.getElementById('statusModal'));
  issueModal = new bootstrap.Modal(document.getElementById('issueModal'));
  actionModal = new bootstrap.Modal(document.getElementById('actionModal'));
  reviewModal = new bootstrap.Modal(document.getElementById('reviewModal'));
  milestoneModal = new bootstrap.Modal(document.getElementById('milestoneModal'));
  kpiModal = new bootstrap.Modal(document.getElementById('kpiModal'));
  measurementModal = new bootstrap.Modal(document.getElementById('measurementModal'));
  completeActionModal = new bootstrap.Modal(document.getElementById('completeActionModal'));
  linkModal = new bootstrap.Modal(document.getElementById('linkModal'));
  teamModal = new bootstrap.Modal(document.getElementById('teamModal'));
  detailsModal = new bootstrap.Modal(document.getElementById('detailsModal'));

  applyRoleVisibility();

  try {
    await reloadProject();
  } catch (err) {
    document.getElementById('projectTitle').textContent = 'Failed to load project';
    document.getElementById('projectMeta').innerHTML = `<span class="text-danger">${esc(err.message)}</span>`;
    return;
  }

  document.querySelectorAll('#projectTabs .nav-link').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  document.querySelectorAll('#trackingTabs .nav-link').forEach((btn) => {
    btn.addEventListener('click', () => switchSection(btn.dataset.sub));
  });

  document.getElementById('btnEditDefinition').addEventListener('click', () => {
    renderDefinitionForm();
    document.getElementById('definitionView').classList.add('d-none');
    document.getElementById('definitionForm').classList.remove('d-none');
  });

  document.getElementById('btnUpdateStatus').addEventListener('click', openStatusModal);
  document.getElementById('statusNewStatus').addEventListener('change', toggleStatusSections);
  document.getElementById('statusSubmit').addEventListener('click', submitStatus);

  [document.getElementById('btnAddIssue'), document.getElementById('btnAddIssue2')].forEach((btn) =>
    btn.addEventListener('click', () => { clearFormError('issueError'); document.getElementById('issueForm').reset(); issueModal.show(); })
  );
  [document.getElementById('btnAddAction'), document.getElementById('btnAddAction2')].forEach((btn) =>
    btn.addEventListener('click', () => { clearFormError('actionError'); document.getElementById('actionForm').reset(); actionModal.show(); })
  );
  [document.getElementById('btnAddReview'), document.getElementById('btnAddReview2')].forEach((btn) =>
    btn.addEventListener('click', () => { clearFormError('reviewError'); document.getElementById('reviewForm').reset(); reviewModal.show(); })
  );
  document.getElementById('btnAddMilestone').addEventListener('click', () => {
    clearFormError('milestoneError'); document.getElementById('milestoneForm').reset(); milestoneModal.show();
  });
  document.getElementById('btnAddKpi').addEventListener('click', () => {
    clearFormError('kpiError'); document.getElementById('kpiForm').reset(); kpiModal.show();
  });
  [document.getElementById('btnAddLink'), document.getElementById('btnAddLink2')].forEach((btn) =>
    btn.addEventListener('click', () => { clearFormError('linkError'); document.getElementById('linkForm').reset(); linkModal.show(); })
  );
  document.getElementById('btnSyncIntegrations').addEventListener('click', async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Syncing…';
    try {
      await Api.post(`/projects/${projectId}/sync`, {});
    } catch (err) {
      alert(err.message);
    } finally {
      e.target.disabled = false;
      e.target.textContent = 'Sync Now';
    }
  });
  document.getElementById('linkSubmit').addEventListener('click', async () => {
    clearFormError('linkError');
    const linkType = document.getElementById('linkType').value;
    const label = document.getElementById('linkLabel').value.trim();
    const url = document.getElementById('linkUrl').value.trim();
    if (!label || !url) {
      showFormError('linkError', 'Label and URL are required.');
      return;
    }
    try {
      await Api.post(`/projects/${projectId}/links`, { linkType, label, url });
      linkModal.hide();
      loadLinks();
    } catch (err) {
      showFormError('linkError', err.message);
    }
  });

  wireSimpleModal({
    modal: issueModal, formId: 'issueForm', errorId: 'issueError', submitId: 'issueSubmit',
    fields: [
      { id: 'issueTitle', key: 'title', required: true },
      { id: 'issueRootCause', key: 'rootCause' },
      { id: 'issueImpact', key: 'impact' },
      { id: 'issueSupportRequired', key: 'supportRequired' },
    ],
    endpoint: () => `/projects/${projectId}/issues`,
    onSuccess: () => { loadIssues(); },
  });

  wireSimpleModal({
    modal: actionModal, formId: 'actionForm', errorId: 'actionError', submitId: 'actionSubmit',
    fields: [
      { id: 'actionDescription', key: 'description', required: true },
      { id: 'actionOwner', key: 'ownerName' },
      { id: 'actionDueDate', key: 'dueDate' },
      { id: 'actionEvidence', key: 'evidence' },
    ],
    endpoint: () => `/projects/${projectId}/actions`,
    onSuccess: () => { loadActions(); },
  });

  wireSimpleModal({
    modal: reviewModal, formId: 'reviewForm', errorId: 'reviewError', submitId: 'reviewSubmit',
    fields: [
      { id: 'reviewComments', key: 'comments', required: true },
      { id: 'reviewDecision', key: 'decision' },
      { id: 'reviewRecommendedStatus', key: 'recommendedStatus' },
      { id: 'reviewNextDate', key: 'nextReviewAt' },
    ],
    endpoint: () => `/projects/${projectId}/reviews`,
    onSuccess: () => { loadReviews(); reloadProject(); },
  });

  wireSimpleModal({
    modal: milestoneModal, formId: 'milestoneForm', errorId: 'milestoneError', submitId: 'milestoneSubmit',
    fields: [
      { id: 'milestoneTitle', key: 'title', required: true },
      { id: 'milestoneDescription', key: 'description' },
      { id: 'milestoneDueDate', key: 'dueDate' },
    ],
    endpoint: () => `/projects/${projectId}/milestones`,
    onSuccess: () => { loadMilestones(); },
  });

  wireSimpleModal({
    modal: kpiModal, formId: 'kpiForm', errorId: 'kpiError', submitId: 'kpiSubmit',
    fields: [
      { id: 'kpiName', key: 'name', required: true },
      { id: 'kpiTarget', key: 'targetValue' },
      { id: 'kpiUnit', key: 'unit' },
    ],
    endpoint: () => `/projects/${projectId}/kpis`,
    onSuccess: () => { loadKpis(); },
  });

  document.getElementById('measurementSubmit').addEventListener('click', async () => {
    clearFormError('measurementError');
    const kpiId = document.getElementById('measurementKpiId').value;
    const measuredValue = document.getElementById('measurementValue').value.trim();
    const evidence = document.getElementById('measurementEvidence').value.trim();
    if (!measuredValue) {
      showFormError('measurementError', 'Measured value is required.');
      return;
    }
    try {
      await Api.post(`/kpis/${kpiId}/measurements`, { measuredValue, evidence: evidence || null });
      measurementModal.hide();
      loadKpis();
    } catch (err) {
      showFormError('measurementError', err.message);
    }
  });

  document.getElementById('btnEditTeam').addEventListener('click', openTeamModal);
  document.getElementById('teamSubmit').addEventListener('click', submitTeam);
  document.getElementById('btnEditDetails').addEventListener('click', openDetailsModal);
  document.getElementById('detailsSubmit').addEventListener('click', submitDetails);

  document.getElementById('completeActionSubmit').addEventListener('click', async () => {
    clearFormError('completeActionError');
    const actionId = document.getElementById('completeActionId').value;
    const evidence = document.getElementById('completeActionEvidence').value.trim();
    if (!evidence) {
      showFormError('completeActionError', 'Evidence is required to mark a corrective action completed.');
      return;
    }
    try {
      await Api.put(`/actions/${actionId}`, { status: 'COMPLETED', evidence });
      completeActionModal.hide();
      loadActions();
    } catch (err) {
      showFormError('completeActionError', err.message);
    }
  });

  loadMilestones();
  loadKpis();
  loadIssues();
  loadActions();
  loadReviews();
  loadHistory();
  loadLinks();
  loadTeam();
}

document.addEventListener('DOMContentLoaded', init);
