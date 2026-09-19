function formatDate(iso) {
  if (!iso) return '<span class="text-muted">&ndash;</span>';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function isOverdue(iso) {
  return iso && new Date(iso) < new Date();
}

function getDepartmentId() {
  return new URLSearchParams(window.location.search).get('id');
}

let departmentId;
let departmentInfo;
let addProjectModal;
const ADMIN_ROLES = ['PLATFORM_ADMIN', 'INSTITUTE_ADMIN'];

function currentFilters() {
  const params = new URLSearchParams();
  const search = document.getElementById('fSearch').value.trim();
  const status = document.getElementById('fStatus').value;
  const mentor = document.getElementById('fMentor').value;
  const semester = document.getElementById('fSemester').value;
  const phase = document.getElementById('fPhase').value;
  const overdue = document.getElementById('fOverdue').checked;
  const sort = document.getElementById('fSort').value;

  if (search) params.set('search', search);
  if (status) params.set('status', status);
  if (mentor) params.set('mentor', mentor);
  if (semester) params.set('semester', semester);
  if (phase) params.set('phase', phase);
  if (overdue) params.set('overdue', 'true');
  if (sort) params.set('sort', sort);
  return params.toString();
}

async function loadProjects() {
  const tbody = document.getElementById('projectTableBody');
  tbody.innerHTML = '<tr><td colspan="7" class="text-muted">Loading projects…</td></tr>';

  try {
    const qs = currentFilters();
    const { projects } = await Api.get(`/departments/${departmentId}/projects${qs ? `?${qs}` : ''}`);

    if (!projects.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-muted">No projects match the current filters.</td></tr>';
      return;
    }

    tbody.innerHTML = projects.map((p) => `
      <tr>
        <td><a href="project-dashboard.html?id=${esc(p.id)}"><strong>${esc(p.title)}</strong></a><br><span class="text-muted" style="font-size:12.5px">${esc(p.project_code)} · ${esc(p.team_id)} · ${esc(p.artefact_id)}</span>${p.theme_name ? `<br><span class="text-muted" style="font-size:12.5px">Theme: ${esc(p.theme_name)}</span>` : ''}</td>
        <td>${esc(p.mentor_name) || '<span class="text-muted">Unassigned</span>'}</td>
        <td>${ragBadge(p.rag_status)}</td>
        <td class="text-end">${esc(p.completion_pct)}%</td>
        <td>${formatDate(p.last_update_at)}</td>
        <td class="${isOverdue(p.next_review_at) ? 'text-danger fw-semibold' : ''}">${formatDate(p.next_review_at)}</td>
        <td class="text-end">${esc(p.open_issue_count)}</td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-danger">Failed to load projects: ${esc(err.message)}</td></tr>`;
  }
}

async function init() {
  if (!Api.token()) {
    window.location.href = '../index.html';
    return;
  }

  departmentId = getDepartmentId();
  if (!departmentId) {
    window.location.href = 'institutes.html';
    return;
  }

  const userChip = document.getElementById('userChip');
  const storedUser = JSON.parse(localStorage.getItem('al_user') || 'null');
  if (storedUser) {
    userChip.textContent = `${storedUser.fullName} · ${storedUser.roleNames?.[0] || storedUser.roles?.[0] || ''}`;
  }

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    try { await Api.post('/auth/logout', {}); } catch (e) { /* ignore */ }
    Api.setToken(null);
    localStorage.removeItem('al_user');
    window.location.href = '../index.html';
  });

  try {
    const { department } = await Api.get(`/departments/${departmentId}`);
    departmentInfo = department;
    document.getElementById('departmentTitle').textContent = department.name;
    document.getElementById('breadcrumb').innerHTML =
      `<a href="institutes.html">Institutes</a> / <a href="institute-dashboard.html?id=${esc(department.institute_id)}">${esc(department.institute_name)}</a> / ` +
      esc(department.name);
    document.getElementById('departmentPeople').textContent =
      `Department Head: ${department.head_name || 'Not assigned'} · Programme Coordinator: ${department.coordinator_name || 'Not assigned'}`;

    const { mentors } = await Api.get(`/departments/${departmentId}/mentors`);
    const mentorSelect = document.getElementById('fMentor');
    mentors.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.full_name;
      opt.textContent = m.full_name;
      mentorSelect.appendChild(opt);
    });
  } catch (err) {
    document.getElementById('projectTableBody').innerHTML =
      `<tr><td colspan="7" class="text-danger">Failed to load department: ${esc(err.message)}</td></tr>`;
    return;
  }

  ['fSearch', 'fStatus', 'fMentor', 'fSemester', 'fPhase', 'fOverdue', 'fSort'].forEach((id) => {
    const el = document.getElementById(id);
    const evt = el.tagName === 'INPUT' && el.type === 'text' ? 'input' : 'change';
    el.addEventListener(evt, () => loadProjects());
  });

  const currentUser = JSON.parse(localStorage.getItem('al_user') || 'null');
  if (currentUser && (currentUser.roles || []).some((r) => ADMIN_ROLES.includes(r))) {
    document.getElementById('navAdmin').classList.remove('d-none');
  }
  const mentorUpRoles = ['PLATFORM_ADMIN', 'FACULTY_MENTOR', 'DEPARTMENT_HEAD', 'INSTITUTE_ADMIN', 'DEAN_PRINCIPAL', 'GLOBAL_PROGRAMME_LEADER'];
  const canCreateProject = currentUser && (currentUser.roles || []).some((r) => mentorUpRoles.includes(r));
  const addProjectBtn = document.getElementById('btnAddProject');
  if (!canCreateProject) {
    addProjectBtn.classList.add('d-none');
  } else {
    addProjectModal = new bootstrap.Modal(document.getElementById('addProjectModal'));
    addProjectBtn.addEventListener('click', async () => {
      document.getElementById('addProjectForm').reset();
      document.getElementById('addProjectSubmit').disabled = false;
      TeamForm.render(document.getElementById('newProjectTeam'), []);
      document.getElementById('newProjectYear').innerHTML = Academic.yearOptions('');
      document.getElementById('newProjectSemester').innerHTML = Academic.semesterOptions('');
      clearAddProjectError();
      showNextIds();
      try {
        const { staff } = await Api.get(`/institutes/${departmentInfo.institute_id}/staff`);
        Academic.fillNameList('staffNames', staff.map((s) => s.full_name));
      } catch (e) { /* names can still be typed */ }
      addProjectModal.show();
    });
    document.getElementById('addProjectSubmit').addEventListener('click', submitNewProject);

    // Bulk upload from a CSV file (same roles as Add Project).
    ProjectImport.init({ departmentId, onDone: () => loadProjects() });
    const importBtn = document.getElementById('btnImportProjects');
    importBtn.classList.remove('d-none');
    importBtn.addEventListener('click', () => ProjectImport.open(departmentInfo.name));
    document.getElementById('linkOpenImport').addEventListener('click', () => {
      addProjectModal.hide();
      ProjectImport.open(departmentInfo.name);
    });
  }

  await loadProjects();
}

