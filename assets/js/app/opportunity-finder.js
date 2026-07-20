/**
 * FlightWay — "Opportunities for you" panel (roadmap focus view, premium).
 * Grounded course/competition/fellowship/student-org matches for the user's
 * top O*NET skill gaps, from GET /opportunities. Read-only over the roadmap.
 *
 * renderFocusView rebuilds #roadmap-focus-view's innerHTML on every persist,
 * so mount() is idempotent-by-reappend: it re-creates the <section> inside
 * .roadmap-focus-inner and re-renders from module-state cache — the network
 * fetch runs once per cache key, never per re-render.
 *
 * The cache key is career + the gap dimIndex set, NOT career alone. That
 * matters on a freshly generated roadmap: the server saves a v1 focusTracker
 * whose gaps carry no dimIndex, and /opportunities filters on dimIndex, so the
 * first mount is answered 'no-gaps'. The v3 coordinate tracker is built
 * client-side moments later (skill-gap-tracker's off-render-path recompute)
 * and persisted; keying on the gap set means that persist re-renders the focus
 * panel, the key changes, and the search fires on its own. Keyed on career
 * alone, the first empty stuck for the whole session — that was the bug.
 */
(function (global) {
  'use strict';

  var TYPE_LABELS = { course: 'Course', competition: 'Competition', fellowship: 'Fellowship', student_org: 'Student org' };
  var TIER_LABELS = { high: 'High impact', medium: 'Medium impact', low: 'Low impact' };

  // Matches the server's per-user result cache (CACHE_TTL_SEC, 1 day), so a
  // tab left open for days re-runs the research instead of showing stale
  // matches. New opportunities post continuously; a day-old set is the floor.
  var REFRESH_MS = 24 * 60 * 60 * 1000;
  // The client's roadmap save is debounced (300ms) and then async, so a mount
  // triggered by the v3 persist can still beat the server's copy. Retry a
  // couple of times before accepting 'no-gaps' as the real answer.
  var RETRY_MS = [1500, 4000];

  var state = {
    key: '',            // career + gap-set key the cached response belongs to
    tree: null,         // last mounted roadmap (retries re-read its gap set)
    data: null,         // last successful GET /opportunities body
    status: 'idle',     // idle | loading | ready | empty | gated
    fetchedAtMs: 0,     // when the cached body landed (client clock)
    retries: 0,         // consecutive stale-server retries for the current key
    retryTimer: null,
    school: '',
    schoolEditing: false,
    schoolSaving: false,
    schoolError: false,
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function careerKeyFor(tree) {
    return String((tree && (tree.targetCareerSlug || tree.targetCareerName)) || '');
  }

  // The gaps /opportunities can actually match on — same filter the server
  // applies (label + dimIndex). Empty until the coordinate tracker exists.
  function gapDimsFor(tree) {
    return ((tree && tree.focusTracker && tree.focusTracker.skillGaps) || [])
      .filter(function (gp) { return gp && gp.label && gp.dimIndex != null; })
      .map(function (gp) { return gp.dimIndex; })
      .sort(function (a, b) { return a - b; })
      .join('.');
  }

  function cacheKeyFor(tree) {
    return careerKeyFor(tree) + '|' + gapDimsFor(tree);
  }

  function clearRetry() {
    if (state.retryTimer) { clearTimeout(state.retryTimer); state.retryTimer = null; }
  }

  function isStale() {
    return !state.fetchedAtMs || (Date.now() - state.fetchedAtMs) > REFRESH_MS;
  }

  function ensureSection(panel) {
    var inner = panel.querySelector('.roadmap-focus-inner');
    if (!inner) return null;
    var el = inner.querySelector('#oppf-panel');
    if (!el) {
      el = document.createElement('section');
      el.className = 'oppf';
      el.id = 'oppf-panel';
      inner.appendChild(el);
    }
    return el;
  }

  function currentSection() {
    return document.getElementById('oppf-panel');
  }

  function rerender() {
    var el = currentSection();
    if (!el || !el.isConnected) return;
    if (state.status === 'ready') renderList(el);
    else if (state.status === 'empty') renderEmpty(el);
    else if (state.status === 'gated') renderGate(el);
    else renderSkeleton(el);
  }

  function headingHtml() {
    return '<h3 class="oppf-heading">Opportunities for you</h3>'
      + '<p class="oppf-sub">Live courses, competitions, fellowships and orgs matched to your skill gaps.</p>';
  }

  function renderSkeleton(el) {
    el.innerHTML = headingHtml()
      + '<div class="oppf-skel" role="status" aria-busy="true">'
      + '<div class="fw-skeleton oppf-skel-bar" aria-hidden="true"></div>'
      + '<div class="fw-skeleton oppf-skel-bar" aria-hidden="true"></div>'
      + '<div class="fw-skeleton oppf-skel-bar" aria-hidden="true"></div>'
      + '<span class="fw-vh">Loading opportunities…</span>'
      + '</div>';
  }

  function renderGate(el) {
    el.innerHTML = headingHtml();
    var wrap = document.createElement('div');
    el.appendChild(wrap);
    var gated = global.FWEnt && typeof FWEnt.gate === 'function' && FWEnt.gate(wrap, 'opportunities');
    if (!gated) {
      // Server said 402 while the client's entitlement state says premium
      // (e.g. stale /config right after the paywall flips): FWEnt.gate
      // no-ops, so render the same CTA markup directly.
      wrap.innerHTML = '<div class="fw-ent-gate">'
        + '<p class="fw-ent-gate-title">A Flight Plan feature</p>'
        + '<p class="fw-ent-gate-sub">Unlock opportunity matching, interview prep, the resume builder, unlimited sims and weekly plans.</p>'
        + '<a class="fw-ent-gate-cta" href="pricing.html">See Flight Plan &rarr;</a>'
        + '</div>';
    }
  }

  function itemHtml(op) {
    if (!op) return '';
    var url = String(op.url || '');
    if (url.indexOf('https://') !== 0) return '';
    var tier = TIER_LABELS[op.impactTier] || 'Related';
    return '<li class="oppf-item">'
      + '<div class="oppf-item-head">'
      + '<span class="oppf-type oppf-type--' + esc(op.type) + '">' + esc(TYPE_LABELS[op.type] || 'Opportunity') + '</span>'
      + '<span class="oppf-tier oppf-tier--' + esc(op.impactTier) + '">' + esc(tier) + ' · ' + esc(op.gapLabel) + '</span>'
      + '</div>'
      + '<a class="oppf-title" href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(op.title) + '</a>'
      + (op.org || op.deadline
        ? '<p class="oppf-org">' + esc(op.org || '')
          + (op.org && op.deadline ? ' · ' : '')
          + (op.deadline ? 'Deadline ' + esc(op.deadline) : '') + '</p>'
        : '')
      + (op.whyThisFits ? '<p class="oppf-why">' + esc(op.whyThisFits) + '</p>' : '')
      + '</li>';
  }

  function schoolHtml() {
    if (state.school && !state.schoolEditing) {
      return '<p class="oppf-school">Org matches personalized for <strong>' + esc(state.school) + '</strong>'
        + ' <button type="button" class="oppf-school-change">Change</button></p>';
    }
    return '<div class="oppf-school-row">'
      + '<input type="text" class="oppf-school-input" maxlength="80" placeholder="Your school (optional)"'
      + ' aria-label="Your school" value="' + esc(state.school) + '"' + (state.schoolSaving ? ' disabled' : '') + '>'
      + '<button type="button" class="oppf-school-save"' + (state.schoolSaving ? ' disabled' : '') + '>'
      + (state.schoolSaving ? 'Saving…' : 'Save') + '</button>'
      + '<span class="oppf-school-hint">'
      + (state.schoolError
        ? 'Could not save — try again.'
        : (state.school
          // Prefilled from the profile (saved value, else what the student told
          // Marco), so this row is a correction, not data entry.
          ? 'Change your school to re-match orgs and campus programs.'
          : 'Add your school to personalize org matches.'))
      + '</span>'
      + '</div>';
  }

  function footerHtml() {
    var asOf = state.data && state.data.grounded && state.data.fetchedAt
      ? '<p class="oppf-asof">Opportunities checked as of ' + esc(String(state.data.fetchedAt).slice(0, 10)) + '</p>'
      : '';
    return '<div class="oppf-foot">' + asOf + schoolHtml() + '</div>';
  }

  function wireFooter(el) {
    var save = el.querySelector('.oppf-school-save');
    var input = el.querySelector('.oppf-school-input');
    var change = el.querySelector('.oppf-school-change');
    if (save && input) {
      save.addEventListener('click', function () { saveSchool(input.value); });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); saveSchool(input.value); }
      });
    }
    if (change) {
      change.addEventListener('click', function () {
        state.schoolEditing = true;
        rerender();
        var inp = currentSection() && currentSection().querySelector('.oppf-school-input');
        if (inp) inp.focus();
      });
    }
  }

  function renderList(el) {
    var ops = (state.data && state.data.opportunities) || [];
    el.innerHTML = headingHtml()
      + '<ul class="oppf-list">' + ops.map(itemHtml).join('') + '</ul>'
      + footerHtml();
    wireFooter(el);
  }

  function renderEmpty(el) {
    el.innerHTML = headingHtml()
      + '<p class="oppf-empty">No live opportunity matches right now — check back soon.</p>'
      + footerHtml();
    wireFooter(el);
  }

  function fetchData() {
    // The gap set can change mid-flight (the v3 tracker landing is exactly
    // that), which starts a second fetch. Stamp the response with the key it
    // was issued for so a slow stale reply can't overwrite a fresh one.
    var forKey = state.key;
    // Worst case ≈ 3×8s research + 20s shaping server-side — the 30s
    // authFetch default is too short for a cold cache.
    return FWAuth.authFetch('/opportunities', { timeoutMs: 60000 })
      .then(function (r) {
        if (state.key !== forKey) return null;
        if (r.status === 402) { state.status = 'gated'; rerender(); return null; }
        if (!r.ok) throw new Error('opportunities fetch failed');
        return r.json();
      })
      .then(function (data) {
        if (!data || state.key !== forKey) return;
        var hits = data.opportunities && data.opportunities.length;
        // 'no-gaps' is the one transient reason: the server is reading a
        // roadmap copy whose focusTracker is still the v1 (dimIndex-less) one
        // this session is in the middle of replacing. Hold the skeleton and
        // retry instead of flashing "no matches" and caching that for the
        // session. The other reasons (grounding-off, no-results, shape-failed)
        // are settled answers for this request.
        if (!hits && data.reason === 'no-gaps' && state.retries < RETRY_MS.length) {
          var wait = RETRY_MS[state.retries];
          state.retries += 1;
          state.school = String(data.school || state.school || '');
          state.status = 'loading';
          rerender();
          clearRetry();
          state.retryTimer = setTimeout(function () {
            state.retryTimer = null;
            if (state.key === forKey) fetchData();
          }, wait);
          return;
        }
        state.data = data;
        state.school = String(data.school || '');
        state.fetchedAtMs = Date.now();
        state.status = hits ? 'ready' : 'empty';
        rerender();
      })
      .catch(function () {
        if (state.key !== forKey) return;
        state.fetchedAtMs = Date.now();
        state.status = 'empty';
        rerender();
      });
  }

  function saveSchool(value) {
    if (state.schoolSaving) return;
    var school = String(value || '').trim().slice(0, 80);
    state.schoolSaving = true;
    state.schoolError = false;
    rerender();
    FWAuth.authFetch('/opportunities', { method: 'POST', body: { school: school }, timeoutMs: 20000 })
      .then(function (r) {
        if (!r.ok) throw new Error('school save failed');
        return r.json();
      })
      .then(function (resp) {
        state.school = String((resp && resp.school) || '');
        state.schoolSaving = false;
        state.schoolEditing = false;
        // Mirror the server-side write into the local quiz copy so local
        // readers agree until the next full profile sync. sync:false — the
        // server already holds this write; no upload round-trip needed.
        try {
          if (window.FWUser && FWUser.get()) {
            FWUser.update(function (u) {
              if (state.school) u.identity.school = state.school;
              else delete u.identity.school;
            }, { sync: false });
          }
        } catch (_) { /* local mirror is best-effort */ }
        // School is part of the server's cache key, so this re-GET is a true
        // miss and re-runs the org query with the new school.
        state.data = null;
        state.status = 'loading';
        state.retries = 0;
        rerender();
        return fetchData();
      })
      .catch(function () {
        state.schoolSaving = false;
        state.schoolError = true;
        rerender();
      });
  }

  function mount(panel, tree) {
    if (!panel || !tree || !global.FWAuth || typeof FWAuth.authFetch !== 'function') return;
    if (typeof FWAuth.authEmail === 'function' && !FWAuth.authEmail()) return; // signed out: render nothing
    var el = ensureSection(panel);
    if (!el) return;
    state.tree = tree;
    var key = cacheKeyFor(tree);
    if (state.key !== key) {
      // Career changed, or the coordinate tracker just replaced the gap set:
      // the cached answer no longer describes this roadmap.
      clearRetry();
      state.key = key;
      state.data = null;
      state.status = 'idle';
      state.fetchedAtMs = 0;
      state.retries = 0;
    }
    if (state.status === 'gated') {
      rerender();
      return;
    }
    if ((state.status === 'ready' || state.status === 'empty') && !isStale()) {
      rerender();
      return;
    }
    if (isStale() && (state.status === 'ready' || state.status === 'empty')) {
      // Past the server's cache window — re-run rather than show day-old
      // matches to someone who left the tab open.
      state.status = 'idle';
      state.retries = 0;
    }
    renderSkeleton(el);
    if (state.status === 'loading') return; // in-flight fetch re-renders on completion
    state.status = 'loading';
    var boot = global.FWEnt && typeof FWEnt.boot === 'function' ? FWEnt.boot() : Promise.resolve();
    Promise.resolve(boot).then(function () {
      if (global.FWEnt && typeof FWEnt.has === 'function' && !FWEnt.has('premium')) {
        state.status = 'gated';
        rerender();
        return null;
      }
      return fetchData();
    }).catch(function () {
      state.status = 'empty';
      rerender();
    });
  }

  global.FWOppFinder = { mount: mount };
})(typeof window !== 'undefined' ? window : globalThis);
