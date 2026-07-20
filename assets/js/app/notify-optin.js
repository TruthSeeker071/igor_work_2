/**
 * FlightWay 2.0 — weekly nudge opt-in toggle (Pillar B2).
 *
 * A compact toggle that reads/writes /notify-prefs, rendered into the Flight
 * Plan card's footer slot (#flightplan-notify-slot). No slot, no render — the
 * flight-plan card re-invokes inject() after rendering the slot. When on,
 * the Monday cron worker emails the user their 3 Flight Plan tasks. Cadence is
 * stated at opt-in (CAN-SPAM); every email has one-click unsubscribe.
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
    var host = document.getElementById('flightplan-notify-slot');
    if (!host || document.getElementById('fw-notify-optin')) return;
    var row = document.createElement('div');
    row.id = 'fw-notify-optin';
    row.className = 'fw-notify-row';
    row.innerHTML = ''
      + '<label class="fw-notify-toggle"><input type="checkbox" id="fw-notify-check" aria-label="Email me these every Monday">'
      + '<span class="fw-notify-slider" aria-hidden="true"></span></label>'
      + '<div class="fw-notify-copy"><span class="fw-notify-title">Email me these every Monday</span>'
      + '<span class="fw-notify-sub" id="fw-notify-sub">One email a week with your 3 tasks — unsubscribe anytime.</span></div>';
    host.appendChild(row);

    var check = row.querySelector('#fw-notify-check');
    var sub = row.querySelector('#fw-notify-sub');

    afetch('/notify-prefs').then(function (r) { return r.json(); }).then(function (d) {
      // The weekly digest rides with the Flight Plan (§1) — hide the toggle
      // rather than offering a switch the server will refuse to flip.
      if (d && d.upgrade) { row.remove(); return; }
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
