/**
 * FlightWay 2.0 — Pillar A1 "Why this match".
 *
 * Turns a fit % into a tap-to-expand explanation citing the O*NET coordinates
 * that drive it ("92% because: Investigation — you 88, role wants 90 → 21% of
 * the match…"). Pure presentation: it consumes the per-dimension comparison rows
 * the deep dive / hub already compute (same shape onet-dimension-viewer uses,
 * {name, domain, user, target, tier?}) so there is no vector recompute and no
 * need to edit the large hydrate files beyond a one-line guarded hook.
 *
 * Contribution ∝ user × role-weight per dimension (the same product that sums to
 * the cosine fit), mirroring FWOnetMath.fitContributions. Provenance chips reuse
 * the A2 confidence tiers when the caller threads a `tier` onto each row.
 */
(function (global) {
  'use strict';

  var CONF_LABEL = { anchored: 'Quiz-anchored', inferred: 'Inferred', estimated: 'Estimated' };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** Rank comparison rows by contribution (user × target); return top-k with share. */
  function fromComparisons(comparisons, k) {
    if (!Array.isArray(comparisons) || !comparisons.length) return [];
    var rows = comparisons.map(function (c) {
      var user = Number(c.user) || 0;
      var target = Number(c.target) || 0;
      return {
        name: c.name,
        domain: c.domain || null,
        user: user,
        target: target,
        tier: c.tier || c.confidence || null,
        product: user * target,
      };
    }).filter(function (r) { return r.product > 0; });
    var total = rows.reduce(function (s, r) { return s + r.product; }, 0);
    rows.sort(function (a, b) { return b.product - a.product; });
    rows.forEach(function (r) { r.share = total > 0 ? r.product / total : 0; });
    return rows.slice(0, k && k > 0 ? k : 3);
  }

  function provChip(tier) {
    if (!tier || tier === 'anchored') return '';
    return '<span class="fw-why-chip fw-why-chip--' + esc(tier) + '">' + esc(CONF_LABEL[tier] || tier) + '</span>';
  }

  /** Escaped inner HTML for the drawer body given top contributors. */
  function drawerHtml(pct, contribs) {
    if (!contribs || !contribs.length) return '';
    var names = contribs.map(function (c) { return esc(c.name); });
    var lead = pct != null
      ? '<p class="fw-why-lead"><strong>' + Math.round(pct) + '%</strong> because your top overlaps with this role are '
        + names.join(', ') + '.</p>'
      : '<p class="fw-why-lead">Your strongest overlaps with this role:</p>';
    var items = contribs.map(function (c) {
      return '<li class="fw-why-item"' + (c.tier ? ' data-confidence="' + esc(c.tier) + '"' : '') + '>'
        + '<span class="fw-why-name">' + esc(c.name) + provChip(c.tier) + '</span>'
        + '<span class="fw-why-nums">you <strong>' + Math.round(c.user) + '</strong>'
        + ' · role wants <strong>' + Math.round(c.target) + '</strong>'
        + ' · drives <strong>' + Math.round(c.share * 100) + '%</strong> of the match</span>'
        + '</li>';
    }).join('');
    return lead + '<ul class="fw-why-list">' + items + '</ul>'
      + '<p class="fw-why-note">Estimated from your quiz &amp; profile vectors — a self-assessment, not a prediction.</p>';
  }

  /**
   * Inject a collapsible "Why this fit" block into a container (e.g. the deep-dive
   * match section). Idempotent per container. `pct` is optional headline number.
   */
  function inject(container, comparisons, pct, opts) {
    if (!container) return;
    opts = opts || {};
    var contribs = fromComparisons(comparisons, opts.k || 3);
    if (!contribs.length) return;
    var existing = container.querySelector('.fw-why-block');
    if (existing) existing.remove();

    var block = document.createElement('div');
    block.className = 'fw-why-block';
    var bodyId = 'fw-why-body-' + Math.random().toString(36).slice(2, 8);
    var label = pct != null ? 'Why ' + Math.round(pct) + '%?' : 'Why this match?';
    block.innerHTML =
      '<button type="button" class="fw-why-toggle" aria-expanded="false" aria-controls="' + bodyId + '">'
      + '<span>' + esc(label) + '</span><span class="fw-why-caret" aria-hidden="true">&rsaquo;</span>'
      + '</button>'
      + '<div class="fw-why-body" id="' + bodyId + '" hidden>' + drawerHtml(pct, contribs) + '</div>';

    var toggle = block.querySelector('.fw-why-toggle');
    var body = block.querySelector('.fw-why-body');
    function setOpen(open, log) {
      body.hidden = !open;
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      block.classList.toggle('is-open', open);
      if (open && log && global.FWEvents) FWEvents.log('why_match_open', { n: contribs.length });
    }
    toggle.addEventListener('click', function () {
      var open = body.hidden;
      setOpen(open, true);
      try { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch (_) { /* ignore */ }
    });
    // Wireframe 1e-2: expanded by default on first visit, then remembered.
    var saved = null;
    try { saved = localStorage.getItem(OPEN_KEY); } catch (_) { /* ignore */ }
    if (saved !== '0') setOpen(true, false);

    if (opts.prepend && container.firstChild) container.insertBefore(block, container.firstChild);
    else container.appendChild(block);
    return block;
  }

  var OPEN_KEY = 'fw_why_match_open_v1';

  global.FWWhyMatch = {
    fromComparisons: fromComparisons,
    drawerHtml: drawerHtml,
    inject: inject,
  };
})(typeof window !== 'undefined' ? window : globalThis);
