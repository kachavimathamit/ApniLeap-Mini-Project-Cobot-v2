function ragBar(green, yellow, red) {
  const total = Number(green) + Number(yellow) + Number(red);
  if (total === 0) return '<span class="text-muted">No projects</span>';
  const pct = (n) => (Number(n) / total) * 100;
  return `
    <div class="d-flex align-items-center gap-2">
      <div class="flex-grow-1" style="height:8px;border-radius:4px;overflow:hidden;display:flex;min-width:80px;background:#eee;">
        <div style="width:${pct(green)}%;background:var(--al-dot-green)"></div>
        <div style="width:${pct(yellow)}%;background:var(--al-dot-yellow)"></div>
        <div style="width:${pct(red)}%;background:var(--al-dot-red)"></div>
      </div>
    </div>`;
}

async function init() {
  if (!Api.token()) {
    window.location.href = '../index.html';
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
    const data = await Api.get('/dashboard/programme');

    document.getElementById('statTotal').textContent = data.totals.total_projects;
    document.getElementById('statGreen').textContent = data.totals.green_count;
    document.getElementById('statYellow').textContent = data.totals.yellow_count;
    document.getElementById('statRed').textContent = data.totals.red_count;
    document.getElementById('statOverdue').textContent = data.totals.overdue_review_count;
    document.getElementById('statUpcoming').textContent = data.totals.upcoming_review_count;

    document.getElementById('refreshedAt').textContent =
      `Last refreshed ${new Date(data.generatedAt).toLocaleString()}`;

    const tbody = document.getElementById('instituteTableBody');
    if (!data.institutes.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-muted">No institutes in your authorized scope.</td></tr>';
    } else {
      tbody.innerHTML = data.institutes.map((inst) => `
        <tr>
          <td><a href="institute-dashboard.html?id=${esc(inst.id)}"><strong>${esc(inst.name)}</strong></a> <span class="text-muted">(${esc(inst.code)})</span></td>
          <td class="text-end">${esc(inst.total_projects)}</td>
          <td class="text-end">${esc(inst.green_count)}</td>
          <td class="text-end">${esc(inst.yellow_count)}</td>
          <td class="text-end">${esc(inst.red_count)}</td>
          <td>${ragBar(inst.green_count, inst.yellow_count, inst.red_count)}</td>
        </tr>
      `).join('');
    }
  } catch (err) {
    document.getElementById('instituteTableBody').innerHTML =
      `<tr><td colspan="6" class="text-danger">Failed to load dashboard: ${esc(err.message)}</td></tr>`;
  }
}

document.addEventListener('DOMContentLoaded', init);
