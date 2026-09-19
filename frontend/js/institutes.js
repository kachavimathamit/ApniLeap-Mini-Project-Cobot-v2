// Plain coloured status circles. Colour is the only visual cue, so each carries
// a tooltip and screen-reader text naming the status.
const RAG_ICONS = {
  green: {
    label: 'Green - On Track',
    svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor"/></svg>',
  },
  yellow: {
    label: 'Yellow - At Risk',
    svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor"/></svg>',
  },
  red: {
    label: 'Red - Intervention Required',
    svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor"/></svg>',
  },
};

function ragCount(kind, count) {
  const { label, svg } = RAG_ICONS[kind];
  return `<div class="al-inst-rag rag-${kind}" title="${label}">
    <span class="al-inst-icon">${svg}</span>
    <span class="al-inst-num">${count}</span>
    <span class="visually-hidden">${label}</span>
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

  const container = document.getElementById('instituteCards');

  try {
    const data = await Api.get('/dashboard/programme');

    if (!data.institutes.length) {
      container.innerHTML = '<div class="col-12 text-muted">No institutes in your authorized scope.</div>';
      return;
    }

    container.innerHTML = data.institutes.map((inst) => `
      <div class="col-12 col-md-6 col-lg-4">
        <a href="institute-dashboard.html?id=${esc(inst.id)}" class="text-decoration-none text-reset">
          <div class="al-card h-100">
            <h3 class="mb-1">${esc(inst.name)}</h3>
            <p class="al-page-subtitle mb-3">${esc(inst.code)}</p>
            <div class="al-inst-counts">
              <div class="al-inst-total"><span class="al-inst-num">${esc(inst.total_projects)}</span><span class="al-inst-cap">Projects</span></div>
              ${ragCount('green', inst.green_count)}
              ${ragCount('yellow', inst.yellow_count)}
              ${ragCount('red', inst.red_count)}
            </div>
          </div>
        </a>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = `<div class="col-12 text-danger">Failed to load institutes: ${esc(err.message)}</div>`;
  }
}

document.addEventListener('DOMContentLoaded', init);
