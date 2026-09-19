const ADMIN_ROLES = ['PLATFORM_ADMIN', 'INSTITUTE_ADMIN'];
const DEPARTMENT_SCOPED_ROLES = ['DEAN_PRINCIPAL', 'DEPARTMENT_HEAD'];
let currentUser;
let userModal, instituteModal, confirmModal, departmentModal, accessModal;
let editingInstitute = null, editingDepartment = null, editingAccessUser = null;
let allRoles = [];
let allInstitutes = [];

function switchTab(tabName) {
  document.querySelectorAll('#adminTabs .nav-link').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tabName));
  document.querySelectorAll('.tab-pane').forEach((pane) => pane.classList.toggle('d-none', pane.id !== `tab-${tabName}`));
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

function isPlatformAdmin() {
  return (currentUser?.roles || []).includes('PLATFORM_ADMIN');
}

// ---------- Users: search ----------
// Nothing is listed until the administrator searches. Students are never
// listed: their accounts come from project teams and sign in with the SRN.

function statusBadge(active) {
  return active
    ? '<span class="al-rag rag-green"><span class="al-dot"></span>Active</span>'
    : '<span class="al-rag rag-red"><span class="al-dot"></span>Inactive</span>';
}

function setUserMessage(text, isError) {
  const el = document.getElementById('userSearchMessage');
  el.textContent = text;
  el.className = `mt-2 ${isError ? 'text-danger' : 'text-muted'}`;
  el.classList.toggle('d-none', !text);
}

function resetUserSearch() {
  document.getElementById('userFilterInstitute').value = '';
  document.getElementById('userFilterRole').value = '';
  document.getElementById('userFilterQuery').value = '';
  document.getElementById('userResults').classList.add('d-none');
  setUserMessage('Choose an organization, a role or type some details, then press Search to see users.', false);
}

function renderUserFilters() {
  const instSelect = document.getElementById('userFilterInstitute');
  const instOptions = isPlatformAdmin() ? allInstitutes : allInstitutes.filter((i) => (currentUser.instituteIds || []).includes(i.id));
  instSelect.innerHTML = `<option value="">${isPlatformAdmin() ? 'All organizations' : 'All my organizations'}</option>` +
    instOptions.map((i) => `<option value="${esc(i.id)}">${esc(i.name)}</option>`).join('');

  const roleSelect = document.getElementById('userFilterRole');
  const roles = (isPlatformAdmin() ? allRoles : allRoles.filter((r) => !['PLATFORM_ADMIN', 'GLOBAL_PROGRAMME_LEADER'].includes(r.code)))
    .filter((r) => r.code !== 'STUDENT');
  roleSelect.innerHTML = '<option value="">All roles</option>' +
    roles.map((r) => `<option value="${esc(r.code)}">${esc(r.name)}</option>`).join('');
}

