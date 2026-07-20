/**
 * FlightWay — client billing bridge (free/paid merge §3).
 *
 * Two calls, both server-driven: FWBilling.checkout(tier) hands the user to a
 * Stripe-hosted Checkout Session, FWBilling.portal() to the Stripe-hosted
 * Customer Portal. No card fields, no prices and no plan logic live here — the
 * client only ever learns *whether* checkout is wired (GET /config →
 * stripeEnabled) so pricing.html can fall back to the fake-door intent modal
 * wherever Stripe keys aren't set.
 */
(function (global) {
  'use strict';

  var configPromise = null;

  function afetch(path, opts) {
    if (global.FWAuth && typeof FWAuth.authFetch === 'function') return FWAuth.authFetch(path, opts);
    var options = Object.assign({ credentials: 'include' }, opts || {});
    if (options.body && typeof options.body === 'object') {
      options.headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
      options.body = JSON.stringify(options.body);
    }
    return fetch(path, options);
  }

  /** Resolves to true when real checkout is available on this deployment. */
  function available() {
    if (!configPromise) {
      configPromise = fetch('/config')
        .then(function (r) { return r.json(); })
        .then(function (cfg) { return !!(cfg && cfg.stripeEnabled); })
        .catch(function () { return false; });
    }
    return configPromise;
  }

  function signInThen(tier) {
    var next = 'pricing.html?tier=' + encodeURIComponent(tier || '');
    var url = (global.FWPage && typeof FWPage.authSignInUrl === 'function')
      ? FWPage.authSignInUrl(next)
      : 'auth.html#signin?next=' + encodeURIComponent(next);
    location.href = url;
  }

  /**
   * Start checkout for one of pricing.html's data-tier values. Resolves to
   * { redirected:true } (the browser is already leaving), or rejects with an
   * Error carrying .status so the caller can fall back to the intent modal.
   */
  function checkout(tier) {
    return afetch('/stripe/checkout', { method: 'POST', body: { tier: tier } }).then(function (res) {
      if (res.status === 401) { signInThen(tier); return { redirected: true, signIn: true }; }
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok || !data.url) {
          var err = new Error(data.error || 'Checkout is unavailable right now.');
          err.status = res.status;
          throw err;
        }
        location.href = data.url;
        return { redirected: true };
      });
    });
  }

  /** Open the Stripe Customer Portal. Rejects with .noCustomer when nothing was ever bought. */
  function portal() {
    return afetch('/stripe/portal', { method: 'POST', body: {} }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok || !data.url) {
          var err = new Error(data.error || 'Could not open billing.');
          err.status = res.status;
          err.noCustomer = !!data.noCustomer;
          throw err;
        }
        location.href = data.url;
        return { redirected: true };
      });
    });
  }

  // ------------------------------------------------------ portal.html billing row
  //
  // Auto-mounts into #portal-billing when present, so the account surface gets a
  // plan line + a Stripe Customer Portal link without a second asset to buster.

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function planLine(me) {
    var raw = (me && me.planRaw) || 'free';
    if (me && me.dev) return 'Developer access — every Flight Plan feature is unlocked.';
    if (me && !me.paywall && raw === 'free') {
      return 'Free plan — every Flight Plan feature is unlocked during the preview.';
    }
    if (raw === 'lifetime') return 'Current plan: Lifetime — Founding 100.';
    if (raw === 'premium') return 'Current plan: Flight Plan.';
    return 'Current plan: Free.';
  }

  function mount() {
    var host = document.getElementById('portal-billing');
    if (!host) return;
    try {
      if (new URLSearchParams(location.search).get('checkout') === 'success'
        && global.FWFwToast && typeof FWFwToast.show === 'function') {
        // The Stripe redirect can beat its own webhook by a second or two.
        FWFwToast.show('Payment received — your plan is activating. Reload in a moment if it still reads Free.');
      }
    } catch (_) {}
    var me = null;
    afetch('/auth/me', { method: 'GET' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) { me = data; return available(); })
      .then(function (stripeOn) {
        if (!me) return;
        var paid = me.planRaw === 'premium' || me.planRaw === 'lifetime';
        var html = '<p class="portal-billing-plan" style="margin:0 0 10px;font-size:13px;line-height:1.5;">'
          + escapeHtml(planLine(me)) + '</p>';
        if (stripeOn && paid) {
          html += '<button type="button" class="portal-signout-btn" id="portal-billing-manage">Manage billing</button>';
        } else if (stripeOn) {
          html += '<a class="portal-signout-btn" style="display:block;text-align:center;text-decoration:none;"'
            + ' href="pricing.html">See Flight Plan &rarr;</a>';
        }
        host.innerHTML = html;
        host.hidden = false;
        var btn = document.getElementById('portal-billing-manage');
        if (btn) btn.addEventListener('click', function () {
          var restore = global.FWButtonBusy ? FWButtonBusy.start(btn, { label: 'Opening…' }) : function () {};
          portal().catch(function (err) {
            restore();
            var msg = err && err.noCustomer
              ? 'No billing account yet — nothing has been purchased on this account.'
              : (global.FWErr ? FWErr.forUser(err, 'Could not open billing.') : 'Could not open billing.');
            if (global.FWFwToast && typeof FWFwToast.show === 'function') FWFwToast.show(msg);
            else host.insertAdjacentHTML('beforeend',
              '<p style="margin:8px 0 0;font-size:12px;">' + escapeHtml(msg) + '</p>');
          });
        });
      })
      .catch(function () { /* account surface stays as-is */ });
  }

  global.FWBilling = { available: available, checkout: checkout, portal: portal, mount: mount };

  if (document.readyState !== 'loading') mount();
  else document.addEventListener('DOMContentLoaded', mount);
})(typeof window !== 'undefined' ? window : globalThis);
