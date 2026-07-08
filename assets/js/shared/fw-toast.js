/**
 * Lightweight shared toast for portal and roadmap retarget notifications.
 */
(function (global) {
  var toastTimer = null;

  function ensureToastEl() {
    var el = document.getElementById('fw-toast');
    if (el) return el;
    el = document.createElement('p');
    el.id = 'fw-toast';
    el.className = 'roadmap-sync-toast';
    el.hidden = true;
    el.setAttribute('role', 'status');
    var anchor = document.getElementById('portal-head')
      || document.getElementById('roadmap-head')
      || document.body;
    anchor.appendChild(el);
    return el;
  }

  function show(message) {
    if (!message) return;
    var el = ensureToastEl();
    el.textContent = message;
    el.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.hidden = true;
    }, 4200);
  }

  global.FWFwToast = { show: show };
})(typeof window !== 'undefined' ? window : globalThis);