async function searchUsers(event) {
  if (event) event.preventDefault();
  const instituteId = document.getElementById('userFilterInstitute').value;
  const role = document.getElementById('userFilterRole').value;
  const q = document.getElementById('userFilterQuery').value.trim();
  const results = document.getElementById('userResults');

  if (!instituteId && !role && !q) {
    results.classList.add('d-none');
    setUserMessage('Choose an organization, a role or type some details before searching.', true);
    return;
  }

  const params = new URLSearchParams();
  if (instituteId) params.set('instituteId', instituteId);
  if (role) params.set('role', role);
  if (q) params.set('q', q);

  const tbody = document.getElementById('usersBody');
  setUserMessage('Searching…', false);
  try {
    const { users, truncated } = await Api.get(`/admin/users?${params}`);
    results.classList.remove('d-none');
    setUserMessage('', false);
    document.getElementById('userCount').textContent = users.length
      ? `${users.length} user${users.length === 1 ? '' : 's'} found${truncated ? ' (showing the first 50 - refine your search)' : ''}`
      : 'No users match your search.';

    tbody.innerHTML = users.length ? users.map((u) => {
      const scoped = u.role_codes.some((r) => DEPARTMENT_SCOPED_ROLES.includes(r));
      return `
      <tr>
        <td>${esc(u.full_name)}</td>
        <td>${esc(u.email)}</td>
        <td>${esc(u.role_names.join(', ')) || '<span class="text-muted">None</span>'}</td>
        <td>${esc(u.institute_names.join(', ')) || '<span class="text-muted">None</span>'}</td>
        <td>${scoped
          ? (u.department_names.length ? esc(u.department_names.join(', ')) : '<span class="text-muted">None - sees nothing yet</span>')
          : '<span class="text-muted">Whole college</span>'}</td>
        <td>${statusBadge(u.is_active)}</td>
        <td class="text-end text-nowrap">
          ${scoped ? `<button class="btn btn-sm btn-outline-secondary me-1" data-edit-access="${esc(u.id)}">Department access</button>` : ''}
          <button class="btn btn-sm btn-outline-secondary" data-toggle-user="${esc(u.id)}" data-active="${esc(u.is_active)}">${u.is_active ? 'Deactivate' : 'Activate'}</button>
        </td>
      </tr>`;
    }).join('') : '';

    tbody.querySelectorAll('[data-toggle-user]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const isActive = btn.dataset.active === 'true';
        try {
          await Api.patch(`/admin/users/${btn.dataset.toggleUser}/status`, { isActive: !isActive });
          searchUsers();
        } catch (err) {
          alert(err.message);
        }
      });
    });
    tbody.querySelectorAll('[data-edit-access]').forEach((btn) => {
      btn.addEventListener('click', () => openAccessModal(users.find((x) => String(x.id) === btn.dataset.editAccess)));
    });
  } catch (err) {
    results.classList.add('d-none');
    setUserMessage(err.message, true);
  }
}

// ---------- Users: department access (Dean / Department Head) ----------

const departmentCache = {};   // instituteId -> departments

async function getDepartments(instituteId) {
  if (!departmentCache[instituteId]) {
    try {
      departmentCache[instituteId] = (await Api.get(`/institutes/${instituteId}/departments`)).departments;
    } catch (err) {
      departmentCache[instituteId] = [];
    }
  }
  return departmentCache[instituteId];
}

// Checkbox list of departments, grouped by college.
async function departmentChecklist(instituteIds, selectedIds, idPrefix) {
  const selected = new Set((selectedIds || []).map(Number));
  let html = '';
  for (const instId of instituteIds) {
    const inst = allInstitutes.find((i) => i.id === instId);
    const depts = await getDepartments(instId);
    html += `<div class="w-100"><div class="fw-semibold" style="font-size:13.5px">${esc(inst ? inst.name : 'Institute')}</div>`;
    html += depts.length ? depts.map((d) => `
      <div class="form-check form-check-inline">
        <input class="form-check-input" type="checkbox" value="${esc(d.id)}" id="${idPrefix}-${esc(d.id)}"${selected.has(Number(d.id)) ? ' checked' : ''}>
        <label class="form-check-label" for="${idPrefix}-${esc(d.id)}" style="font-size:13.5px">${esc(d.name)}</label>
      </div>`).join('') : '<div class="text-muted" style="font-size:13px">No departments yet.</div>';
    html += '</div>';
  }
  return html || '<div class="text-muted" style="font-size:13px">Tick an institute first.</div>';
}

async function openAccessModal(user) {
  if (!user) return;
  editingAccessUser = user;
  clearFormError('accessError');
  document.getElementById('accessUserName').textContent = `${user.full_name} (${user.role_names.join(', ')})`;
  const manageable = isPlatformAdmin() ? user.institute_ids : user.institute_ids.filter((i) => (currentUser.instituteIds || []).includes(i));
  document.getElementById('accessDepartmentList').innerHTML =
    await departmentChecklist(manageable, user.department_ids, 'acc');
  accessModal.show();
}

async function submitAccess() {
  clearFormError('accessError');
  const departmentIds = Array.from(document.querySelectorAll('#accessDepartmentList input:checked')).map((el) => Number(el.value));
  try {
    await Api.patch(`/admin/users/${editingAccessUser.id}/departments`, { departmentIds });
    accessModal.hide();
    searchUsers();
  } catch (err) {
    showFormError('accessError', err.message);
  }
}

// ---------- Users: add ----------

