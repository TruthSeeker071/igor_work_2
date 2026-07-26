/**
 * FlightWay 2.0 — notification preferences center (Pillar B2, expanded S4).
 *
 * Four labeled toggles that read/write /notify-prefs, rendered into the
 * Flight Plan card's footer slot (#flightplan-notify-slot) as #notifications
 * — the anchor every "manage your email preferences" link in an outbound
 * email points at. No slot, no render — the flight-plan card re-invokes
 * inject() after rendering the slot. Cadence is stated at opt-in (CAN-SPAM);
 * every email has one-click unsubscribe.
 *
 * D10: existing users pre-dating the default-on flip (weekly still false)
 * get a one-time FWFeatureIntro prompt after the first GET resolves, offering
 * to turn the weekly digest on for them.
 */
(function (global) {
  'use strict';

  var CATEGORIES = [
    { key: 'weekly', title: 'Weekly Flight Plan', sub: 'One email a week with your tasks — unsubscribe anytime.' },
    { key: 'deadlines', title: 'Deadline reminders', sub: 'A heads up before an opportunity deadline closes.' },
    { key: 'review', title: 'Monthly review', sub: 'A monthly look back at your progress and what changed.' },
    { key: 'product', title: 'Product updates', sub: 'Occasional news about new FlightWay features.' },
  ];

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

  function buildRow(cat) {
    var row = document.createElement('div');
    row.className = 'fw-notify-row';
    row.innerHTML = ''
      + '<label class="fw-notify-toggle"><input type="checkbox" id="fw-notify-check-' + cat.key + '" aria-label="' + cat.title + '">'
      + '<span class="fw-notify-slider" aria-hidden="true"></span></label>'
      + '<div class="fw-notify-copy"><span class="fw-notify-title">' + cat.title + '</span>'
      + '<span class="fw-notify-sub" id="fw-notify-sub-' + cat.key + '">' + cat.sub + '</span></div>';
    return row;
  }

  function inject() {
    var host = document.getElementById('flightplan-notify-slot');
    if (!host || document.getElementById('notifications')) return;
    var panel = document.createElement('div');
    panel.id = 'notifications';

    var checks = {};
    CATEGORIES.forEach(function (cat) {
      var row = buildRow(cat);
      panel.appendChild(row);
      var check = row.querySelector('input');
      var sub = row.querySelector('.fw-notify-sub');
      checks[cat.key] = check;

      check.addEventListener('change', function () {
        var on = check.checked;
        check.disabled = true;
        var patch = {};
        patch[cat.key] = on;
        afetch('/notify-prefs', { prefs: patch }).then(function (r) { return r.json(); }).then(function (res) {
          check.disabled = false;
          if (!res || res.error) { check.checked = !on; return; }
          if (cat.key === 'weekly') {
            sub.textContent = on
              ? 'On — you’ll get one email each Monday. Unsubscribe anytime.'
              : 'One email a week with your tasks — unsubscribe anytime.';
            try { if (global.FWEvents) FWEvents.log('nudge_optin', { optin: on }); } catch (_) {}
          }
        }).catch(function () { check.disabled = false; check.checked = !on; });
      });
    });

    var note = document.createElement('p');
    note.className = 'fw-notify-sub';
    note.id = 'fw-notify-verify-note';
    note.textContent = 'Confirm your email to start receiving these.';
    note.hidden = true;
    panel.appendChild(note);

    host.appendChild(panel);

    // The panel mounts well after page load, so the browser's native scroll to
    // #notifications (fired at load, before this exists) misses it. Every email
    // footer + the signup disclosure deep-link here, so honour the fragment once
    // the toggles are actually on the page.
    if (global.location && location.hash === '#notifications') {
      try { panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      catch (_) { try { panel.scrollIntoView(); } catch (_2) { /* ignore */ } }
    }

    afetch('/notify-prefs').then(function (r) { return r.json(); }).then(function (d) {
      var prefs = (d && d.prefs) || {};
      CATEGORIES.forEach(function (cat) { checks[cat.key].checked = !!prefs[cat.key]; });
      note.hidden = d.verified !== false;

      // D10: pre-V2 users default weekly=false server-side; new users default
      // true and never see this. maybeShow is once-ever per FWUser journey.
      if (prefs.weekly === false && global.FWFeatureIntro && typeof FWFeatureIntro.maybeShow === 'function') {
        FWFeatureIntro.maybeShow('weekly-digest').then(function (how) {
          if (how !== 'go') return;
          checks.weekly.checked = true;
          var weeklySub = document.getElementById('fw-notify-sub-weekly');
          if (weeklySub) weeklySub.textContent = 'On — you’ll get one email each Monday. Unsubscribe anytime.';
          afetch('/notify-prefs', { prefs: { weekly: true } }).then(function (r) { return r.json(); }).catch(function () {});
        });
      }
    }).catch(function () { /* leave defaults unchecked */ });
  }

  global.FWNotifyOptin = { inject: inject };
})(typeof window !== 'undefined' ? window : globalThis);
