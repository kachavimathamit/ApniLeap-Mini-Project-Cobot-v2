// The Projects / Issues / Reviews lists. They live as tabs on the Reports page:
//   PortfolioList.mount('projects' | 'issues' | 'reviews', containerElement)
// Each list builds its own filters and table inside the container, so all three
// can exist on one page. The server limits every list to what the user may see.
const PortfolioList = (() => {
  function fmtDate(iso) {
    return iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '<span class="text-muted">&ndash;</span>';
  }
  function projectCell(code, title, id, institute, extra) {
    return `<a href="project-dashboard.html?id=${esc(id)}"><strong>${esc(title)}</strong></a><br><span class="text-muted" style="font-size:12.5px">${esc(code)} &middot; ${esc(institute)}${extra ? ` &middot; ${extra}` : ''}</span>`;
  }

  const VIEWS = {
    projects: {
      subtitle: 'All projects in your authorized scope',
      endpoint: '/portfolio/projects',
      key: 'projects',
      columns: ['Project', 'Department', 'Mentor', 'RAG', 'Completion', 'Next Review'],
      row: (p) => `<tr>
        <td>${projectCell(p.project_code, p.title, p.id, p.institute_name, `${esc(p.team_id)} &middot; ${esc(p.artefact_id)}${p.theme_name ? ` &middot; Theme: ${esc(p.theme_name)}` : ''}`)}</td>
        <td>${esc(p.department_name)}</td>
        <td>${p.mentor_name ? esc(p.mentor_name) : '<span class="text-muted">Unassigned</span>'}</td>
        <td>${ragBadge(p.rag_status)}</td>
        <td class="text-end">${esc(p.completion_pct)}%</td>
        <td>${fmtDate(p.next_review_at)}</td></tr>`,
      empty: 'No projects in your authorized scope.',
      filter: { label: 'RAG status', param: 'status', options: [['', 'All'], ['RED', 'Red'], ['YELLOW', 'Yellow'], ['GREEN', 'Green']] },
      search: true,
      cascade: true,   // Institute -> Department -> Faculty Mentor / Theme filters
    },
    issues: {
      subtitle: 'Challenges and issues across your authorized projects',
      endpoint: '/portfolio/issues',
      key: 'issues',
      columns: ['Issue', 'Project', 'Escalation', 'Status', 'Raised'],
      row: (i) => `<tr>
        <td><strong>${esc(i.title)}</strong></td>
        <td>${projectCell(i.project_code, i.project_title, i.project_id, i.institute_name)}</td>
        <td>${esc(i.escalation_level)}</td>
        <td>${esc(i.status.replace('_', ' '))}</td>
        <td>${fmtDate(i.created_at)}</td></tr>`,
      empty: 'No issues in your authorized scope.',
      filter: { label: 'Status', param: 'status', options: [['', 'All'], ['OPEN', 'Open'], ['IN_PROGRESS', 'In progress'], ['RESOLVED', 'Resolved'], ['CLOSED', 'Closed']] },
    },
    reviews: {
      subtitle: 'Reviews recorded across your authorized projects',
      endpoint: '/portfolio/reviews',
      key: 'reviews',
      columns: ['Date', 'Project', 'Reviewer', 'Comments', 'Decision', 'Recommended'],
      row: (r) => `<tr>
        <td>${fmtDate(r.review_date)}</td>
        <td>${projectCell(r.project_code, r.project_title, r.project_id, r.institute_name)}</td>
        <td>${r.reviewer_name ? esc(r.reviewer_name) : '<span class="text-muted">Unknown</span>'}</td>
        <td>${esc(r.comments)}</td>
        <td>${r.decision ? esc(r.decision) : '<span class="text-muted">&ndash;</span>'}</td>
        <td>${ragBadge(r.recommended_status)}</td></tr>`,
      empty: 'No reviews recorded in your authorized scope.',
    },
  };

  function subtitleOf(view) { return VIEWS[view].subtitle; }

  function mount(view, root) {
    const cfg = VIEWS[view];
    const $ = (role) => root.querySelector(`[data-role="${role}"]`);
    const hasFilters = Boolean(cfg.filter || cfg.search);

    root.innerHTML = `
      ${hasFilters ? '<div class="al-card mb-3"><div class="row g-2 align-items-end" data-role="filterRow"></div></div>' : ''}
      <div class="d-flex justify-content-end mb-1"><span class="al-page-subtitle" data-role="count"></span></div>
      <div class="al-card">
        <div class="table-responsive">
          <table class="table al-table">
            <thead><tr>${cfg.columns.map((c) => `<th>${c}</th>`).join('')}</tr></thead>
            <tbody data-role="body"></tbody>
          </table>
        </div>
      </div>`;

    const row = $('filterRow');
    const cascadeClass = cfg.cascade ? 'col-6 col-md-4 col-lg-2' : 'col-6 col-md-3';
    if (cfg.search) {
      const div = document.createElement('div');
      div.className = cfg.cascade ? 'col-12 col-md-4 col-lg-2' : 'col-12 col-md-4';
      div.innerHTML = `<label class="form-label mb-1">Search</label>
        <input data-role="search" class="form-control form-control-sm" placeholder="${cfg.cascade ? 'Project, ID, theme or mentor' : 'Project name or ID'}">`;
      row.appendChild(div);
    }
    let filterDiv = null;
    if (cfg.filter) {
      filterDiv = document.createElement('div');
      filterDiv.className = cascadeClass;
      filterDiv.innerHTML = `<label class="form-label mb-1">${cfg.filter.label}</label>
        <select data-role="filter" class="form-select form-select-sm">${cfg.filter.options.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>`;
      row.appendChild(filterDiv);
    }

    async function load() {
      const params = new URLSearchParams();
      const filterEl = $('filter');
      const searchEl = $('search');
      if (filterEl && filterEl.value) params.set(cfg.filter.param, filterEl.value);
      for (const [role, param] of [['institute', 'instituteId'], ['department', 'departmentId'], ['mentor', 'mentor'], ['theme', 'theme']]) {
        const el = $(role);
        if (el && el.value) params.set(param, el.value);
      }
      if (searchEl && searchEl.value.trim()) params.set('search', searchEl.value.trim());
      const tbody = $('body');
      tbody.innerHTML = `<tr><td colspan="${cfg.columns.length}" class="text-muted">Loading…</td></tr>`;
      try {
        const data = await Api.get(`${cfg.endpoint}${params.toString() ? `?${params}` : ''}`);
        const rows = data[cfg.key];
        $('count').textContent = `${rows.length} record${rows.length === 1 ? '' : 's'}`;
        tbody.innerHTML = rows.length ? rows.map(cfg.row).join('') : `<tr><td colspan="${cfg.columns.length}" class="text-muted">${cfg.empty}</td></tr>`;
      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="${cfg.columns.length}" class="text-danger">Failed to load: ${esc(err.message)}</td></tr>`;
      }
    }

    if ($('filter')) $('filter').addEventListener('change', load);
    if ($('search')) $('search').addEventListener('input', load);
    if (cfg.cascade) setupCascade(root, row, cascadeClass, filterDiv, load);
    load();
    return { reload: load };
  }

  // ---- Institute -> Department -> Faculty Mentor / Theme ----
  // Each choice narrows the next. Institutes and departments come from what the
  // user is allowed to see (the server enforces that), and the mentor and theme
  // lists come from the projects inside the chosen department.
  async function setupCascade(root, row, cls, anchor, load) {
    let institutes = [];
    try { institutes = (await Api.get('/institutes')).institutes; } catch (e) { return; }
    if (!institutes.length) return;   // e.g. a student: only search and status apply

    const pick = (role, label, first, disabled) => {
      const div = document.createElement('div');
      div.className = cls;
      div.innerHTML = `<label class="form-label mb-1">${label}</label>
        <select data-role="${role}" class="form-select form-select-sm"${disabled ? ' disabled' : ''}><option value="">${first}</option></select>`;
      row.insertBefore(div, anchor);
    };
    pick('institute', 'Institute', 'All institutes', false);
    pick('department', 'Department', 'All departments', true);
    pick('mentor', 'Faculty Mentor', 'All mentors', true);
    pick('theme', 'Theme', 'All themes', true);

    const $ = (role) => root.querySelector(`[data-role="${role}"]`);
    const fill = (role, first, values, toOption) => {
      $(role).innerHTML = `<option value="">${first}</option>` + values.map(toOption).join('');
      $(role).disabled = !values.length;
    };
    fill('institute', 'All institutes', institutes, (i) => `<option value="${esc(i.id)}">${esc(i.name)}</option>`);
    $('institute').disabled = false;

    async function refreshPeople() {
      const dept = $('department').value;
      if (!dept) {
        fill('mentor', 'All mentors', [], () => '');
        fill('theme', 'All themes', [], () => '');
        return;
      }
      try {
        const { mentors, themes } = await Api.get(`/portfolio/filters?instituteId=${encodeURIComponent($('institute').value)}&departmentId=${encodeURIComponent(dept)}`);
        fill('mentor', 'All mentors', mentors, (m) => `<option value="${esc(m)}">${esc(m)}</option>`);
        fill('theme', 'All themes', themes, (t) => `<option value="${esc(t)}">${esc(t)}</option>`);
      } catch (e) { /* the lists stay empty */ }
    }

    $('institute').addEventListener('change', async () => {
      const inst = $('institute').value;
      fill('department', 'All departments', [], () => '');
      await refreshPeople();
      if (inst) {
        try {
          const { departments } = await Api.get(`/institutes/${encodeURIComponent(inst)}/departments`);
          fill('department', 'All departments', departments, (d) => `<option value="${esc(d.id)}">${esc(d.name)}</option>`);
        } catch (e) { /* stays empty */ }
      }
      load();
    });
    $('department').addEventListener('change', async () => { await refreshPeople(); load(); });
    $('mentor').addEventListener('change', load);
    $('theme').addEventListener('change', load);
  }

  return { mount, subtitleOf };
})();