function renderUserFormOptions() {
  const rolesList = document.getElementById('userRolesList');
  // Student accounts are created automatically from the SRNs on a project team.
  const roleOptions = (isPlatformAdmin() ? allRoles : allRoles.filter((r) => !['PLATFORM_ADMIN', 'GLOBAL_PROGRAMME_LEADER'].includes(r.code))).filter((r) => r.code !== 'STUDENT');
  rolesList.innerHTML = roleOptions.map((r) => `
    <div class="form-check">
      <input class="form-check-input" type="checkbox" value="${esc(r.code)}" id="role-${esc(r.code)}">
      <label class="form-check-label" for="role-${esc(r.code)}" style="font-size:13.5px">${esc(r.name)}</label>
    </div>
  `).join('');

  const institutesList = document.getElementById('userInstitutesList');
  const instituteOptions = isPlatformAdmin() ? allInstitutes : allInstitutes.filter((i) => (currentUser.instituteIds || []).includes(i.id));
  institutesList.innerHTML = instituteOptions.map((i) => `
    <div class="form-check">
      <input class="form-check-input" type="checkbox" value="${esc(i.id)}" id="inst-${esc(i.id)}">
      <label class="form-check-label" for="inst-${esc(i.id)}" style="font-size:13.5px">${esc(i.name)}</label>
    </div>
  `).join('');

  rolesList.querySelectorAll('input').forEach((el) => el.addEventListener('change', refreshUserDepartments));
  institutesList.querySelectorAll('input').forEach((el) => el.addEventListener('change', refreshUserDepartments));
  refreshUserDepartments();
}

// The department checklist appears for a Dean or Department Head, for the colleges ticked.
async function refreshUserDepartments() {
  const wrap = document.getElementById('userDepartmentsWrap');
  const roleCodes = Array.from(document.querySelectorAll('#userRolesList input:checked')).map((el) => el.value);
  const scoped = roleCodes.some((r) => DEPARTMENT_SCOPED_ROLES.includes(r));
  wrap.classList.toggle('d-none', !scoped);
  if (!scoped) return;
  const kept = new Set(Array.from(document.querySelectorAll('#userDepartmentList input:checked')).map((el) => Number(el.value)));
  const instituteIds = Array.from(document.querySelectorAll('#userInstitutesList input:checked')).map((el) => el.value);
  document.getElementById('userDepartmentList').innerHTML = await departmentChecklist(instituteIds, [...kept], 'ud');
}

async function submitUser() {
  clearFormError('userError');
  const fullName = document.getElementById('userFullName').value.trim();
  const email = document.getElementById('userEmail').value.trim();
  const password = document.getElementById('userPassword').value;
  const roleCodes = Array.from(document.querySelectorAll('#userRolesList input:checked')).map((el) => el.value);
  const instituteIds = Array.from(document.querySelectorAll('#userInstitutesList input:checked')).map((el) => el.value);
  const departmentIds = Array.from(document.querySelectorAll('#userDepartmentList input:checked')).map((el) => Number(el.value));

  if (!fullName || !email || !password || !roleCodes.length) {
    showFormError('userError', 'Full name, email, password and at least one role are required.');
    return;
  }

  try {
    await Api.post('/admin/users', { fullName, email, password, roleCodes, instituteIds, departmentIds });
    userModal.hide();
    document.getElementById('userForm').reset();
    setUserMessage(`User "${fullName}" was added. Use Search to find them.`, false);
    document.getElementById('userResults').classList.add('d-none');
  } catch (err) {
    showFormError('userError', err.message);
  }
}

// ---------- Institutes ----------

