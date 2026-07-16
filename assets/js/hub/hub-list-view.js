/**
 * FWHubListView — ranked career list, the mobile-first alternative to the
 * canvas map (UI overhaul Phase 4, wireframe 1g).
 *
 * - List is DEFAULT below 768px; Map stays default on desktop. ?view= overrides.
 * - Ranked by fit via FWOnetVectors.rankOnetCareersFromVectors (782 careers);
 *   falls back to A-Z catalog when no quiz vector exists.
 * - Filter chips = hub zones; search = catalog titleNorm contains.
 * - Chunked "Load 30 more" — intentionally NO scroll-event lazy rendering
 *   (wireframe 1g risk note).
 * - State (view/q/zone/sort) lives in the URL query — shareable, back-safe.
 * - Does not touch canvas boot: map modules run untouched; visibility is CSS.
 */
(function (global) {
  var PAGE_SIZE = 30;
  var state = { view: 'map', q: '', zone: '', sort: 'fit', shown: PAGE_SIZE, rows: null, ranked: false };
  var root = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var JOB_ZONE_LABEL = {
    1: 'Minimal prep', 2: 'High school', 3: 'Some college',
    4: "Bachelor's typical", 5: 'Advanced degree'
  };

  function zoneLabel(z) {
    return String(z || '').replace(/[-_]/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function isMobile() {
    return global.matchMedia && matchMedia('(max-width: 768px)').matches;
  }

  function readUrl() {
    var p = new URLSearchParams(global.location.search || '');
    state.q = p.get('q') || '';
    state.zone = p.get('zone') || '';
    state.sort = p.get('sort') === 'az' ? 'az' : 'fit';
    var v = p.get('view');
    state.view = v === 'list' || v === 'map' ? v : (isMobile() ? 'list' : 'map');
  }

  function writeUrl() {
    try {
      var p = new URLSearchParams(global.location.search || '');
      ['view', 'q', 'zone', 'sort'].forEach(function (k) { p.delete(k); });
      p.set('view', state.view);
      if (state.q) p.set('q', state.q);
      if (state.zone) p.set('zone', state.zone);
      if (state.sort !== 'fit') p.set('sort', state.sort);
      history.replaceState(null, '', global.location.pathname + '?' + p.toString());
    } catch (_) { /* ignore */ }
  }

  function applyView() {
    document.body.classList.toggle('fw-hub-list-active', state.view === 'list');
    if (root) root.hidden = state.view !== 'list';
  }

  function targetSlug() {
    try {
      if (global.FWCareerTarget && typeof FWCareerTarget.resolveTargetCareer === 'function') {
        var t = FWCareerTarget.resolveTargetCareer();
        return (t && t.slug) || '';
      }
    } catch (_) { /* ignore */ }
    return '';
  }

  function catalogRow(soc) {
    if (global.FWOnetCatalog && typeof FWOnetCatalog.getBySoc === 'function') {
      return FWOnetCatalog.getBySoc(soc) || null;
    }
    return null;
  }

  function loadRows() {
    var rankFn = global.FWOnetVectors && FWOnetVectors.rankOnetCareersFromVectors;
    var fromCatalog = function () {
      var all = (global.FWOnetCatalog && FWOnetCatalog.getAll && FWOnetCatalog.getAll()) || [];
      state.ranked = false;
      return all.map(function (r) {
        return { soc: r.soc, name: r.title, slug: null, score: null };
      }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    };
    var loadCatalog = global.FWOnetCatalog && FWOnetCatalog.load
      ? FWOnetCatalog.load() : Promise.resolve();
    return loadCatalog.then(function () {
      if (!rankFn) return fromCatalog();
      return rankFn({ limit: 782 }).then(function (ranked) {
        if (!ranked || !ranked.length) return fromCatalog();
        state.ranked = true;
        return ranked;
      }).catch(fromCatalog);
    });
  }

  function filteredRows() {
    var rows = state.rows || [];
    var q = state.q.trim().toLowerCase();
    if (q) rows = rows.filter(function (r) { return (r.name || '').toLowerCase().indexOf(q) !== -1; });
    if (state.zone) {
      rows = rows.filter(function (r) {
        var c = catalogRow(r.soc);
        return c && c.hubZone === state.zone;
      });
    }
    if (state.sort === 'az') {
      rows = rows.slice().sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
    }
    return rows;
  }

  function rowHtml(r, tSlug) {
    var c = catalogRow(r.soc) || {};
    var href = 'career.html?slug=' + encodeURIComponent(r.slug || r.soc)
      + (r.soc ? '&soc=' + encodeURIComponent(r.soc) : '');
    var isTarget = tSlug && r.slug && r.slug === tSlug;
    var score = Number.isFinite(r.score) ? String(Math.round(r.score)) : '–';
    var sub = [zoneLabel(c.hubZone), JOB_ZONE_LABEL[c.jobZone]].filter(Boolean).join(' · ')
      + (isTarget ? ' · ★ your target' : '');
    return '<a class="fw-hlv-row' + (isTarget ? ' is-target' : '') + '" href="' + esc(href) + '">'
      + '<b class="fw-hlv-score">' + esc(score) + '</b>'
      + '<span class="fw-hlv-body"><b class="fw-hlv-name">' + esc(r.name) + '</b>'
      + '<span class="fw-hlv-sub">' + esc(sub) + '</span></span>'
      + '<span class="fw-hlv-chev" aria-hidden="true">&rsaquo;</span>'
      + '</a>';
  }

  function zones() {
    var all = (global.FWOnetCatalog && FWOnetCatalog.getAll && FWOnetCatalog.getAll()) || [];
    var seen = {};
    all.forEach(function (r) { if (r.hubZone) seen[r.hubZone] = true; });
    return Object.keys(seen).sort();
  }

  function render() {
    if (!root) return;
    var rows = filteredRows();
    var tSlug = targetSlug();
    var shown = rows.slice(0, state.shown);
    var chips = ['<button type="button" class="fw-hlv-chip' + (!state.zone ? ' is-on' : '') + '" data-zone="">Best fit</button>']
      .concat(zones().map(function (z) {
        return '<button type="button" class="fw-hlv-chip' + (state.zone === z ? ' is-on' : '') + '" data-zone="' + esc(z) + '">' + esc(zoneLabel(z)) + '</button>';
      })).join('');

    root.innerHTML = ''
      + '<div class="fw-hlv-head">'
      + '<div class="fw-hlv-titlerow"><h2 class="fw-hlv-title">Explore careers</h2>'
      + '<div class="fw-hlv-viewtoggle" role="group" aria-label="View">'
      + '<button type="button" class="fw-hlv-vbtn is-on" data-view="list" aria-pressed="true">List</button>'
      + '<button type="button" class="fw-hlv-vbtn" data-view="map" aria-pressed="false">Map</button>'
      + '</div></div>'
      + '<input class="fw-hlv-search" type="search" placeholder="Search ' + rowsCountLabel() + ' careers…" value="' + esc(state.q) + '" aria-label="Search careers">'
      + '<div class="fw-hlv-chips">' + chips + '</div>'
      + '<div class="fw-hlv-meta"><span>' + (state.ranked ? 'Ranked by fit to <b>your</b> profile' : '<a href="quiz.html" class="fw-hlv-quizlink">Take the quiz</a> to rank by fit') + '</span>'
      + '<button type="button" class="fw-hlv-sort">Sort: ' + (state.sort === 'fit' ? 'Fit' : 'A–Z') + ' ▾</button></div>'
      + '</div>'
      + '<div class="fw-hlv-list">' + (shown.length ? shown.map(function (r) { return rowHtml(r, tSlug); }).join('') : '<p class="fw-hlv-empty">No careers match. Clear search or filters.</p>') + '</div>'
      + (rows.length > state.shown
        ? '<button type="button" class="fw-hlv-more">Load ' + Math.min(PAGE_SIZE, rows.length - state.shown) + ' more (' + (rows.length - state.shown) + ' left)</button>'
        : '');

    bind();
  }

  function rowsCountLabel() {
    return state.rows ? state.rows.length : 782;
  }

  function bind() {
    root.querySelectorAll('.fw-hlv-vbtn').forEach(function (b) {
      b.addEventListener('click', function () {
        state.view = b.getAttribute('data-view') === 'map' ? 'map' : 'list';
        writeUrl(); applyView();
      });
    });
    var search = root.querySelector('.fw-hlv-search');
    var debounce = null;
    if (search) {
      search.addEventListener('input', function () {
        clearTimeout(debounce);
        debounce = setTimeout(function () {
          state.q = search.value || '';
          state.shown = PAGE_SIZE;
          writeUrl(); render();
          var s2 = root.querySelector('.fw-hlv-search');
          if (s2) { s2.focus(); s2.setSelectionRange(s2.value.length, s2.value.length); }
        }, 180);
      });
    }
    root.querySelectorAll('.fw-hlv-chip').forEach(function (b) {
      b.addEventListener('click', function () {
        state.zone = b.getAttribute('data-zone') || '';
        state.shown = PAGE_SIZE;
        writeUrl(); render();
      });
    });
    var sort = root.querySelector('.fw-hlv-sort');
    if (sort) {
      sort.addEventListener('click', function () {
        state.sort = state.sort === 'fit' ? 'az' : 'fit';
        state.shown = PAGE_SIZE;
        writeUrl(); render();
      });
    }
    var more = root.querySelector('.fw-hlv-more');
    if (more) {
      more.addEventListener('click', function () {
        state.shown += PAGE_SIZE;
        render();
      });
    }
    if (global.FWEvents) FWEvents.log('hub_list_render', { n: state.shown, zone: state.zone, ranked: state.ranked });
  }

  function mountMapToggle() {
    // Small floating "List" switch visible in map view on mobile.
    if (document.getElementById('fw-hlv-maptoggle')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'fw-hlv-maptoggle';
    btn.className = 'fw-hlv-maptoggle';
    btn.textContent = 'List view';
    btn.addEventListener('click', function () {
      state.view = 'list';
      writeUrl(); applyView();
    });
    document.body.appendChild(btn);
  }

  function boot() {
    root = document.getElementById('fw-hub-list');
    if (!root) return;
    readUrl();
    applyView();
    mountMapToggle();
    loadRows().then(function (rows) {
      state.rows = rows || [];
      render();
      applyView();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  global.FWHubListView = { refresh: boot };
})(window);
