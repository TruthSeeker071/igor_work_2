/**
 * FWUserChip — the signed-in identity chip in the app nav.
 *
 * The Career Hub has carried a user chip in its topbar since launch; every
 * other app page merely HID the "Sign in" link when signed in and showed
 * nothing in its place, so the nav read as a different component depending on
 * which feature you were in. This mounts the same chip everywhere.
 *
 * On the hub the chip is already in the markup and hub-dashboard.js fills it,
 * so this only adds the plan pill rather than building a second one.
 *
 * PLAN SOURCE — the load-bearing detail. The pill reads `planRaw` from
 * /auth/me, never FWEntitlements.plan: while PAYWALL_ENABLED is false,
 * entitlements.js resolves EVERY user to 'premium' by design, so a pill driven
 * off it would decorate all 43 accounts and mean nothing. planRaw is what the
 * user actually holds — comp, purchase or free.
 */
(function (global) {
  'use strict';

  var PLAN_PILL = {
    premium: { label: 'Premium', title: 'Premium member' },
    lifetime: { label: 'Lifetime', title: 'Founding lifetime member' },
  };

  var mePromise = null;

  /** Memoized so mounting on any page costs at most one request. */
  function me() {
    if (mePromise) return mePromise;
    if (!global.FWAuth || typeof FWAuth.authFetch !== 'function') return Promise.resolve(null);
    mePromise = FWAuth.authFetch('/auth/me')
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
    return mePromise;
  }

  function signedIn() {
    return !!(global.FWAuth && typeof FWAuth.authEmail === 'function' && FWAuth.authEmail());
  }

  /** Display name: the profile name, else the email local part, else Student. */
  function displayName() {
    var name = '';
    try {
      var u = global.FWUser && typeof FWUser.get === 'function' ? FWUser.get() : null;
      name = (u && u.identity && u.identity.name) || '';
    } catch (_) { name = ''; }
    if (!name && signedIn()) {
      var email = String(FWAuth.authEmail() || '');
      var at = email.indexOf('@');
      if (at > 0) name = email.slice(0, at);
    }
    name = String(name || '').trim();
    return name || 'Student';
  }

  function initialOf(name) {
    var ch = String(name || '').trim().charAt(0);
    return (ch || 'S').toUpperCase();
  }

  function buildChip(name) {
    var chip = document.createElement('div');
    chip.className = 'user-chip';
    chip.id = 'fw-user-chip';

    var avatar = document.createElement('div');
    avatar.className = 'user-avatar';
    avatar.id = 'user-avatar-initials';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = initialOf(name);

    var label = document.createElement('span');
    label.id = 'user-display-name';
    label.textContent = name;

    chip.appendChild(avatar);
    chip.appendChild(label);
    return chip;
  }

  /** Add (or refresh) the plan pill on whichever chip is on the page. */
  function applyPill(chip, planRaw) {
    if (!chip) return;
    var spec = PLAN_PILL[String(planRaw || '').toLowerCase()];
    var existing = chip.querySelector('.fw-plan-pill');
    if (!spec) { if (existing) existing.remove(); return; }

    var pill = existing || document.createElement('span');
    pill.className = 'fw-plan-pill fw-plan-pill--' + String(planRaw).toLowerCase();
    pill.textContent = spec.label;
    pill.title = spec.title;
    pill.setAttribute('aria-label', spec.title);
    if (!existing) chip.appendChild(pill);
  }

  function mount() {
    if (!signedIn()) return;

    // The hub already has a chip in its markup — decorate it, don't duplicate.
    var chip = document.querySelector('.user-chip');
    if (!chip) {
      var host = document.querySelector('.nav-links.app-nav') || document.querySelector('.app-nav');
      if (!host) return;
      chip = buildChip(displayName());
      host.appendChild(chip);
    }

    me().then(function (data) {
      if (!data) return;
      applyPill(chip, data.planRaw);
    });
  }

  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mount);
    } else {
      mount();
    }
  }

  global.FWUserChip = { init: init, mount: mount, displayName: displayName };
  init();
})(typeof window !== 'undefined' ? window : globalThis);
