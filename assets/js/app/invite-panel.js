/**
 * FlightWay V2 S15 — invite card + share-link manager (plan §5 S15, D24).
 *
 * Two hosts, one fetch each, mounted wherever the attribute appears:
 *
 *   [data-fw-invite]  your referral link, the counter, the pitch. Home and the
 *                     Flight Plan both carry one.
 *   [data-fw-shares]  the live share links this account has published, each with
 *                     an off switch. Home only — revoking is an account action,
 *                     and the plan puts it on the account surface for the same
 *                     reason the delete button lives there.
 *
 * Nothing here hard-codes a number, a URL or the yearly credit ceiling: all of
 * it comes from GET /referral (§3 rule 11). A deployment without migration 0023
 * gets one honest sentence instead of a broken copy button.
 */
(function (global) {
  'use strict';

  var referralState = null;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function api(path, opts) {
    if (global.FWAuth && typeof FWAuth.authFetch === 'function') return FWAuth.authFetch(path, opts || {});
    var init = { credentials: 'include' };
    if (opts && opts.method) init.method = opts.method;
    if (opts && opts.body) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(opts.body);
    }
    return fetch(path, init);
  }

  function json(resp) {
    return resp.json().catch(function () { return {}; }).then(function (data) {
      return { ok: resp.ok, status: resp.status, data: data || {} };
    });
  }

  function logEvent(name, props) {
    try { if (global.FWEvents) FWEvents.log(name, props || {}); } catch (_) {}
  }

  function copyText(text, btn) {
    var was = btn.textContent;
    var ok = function () {
      btn.textContent = 'Copied';
      setTimeout(function () { btn.textContent = was; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok, function () { btn.textContent = 'Press Ctrl+C'; });
      return;
    }
    var ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); ok(); } catch (_) { btn.textContent = 'Press Ctrl+C'; }
    ta.remove();
  }

  // --------------------------------------------------------------- invite card

  function renderInvite(host, state) {
    host.textContent = '';
    if (!state || !state.enabled) {
      host.appendChild(el('p', 'fw-invite-note',
        (state && state.note) || 'Invites are not switched on yet.'));
      return;
    }

    host.appendChild(el('p', 'fw-invite-lede',
      'Send this to a friend. They get their first month free, and a month lands on your account when they subscribe.'));

    var row = el('div', 'fw-invite-row');
    row.appendChild(el('span', 'fw-invite-link', state.link));
    var copy = el('button', 'fw-sc-btn', 'Copy');
    copy.type = 'button';
    copy.addEventListener('click', function () {
      copyText(state.link, copy);
      logEvent('referral_copy', { channel: 'card' });
    });
    row.appendChild(copy);
    host.appendChild(row);

    // The counter only appears once it says something. A row of zeroes on a
    // brand-new account reads as failure at the exact moment we are asking for
    // a favour.
    var joined = state.signedUp + state.converted + state.credited;
    if (joined > 0) {
      var stats = el('ul', 'fw-invite-stats');
      var add = function (n, label) {
        var li = el('li');
        li.appendChild(el('b', null, String(n)));
        li.appendChild(document.createTextNode(label));
        stats.appendChild(li);
      };
      add(joined, joined === 1 ? 'friend joined' : 'friends joined');
      if (state.converted + state.credited > 0) add(state.converted + state.credited, 'subscribed');
      if (state.credited > 0) add(state.credited, state.credited === 1 ? 'month credited' : 'months credited');
      host.appendChild(stats);
    }

    var notes = [];
    if (!state.verified) notes.push('Confirm your email address before a credit can be issued to you.');
    if (!state.promoConfigured) notes.push('The free month for your friend is not switched on yet — your credit still is.');
    if (notes.length) host.appendChild(el('p', 'fw-invite-note', notes.join(' ')));

    var more = el('a', 'fw-invite-note fw-invite-more', 'Messages you can paste →');
    more.href = '/invite';
    host.appendChild(more);
  }

  function loadReferral(hosts) {
    if (!hosts.length) return Promise.resolve();
    return api('/referral').then(json).then(function (res) {
      if (res.status === 401) return; // signed out: the panel simply stays empty
      referralState = res.data;
      hosts.forEach(function (h) { renderInvite(h, referralState); });
    }).catch(function () {
      hosts.forEach(function (h) {
        h.textContent = '';
        h.appendChild(el('p', 'fw-invite-note', 'Could not load your invite link. Reload the page.'));
      });
    });
  }

  // ---------------------------------------------------------- share manager

  function renderShares(host, data) {
    host.textContent = '';
    var shares = (data && data.shares) || [];
    if (!data || !data.enabled) return;   // pre-0023: silent, the invite card says it
    if (!shares.length) return;           // nothing published: nothing to manage

    host.appendChild(el('p', 'fw-shares-title', 'Your public share links'));
    shares.forEach(function (s) {
      var row = el('div', 'fw-shares-row');
      var name = el('a', 'fw-shares-name', s.careers && s.careers.length ? s.careers.join(' · ') : s.url);
      name.href = s.url;
      name.target = '_blank';
      name.rel = 'noopener';
      row.appendChild(name);
      row.appendChild(el('span', 'fw-shares-views', s.views === 1 ? '1 view' : s.views + ' views'));
      var off = el('button', 'fw-shares-off', 'Turn off');
      off.type = 'button';
      off.addEventListener('click', function () {
        off.disabled = true;
        off.textContent = 'Turning off…';
        api('/share?id=' + encodeURIComponent(s.id), { method: 'DELETE' }).then(json).then(function (res) {
          if (res.ok) { row.remove(); if (!host.querySelector('.fw-shares-row')) host.textContent = ''; return; }
          off.disabled = false;
          off.textContent = 'Turn off';
        }).catch(function () {
          off.disabled = false;
          off.textContent = 'Turn off';
        });
      });
      row.appendChild(off);
      host.appendChild(row);
    });
  }

  function loadShares(hosts) {
    if (!hosts.length) return Promise.resolve();
    return api('/share').then(json).then(function (res) {
      if (res.status === 401) return;
      hosts.forEach(function (h) { renderShares(h, res.data); });
    }).catch(function () { /* a manager that fails to load shows nothing, not an error */ });
  }

  function mount() {
    var invite = Array.prototype.slice.call(document.querySelectorAll('[data-fw-invite]'));
    var shares = Array.prototype.slice.call(document.querySelectorAll('[data-fw-shares]'));
    if (!invite.length && !shares.length) return;
    loadReferral(invite);
    loadShares(shares);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  global.FWInvitePanel = { mount: mount, renderInvite: renderInvite, renderShares: renderShares };
})(typeof window !== 'undefined' ? window : globalThis);
