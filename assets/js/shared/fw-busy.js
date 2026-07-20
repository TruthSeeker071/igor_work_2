/**
 * Shared in-button busy state — instant feedback on every async action.
 *
 * Global: FWButtonBusy.start(btn, opts?) -> restore()
 *   opts.label: text shown while busy (default: keep the button's current text)
 *
 * start() must be called synchronously, before the first `await`: the point is
 * that the click registers instantly. It freezes the button's measured width so
 * the label swap can't jump layout, disables it, sets aria-busy, and swaps the
 * content for a small .fw-spinner + label. restore() puts everything back and
 * is safe to call twice (second call is a no-op).
 */
(function (global) {
  function noop() { /* nothing to restore */ }

  function start(btn, opts) {
    if (!btn) return noop;
    opts = opts || {};
    if (btn._fwBusyRestore) return btn._fwBusyRestore; // already busy — reuse

    var prevHtml = btn.innerHTML;
    var prevMinWidth = btn.style.minWidth;
    var prevDisabled = btn.disabled;
    var label = opts.label || (btn.textContent || '').trim();

    // Measure before the swap — afterwards the content is already different.
    var width = btn.offsetWidth;
    if (width) btn.style.minWidth = width + 'px';

    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.classList.add('is-busy');

    btn.textContent = '';
    var ring = document.createElement('span');
    ring.className = 'fw-spinner';
    ring.setAttribute('aria-hidden', 'true');
    var text = document.createElement('span');
    text.textContent = label;
    btn.appendChild(ring);
    btn.appendChild(text);

    function restore() {
      if (btn._fwBusyRestore !== restore) return;
      btn._fwBusyRestore = null;
      btn.innerHTML = prevHtml;
      btn.style.minWidth = prevMinWidth;
      btn.disabled = prevDisabled;
      btn.removeAttribute('aria-busy');
      btn.classList.remove('is-busy');
    }

    btn._fwBusyRestore = restore;
    return restore;
  }

  function stop(btn) {
    if (btn && btn._fwBusyRestore) btn._fwBusyRestore();
  }

  function isBusy(btn) {
    return !!(btn && btn._fwBusyRestore);
  }

  global.FWButtonBusy = { start: start, stop: stop, isBusy: isBusy };
})(typeof window !== 'undefined' ? window : globalThis);
