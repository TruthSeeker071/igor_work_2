/**
 * FWAdminConsole — admin.html.
 *
 * Boots off GET /admin/whoami: a 404 (the answer every non-admin and every
 * signed-out caller gets) shows the "not available" card and nothing else, so
 * the page leaks no more than the endpoint does.
 *
 * Mutations need a 15-minute elevation lease bought with the admin's own
 * password; a 403 with `elevate:true` from any endpoint drops the UI back to
 * locked and points at the password field.
 *
 * Every cell is built with createElement + textContent. No innerHTML anywhere
 * near an email, a note or an audit detail — those are user-supplied strings.
 */
(function (global) {
  'use strict';

  var AUDIT_PAGE = 50;

  function busy(btn, label) {
    return global.FWButtonBusy ? FWButtonBusy.start(btn, { label: label }) : function () {};
  }

  // Tail-restore for the confirm-gated actions: their busy state starts inside
  // the ask.then() callback, out of scope by the time the chain settles.
  function unbusy(btn) {
    if (global.FWButtonBusy) FWButtonBusy.stop(btn);
  }

  var state = {
    root: false,
    elevated: false,
    auditOffset: 0,
  };

  function $(id) { return document.getElementById(id); }

  function setMsg(el, text, isError) {
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('admin-msg--error', !!isError && !!text);
  }

  function fetchJson(path, opts) {
    return FWAuth.authFetch(path, opts).then(function (resp) {
      return resp.json().catch(function () { return {}; }).then(function (data) {
        return { status: resp.status, ok: resp.ok, data: data || {} };
      });
    });
  }

  /** Common refusal handling. Returns true when the caller should stop. */
  function handleRefusal(res, msgEl) {
    if (res.ok) return false;
    if (res.status === 403 && res.data.elevate) {
      setElevated(false);
      setMsg(msgEl, 'Session locked — confirm your password above, then try again.', true);
      var pw = $('admin-elev-password');
      if (pw) pw.focus();
      return true;
    }
    setMsg(msgEl, res.data.error || 'Something went wrong. Please try again.', true);
    return true;
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    var t = Date.parse(iso);
    if (!Number.isFinite(t)) return String(iso);
    return new Date(t).toLocaleString();
  }

  function cell(row, text, className) {
    var td = document.createElement('td');
    td.textContent = text == null || text === '' ? '—' : String(text);
    if (className) td.className = className;
    row.appendChild(td);
    return td;
  }

  function grantStatus(g) {
    if (g.revoked_at) return 'revoked';
    if (!g.applied_at) return 'pending signup';
    if (g.user_plan_source !== 'comp') return 'superseded';
    return 'active';
  }

  // ------------------------------------------------------------- identity

  function setElevated(on) {
    state.elevated = !!on;
    var badge = $('admin-elev-badge');
    if (badge) {
      badge.textContent = on ? 'unlocked · 15 min' : 'locked';
      badge.classList.toggle('admin-badge--locked', !on);
    }
  }

  function showDenied(message) {
    var denied = $('admin-denied');
    var app = $('admin-app');
    if (app) app.hidden = true;
    if (denied) denied.hidden = false;
    if (message) setMsg($('admin-denied-msg'), message, false);
    if (global.FWPageVeil) FWPageVeil.notifyRender();
  }

  // --------------------------------------------------------------- grants

  function renderGrants(rows) {
    var body = $('admin-grants-body');
    if (!body) return;
    body.textContent = '';
    var list = Array.isArray(rows) ? rows : [];
    var empty = $('admin-grants-empty');
    if (empty) empty.hidden = list.length > 0;

    list.forEach(function (g) {
      var tr = document.createElement('tr');
      cell(tr, g.email, 'admin-mono');
      cell(tr, g.plan);
      cell(tr, g.expires_at ? fmtDate(g.expires_at) : 'never');
      cell(tr, grantStatus(g), 'admin-dim');
      cell(tr, g.granted_by, 'admin-mono admin-dim');
      cell(tr, g.note, 'admin-detail admin-dim');

      var actions = document.createElement('td');
      if (!g.revoked_at) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'admin-btn-quiet';
        btn.textContent = 'Revoke';
        btn.addEventListener('click', function () { revokeGrant(g.email, btn); });
        actions.appendChild(btn);
      }
      tr.appendChild(actions);
      body.appendChild(tr);
    });
    if (global.FWPageVeil) FWPageVeil.notifyRender();
  }

  function loadGrants() {
    return fetchJson('/admin/grants').then(function (res) {
      if (!res.ok) { setMsg($('admin-grant-msg'), res.data.error || 'Could not load grants.', true); return; }
      renderGrants(res.data.grants);
    });
  }

  function submitGrant(ev) {
    ev.preventDefault();
    var msg = $('admin-grant-msg');
    var btn = $('admin-grant-btn');
    var days = Number($('admin-grant-days').value);
    var payload = {
      email: $('admin-grant-email').value,
      plan: $('admin-grant-plan').value,
      note: $('admin-grant-note').value,
    };
    if (Number.isFinite(days) && days > 0) payload.days = days;

    var restore = busy(btn, 'Saving…');
    setMsg(msg, 'Saving…', false);
    fetchJson('/admin/grants', { method: 'POST', body: payload }).then(function (res) {
      if (handleRefusal(res, msg)) return;
      setMsg(msg, res.data.pending
        ? 'Saved. No account with that email yet — it will apply at signup.'
        : 'Granted and applied.', false);
      $('admin-grant-email').value = '';
      $('admin-grant-note').value = '';
      $('admin-grant-days').value = '';
      return Promise.all([loadGrants(), loadAudit(true)]);
    }).catch(function (err) {
      setMsg(msg, err && err.message ? err.message : 'Request failed.', true);
    }).then(restore);
  }

  function revokeGrant(email, btn) {
    var msg = $('admin-grant-msg');
    var ask = global.FWConfirm
      ? FWConfirm.show({
        title: 'Revoke this comp?',
        message: 'Resets ' + email + ' to free — unless they have since paid, which is left alone.',
        confirmLabel: 'Revoke',
      })
      : Promise.resolve(true);

    ask.then(function (ok) {
      if (!ok) return;
      busy(btn, 'Revoking…');
      setMsg(msg, 'Revoking…', false);
      return fetchJson('/admin/grants/revoke', { method: 'POST', body: { email: email } }).then(function (res) {
        if (handleRefusal(res, msg)) return;
        setMsg(msg, res.data.resetPlan ? 'Revoked and reset to free.' : 'Revoked (their plan came from elsewhere and was left alone).', false);
        return Promise.all([loadGrants(), loadAudit(true)]);
      });
    }).catch(function (err) {
      setMsg(msg, err && err.message ? err.message : 'Request failed.', true);
    }).then(function () { unbusy(btn); });
  }

  // --------------------------------------------------------------- admins

  function renderAdmins(rows) {
    var body = $('admin-admins-body');
    if (!body) return;
    body.textContent = '';
    var list = Array.isArray(rows) ? rows : [];
    var empty = $('admin-admins-empty');
    if (empty) empty.hidden = list.length > 0;

    list.forEach(function (a) {
      var tr = document.createElement('tr');
      cell(tr, a.email, 'admin-mono');
      cell(tr, a.granted_by, 'admin-mono admin-dim');
      cell(tr, fmtDate(a.created_at), 'admin-dim');
      var actions = document.createElement('td');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'admin-btn-quiet';
      btn.textContent = 'Remove';
      btn.addEventListener('click', function () { removeAdmin(a.email, btn); });
      actions.appendChild(btn);
      tr.appendChild(actions);
      body.appendChild(tr);
    });
    if (global.FWPageVeil) FWPageVeil.notifyRender();
  }

  function loadAdmins() {
    if (!state.root) return Promise.resolve();
    return fetchJson('/admin/admins').then(function (res) {
      if (!res.ok) { setMsg($('admin-admin-msg'), res.data.error || 'Could not load admins.', true); return; }
      renderAdmins(res.data.admins);
    });
  }

  function submitAdmin(ev) {
    ev.preventDefault();
    var msg = $('admin-admin-msg');
    var btn = $('admin-admin-btn');
    var input = $('admin-admin-email');
    var restore = busy(btn, 'Saving…');
    setMsg(msg, 'Saving…', false);
    fetchJson('/admin/admins', { method: 'POST', body: { email: input.value } }).then(function (res) {
      if (handleRefusal(res, msg)) return;
      setMsg(msg, 'Admin added.', false);
      input.value = '';
      return Promise.all([loadAdmins(), loadAudit(true)]);
    }).catch(function (err) {
      setMsg(msg, err && err.message ? err.message : 'Request failed.', true);
    }).then(restore);
  }

  function removeAdmin(email, btn) {
    var msg = $('admin-admin-msg');
    var ask = global.FWConfirm
      ? FWConfirm.show({ title: 'Remove this admin?', message: email + ' loses console access immediately.', confirmLabel: 'Remove' })
      : Promise.resolve(true);

    ask.then(function (ok) {
      if (!ok) return;
      busy(btn, 'Removing…');
      setMsg(msg, 'Removing…', false);
      return fetchJson('/admin/admins?email=' + encodeURIComponent(email), { method: 'DELETE' }).then(function (res) {
        if (handleRefusal(res, msg)) return;
        setMsg(msg, 'Admin removed.', false);
        return Promise.all([loadAdmins(), loadAudit(true)]);
      });
    }).catch(function (err) {
      setMsg(msg, err && err.message ? err.message : 'Request failed.', true);
    }).then(function () { unbusy(btn); });
  }

  // ---------------------------------------------------------------- audit

  function renderAuditRows(rows, replace) {
    var body = $('admin-audit-body');
    if (!body) return;
    if (replace) body.textContent = '';
    var list = Array.isArray(rows) ? rows : [];
    var empty = $('admin-audit-empty');
    if (empty) empty.hidden = body.children.length > 0 || list.length > 0;

    list.forEach(function (e) {
      var tr = document.createElement('tr');
      cell(tr, fmtDate(e.created_at), 'admin-dim');
      cell(tr, e.actor_email, 'admin-mono');
      cell(tr, e.action);
      cell(tr, e.target_email, 'admin-mono');
      cell(tr, e.detail, 'admin-detail admin-dim admin-mono');
      body.appendChild(tr);
    });
    if (global.FWPageVeil) FWPageVeil.notifyRender();
  }

  function loadAudit(replace) {
    var offset = replace ? 0 : state.auditOffset;
    return fetchJson('/admin/audit?limit=' + AUDIT_PAGE + '&offset=' + offset).then(function (res) {
      if (!res.ok) { setMsg($('admin-audit-msg'), res.data.error || 'Could not load the audit log.', true); return; }
      setMsg($('admin-audit-msg'), '', false);
      renderAuditRows(res.data.entries, replace);
      state.auditOffset = offset + ((res.data.entries || []).length);
      var more = $('admin-audit-more');
      if (more) more.hidden = !res.data.hasMore;
    });
  }

  // ------------------------------------------------------------ elevation

  function submitElevate(ev) {
    ev.preventDefault();
    var msg = $('admin-elev-msg');
    var btn = $('admin-elev-btn');
    var input = $('admin-elev-password');
    if (!input.value) { setMsg(msg, 'Enter your password.', true); return; }

    var restore = busy(btn, 'Checking…');
    setMsg(msg, 'Checking…', false);
    fetchJson('/admin/elevate', { method: 'POST', body: { password: input.value } }).then(function (res) {
      input.value = '';
      if (!res.ok) { setElevated(false); setMsg(msg, res.data.error || 'Could not unlock.', true); return; }
      setElevated(true);
      setMsg(msg, 'Unlocked for 15 minutes.', false);
      return loadAudit(true);
    }).catch(function (err) {
      setMsg(msg, err && err.message ? err.message : 'Request failed.', true);
    }).then(restore);
  }

  // ----------------------------------------------------------------- boot

  function init() {
    var forms = [
      ['admin-elevate-form', submitElevate],
      ['admin-grant-form', submitGrant],
      ['admin-admin-form', submitAdmin],
    ];
    forms.forEach(function (pair) {
      var el = $(pair[0]);
      if (el) el.addEventListener('submit', pair[1]);
    });
    var more = $('admin-audit-more');
    if (more) more.addEventListener('click', function () { loadAudit(false); });

    if (global.FWPageVeil) FWPageVeil.hold();
    fetchJson('/admin/whoami').then(function (res) {
      if (!res.ok) { showDenied(); return; }

      state.root = !!res.data.root;
      var app = $('admin-app');
      if (app) app.hidden = false;
      var who = $('admin-who');
      if (who) who.textContent = res.data.email || '';
      var roleBadge = $('admin-role-badge');
      if (roleBadge) {
        roleBadge.textContent = state.root ? 'root' : 'admin';
        roleBadge.classList.toggle('admin-badge--root', state.root);
      }
      var adminsCard = $('admin-admins-card');
      if (adminsCard) adminsCard.hidden = !state.root;
      setElevated(res.data.elevated);

      return Promise.all([loadGrants(), loadAdmins(), loadAudit(true)]);
    }).catch(function (err) {
      console.warn('admin console boot failed', err);
      showDenied('Could not reach the admin service. Try again in a moment.');
    }).then(function () {
      if (global.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
      if (global.FWPageVeil) FWPageVeil.release();
    });
  }

  global.FWAdminConsole = { init: init };
})(typeof window !== 'undefined' ? window : globalThis);
