function getInstituteId() {
  return new URLSearchParams(window.location.search).get('id');
}

async function init() {
  if (!Api.token()) {
    window.location.href = '../index.html';
    return;
  }

  const instituteId = getInstituteId();
  if (!instituteId) {
    window.location.href = 'institutes.html';
    return;
  }

  const userChip = document.getElementById('userChip');
  const storedUser = JSON.parse(localStorage.getItem('al_user') || 'null');
  if (storedUser) {
    userChip.textContent = `${storedUser.fullName} · ${storedUser.roleNames?.[0] || storedUser.roles?.[0] || ''}`;
    if ((storedUser.roles || []).some((r) => ['PLATFORM_ADMIN', 'INSTITUTE_ADMIN'].includes(r))) {
      document.getElementById('navAdmin').classList.remove('d-none');
    }
  }

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    try { await Api.post('/auth/logout', {}); } catch (e) { /* ignore */ }
    Api.setToken(null);
    localStorage.removeItem('al_user');
    window.location.href = '../index.html';
  });

  try {
    const [instResp, totalsResp, deptResp] = await Promise.all([
      Api.get(`/institutes/${instituteId}`),
      Api.get(`/dashboard/institute/${instituteId}`),
      Api.get(`/institutes/${instituteId}/departments`),
    ]);

    document.getElementById('instituteName').textContent = instResp.institute.name;
    document.getElementById('instituteTitle').textContent = instResp.institute.name;

    const totals = totalsResp.totals;
    const departments = deptResp.departments;
    document.getElementById('statDepartments').textContent = totals.total_departments;
    document.getElementById('statTotal').textContent = totals.total_projects;
    document.getElementById('statGreen').textContent = totals.green_count;
    document.getElementById('statYellow').textContent = totals.yellow_count;
    document.getElementById('statRed').textContent = totals.red_count;

    const rows = departments.map((d) => `
      <tr>
        <td><a href="department-dashboard.html?id=${esc(d.id)}"><strong>${esc(d.name)}</strong></a> <span class="text-muted">(${esc(d.code)})</span></td>
        <td>${d.head_name ? esc(d.head_name) : '<span class="text-muted">Not assigned</span>'}</td>
        <td class="text-end">${esc(d.project_count)}</td>
        <td class="text-end">${esc(d.green_count)}</td>
        <td class="text-end">${esc(d.yellow_count)}</td>
        <td class="text-end">${esc(d.red_count)}</td>
      </tr>`);

    document.getElementById('departmentTableBody').innerHTML =
      rows.length ? rows.join('') : '<tr><td colspan="6" class="text-muted">No departments found.</td></tr>';
  } catch (err) {
    document.getElementById('departmentTableBody').innerHTML =
      `<tr><td colspan="6" class="text-danger">Failed to load institute: ${esc(err.message)}</td></tr>`;
  }
}

document.addEventListener('DOMContentLoaded', init);
