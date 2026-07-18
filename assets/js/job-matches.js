/* Good Fit Jobs (FWJobs) — renders real internship / entry-level postings matched to
   the user's top-fit careers. Two surfaces: the Home card (portal.html) and a
   per-career block on the deep-dive page (career.html).

   Invariants:
   - All Adzuna text is untrusted → inserted via textContent only, never innerHTML.
   - Empty / error / unconfigured / logged-out → the section stays hidden. Jobs must
     never block or break page boot; every path degrades to a hidden section.
   - Career identity flows through the SOC only; the server resolves title + listings. */
(function (global) {
  'use strict';

  var ENDPOINT = '/job-matches';

  function hasAuth() {
    return !!(global.FWAuth
      && typeof FWAuth.authEmail === 'function' && FWAuth.authEmail()
      && typeof FWAuth.authFetch === 'function');
  }

  function hide(el) { if (el) el.hidden = true; }
  function show(el) { if (el) el.hidden = false; }

  function daysAgoLabel(iso) {
    var t = Date.parse(iso);
    if (!isFinite(t)) return '';
    var d = Math.floor((Date.now() - t) / 86400000);
    if (d <= 0) return 'today';
    if (d === 1) return 'posted 1d ago';
    return 'posted ' + d + 'd ago';
  }

  function money(n) {
    if (n == null || !isFinite(Number(n))) return '';
    n = Number(n);
    if (n >= 1000) return '$' + Math.round(n / 1000) + 'k';
    return '$' + Math.round(n);
  }

  function salaryLabel(min, max) {
    var a = money(min), b = money(max);
    if (a && b && a !== b) return a + '–' + b;
    return a || b || '';
  }

  // Top-fit careers the user already has client-side. Reuses the exact source the
  // app sends to the API elsewhere (Invariant: one career system, keyed by SOC).
  function topCareerItems(n) {
    try {
      if (global.FWAuth && typeof FWAuth.buildCareerPoolForApi === 'function') {
        var quiz = (global.FWOnetVectors && typeof FWOnetVectors.readLocalQuizBlob === 'function')
          ? FWOnetVectors.readLocalQuizBlob() : null;
        var pool = FWAuth.buildCareerPoolForApi(quiz && quiz.scores) || [];
        return pool
          .filter(function (p) { return p && p.soc; })
          .slice(0, n)
          .map(function (p) { return { soc: p.soc }; });
      }
    } catch (_) { /* fall through */ }
    return [];
  }

  function jobCardEl(job, careerTitle) {
    var a = document.createElement('a');
    a.className = 'fw-job-card';
    a.href = job.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';

    var title = document.createElement('div');
    title.className = 'fw-job-title';
    title.textContent = job.title || 'Job posting';
    a.appendChild(title);

    var meta = document.createElement('div');
    meta.className = 'fw-job-meta';
    var metaBits = [];
    if (job.company) metaBits.push(job.company);
    if (job.location) metaBits.push(job.location);
    meta.textContent = metaBits.join(' · ');
    a.appendChild(meta);

    var sub = document.createElement('div');
    sub.className = 'fw-job-sub';
    var sal = salaryLabel(job.salaryMin, job.salaryMax);
    if (sal) { var s1 = document.createElement('span'); s1.textContent = sal; sub.appendChild(s1); }
    var ago = daysAgoLabel(job.postedAt);
    if (ago) { var s2 = document.createElement('span'); s2.textContent = ago; sub.appendChild(s2); }
    if (careerTitle) {
      var s3 = document.createElement('span');
      s3.className = 'fw-job-career';
      s3.textContent = careerTitle;
      sub.appendChild(s3);
    }
    if (sub.childNodes.length) a.appendChild(sub);

    return a;
  }

  // Round-robin across careers so several are represented before any one is exhausted.
  function flattenJobs(careers, limit) {
    var showCareerTag = careers.length > 1;
    var maxLen = 0;
    careers.forEach(function (c) {
      var len = (c && Array.isArray(c.jobs)) ? c.jobs.length : 0;
      if (len > maxLen) maxLen = len;
    });
    var out = [];
    for (var i = 0; i < maxLen && out.length < limit; i += 1) {
      for (var j = 0; j < careers.length && out.length < limit; j += 1) {
        var c = careers[j];
        var job = c && Array.isArray(c.jobs) ? c.jobs[i] : null;
        if (job) out.push({ job: job, careerTitle: showCareerTag ? (c.title || '') : '' });
      }
    }
    return out;
  }

  /**
   * Core renderer. `containerEl` is the section to reveal/hide; it must contain a
   * `.fw-jobs-list`. POSTs the SOCs, paints job cards, hides on any empty/error.
   */
  function render(containerEl, opts) {
    opts = opts || {};
    if (!containerEl) return;
    var listEl = containerEl.querySelector('.fw-jobs-list');
    if (!listEl) return;

    var items = (Array.isArray(opts.items) ? opts.items : [])
      .map(function (it) { return { soc: it && it.soc }; })
      .filter(function (it) { return it.soc; })
      .slice(0, 6);
    var limit = opts.limit || 5;

    if (!items.length || !hasAuth()) { hide(containerEl); return; }

    FWAuth.authFetch(ENDPOINT, { method: 'POST', body: { items: items }, timeoutMs: 12000 })
      .then(function (resp) { return (resp && resp.ok) ? resp.json() : null; })
      .then(function (data) {
        if (!data || data.unconfigured || !Array.isArray(data.careers) || !data.careers.length) {
          hide(containerEl); return;
        }
        var flat = flattenJobs(data.careers, limit);
        if (!flat.length) { hide(containerEl); return; }
        listEl.textContent = '';
        flat.forEach(function (x) { listEl.appendChild(jobCardEl(x.job, x.careerTitle)); });
        show(containerEl);
      })
      .catch(function () { hide(containerEl); });
  }

  // Build a hidden section shell with a header and an empty list.
  function buildSection(id, heading, subtitle) {
    var section = document.createElement('section');
    section.className = 'fw-jobs-section';
    section.id = id;
    section.hidden = true;
    section.setAttribute('aria-label', heading);

    var card = document.createElement('div');
    card.className = 'fw-jobs-card';

    var head = document.createElement('div');
    head.className = 'fw-jobs-head';
    var tag = document.createElement('span');
    tag.className = 'fw-jobs-tag';
    tag.textContent = 'Good Fit Jobs';
    var h = document.createElement('h3');
    h.className = 'fw-jobs-heading';
    h.textContent = heading;
    var sub = document.createElement('p');
    sub.className = 'fw-jobs-sub';
    sub.textContent = subtitle;
    head.appendChild(tag);
    head.appendChild(h);
    head.appendChild(sub);

    var list = document.createElement('div');
    list.className = 'fw-jobs-list';

    card.appendChild(head);
    card.appendChild(list);
    section.appendChild(card);
    return section;
  }

  // Home card (portal.html): top 3 careers, up to 5 jobs total.
  function injectHomeCard() {
    if (!hasAuth()) return;
    if (document.getElementById('fw-jobs-home')) return;
    var wrap = document.querySelector('.portal-wrap');
    if (!wrap) return;
    var items = topCareerItems(3);
    if (!items.length) return;
    var section = buildSection('fw-jobs-home', 'Jobs worth a look',
      'Recent internships and entry-level roles matched to your top-fit careers.');
    var anchor = document.getElementById('portal-snapshot');
    if (anchor && anchor.parentNode === wrap) wrap.insertBefore(section, anchor.nextSibling);
    else wrap.appendChild(section);
    render(section, { items: items, limit: 5 });
  }

  // Career deep-dive (career.html): one career, up to 6 jobs.
  function renderCareer(soc) {
    if (!soc || !hasAuth()) return;
    var content = document.getElementById('career-content');
    if (!content) return;
    var existing = document.getElementById('fw-jobs-career');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    var section = buildSection('fw-jobs-career', 'Jobs hiring now',
      'Live internship and entry-level postings for this career.');
    var cta = content.querySelector('.cta-section');
    if (cta && cta.parentNode === content) content.insertBefore(section, cta);
    else content.appendChild(section);
    render(section, { items: [{ soc: soc }], limit: 6 });
  }

  global.FWJobs = {
    render: render,
    injectHomeCard: injectHomeCard,
    renderCareer: renderCareer,
  };
})(this);