async function loadInstitutes() {
  const tbody = document.getElementById('institutesBody');
  try {
    const { institutes } = await Api.get('/institutes');
    allInstitutes = institutes;
    const canManage = isPlatformAdmin();
    tbody.innerHTML = institutes.length
      ? institutes.map((i) => `<tr><td>${esc(i.code)}</td><td>${esc(i.name)}</td><td class="text-end text-nowrap">${canManage
          ? `<button class="btn btn-sm btn-outline-secondary me-1" data-edit-institute="${esc(i.id)}">Edit</button><button class="btn btn-sm btn-outline-danger" data-delete-institute="${esc(i.id)}">Delete</button>`
          : ''}</td></tr>`).join('')
      : '<tr><td colspan="3" class="text-muted">No institutes in scope.</td></tr>';
    tbody.querySelectorAll('[data-edit-institute]').forEach((btn) => btn.addEventListener('click', () => openInstituteModal(institutes.find((x) => x.id === btn.dataset.editInstitute))));
    tbody.querySelectorAll('[data-delete-institute]').forEach((btn) => btn.addEventListener('click', () => deleteInstitute(institutes.find((x) => x.id === btn.dataset.deleteInstitute))));
    populateInstituteSelect('deptInstituteSelect', loadDepartments);
    renderUserFilters();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="3" class="text-danger">${esc(err.message)}</td></tr>`;
  }
}

function openInstituteModal(inst) {
  if (!isPlatformAdmin()) return;
  editingInstitute = inst || null;
  clearFormError('instituteError');
  document.getElementById('instituteForm').reset();
  document.getElementById('instituteModalTitle').textContent = inst ? 'Edit Institute' : 'Add Institute';
  const code = document.getElementById('instituteCode');
  code.value = inst ? inst.code : '';
  code.disabled = Boolean(inst);
  document.getElementById('instituteName').value = inst ? inst.name : '';
  instituteModal.show();
}

// Asks the Platform Administrator to confirm. The server refuses to delete
// until the request carries cascade=true and the typed institute code, and
// its first reply gives the counts shown here.
async function deleteInstitute(inst) {
  let preview;
  try {
    await Api.del(`/admin/institutes/${inst.id}`);
    return;
  } catch (err) {
    preview = err;
  }
  if (!/^Deleting /.test(preview.message)) {
    alert(preview.message);
    return;
  }
  const ok = await confirmDialog({
    title: `Delete ${inst.name}?`,
    message: `${preview.message} Users stay in the system but lose access to this institute. Jira issues and Confluence pages already created are not removed. This cannot be undone.`,
    requireText: inst.code,
  });
  if (!ok) return;
  try {
    await Api.del(`/admin/institutes/${inst.id}?cascade=true&confirmCode=${encodeURIComponent(inst.code)}`);
    staffCache[inst.id] = undefined;
    departmentCache[inst.id] = undefined;
    loadInstitutes();
  } catch (err) {
    alert(err.message);
  }
}

// Generic confirmation dialog. With requireText, the user must type it to enable Delete.
function confirmDialog({ title, message, requireText }) {
  return new Promise((resolve) => {
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    clearFormError('confirmError');
    const wrap = document.getElementById('confirmTypeWrap');
    const input = document.getElementById('confirmTypeInput');
    const okBtn = document.getElementById('confirmOk');
    input.value = '';
    wrap.classList.toggle('d-none', !requireText);
    if (requireText) document.getElementById('confirmTypeLabel').textContent = `Type ${requireText} to confirm`;
    const refresh = () => { okBtn.disabled = Boolean(requireText) && input.value.trim().toUpperCase() !== String(requireText).toUpperCase(); };
    refresh();
    let answered = false;
    const finish = (value) => {
      if (answered) return;
      answered = true;
      okBtn.removeEventListener('click', onOk);
      input.removeEventListener('input', refresh);
      document.getElementById('confirmModal').removeEventListener('hidden.bs.modal', onHidden);
      confirmModal.hide();
      resolve(value);
    };
    const onOk = () => finish(true);
    const onHidden = () => finish(false);
    okBtn.addEventListener('click', onOk);
    input.addEventListener('input', refresh);
    document.getElementById('confirmModal').addEventListener('hidden.bs.modal', onHidden);
    confirmModal.show();
  });
}

async function submitInstitute() {
  clearFormError('instituteError');
  const code = document.getElementById('instituteCode').value.trim();
  const name = document.getElementById('instituteName').value.trim();
  if ((!editingInstitute && !code) || !name) {
    showFormError('instituteError', 'Code and name are required.');
    return;
  }
  try {
    if (editingInstitute) await Api.patch(`/admin/institutes/${editingInstitute.id}`, { name });
    else await Api.post('/admin/institutes', { code, name });
    instituteModal.hide();
    document.getElementById('instituteForm').reset();
    loadInstitutes();
  } catch (err) {
    showFormError('instituteError', err.message);
  }
}

// ---------- Departments ----------
// The department id and code are assigned by the system; only the name (and the
// Head) are entered.

const staffCache = {};   // instituteId -> staff list (with role codes)

async function getStaff(instituteId) {
  if (!staffCache[instituteId]) {
    try {
      staffCache[instituteId] = (await Api.get(`/institutes/${instituteId}/staff`)).staff;
    } catch (err) {
      staffCache[instituteId] = [];
    }
  }
  return staffCache[instituteId];
}

// Suggestions for a name box: people who hold the given role in the institute.
function personSuggestions(staff, roleCode) {
  return staff.filter((u) => u.role_codes.includes(roleCode))
    .map((u) => `<option value="${esc(u.full_name)}"></option>`).join('');
}

// A typed name that exactly matches an eligible account links that account;
// any other name is stored as plain text.
function resolvePerson(staff, roleCode, typed) {
  const name = String(typed || '').trim();
  const match = staff.find((u) => u.role_codes.includes(roleCode) && u.full_name.toLowerCase() === name.toLowerCase());
  return match ? { userId: match.id, name: match.full_name } : { userId: null, name };
}

function populateInstituteSelect(selectId, onChange) {
  const select = document.getElementById(selectId);
  const previous = select.value;
  select.innerHTML = allInstitutes.map((i) => `<option value="${esc(i.id)}">${esc(i.name)}</option>`).join('');
  if (previous && allInstitutes.some((i) => i.id === previous)) select.value = previous;
  if (select.value) onChange();
}

async function loadDepartments() {
  const instituteId = document.getElementById('deptInstituteSelect').value;
  const tbody = document.getElementById('departmentsBody');
  if (!instituteId) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-muted">Select an institute.</td></tr>';
    return;
  }
  try {
    const { departments } = await Api.get(`/institutes/${instituteId}/departments`);
    departmentCache[instituteId] = departments;
    tbody.innerHTML = departments.length ? departments.map((d) => `
      <tr>
        <td>${esc(d.code)}</td>
        <td>${esc(d.name)}</td>
        <td>${d.head_name ? esc(d.head_name) : '<span class="text-muted">Not assigned</span>'}</td>
        <td class="text-end">${esc(d.project_count)}</td>
        <td class="text-end text-nowrap"><button class="btn btn-sm btn-outline-secondary me-1" data-edit-dept="${esc(d.id)}">Edit</button><button class="btn btn-sm btn-outline-danger" data-delete-dept="${esc(d.id)}">Delete</button></td>
      </tr>`).join('') : '<tr><td colspan="5" class="text-muted">No departments yet.</td></tr>';
    tbody.querySelectorAll('[data-edit-dept]').forEach((btn) => btn.addEventListener('click', () => openDepartmentModal(departments.find((x) => String(x.id) === btn.dataset.editDept))));
    tbody.querySelectorAll('[data-delete-dept]').forEach((btn) => btn.addEventListener('click', () => deleteDepartment(departments.find((x) => String(x.id) === btn.dataset.deleteDept))));
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-danger">${esc(err.message)}</td></tr>`;
  }
}

