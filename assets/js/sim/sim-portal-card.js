/**
 * Portal quick-action card for the Career Tester. Injected after
 * FWPortal.render() from portal.html's boot script — deliberately kept out
 * of portal.js to avoid touching Jacob's actively-developed file.
 * Markup mirrors renderActions() in portal.js exactly.
 */
(function (global) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function inProgress() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('fw_sim_draft_v2:') === 0) return true;
      }
    } catch (_) {}
    return false;
  }

  function triedCount() {
    try {
      var arr = JSON.parse(localStorage.getItem('fw_sim_history_v2') || '[]');
      return Array.isArray(arr) ? arr.length : 0;
    } catch (_) { return 0; }
  }

  function inject() {
    var wrap = document.getElementById('portal-actions');
    if (!wrap || document.getElementById('portal-card-sim')) return;
    var resume = inProgress();
    var tried = triedCount();
    var label = resume ? 'Resume your career simulation' : 'Test-drive a career';
    var desc = resume
      ? 'Your writing is saved — pick up where you left off.'
      : (tried > 0
        ? 'You’ve tried ' + tried + ' so far — the Mirror finds your patterns after 2.'
        : 'Spend 2 minutes inside a career before you commit years to it.');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'portal-card-sim';
    btn.className = 'portal-card';
    btn.innerHTML =
      '<span class="portal-card-icon"><i data-lucide="plane-takeoff"></i></span>'
      + '<span class="portal-card-body">'
      + '<span class="portal-card-label">' + esc(label) + '</span>'
      + '<span class="portal-card-desc">' + esc(desc) + '</span>'
      + '</span>'
      + '<span class="portal-card-arrow" aria-hidden="true">&rarr;</span>';
    btn.addEventListener('click', function () { window.location.href = 'simulation.html'; });
    wrap.appendChild(btn);
    try { if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons(); } catch (_) {}
  }

  global.FWSimPortalCard = { inject: inject };
})(typeof window !== 'undefined' ? window : globalThis);
