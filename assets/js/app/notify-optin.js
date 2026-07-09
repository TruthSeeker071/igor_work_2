/**
 * FlightWay 2.0 — weekly nudge opt-in toggle (Pillar B2).
 *
 * A small toggle in the portal footer that reads/writes /notify-prefs. When on,
 * the Monday cron worker emails the user their 3 Flight Plan tasks. Cadence is
 * stated at opt-in (CAN-SPAM); every email has one-click unsubscribe. Self-mounts
 * like the other portal cards — no edits to portal.js.
 */
(function (global) {
  'use strict';

  function afetch(url, bodyObj) {
    var useAuth = global.FWAuth && typeof FWAuth.authFetch === 'function';
    if (useAuth) {
      var opts = { method: bodyObj ? 'POST' : 'GET' };
      if (bodyObj) opts.body = bodyObj;
      return FWAuth.authFetch(url, opts);
    }
    var o = { method: bodyObj ? 'POST' : 'GET', credentials: 'include' };
    if (bodyObj) { o.headers = { 'Content-Type': 'application/json' }; o.body = JSON.stringify(bodyObj); }
    return fetch(url, o);
  }

  function inject() {
    var actions = document.getElementById('portal-actions');
    if (!actions || document.getElementById('fw-notify-optin')) return;
    var row = document.createElement('div');
    row.id = 'fw-notify-optin';
    row.className = 'fw-notify-row';
    row.innerHTML = ''
      + '<label class="fw-notify-toggle"><input type="checkbox" id="fw-notify-check" aria-label="Weekly nudge email">'
      + '<span class="fw-notify-slider" aria-hidden="true"></span></label>'
      + '<div class="fw-notify-copy"><span class="fw-notify-title">Weekly nudge</span>'
      + '<span class="fw-notify-sub" id="fw-notify-sub">One email a week with your 3 tasks — unsubscribe anytime.</span></div>';
    actions.parentNode.appendChild(row);

    var check = row.querySelector('#fw-notify-check');
    var sub = row.querySelector('#fw-notify-sub');

    afetch('/notify-prefs').then(function (r) { return r.json(); }).then(function (d) {
      check.checked = !!(d && d.optin);
    }).catch(function () { /* leave unchecked */ });

    check.addEventListener('change', function () {
      var optin = check.checked;
      check.disabled = true;
      afetch('/notify-prefs', { optin: optin }).then(function (r) { return r.json(); }).then(function (res) {
        check.disabled = false;
        if (!res || res.error) { check.checked = !optin; return; }
        if (sub) sub.textContent = optin
          ? 'On — you’ll get one email each Monday. Unsubscribe anytime.'
          : 'One email a week with your 3 tasks — unsubscribe anytime.';
        try { if (global.FWEvents) FWEvents.log('nudge_optin', { optin: optin }); } catch (_) {}
      }).catch(function () { check.disabled = false; check.checked = !optin; });
    });
  }

  global.FWNotifyOptin = { inject: inject };
})(typeof window !== 'undefined' ? window : globalThis);