async function openDepartmentModal(dept) {
  const instituteId = document.getElementById('deptInstituteSelect').value;
  if (!instituteId) return;
  editingDepartment = dept || null;
  clearFormError('departmentError');
  document.getElementById('departmentModalTitle').textContent = dept ? 'Edit Department' : 'Add Department';
  document.getElementById('departmentName').value = dept ? dept.name : '';
  document.getElementById('departmentHead').value = dept && dept.head_name ? dept.head_name : '';
  document.getElementById('departmentHeadList').innerHTML = personSuggestions(await getStaff(instituteId), 'DEPARTMENT_HEAD');
  departmentModal.show();
}

async function submitDepartment() {
  clearFormError('departmentError');
  const instituteId = document.getElementById('deptInstituteSelect').value;
  const name = document.getElementById('departmentName').value.trim();
  const head = resolvePerson(await getStaff(instituteId), 'DEPARTMENT_HEAD', document.getElementById('departmentHead').value);
  const headUserId = head.userId;
  const headName = head.userId ? null : (head.name || null);
  if (!instituteId) {
    showFormError('departmentError', 'Select an institute first.');
    return;
  }
  if (!name) {
    showFormError('departmentError', 'Department name is required.');
    return;
  }
  try {
    if (editingDepartment) await Api.patch(`/admin/departments/${editingDepartment.id}`, { name, headUserId, headName });
    else await Api.post(`/admin/institutes/${instituteId}/departments`, { name, headUserId, headName });
    departmentModal.hide();
    departmentCache[instituteId] = undefined;
    loadDepartments();
  } catch (err) {
    showFormError('departmentError', err.message);
  }
}

