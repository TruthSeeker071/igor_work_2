/**
 * FlightWay V2 S19 — the one-question NPS card + the consented quote ask (D28).
 *
 * Server contract: functions/nps.js and functions/testimonials.js. This file
 * renders and nothing else — every rule (who may be asked, how often, what may
 * be stored) is enforced there, because a survey whose frequency cap lives in a
 * browser is a survey that asks twice from two tabs.
 *
 * `FWNps.maybeAsk(moment)` is called from the three product moments §5 S19
 * names: a weekly task checked off, a roadmap track committed, a Month in
 * Review opened. It is deliberately called AT the moment and never on page
 * load — the eligibility read costs one indexed row, and paying for it on every
 * render of three pages to ask a question once a month would be a bad trade.
 *
 * Three shapes worth keeping:
 *
 *  1. **Closing the card after picking a number sends the number.** The comment
 *     box appears only once a score is chosen, so a student who scores and then
 *     hits X has answered; recording that as a dismissal would throw away the
 *     one data point they gave us. Only an untouched card dismisses.
 *  2. **A consent checkbox is only rendered when there is something behind it.**
 *     The server tells us the exact name and school it would print, and a box
 *     offering to use a school we never learned is a promise about a value that
 *     does not exist.
 *  3. **Nothing here writes user state to localStorage.** The cooldown is a D1
 *     row; a client marker would be a second, disagreeing copy of it (§3 rule 5
 *     — user state goes through FWUser, and this is not user state, it is the
 *     server's).
 */
