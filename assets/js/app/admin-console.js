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

  // ----------------------------------------------------------- broadcasts
  //
  // Product-update composer (D11). Preview needs no elevation (a read); test,
  // queue and cancel all go through the same 403 {elevate:true} flow as
  // grants — handleRefusal() already covers it, so it is reused as-is rather
  // than duplicated. `migrated:false` on the GET means migration 0021 has not
  // landed in D1 yet: the note says exactly that, because "the console is
  // broken" and "the migration isn't applied" look identical from outside and
  // only one of them is actionable.

  var broadcastState = {
    segments: [],                          // [{key,label}] from the server — never hard-coded
    limits: { subject: 140, body: 8000 },  // overwritten by the GET response once it lands
    lastPreview: null,                     // {segmentKind, segmentValue, recipients} for the queue confirm
  };

  function bcastSegmentLabel(kind) {
    var found = null;
    broadcastState.segments.forEach(function (s) { if (s.key === kind) found = s; });
    return found ? found.label : kind;
  }

  function toggleSchoolField() {
    var sel = $('admin-bcast-segment');
    var field = $('admin-bcast-school-field');
    if (!sel || !field) return;
    field.hidden = sel.value !== 'school';
  }

  function renderBroadcastSegments(segments) {
    var sel = $('admin-bcast-segment');
    if (!sel) return;
    var prev = sel.value;
    broadcastState.segments = Array.isArray(segments) ? segments : [];
    sel.textContent = '';
    broadcastState.segments.forEach(function (s) {
      var opt = document.createElement('option');
      opt.value = s.key;
      opt.textContent = s.label;
      sel.appendChild(opt);
    });
    if (prev && broadcastState.segments.some(function (s) { return s.key === prev; })) sel.value = prev;
    toggleSchoolField();
  }

  function charCount(inputId, counterId, max) {
    var input = $(inputId);
    var counter = $(counterId);
    if (!input || !counter) return;
    counter.textContent = (input.value || '').length + ' / ' + max;
  }

  function applyBroadcastLimits(limits) {
    broadcastState.limits = limits && limits.subject && limits.body ? limits : broadcastState.limits;
    var subjectInput = $('admin-bcast-subject');
    var bodyInput = $('admin-bcast-body');
    if (subjectInput) subjectInput.maxLength = broadcastState.limits.subject;
    if (bodyInput) bodyInput.maxLength = broadcastState.limits.body;
    charCount('admin-bcast-subject', 'admin-bcast-subject-count', broadcastState.limits.subject);
    charCount('admin-bcast-body', 'admin-bcast-body-count', broadcastState.limits.body);
  }

  function bcastFormValues() {
    var subject = ($('admin-bcast-subject').value || '').trim();
    var body = ($('admin-bcast-body').value || '').trim();
    var segment = $('admin-bcast-segment').value;
    var payload = { subject: subject, body: body, segment: segment };
    if (segment === 'school') payload.segmentValue = ($('admin-bcast-school').value || '').trim();
    return payload;
  }

  function bcastValidate(msg, payload) {
    if (!payload.subject || !payload.body) { setMsg(msg, 'Subject and body are required.', true); return false; }
    if (payload.segment === 'school' && !payload.segmentValue) { setMsg(msg, 'Enter a school name to match.', true); return false; }
    return true;
  }

  function bcastRecipientsCell(b) {
    var head = b.recipients == null ? '—' : fmt(b.recipients);
    if (b.sent_count == null && b.failed_count == null) return head;
    return head + ' (' + fmt(b.sent_count || 0) + ' sent, ' + fmt(b.failed_count || 0) + ' failed)';
  }

  function broadcastStatusClass(status) {
    if (status === 'sent') return 'admin-badge--status-sent';
    if (status === 'sending') return 'admin-badge--status-sending';
    if (status === 'failed') return 'admin-badge--status-failed';
    if (status === 'cancelled') return 'admin-badge--status-cancelled';
    return 'admin-badge--status-scheduled'; // scheduled | draft
  }

  function renderBroadcastRows(rows) {
    var body = $('admin-broadcasts-body');
    if (!body) return;
    body.textContent = '';
    var list = Array.isArray(rows) ? rows : [];
    var empty = $('admin-broadcasts-empty');
    if (empty) empty.hidden = list.length > 0;

    list.forEach(function (b) {
      var tr = document.createElement('tr');
      cell(tr, fmtDate(b.created_at), 'admin-dim');
      cell(tr, b.subject);

      var segCell = document.createElement('td');
      var segLabel = bcastSegmentLabel(b.segment_kind);
      segCell.textContent = b.segment_value ? (segLabel + ' — ' + b.segment_value) : segLabel;
      tr.appendChild(segCell);

      var statusCell = document.createElement('td');
      var pill = document.createElement('span');
      pill.className = 'admin-badge ' + broadcastStatusClass(b.status);
      pill.textContent = b.status;
      statusCell.appendChild(pill);
      tr.appendChild(statusCell);

      cell(tr, bcastRecipientsCell(b));
      cell(tr, b.scheduled_at ? fmtDate(b.scheduled_at) : '—', 'admin-dim');
      cell(tr, b.sent_at ? fmtDate(b.sent_at) : '—', 'admin-dim');

      var actions = document.createElement('td');
      if (b.status === 'scheduled') {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'admin-btn-quiet';
        btn.textContent = 'Cancel';
        btn.addEventListener('click', function () { cancelBroadcast(b.id, btn); });
        actions.appendChild(btn);
      }
      tr.appendChild(actions);
      body.appendChild(tr);
    });
    if (global.FWPageVeil) FWPageVeil.notifyRender();
  }

  function loadBroadcasts() {
    return fetchJson('/admin/broadcasts').then(function (res) {
      if (!res.ok) { setMsg($('admin-broadcast-msg'), res.data.error || 'Could not load broadcasts.', true); return; }
      var note = $('admin-broadcast-migration');
      if (note) note.hidden = res.data.migrated !== false;
      applyBroadcastLimits(res.data.limits);
      renderBroadcastSegments(res.data.segments);
      renderBroadcastRows(res.data.broadcasts);
    });
  }

  // Cosmetic wrapper only — the `html` the endpoint returns is just the
  // rendered markdown fragment (renderMarkdown()'s output), styled for the
  // dark card the real email template drops it into. Without a matching
  // shell here the light-colored inline text would sit unreadable on a
  // plain white iframe background. The subject is escaped before splicing
  // in: this string becomes the sandboxed iframe's OWN document (assigned
  // via the `.srcdoc` property, never parsed as an attribute of this page),
  // so there is no XSS risk to admin.html either way — the escaping here is
  // purely so a stray `<`/`>` in a subject can't visually break the preview.
  function escBcastHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function buildBroadcastPreviewDoc(subject, bodyHtml) {
    return '<!doctype html><html><head><meta charset="utf-8"><style>'
      + 'body{margin:0;padding:24px 16px;background:#0b1020;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}'
      + '.fw-bcast-shell{max-width:520px;margin:0 auto;background:#111834;border-radius:16px;border:1px solid #223056;padding:26px 24px}'
      + '.fw-bcast-heading{font-size:20px;font-weight:800;line-height:1.3;color:#f3f6ff;margin:0 0 18px}'
      + '</style></head><body><div class="fw-bcast-shell">'
      + '<div class="fw-bcast-heading">' + escBcastHtml(subject) + '</div>'
      + (bodyHtml || '')
      + '</div></body></html>';
  }

  function renderBroadcastPreview(data) {
    var wrap = $('admin-broadcast-preview');
    if (!wrap) return;
    wrap.hidden = false;
    var frame = $('admin-bcast-preview-frame');
    if (frame) frame.srcdoc = buildBroadcastPreviewDoc(data.subject, data.html);
    var pre = $('admin-bcast-preview-text');
    if (pre) pre.textContent = data.text || '';
    var seg = data.segment || {};
    var segEl = $('admin-bcast-preview-segment');
    if (segEl) segEl.textContent = 'Segment: ' + (seg.label || seg.kind || '—') + (seg.value ? ' — ' + seg.value : '');
    var recEl = $('admin-bcast-preview-recipients');
    if (recEl) recEl.textContent = 'Recipients: ' + (data.recipients == null ? 'unknown' : fmt(data.recipients));
  }

  function previewBroadcast() {
    var msg = $('admin-broadcast-msg');
    var btn = $('admin-bcast-preview-btn');
    var payload = bcastFormValues();
    if (!bcastValidate(msg, payload)) return;

    var restore = busy(btn, 'Rendering…');
    setMsg(msg, '', false);
    fetchJson('/admin/broadcasts', { method: 'POST', body: Object.assign({ action: 'preview' }, payload) }).then(function (res) {
      if (handleRefusal(res, msg)) return;
      broadcastState.lastPreview = {
        segmentKind: payload.segment,
        segmentValue: payload.segmentValue || null,
        recipients: res.data.recipients,
      };
      renderBroadcastPreview(res.data);
    }).catch(function (err) {
      setMsg(msg, err && err.message ? err.message : 'Request failed.', true);
    }).then(restore);
  }

  function testSendBroadcast() {
    var msg = $('admin-broadcast-msg');
    var btn = $('admin-bcast-test-btn');
    var payload = bcastFormValues();
    if (!bcastValidate(msg, payload)) return;

    var restore = busy(btn, 'Sending…');
    setMsg(msg, 'Sending test…', false);
    fetchJson('/admin/broadcasts', { method: 'POST', body: Object.assign({ action: 'test' }, payload) }).then(function (res) {
      if (handleRefusal(res, msg)) return;
      setMsg(msg, 'Test sent to ' + res.data.sentTo + '.', false);
    }).catch(function (err) {
      setMsg(msg, err && err.message ? err.message : 'Request failed.', true);
    }).then(restore);
  }

  function resetBroadcastComposer() {
    var subject = $('admin-bcast-subject');
    var textBody = $('admin-bcast-body');
    var sched = $('admin-bcast-schedule');
    if (subject) subject.value = '';
    if (textBody) textBody.value = '';
    if (sched) sched.value = '';
    charCount('admin-bcast-subject', 'admin-bcast-subject-count', broadcastState.limits.subject);
    charCount('admin-bcast-body', 'admin-bcast-body-count', broadcastState.limits.body);
    var wrap = $('admin-broadcast-preview');
    if (wrap) wrap.hidden = true;
    broadcastState.lastPreview = null;
  }

  function bcastConfirmMessage(payload) {
    var label = bcastSegmentLabel(payload.segment) + (payload.segmentValue ? ' — ' + payload.segmentValue : '');
    var lp = broadcastState.lastPreview;
    var fresh = lp && lp.segmentKind === payload.segment && (lp.segmentValue || null) === (payload.segmentValue || null);
    var recipients = fresh ? lp.recipients : null;
    var recipientsText = recipients == null ? 'unknown' : fmt(recipients);
    return 'Sends to ' + label + ' — ' + recipientsText + ' recipients. Goes out at the next dispatch, within the hour.';
  }

  function submitBroadcastQueue(ev) {
    ev.preventDefault();
    var msg = $('admin-broadcast-msg');
    var btn = $('admin-bcast-queue-btn');
    var payload = bcastFormValues();
    if (!bcastValidate(msg, payload)) return;

    var schedVal = $('admin-bcast-schedule').value;
    if (schedVal) {
      var d = new Date(schedVal);
      if (isNaN(d.getTime())) { setMsg(msg, 'That schedule time is not valid.', true); return; }
      payload.scheduledAt = d.toISOString();
    }

    var ask = global.FWConfirm
      ? FWConfirm.show({ title: 'Queue this broadcast?', message: bcastConfirmMessage(payload), confirmLabel: 'Queue' })
      : Promise.resolve(true);

    ask.then(function (ok) {
      if (!ok) return;
      busy(btn, 'Queueing…');
      setMsg(msg, 'Queueing…', false);
      return fetchJson('/admin/broadcasts', { method: 'POST', body: Object.assign({ action: 'queue' }, payload) }).then(function (res) {
        if (handleRefusal(res, msg)) return;
        setMsg(msg, 'Queued — goes out at the next dispatch (within the hour).', false);
        resetBroadcastComposer();
        return loadBroadcasts();
      });
    }).catch(function (err) {
      setMsg(msg, err && err.message ? err.message : 'Request failed.', true);
    }).then(function () { unbusy(btn); });
  }

  function cancelBroadcast(id, btn) {
    var msg = $('admin-broadcast-msg');
    var ask = global.FWConfirm
      ? FWConfirm.show({ title: 'Cancel this broadcast?', message: 'It will not go out at the next dispatch.', confirmLabel: 'Cancel broadcast' })
      : Promise.resolve(true);

    ask.then(function (ok) {
      if (!ok) return;
      busy(btn, 'Cancelling…');
      setMsg(msg, 'Cancelling…', false);
      return fetchJson('/admin/broadcasts', { method: 'POST', body: { action: 'cancel', id: id } }).then(function (res) {
        if (handleRefusal(res, msg)) return;
        setMsg(msg, 'Cancelled.', false);
        return loadBroadcasts();
      });
    }).catch(function (err) {
      setMsg(msg, err && err.message ? err.message : 'Request failed.', true);
    }).then(function () { unbusy(btn); });
  }

  // ----------------------------------------------------------- testimonials
  //
  // The NPS summary + the promoter-quote review queue (S19). GET needs no
  // elevation; every POST (approve/feature/unfeature/reject) does, exactly
  // like grants and broadcasts — handleRefusal() covers the 403 case, reused
  // as-is. After a write the list is re-fetched rather than the row mutated
  // in place, same shape as loadReferrals()/loadBroadcasts(). `migrated:false`
  // on the GET means migration 0027 has not landed in D1 yet, same idea as
  // the broadcasts/referrals notes. Every cell is createElement + textContent
  // (via cell()/el()/tableFrom(), the same builders the analytics panels
  // below use) — quotes, names and schools are student-written text and none
  // of it is trusted.

  var TESTIMONIAL_MOMENT_LABELS = {
    flightplan_done: 'Weekly task done',
    roadmap_commit: 'Roadmap track committed',
    month_review: 'Month in Review opened',
  };

  var TESTIMONIAL_ACTIONS = {
    pending: ['approve', 'feature', 'reject'],
    approved: ['feature', 'reject'],
    featured: ['unfeature', 'reject'],
    rejected: ['approve'],
  };
  var TESTIMONIAL_ACTION_LABELS = { approve: 'Approve', feature: 'Feature', unfeature: 'Unfeature', reject: 'Reject' };
  var TESTIMONIAL_ACTION_PROGRESS = {
    approve: 'Approving…', feature: 'Featuring…', unfeature: 'Unfeaturing…', reject: 'Rejecting…',
  };
  var TESTIMONIAL_ACTION_DONE = { approve: 'Approved.', feature: 'Featured.', unfeature: 'Unfeatured.', reject: 'Rejected.' };
  var TESTIMONIAL_ACTION_CONFIRM = {
    approve: { title: 'Approve this quote?', message: 'Publishes it on the public site.' },
    feature: { title: 'Feature this quote?', message: 'Publishes it and pins it first on the homepage.' },
    unfeature: { title: 'Unfeature this quote?', message: 'Stays published, just no longer pinned first.' },
    reject: { title: 'Reject this quote?', message: 'Hides it from the public site.' },
  };

  function testimonialStats(summary, days) {
    var wrap = $('admin-testimonials-stats');
    var emptyNote = $('admin-testimonials-summary-empty');
    if (!wrap) return;
    wrap.textContent = '';
    var s = summary || {};
    var asked = s.asked || 0;
    if (emptyNote) emptyNote.hidden = !!asked;
    wrap.appendChild(statTile('NPS · ' + (days || 90) + 'd', s.nps == null ? '—' : String(s.nps)));
    wrap.appendChild(statTile('Scored', fmt(s.scored || 0)));
    wrap.appendChild(statTile('Dismissed', fmt(s.dismissed || 0)));
    wrap.appendChild(statTile('Promoters', fmt(s.promoters || 0)));
    wrap.appendChild(statTile('Passives', fmt(s.passives || 0)));
    wrap.appendChild(statTile('Detractors', fmt(s.detractors || 0)));
  }

  function testimonialMoments(data) {
    var host = $('admin-testimonials-moments');
    if (!host) return;
    host.textContent = '';
    var byMoment = data.byMoment || {};
    var moments = Array.isArray(data.moments) && data.moments.length
      ? data.moments : Object.keys(TESTIMONIAL_MOMENT_LABELS);
    var rows = moments.map(function (m) {
      var s = byMoment[m] || {};
      var label = TESTIMONIAL_MOMENT_LABELS[m] || m;
      return [label, s.nps == null ? '—' : String(s.nps), fmt(s.scored || 0),
        fmt(s.dismissed || 0), fmt(s.promoters || 0), fmt(s.passives || 0), fmt(s.detractors || 0)];
    });
    host.appendChild(tableFrom(
      ['Moment', 'NPS', 'Scored', 'Dismissed', 'Promoters', 'Passives', 'Detractors'], rows,
    ).wrap);
  }

  function testimonialComments(comments) {
    var host = $('admin-testimonials-comments');
    if (!host) return;
    host.textContent = '';
    var list = Array.isArray(comments) ? comments : [];
    if (!list.length) { host.hidden = true; return; }
    host.hidden = false;
    host.appendChild(subhead('Recent comments'));
    var rows = list.map(function (c) {
      return [
        { text: c.score, className: 'admin-mono' },
        TESTIMONIAL_MOMENT_LABELS[c.moment] || c.moment,
        { text: c.comment, className: 'admin-detail' },
        { text: fmtDate(c.ts), className: 'admin-dim' },
      ];
    });
    host.appendChild(tableFrom(['Score', 'Moment', 'Comment', 'Date'], rows).wrap);
  }

  function truncateQuote(q) {
    var s = String(q == null ? '' : q);
    return s.length > 140 ? s.slice(0, 140).trim() + '…' : s;
  }

  function testimonialAttribution(t) {
    var name = String(t.display_name || '').trim();
    var school = String(t.school || '').trim();
    if (!name && !school) return 'anonymous';
    if (name && school) return name + ' · ' + school;
    return name || school;
  }

  function renderTestimonialQueue(rows) {
    var body = $('admin-testimonials-body');
    if (!body) return;
    body.textContent = '';
    var list = Array.isArray(rows) ? rows : [];
    var empty = $('admin-testimonials-empty');
    if (empty) empty.hidden = list.length > 0;

    list.forEach(function (t) {
      var tr = document.createElement('tr');
      var quoteCell = document.createElement('td');
      quoteCell.textContent = truncateQuote(t.quote);
      quoteCell.title = String(t.quote == null ? '' : t.quote);
      tr.appendChild(quoteCell);
      cell(tr, testimonialAttribution(t));
      cell(tr, t.score, 'admin-mono');

      var statusCell = document.createElement('td');
      var pill = document.createElement('span');
      pill.className = 'admin-badge admin-badge--status-' + t.status;
      pill.textContent = t.status;
      statusCell.appendChild(pill);
      tr.appendChild(statusCell);

      cell(tr, fmtDate(t.created_at), 'admin-dim');

      var actions = document.createElement('td');
      (TESTIMONIAL_ACTIONS[t.status] || []).forEach(function (action) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'admin-btn-quiet';
        btn.textContent = TESTIMONIAL_ACTION_LABELS[action];
        btn.addEventListener('click', function () { reviewTestimonial(t.id, action, btn); });
        actions.appendChild(btn);
      });
      tr.appendChild(actions);
      body.appendChild(tr);
    });
    if (global.FWPageVeil) FWPageVeil.notifyRender();
  }

  function loadTestimonials() {
    return fetchJson('/admin/testimonials').then(function (res) {
      var msg = $('admin-testimonials-msg');
      if (!res.ok) { setMsg(msg, res.data.error || 'Could not load testimonials.', true); return; }

      var data = res.data || {};
      var note = $('admin-testimonials-migration');
      if (note) note.hidden = data.migrated !== false;

      testimonialStats(data.summary, data.summaryDays);
      testimonialMoments(data);
      testimonialComments(data.comments);

      var tableWrap = $('admin-testimonials-table-wrap');
      var empty = $('admin-testimonials-empty');

      // migrated:false — nothing to read yet; the callout above says so.
      if (data.migrated === false) {
        if (tableWrap) tableWrap.hidden = true;
        if (empty) empty.hidden = true;
        setMsg(msg, '', false);
        return;
      }
      // migrated:true but the read itself failed — this must not look like
      // an empty queue, so the table stays hidden and an error takes its place.
      if (data.queueReadable === false) {
        if (tableWrap) tableWrap.hidden = true;
        if (empty) empty.hidden = true;
        setMsg(msg, 'Could not read the testimonial queue. Try again in a moment.', true);
        return;
      }
      if (tableWrap) tableWrap.hidden = false;
      setMsg(msg, '', false);
      renderTestimonialQueue(data.queue);
    });
  }

  function reviewTestimonial(id, action, btn) {
    var msg = $('admin-testimonials-msg');
    var spec = TESTIMONIAL_ACTION_CONFIRM[action] || { title: 'Continue?', message: '' };
    var ask = global.FWConfirm
      ? FWConfirm.show({
        title: spec.title,
        message: spec.message,
        confirmLabel: TESTIMONIAL_ACTION_LABELS[action] || 'Continue',
      })
      : Promise.resolve(true);

    ask.then(function (ok) {
      if (!ok) return;
      busy(btn, TESTIMONIAL_ACTION_PROGRESS[action] || 'Working…');
      setMsg(msg, TESTIMONIAL_ACTION_PROGRESS[action] || 'Working…', false);
      return fetchJson('/admin/testimonials', { method: 'POST', body: { action: action, id: id } }).then(function (res) {
        if (handleRefusal(res, msg)) return;
        setMsg(msg, TESTIMONIAL_ACTION_DONE[action] || 'Done.', false);
        return loadTestimonials();
      });
    }).catch(function (err) {
      setMsg(msg, err && err.message ? err.message : 'Request failed.', true);
    }).then(function () { unbusy(btn); });
  }

  // -------------------------------------------------------------- referrals
  //
  // Mirrors the grants card: fetchJson, handleRefusal (covers the 403
  // elevate:true case) and FWConfirm before every write. `void` needs a free-
  // text reason for the audit log and there is no existing text-input confirm
  // component in this file, so it is captured with a native prompt() first,
  // then the usual FWConfirm gate runs on top of it — same two-step shape the
  // rest of the console already uses (grab the input, then confirm the
  // consequence), just with the input coming from a browser dialog instead of
  // a form field. `migrated:false`/`migrationPending` on the GET means
  // migration 0023 has not landed in D1 yet, same idea as the broadcasts note.

  function fmtCents(cents) {
    if (cents == null) return '—';
    var n = Number(cents);
    return Number.isFinite(n) ? '$' + (n / 100).toFixed(2) : '—';
  }

  function referralFlagsText(flags) {
    var list = Array.isArray(flags) ? flags : [];
    return list.length ? list.join(', ') : '—';
  }

  function renderReferrals(data) {
    var body = $('admin-referrals-body');
    if (!body) return;
    body.textContent = '';
    var list = Array.isArray(data.referrals) ? data.referrals : [];
    var empty = $('admin-referrals-empty');
    if (empty) empty.hidden = list.length > 0;

    list.forEach(function (r) {
      var tr = document.createElement('tr');
      cell(tr, r.referrer_id, 'admin-mono');
      cell(tr, r.referee_id, 'admin-mono');
      cell(tr, r.status, 'admin-dim');
      cell(tr, referralFlagsText(r.flags), 'admin-mono admin-dim');
      cell(tr, fmtCents(r.credit_cents));
      cell(tr, fmtDate(r.created_at), 'admin-dim');

      var actions = document.createElement('td');
      if (r.status === 'converted') {
        var retryBtn = document.createElement('button');
        retryBtn.type = 'button';
        retryBtn.className = 'admin-btn-quiet';
        retryBtn.textContent = 'Retry';
        retryBtn.addEventListener('click', function () { retryReferral(r.id, retryBtn); });
        actions.appendChild(retryBtn);
      }
      if (r.status !== 'credited' && r.status !== 'void') {
        var voidBtn = document.createElement('button');
        voidBtn.type = 'button';
        voidBtn.className = 'admin-btn-quiet';
        voidBtn.textContent = 'Void';
        voidBtn.addEventListener('click', function () { voidReferral(r.id, voidBtn); });
        actions.appendChild(voidBtn);
      }
      tr.appendChild(actions);
      body.appendChild(tr);
    });
    if (global.FWPageVeil) FWPageVeil.notifyRender();
  }

  function loadReferrals() {
    var sel = $('admin-referrals-filter');
    var status = sel ? sel.value : '';
    var qs = status ? '?status=' + encodeURIComponent(status) : '';
    return fetchJson('/admin/referrals' + qs).then(function (res) {
      if (!res.ok) { setMsg($('admin-referrals-msg'), res.data.error || 'Could not load referrals.', true); return; }
      var note = $('admin-referrals-migration');
      if (note) note.hidden = !res.data.migrationPending;
      renderReferrals(res.data);
    });
  }

  function retryReferral(id, btn) {
    var msg = $('admin-referrals-msg');
    var ask = global.FWConfirm
      ? FWConfirm.show({
        title: 'Retry this referral?',
        message: 'Runs the fraud checks again and issues the Stripe credit if they now pass.',
        confirmLabel: 'Retry',
      })
      : Promise.resolve(true);

    ask.then(function (ok) {
      if (!ok) return;
      busy(btn, 'Retrying…');
      setMsg(msg, 'Retrying…', false);
      return fetchJson('/admin/referrals', { method: 'POST', body: { action: 'retry', id: id } }).then(function (res) {
        if (handleRefusal(res, msg)) return;
        setMsg(msg, 'Credited ' + fmtCents(res.data.cents) + '.', false);
        return loadReferrals();
      });
    }).catch(function (err) {
      setMsg(msg, err && err.message ? err.message : 'Request failed.', true);
    }).then(function () { unbusy(btn); });
  }

  function voidReferral(id, btn) {
    var msg = $('admin-referrals-msg');
    var reason = global.prompt ? global.prompt('Why void this referral? (at least 3 characters — goes in the audit log)') : '';
    if (reason == null) return;
    reason = reason.trim();
    if (reason.length < 3) { setMsg(msg, 'Say why — it goes in the audit log.', true); return; }

    var ask = global.FWConfirm
      ? FWConfirm.show({
        title: 'Void this referral?',
        message: 'Marks it void — no credit will be issued. Reason: ' + reason,
        confirmLabel: 'Void',
      })
      : Promise.resolve(true);

    ask.then(function (ok) {
      if (!ok) return;
      busy(btn, 'Voiding…');
      setMsg(msg, 'Voiding…', false);
      return fetchJson('/admin/referrals', { method: 'POST', body: { action: 'void', id: id, reason: reason } }).then(function (res) {
        if (handleRefusal(res, msg)) return;
        setMsg(msg, 'Voided.', false);
        return loadReferrals();
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

  // ----------------------------------------------------------- unverified

  function renderUnverified(rows) {
    var body = $('admin-unverified-body');
    if (!body) return;
    body.textContent = '';
    var list = Array.isArray(rows) ? rows : [];
    var empty = $('admin-unverified-empty');
    if (empty) empty.hidden = list.length > 0;

    list.forEach(function (u) {
      var tr = document.createElement('tr');
      cell(tr, u.email, 'admin-mono');
      cell(tr, fmtDate(u.created_at), 'admin-dim');
      cell(tr, u.verify_sent_at ? fmtDate(u.verify_sent_at) : 'never', 'admin-dim');
      body.appendChild(tr);
    });
    if (global.FWPageVeil) FWPageVeil.notifyRender();
  }

  function loadUnverified() {
    return fetchJson('/admin/unverified').then(function (res) {
      if (!res.ok) return;
      renderUnverified(res.data.unverified);
    }).catch(function () { /* keep empty-state on error */ });
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

  // -------------------------------------------------------------- analytics
  //
  // Read-only dashboards (S3). Panels load lazily on tab switch into
  // #admin-analytics-panel; every cell is createElement + textContent, because
  // event props, paths, error messages and channel labels are all data from the
  // wild. The endpoint has already gated on adminGate — reads need no elevation.

  var analytics = {
    panel: 'overview',
    cache: {},          // panel -> last rendered data (re-render on tab return)
    range: { funnel: 30, sources: 30 },
    weeks: { retention: 8, features: 8 },
    tailTimer: null,
    tailAuto: false,
  };

  function fmt(n) { var x = Number(n); return Number.isFinite(x) ? x.toLocaleString() : '—'; }
  function fmtPct(n) { var x = Number(n); return (Number.isFinite(x) ? x : 0) + '%'; }

  function el(tag, className, text) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = String(text);
    return e;
  }

  function panelEl() { return $('admin-analytics-panel'); }

  function setPanel(node) {
    var host = panelEl();
    if (!host) return;
    host.textContent = '';
    host.appendChild(node);
    if (global.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
    if (global.FWPageVeil) FWPageVeil.notifyRender();
  }

  function emptyNote(text) {
    var wrap = document.createElement('div');
    wrap.appendChild(el('p', 'admin-empty', text));
    return wrap;
  }

  function statTile(label, value, sub) {
    var t = el('div', 'admin-stat');
    t.appendChild(el('div', 'admin-stat-label', label));
    t.appendChild(el('div', 'admin-stat-num', value));
    if (sub != null) t.appendChild(el('div', 'admin-stat-sub', sub));
    return t;
  }

  function subhead(text) { return el('div', 'admin-subhead', text); }

  function tableFrom(headers, rows) {
    // rows: array of arrays of { text, className } | string
    var wrap = el('div', 'admin-table-wrap');
    var table = el('table', 'admin-table');
    var thead = document.createElement('thead');
    var htr = document.createElement('tr');
    headers.forEach(function (h) {
      var th = el('th', null, typeof h === 'string' ? h : h.text);
      th.setAttribute('scope', 'col');
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    table.appendChild(thead);
    var tbody = document.createElement('tbody');
    rows.forEach(function (cells) {
      var tr = document.createElement('tr');
      cells.forEach(function (c) {
        var spec = (c && typeof c === 'object') ? c : { text: c };
        cell(tr, spec.text, spec.className);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return { wrap: wrap, table: table, tbody: tbody };
  }

  function utcDayShift(daysBack) {
    return new Date(Date.now() - daysBack * 86400000).toISOString().slice(0, 10);
  }

  function rangeSelect(id, value, options, onChange) {
    var wrap = el('div', 'admin-field');
    var label = el('label', null, 'Range');
    label.setAttribute('for', id);
    var sel = el('select');
    sel.id = id;
    options.forEach(function (o) {
      var opt = el('option', null, o.label);
      opt.value = String(o.value);
      if (String(o.value) === String(value)) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', function () { onChange(Number(sel.value)); });
    wrap.appendChild(label);
    wrap.appendChild(sel);
    return wrap;
  }

  // ---- Overview

  function renderOverview(data) {
    var root = document.createElement('div');
    if (!data) { return emptyNote('No data yet.'); }
    var a = data.active || {};
    var stats = el('div', 'admin-stats');
    var mk = function (label, o) { return statTile(label, fmt(o && o.anon), fmt(o && o.user) + ' signed-in'); };
    stats.appendChild(mk('DAU', a.dau));
    stats.appendChild(mk('WAU', a.wau));
    stats.appendChild(mk('MAU', a.mau));
    var s = data.signups || {};
    stats.appendChild(statTile('Signups · 7d', fmt(s.last7), fmt(s.today) + ' today'));
    stats.appendChild(statTile('Signups · 30d', fmt(s.last30), null));
    var act = data.activation || {};
    stats.appendChild(statTile('Activation', fmtPct(act.rate), fmt(act.activated) + '/' + fmt(act.signups) + ' in 48h'));
    var rev = data.revenue || {};
    var byPlan = rev.activeByPlan || {};
    stats.appendChild(statTile('Paid accounts', fmt(rev.paidCount), fmt(byPlan.premium) + ' prem · ' + fmt(byPlan.lifetime) + ' life'));
    var mrr = rev.mrr || {};
    stats.appendChild(statTile('MRR (est.)', mrr.estimateCents != null ? '$' + fmt(Math.round(mrr.estimateCents / 100)) : '—',
      mrr.estimateCents != null ? 'premium × monthly' : 'set MRR_MONTHLY_CENTS'));
    root.appendChild(stats);

    // Signups sparkline (last 14 days).
    if (s.perDay && s.perDay.length) {
      root.appendChild(subhead('Signups · last 14 days'));
      var max = s.perDay.reduce(function (m, d) { return Math.max(m, d.count); }, 0) || 1;
      var spark = el('div', 'admin-spark');
      s.perDay.forEach(function (d) {
        var bar = el('div', 'admin-spark-bar');
        bar.style.height = Math.max(2, Math.round((d.count / max) * 44)) + 'px';
        bar.title = d.day + ': ' + d.count;
        spark.appendChild(bar);
      });
      root.appendChild(spark);
    }
    return root;
  }

  // ---- Funnel

  function renderFunnel(data) {
    var root = document.createElement('div');
    var controls = el('div', 'admin-controls');
    controls.appendChild(rangeSelect('admin-funnel-range', analytics.range.funnel, [
      { value: 7, label: 'Last 7 days' }, { value: 14, label: 'Last 14 days' },
      { value: 30, label: 'Last 30 days' }, { value: 90, label: 'Last 90 days' },
    ], function (days) { analytics.range.funnel = days; loadPanel('funnel', { force: true }); }));
    root.appendChild(controls);
    if (!data) { root.appendChild(emptyNote('No data yet.')); return root; }

    root.appendChild(subhead('Discovery · ' + data.from + ' → ' + data.to));
    (data.discovery || []).forEach(function (stg) {
      var row = el('div', 'admin-funnel-row');
      var label = el('div', 'admin-funnel-label');
      label.appendChild(document.createTextNode(stg.label + ' '));
      if (stg.pending) { var chip = el('span', 'admin-chip', 'pending'); label.appendChild(chip); }
      row.appendChild(label);
      var track = el('div', 'admin-funnel-track');
      var fill = el('div', 'admin-funnel-fill');
      fill.style.width = Math.max(0, Math.min(100, Number(stg.pctOfTop) || 0)) + '%';
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el('div', 'admin-funnel-num', fmt(stg.count)));
      row.appendChild(el('div', 'admin-funnel-pct', stg.stage === 'landing' ? '' : fmtPct(stg.pctOfPrev)));
      root.appendChild(row);
    });

    var pay = data.paywall || {};
    root.appendChild(subhead('Paywall'));
    var stageRows = (pay.stages || []).map(function (st) { return [st.event, { text: fmt(st.count), className: 'admin-funnel-num' }]; });
    root.appendChild(tableFrom(['Stage', 'Count'], stageRows).wrap);
    if (pay.capsByFeature && pay.capsByFeature.length) {
      root.appendChild(subhead('Cap hits by feature'));
      root.appendChild(tableFrom(['Feature', 'Hits'],
        pay.capsByFeature.map(function (c) { return [c.feature, { text: fmt(c.count), className: 'admin-funnel-num' }]; })).wrap);
    }
    return root;
  }

  // ---- Retention

  function renderRetention(data) {
    var root = document.createElement('div');
    var controls = el('div', 'admin-controls');
    controls.appendChild(rangeSelect('admin-retention-weeks', analytics.weeks.retention, [
      { value: 4, label: '4 weeks' }, { value: 8, label: '8 weeks' }, { value: 12, label: '12 weeks' },
    ], function (w) { analytics.weeks.retention = w; loadPanel('retention', { force: true }); }));
    root.appendChild(controls);
    if (!data) { root.appendChild(emptyNote('No data yet.')); return root; }

    root.appendChild(subhead('Weekly signup cohorts × weeks since'));
    var maxW = data.weeks || 8;
    var headers = ['Cohort', 'Size'];
    for (var w = 0; w < maxW; w += 1) headers.push('W' + w);
    var built = tableFrom(headers, []);
    (data.cohorts || []).forEach(function (co) {
      var tr = document.createElement('tr');
      cell(tr, co.cohortWeek, 'admin-mono admin-dim');
      cell(tr, fmt(co.size));
      for (var i = 0; i < maxW; i += 1) {
        var r = co.retained && co.retained[i];
        cell(tr, r ? (fmt(r.count) + ' (' + r.pct + '%)') : '', 'tri-cell admin-dim');
      }
      built.tbody.appendChild(tr);
    });
    if (!(data.cohorts || []).length) built.tbody.appendChild((function () { var tr = document.createElement('tr'); cell(tr, 'No cohorts in range.', 'admin-dim'); return tr; })());
    root.appendChild(built.wrap);

    root.appendChild(subhead('Days since last action'));
    root.appendChild(tableFrom(['Bucket', 'Users'],
      (data.recency || []).map(function (b) { return [b.bucket, { text: fmt(b.count), className: 'admin-funnel-num' }]; })).wrap);
    return root;
  }

  // ---- Features

  function renderFeatures(data) {
    var root = document.createElement('div');
    var controls = el('div', 'admin-controls');
    controls.appendChild(rangeSelect('admin-features-weeks', analytics.weeks.features, [
      { value: 4, label: '4 weeks' }, { value: 8, label: '8 weeks' }, { value: 12, label: '12 weeks' },
    ], function (w) { analytics.weeks.features = w; loadPanel('features', { force: true }); }));
    root.appendChild(controls);
    if (!data) { root.appendChild(emptyNote('No data yet.')); return root; }

    root.appendChild(subhead('Events per feature per week'));
    var weeks = data.cohortWeeks || [];
    var headers = ['Feature'];
    weeks.forEach(function (w) { headers.push(w.slice(5)); }); // MM-DD
    headers.push('Total');
    var built = tableFrom(headers, []);
    (data.features || []).forEach(function (f) {
      var tr = document.createElement('tr');
      cell(tr, f.label);
      (f.perWeek || []).forEach(function (c) { cell(tr, c.events ? fmt(c.events) : '·', 'tri-cell admin-dim'); });
      cell(tr, fmt(f.total), 'admin-funnel-num');
      built.tbody.appendChild(tr);
    });
    root.appendChild(built.wrap);

    if (data.zeroUse && data.zeroUse.length) {
      root.appendChild(subhead('Zero-use in range (' + data.zeroUse.length + ')'));
      var p = el('p', 'admin-note', data.zeroUse.map(function (z) { return z.label; }).join(' · '));
      root.appendChild(p);
    }
    return root;
  }

  // ---- Sources

  function renderSources(data) {
    var root = document.createElement('div');
    var controls = el('div', 'admin-controls');
    controls.appendChild(rangeSelect('admin-sources-range', analytics.range.sources, [
      { value: 7, label: 'Last 7 days' }, { value: 14, label: 'Last 14 days' },
      { value: 30, label: 'Last 30 days' }, { value: 90, label: 'Last 90 days' },
    ], function (days) { analytics.range.sources = days; loadPanel('sources', { force: true }); }));
    root.appendChild(controls);
    if (!data) { root.appendChild(emptyNote('No data yet.')); return root; }

    root.appendChild(subhead('First-touch channel · ' + data.from + ' → ' + data.to));
    var rows = (data.channels || []).map(function (c) {
      return [c.channel, { text: fmt(c.visitors), className: 'admin-funnel-num' },
        { text: fmt(c.signups), className: 'admin-funnel-num' }, { text: fmtPct(c.signupRate), className: 'admin-funnel-pct' },
        { text: fmt(c.activations), className: 'admin-funnel-num' }, { text: fmtPct(c.activationRate), className: 'admin-funnel-pct' }];
    });
    if (!rows.length) { root.appendChild(emptyNote('No attributed visitors in range.')); return root; }
    root.appendChild(tableFrom(['Channel', 'Visitors', 'Signups', 'Sign %', 'Activations', 'Act %'], rows).wrap);
    return root;
  }

  // ---- Live tail

  function renderTail(data) {
    var root = document.createElement('div');
    var controls = el('div', 'admin-refresh-row');
    var lbl = el('label');
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = analytics.tailAuto;
    cb.addEventListener('change', function () { analytics.tailAuto = cb.checked; setTailTimer(); });
    lbl.appendChild(cb);
    lbl.appendChild(document.createTextNode(' Auto-refresh (5s)'));
    controls.appendChild(lbl);
    var refresh = el('button', 'admin-btn-quiet', 'Refresh');
    refresh.type = 'button';
    refresh.addEventListener('click', function () { loadPanel('tail', { force: true }); });
    controls.appendChild(refresh);
    root.appendChild(controls);
    if (!data) { root.appendChild(emptyNote('No events yet.')); return root; }

    var events = data.events || [];
    if (!events.length) { root.appendChild(emptyNote('No events yet.')); return root; }
    var built = tableFrom(['Time', 'Event', 'Path', 'Anon', 'UA', 'Props'], []);
    built.table.classList.add('admin-tail');
    events.forEach(function (e) {
      var tr = document.createElement('tr');
      cell(tr, fmtTime(e.ts), 'admin-dim');
      cell(tr, e.name);
      cell(tr, e.path, 'admin-dim');
      cell(tr, e.anon, 'admin-dim');
      cell(tr, e.ua, 'admin-dim');
      cell(tr, e.props ? JSON.stringify(e.props) : '', 'admin-dim');
      built.tbody.appendChild(tr);
    });
    root.appendChild(built.wrap);
    return root;
  }

  function fmtTime(iso) {
    var t = Date.parse(iso);
    if (!Number.isFinite(t)) return String(iso || '');
    return new Date(t).toLocaleTimeString();
  }

  function setTailTimer() {
    if (analytics.tailTimer) { clearInterval(analytics.tailTimer); analytics.tailTimer = null; }
    if (analytics.tailAuto && analytics.panel === 'tail') {
      analytics.tailTimer = setInterval(function () {
        if (analytics.panel !== 'tail') { setTailTimer(); return; }
        loadPanel('tail', { force: true, silent: true });
      }, 5000);
    }
  }

  // ---- Errors

  function renderErrors(data) {
    var root = document.createElement('div');
    if (!data) { root.appendChild(emptyNote('No errors logged.')); return root; }
    if (data.byRoute && data.byRoute.length) {
      root.appendChild(subhead('By route · last ' + data.sinceDays + 'd'));
      root.appendChild(tableFrom(['Route', 'Count'],
        data.byRoute.map(function (r) { return [r.route, { text: fmt(r.count), className: 'admin-funnel-num' }]; })).wrap);
    }
    root.appendChild(subhead('Recent'));
    var recent = data.recent || [];
    if (!recent.length) { root.appendChild(emptyNote('Nothing logged — a healthy sign.')); return root; }
    var built = tableFrom(['Time', 'Route', 'Message', 'Detail'], []);
    recent.forEach(function (r) {
      var tr = document.createElement('tr');
      cell(tr, fmtDate(r.ts), 'admin-dim');
      cell(tr, r.route, 'admin-mono');
      cell(tr, r.message, 'admin-detail');
      cell(tr, r.detail, 'admin-detail admin-dim admin-mono');
      built.tbody.appendChild(tr);
    });
    root.appendChild(built.wrap);
    return root;
  }

  // ---- Panel controller

  var RENDERERS = {
    overview: renderOverview, funnel: renderFunnel, retention: renderRetention,
    features: renderFeatures, sources: renderSources, tail: renderTail, errors: renderErrors,
  };

  function panelQuery(panel) {
    if (panel === 'funnel') return '&from=' + utcDayShift(analytics.range.funnel - 1) + '&to=' + utcDayShift(0);
    if (panel === 'sources') return '&from=' + utcDayShift(analytics.range.sources - 1) + '&to=' + utcDayShift(0);
    if (panel === 'retention') return '&weeks=' + analytics.weeks.retention;
    if (panel === 'features') return '&weeks=' + analytics.weeks.features;
    if (panel === 'tail') return '&limit=100';
    if (panel === 'errors') return '&days=7&limit=50';
    return '';
  }

  function loadPanel(panel, opts) {
    opts = opts || {};
    analytics.panel = panel;
    // Reflect the active tab.
    var tabs = document.querySelectorAll('#admin-analytics-tabs .admin-tab');
    Array.prototype.forEach.call(tabs, function (t) { t.classList.toggle('is-active', t.getAttribute('data-atab') === panel); });
    setTailTimer();

    var msg = $('admin-analytics-msg');
    if (!opts.silent) { setMsg(msg, '', false); if (!opts.force && analytics.cache[panel]) { setPanel(RENDERERS[panel](analytics.cache[panel])); return; } }
    if (!opts.silent && !analytics.cache[panel]) setPanel(emptyNote('Loading…'));

    return fetchJson('/admin/analytics?panel=' + panel + panelQuery(panel)).then(function (res) {
      if (!res.ok) { setMsg(msg, res.data.error || 'Could not load this panel.', true); return; }
      analytics.cache[panel] = res.data.data;
      if (analytics.panel === panel) setPanel(RENDERERS[panel](res.data.data));
    }).catch(function (err) {
      setMsg(msg, err && err.message ? err.message : 'Request failed.', true);
    });
  }

  function initAnalytics() {
    var section = $('admin-analytics');
    if (section) section.hidden = false;
    var tabsHost = $('admin-analytics-tabs');
    if (tabsHost) {
      tabsHost.addEventListener('click', function (ev) {
        var btn = ev.target && ev.target.closest ? ev.target.closest('.admin-tab') : null;
        if (!btn) return;
        var panel = btn.getAttribute('data-atab');
        if (panel && RENDERERS[panel]) loadPanel(panel, {});
      });
    }
    loadPanel('overview', {});
  }

  // ----------------------------------------------------------------- boot

  function init() {
    var forms = [
      ['admin-elevate-form', submitElevate],
      ['admin-grant-form', submitGrant],
      ['admin-admin-form', submitAdmin],
      ['admin-broadcast-form', submitBroadcastQueue],
    ];
    forms.forEach(function (pair) {
      var el = $(pair[0]);
      if (el) el.addEventListener('submit', pair[1]);
    });
    var more = $('admin-audit-more');
    if (more) more.addEventListener('click', function () { loadAudit(false); });

    var bcastPreviewBtn = $('admin-bcast-preview-btn');
    if (bcastPreviewBtn) bcastPreviewBtn.addEventListener('click', previewBroadcast);
    var bcastTestBtn = $('admin-bcast-test-btn');
    if (bcastTestBtn) bcastTestBtn.addEventListener('click', testSendBroadcast);
    var bcastSegment = $('admin-bcast-segment');
    if (bcastSegment) bcastSegment.addEventListener('change', toggleSchoolField);
    var bcastSubject = $('admin-bcast-subject');
    if (bcastSubject) bcastSubject.addEventListener('input', function () {
      charCount('admin-bcast-subject', 'admin-bcast-subject-count', broadcastState.limits.subject);
    });
    var bcastBody = $('admin-bcast-body');
    if (bcastBody) bcastBody.addEventListener('input', function () {
      charCount('admin-bcast-body', 'admin-bcast-body-count', broadcastState.limits.body);
    });

    var referralsFilter = $('admin-referrals-filter');
    if (referralsFilter) referralsFilter.addEventListener('change', function () { loadReferrals(); });

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

      // Analytics loads independently of the operational tools so a slow query
      // never holds up the grants/audit render or the page veil.
      initAnalytics();

      return Promise.all([
        loadGrants(), loadUnverified(), loadAdmins(), loadAudit(true),
        loadBroadcasts(), loadTestimonials(), loadReferrals(),
      ]);
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