async function deleteDepartment(dept) {
  const n = Number(dept.project_count);
  const message = n > 0
    ? `Delete the department "${dept.name}"? Its ${n} project(s) will also be deleted, together with their student teams, milestones, KPIs, issues, actions and reviews. Jira issues and Confluence pages already created are not removed. This cannot be undone.`
    : `Delete the department "${dept.name}"? It has no projects. This cannot be undone.`;
  const ok = await confirmDialog({ title: 'Delete department', message, requireText: n > 0 ? dept.code : undefined });
  if (!ok) return;
  try {
    await Api.del(`/admin/departments/${dept.id}?cascade=true`);
    departmentCache[document.getElementById('deptInstituteSelect').value] = undefined;
    loadDepartments();
  } catch (err) {
    alert(err.message);
  }
}

// ---------- Init ----------

async function init() {
  if (!Api.token()) {
    window.location.href = '../index.html';
    return;
  }

  currentUser = JSON.parse(localStorage.getItem('al_user') || 'null');
  const userChip = document.getElementById('userChip');
  if (currentUser) {
    userChip.textContent = `${currentUser.fullName} · ${currentUser.roleNames?.[0] || currentUser.roles?.[0] || ''}`;
  }

  if (!currentUser || !(currentUser.roles || []).some((r) => ADMIN_ROLES.includes(r))) {
    document.getElementById('accessDenied').classList.remove('d-none');
    document.getElementById('adminContent').classList.add('d-none');
    return;
  }

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    try { await Api.post('/auth/logout', {}); } catch (e) { /* ignore */ }
    Api.setToken(null);
    localStorage.removeItem('al_user');
    window.location.href = '../index.html';
  });

  document.querySelectorAll('#adminTabs .nav-link').forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

  userModal = new bootstrap.Modal(document.getElementById('userModal'));
  instituteModal = new bootstrap.Modal(document.getElementById('instituteModal'));
  confirmModal = new bootstrap.Modal(document.getElementById('confirmModal'));
  departmentModal = new bootstrap.Modal(document.getElementById('departmentModal'));
  accessModal = new bootstrap.Modal(document.getElementById('accessModal'));

  document.getElementById('btnAddUser').addEventListener('click', () => {
    clearFormError('userError');
    document.getElementById('userForm').reset();
    renderUserFormOptions();
    userModal.show();
  });
  document.getElementById('userSubmit').addEventListener('click', submitUser);
  document.getElementById('accessSubmit').addEventListener('click', submitAccess);

  document.getElementById('userSearchForm').addEventListener('submit', searchUsers);
  document.getElementById('userSearchReset').addEventListener('click', resetUserSearch);

  document.getElementById('btnAddInstitute').addEventListener('click', () => openInstituteModal(null));
  document.getElementById('instituteSubmit').addEventListener('click', submitInstitute);
  if (!isPlatformAdmin()) {
    document.getElementById('btnAddInstitute').classList.add('d-none');
  }

  document.getElementById('btnAddDepartment').addEventListener('click', () => openDepartmentModal(null));
  document.getElementById('departmentSubmit').addEventListener('click', submitDepartment);
  document.getElementById('deptInstituteSelect').addEventListener('change', loadDepartments);

  try {
    const { roles } = await Api.get('/admin/roles');
    allRoles = roles;
  } catch (err) {
    // Non-fatal - the roles lists just stay empty.
  }

  // Awaited so allInstitutes and the search filters are ready before the
  // administrator can use them.
  await loadInstitutes();
  resetUserSearch();
}

document.addEventListener('DOMContentLoaded', init);