// Shows the numbers the next project will get. They are only a preview: the
// server assigns the real ones when the project is saved.
async function showNextIds() {
  const teamEl = document.getElementById('newTeamId');
  const artefactEl = document.getElementById('newArtefactId');
  teamEl.value = artefactEl.value = '…';
  try {
    const ids = await Api.get('/projects/next-ids');
    teamEl.value = ids.team_id;
    artefactEl.value = ids.artefact_id;
  } catch (e) {
    teamEl.value = artefactEl.value = 'Automatic';
  }
}

function showAddProjectError(message) {
  const el = document.getElementById('addProjectError');
  el.textContent = message;
  el.style.display = 'block';
}
function clearAddProjectError() {
  const el = document.getElementById('addProjectError');
  el.textContent = '';
  el.style.display = 'none';
}

async function submitNewProject() {
  clearAddProjectError();
  const title = document.getElementById('newProjectTitle').value.trim();
  const themeName = document.getElementById('newThemeName').value.trim();
  const artefactTitle = document.getElementById('newArtefactTitle').value.trim();
  const facultyMentorName = document.getElementById('newProjectMentor').value.trim();
  const coordinatorName = document.getElementById('newProjectCoordinator').value.trim();
  const reviewerName = document.getElementById('newProjectReviewer').value.trim();
  const academicYear = document.getElementById('newProjectYear').value || null;
  const semester = document.getElementById('newProjectSemester').value || null;

  if (!themeName) {
    showAddProjectError('Theme name is required.');
    return;
  }
  if (!artefactTitle) {
    showAddProjectError('Artefact title is required.');
    return;
  }
  if (!title) {
    showAddProjectError('Project title is required.');
    return;
  }

  // Disabled while saving so a double click cannot create the project twice.
  const submitBtn = document.getElementById('addProjectSubmit');
  submitBtn.disabled = true;
  try {
    const students = TeamForm.read(document.getElementById('newProjectTeam'));
    const { project } = await Api.post('/projects', { departmentId, title, themeName, artefactTitle, facultyMentorName, coordinatorName, reviewerName, academicYear, semester, students });
    addProjectModal.hide();
    window.location.href = `project-dashboard.html?id=${esc(project.id)}`;
  } catch (err) {
    submitBtn.disabled = false;
    showAddProjectError(err.message);
  }
}

document.addEventListener('DOMContentLoaded', init);