(function (global) {
  'use strict';

  var MOMENT_QUESTION = {
    flightplan_done: 'How likely are you to recommend FlightWay to a friend at your school?',
    roadmap_commit: 'How likely are you to recommend FlightWay to a friend at your school?',
    month_review: 'How likely are you to recommend FlightWay to a friend at your school?',
  };

  var asked = false;   // once per page load, whatever the moment
  var host = null;

  function afetch(url, method, bodyObj) {
    if (global.FWAuth && typeof FWAuth.authFetch === 'function') {
      var opts = { method: method || 'GET' };
      if (bodyObj) opts.body = bodyObj;
      return FWAuth.authFetch(url, opts);
    }
    var o = { method: method || 'GET', credentials: 'include' };
    if (bodyObj) { o.headers = { 'Content-Type': 'application/json' }; o.body = JSON.stringify(bodyObj); }
    return fetch(url, o);
  }

  function log(name, props) {
    try { if (global.FWEvents) FWEvents.log(name, props || {}); } catch (_) { /* never block on telemetry */ }
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function close() {
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = null;
  }

  // -------------------------------------------------------------- step two
  /**
   * The quote ask, shown only to promoters (9–10). `attribution` is what the
   * SERVER says it would print — read back to the student before they agree to
   * it, which is the difference between consent and a checkbox.
   */
  function renderQuoteStep(npsId, score, attribution) {
    var body = host.querySelector('.fw-nps-body');
    if (!body) return;
    body.textContent = '';

    body.appendChild(el('p', 'fw-nps-q', 'Glad to hear it. Mind if we quote you?'));

    var ta = el('textarea', 'fw-nps-quote');
    ta.setAttribute('rows', '3');
    ta.setAttribute('maxlength', '400');
    ta.setAttribute('aria-label', 'What you would tell a friend about FlightWay');
    ta.placeholder = 'What would you tell a friend about it?';
    body.appendChild(ta);

    var name = (attribution && attribution.name) || '';
    var school = (attribution && attribution.school) || '';
    var nameBox = null;
    var schoolBox = null;

    function consentRow(labelText) {
      var row = el('label', 'fw-nps-consent');
      var cb = el('input');
      cb.type = 'checkbox';
      row.appendChild(cb);
      row.appendChild(el('span', null, labelText));
      body.appendChild(row);
      return cb;
    }
    // Only offered when there is a real value behind it — see the header.
    if (name) nameBox = consentRow('Use my name (' + name + ')');
    if (school) schoolBox = consentRow('Use my school (' + school + ')');
    if (!name && !school) {
      body.appendChild(el('p', 'fw-nps-fine', 'We will publish it without a name — we do not have one on file for you.'));
    }

    var msg = el('p', 'fw-nps-msg');
    msg.setAttribute('role', 'status');
    msg.setAttribute('aria-live', 'polite');

    var actions = el('div', 'fw-nps-actions');
    var send = el('button', 'fw-nps-btn fw-nps-btn--primary', 'Share it');
    send.type = 'button';
    var skip = el('button', 'fw-nps-btn fw-nps-btn--quiet', 'No thanks');
    skip.type = 'button';
    actions.appendChild(send);
    actions.appendChild(skip);
    body.appendChild(actions);
    body.appendChild(msg);
    body.appendChild(el('p', 'fw-nps-fine',
      'A person reads every quote before it goes anywhere, and nothing is published without one. '
      + 'Email hello@flightway.ai any time to pull it back.'));

    skip.addEventListener('click', close);
    send.addEventListener('click', function () {
      var quote = String(ta.value || '').trim();
      if (quote.length < 20) {
        msg.textContent = 'A sentence or two, please — at least 20 characters.';
        return;
      }
      send.disabled = true;
      msg.textContent = '';
      afetch('/testimonials', 'POST', {
        quote: quote,
        npsId: npsId,
        score: score,
        consentName: !!(nameBox && nameBox.checked),
        consentSchool: !!(schoolBox && schoolBox.checked),
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; });
      }).then(function (res) {
        if (!res.ok) {
          send.disabled = false;
          msg.textContent = (res.d && res.d.error) || 'Could not save that just now.';
          return;
        }
        body.textContent = '';
        body.appendChild(el('p', 'fw-nps-q', 'Thank you — that genuinely helps.'));
        body.appendChild(el('p', 'fw-nps-fine', 'We will read it before it appears anywhere.'));
        setTimeout(close, 2600);
      }).catch(function () {
        send.disabled = false;
        msg.textContent = 'Could not save that just now.';
      });
    });
  }

  // -------------------------------------------------------------- step one
  function render(moment) {
    host = el('div', 'fw-nps');
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-label', 'One quick question');

    var card = el('div', 'fw-nps-card');
    var closeBtn = el('button', 'fw-nps-close', '×');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close');
    card.appendChild(closeBtn);

    var body = el('div', 'fw-nps-body');
    body.appendChild(el('p', 'fw-nps-q', MOMENT_QUESTION[moment] || MOMENT_QUESTION.flightplan_done));

    var scale = el('div', 'fw-nps-scale');
    scale.setAttribute('role', 'group');
    scale.setAttribute('aria-label', '0 is not at all likely, 10 is extremely likely');
    var chosen = null;
    var buttons = [];
    for (var i = 0; i <= 10; i += 1) {
      (function (n) {
        var b = el('button', 'fw-nps-num', String(n));
        b.type = 'button';
        b.setAttribute('aria-pressed', 'false');
        b.addEventListener('click', function () { pick(n); });
        buttons.push(b);
        scale.appendChild(b);
      }(i));
    }
    body.appendChild(scale);

    var ends = el('div', 'fw-nps-ends');
    ends.appendChild(el('span', null, 'Not at all'));
    ends.appendChild(el('span', null, 'Extremely'));
    body.appendChild(ends);

    // Revealed on the first pick — see header note 1.
    var more = el('div', 'fw-nps-more');
    more.hidden = true;
    var input = el('input', 'fw-nps-comment');
    input.type = 'text';
    input.setAttribute('maxlength', '500');
    input.setAttribute('aria-label', 'Anything you would change (optional)');
    input.placeholder = 'Anything you would change? (optional)';
    more.appendChild(input);
    var sendRow = el('div', 'fw-nps-actions');
    var send = el('button', 'fw-nps-btn fw-nps-btn--primary', 'Send');
    send.type = 'button';
    sendRow.appendChild(send);
    more.appendChild(sendRow);
    body.appendChild(more);

    var msg = el('p', 'fw-nps-msg');
    msg.setAttribute('role', 'status');
    msg.setAttribute('aria-live', 'polite');
    body.appendChild(msg);

    card.appendChild(body);
    host.appendChild(card);
    document.body.appendChild(host);
    log('nps_shown', { moment: moment });

    function pick(n) {
      chosen = n;
      for (var j = 0; j < buttons.length; j += 1) {
        var on = j === n;
        buttons[j].classList.toggle('is-on', on);
        buttons[j].setAttribute('aria-pressed', on ? 'true' : 'false');
      }
      more.hidden = false;
    }

    var submitting = false;
    function submit(status) {
      if (submitting) return;
      submitting = true;
      var payload = status === 'dismiss'
        ? { action: 'dismiss', moment: moment }
        : { action: 'score', moment: moment, score: chosen, comment: String(input.value || '').trim() };
      return afetch('/nps', 'POST', payload).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; });
      }).then(function (res) {
        if (status === 'dismiss') { close(); return; }
        if (!res.ok) {
          submitting = false;
          send.disabled = false;
          msg.textContent = (res.d && res.d.error) || 'Could not save that just now.';
          return;
        }
        if (res.d && res.d.promoter) {
          renderQuoteStep(res.d.id, chosen, res.d.attribution);
          return;
        }
        body.textContent = '';
        body.appendChild(el('p', 'fw-nps-q', 'Thank you — noted.'));
        setTimeout(close, 2000);
      }).catch(function () {
        if (status === 'dismiss') { close(); return; }
        submitting = false;
        send.disabled = false;
        msg.textContent = 'Could not save that just now.';
      });
    }

    send.addEventListener('click', function () {
      if (chosen === null) return;
      send.disabled = true;
      msg.textContent = '';
      submit('score');
    });

    // Header note 1: an answered card that gets closed sends its answer.
    closeBtn.addEventListener('click', function () {
      if (chosen === null) { submit('dismiss'); close(); return; }
      submit('score');
      close();
    });
  }

  /**
   * Ask, if the server says we may. Silent on every refusal — a survey that
   * explains why it is not appearing is worse than one that does not appear.
   */
  function maybeAsk(moment) {
    if (asked || host) return;
    if (!moment || !MOMENT_QUESTION[moment]) return;
    if (!document.body) return;
    asked = true;   // set before the request: two rapid task check-offs must not race
    afetch('/nps?moment=' + encodeURIComponent(moment))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.ready || !d.eligible) return;
        render(moment);
      })
      .catch(function () { /* never surface a survey failure to a student */ });
  }

  global.FWNps = { maybeAsk: maybeAsk, close: close };
}(window));
