/**
 * FWConfirm — promise-based styled confirm dialog (replaces native confirm()).
 * Usage: FWConfirm.show({ title, message, confirmLabel, cancelLabel })
 *          .then(function (ok) { ... });
 * Escape / backdrop click / Cancel resolve false. Focus moves into the dialog
 * on open and returns to the previously focused element on close.
 */
(function (global) {
  'use strict';

  var activeResolve = null;
  var lastFocused = null;

  function ensureShell() {
    var el = document.getElementById('fw-confirm-modal');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'fw-confirm-modal';
    el.className = 'fw-confirm-modal';
    el.hidden = true;
    el.innerHTML = ''
      + '<div class="fw-confirm-backdrop" data-act="cancel"></div>'
      + '<div class="fw-confirm-card" role="dialog" aria-modal="true" aria-labelledby="fw-confirm-title">'
      + '<h2 id="fw-confirm-title" class="fw-confirm-title"></h2>'
      + '<p class="fw-confirm-message" id="fw-confirm-message"></p>'
      + '<div class="fw-confirm-actions">'
      + '<button type="button" class="cta-btn cta-btn-outline fw-confirm-cancel" data-act="cancel"></button>'
      + '<button type="button" class="cta-btn fw-confirm-ok" data-act="confirm"></button>'
      + '</div></div>';
    document.body.appendChild(el);

    el.addEventListener('click', function (e) {
      var act = e.target.closest('[data-act]');
      if (!act) return;
      settle(act.getAttribute('data-act') === 'confirm');
    });
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        settle(false);
      } else if (e.key === 'Tab') {
        // Two-button trap: keep focus cycling inside the dialog.
        var focusables = el.querySelectorAll('button');
        var first = focusables[0];
        var last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });
    return el;
  }

  function settle(ok) {
    var el = document.getElementById('fw-confirm-modal');
    if (el) el.hidden = true;
    var resolve = activeResolve;
    activeResolve = null;
    if (lastFocused && typeof lastFocused.focus === 'function') {
      try { lastFocused.focus(); } catch (_) { /* ignore */ }
    }
    lastFocused = null;
    if (resolve) resolve(!!ok);
  }

  function show(opts) {
    opts = opts || {};
    var el = ensureShell();
    el.querySelector('#fw-confirm-title').textContent = opts.title || 'Are you sure?';
    el.querySelector('#fw-confirm-message').textContent = opts.message || '';
    el.querySelector('.fw-confirm-ok').textContent = opts.confirmLabel || 'Confirm';
    el.querySelector('.fw-confirm-cancel').textContent = opts.cancelLabel || 'Cancel';
    if (activeResolve) settle(false);
    lastFocused = document.activeElement;
    el.hidden = false;
    return new Promise(function (resolve) {
      activeResolve = resolve;
      var ok = el.querySelector('.fw-confirm-ok');
      if (ok) ok.focus();
    });
  }

  global.FWConfirm = { show: show };
})(typeof window !== 'undefined' ? window : globalThis);
