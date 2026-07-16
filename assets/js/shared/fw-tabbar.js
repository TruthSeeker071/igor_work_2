/**
 * FWTabbar — mobile bottom tab bar (UI overhaul Phase 2, wireframe 1h).
 * Include on signed-in pages only. Renders fixed 4-tab bar below 768px;
 * desktop keeps the top nav. Static markup only — never feed user input here.
 *
 * API: FWTabbar.setAction(node|null)  — stack a page-level primary CTA above
 *      the tabs inside the same fixed container (per wireframe 1e risk note:
 *      one fixed container + one safe-area padding, never two fixed elements).
 *      FWTabbar.hide(bool)            — e.g. inside full-screen sheets.
 */
(function (global) {
  var ICONS = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h5v-6h4v6h5V9.5"/></svg>',
    explore: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/></svg>',
    roadmap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3v12"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>',
    marco: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.2 0-2.4-.25-3.4-.7L3 21l1.7-5.1A8.5 8.5 0 1 1 21 11.5z"/></svg>'
  };

  var TABS = [
    { href: 'portal.html', label: 'Home', icon: 'home', match: ['portal.html'] },
    { href: 'dashboard.html', label: 'Explore', icon: 'explore', match: ['dashboard.html', 'career.html'] },
    { href: 'roadmap.html', label: 'Roadmap', icon: 'roadmap', match: ['roadmap.html'] },
    { href: 'coach.html', label: 'Ask Marco', icon: 'marco', match: ['coach.html'], cls: 'fw-tab--marco' }
  ];

  function currentPage() {
    var p = (global.location.pathname.split('/').pop() || 'index.html').toLowerCase();
    return p.indexOf('.html') === -1 ? p + '.html' : p;
  }

  function build() {
    if (document.querySelector('.fw-tabbar-wrap')) return;
    var page = currentPage();
    var wrap = document.createElement('div');
    wrap.className = 'fw-tabbar-wrap';

    var action = document.createElement('div');
    action.className = 'fw-tabbar-action';
    action.hidden = true;
    wrap.appendChild(action);

    var nav = document.createElement('nav');
    nav.className = 'fw-tabbar';
    nav.setAttribute('aria-label', 'Primary');
    TABS.forEach(function (t) {
      var a = document.createElement('a');
      a.className = 'fw-tab' + (t.cls ? ' ' + t.cls : '');
      a.href = t.href;
      if (t.match.indexOf(page) !== -1) {
        a.classList.add('is-active');
        a.setAttribute('aria-current', 'page');
      }
      a.innerHTML = ICONS[t.icon]; /* static module-local strings only */
      var span = document.createElement('span');
      span.textContent = t.label;
      a.appendChild(span);
      nav.appendChild(a);
    });
    wrap.appendChild(nav);
    document.body.appendChild(wrap);
    document.body.classList.add('has-fw-tabbar');
  }

  function setAction(node) {
    var slot = document.querySelector('.fw-tabbar-action');
    if (!slot) return;
    while (slot.firstChild) slot.removeChild(slot.firstChild);
    if (node) slot.appendChild(node);
    slot.hidden = !node;
    document.body.classList.toggle('has-fw-tabbar-action', !!node);
  }

  function hide(hidden) {
    var wrap = document.querySelector('.fw-tabbar-wrap');
    if (wrap) wrap.hidden = !!hidden;
    document.body.classList.toggle('has-fw-tabbar', !hidden);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }

  global.FWTabbar = { setAction: setAction, hide: hide };
})(window);
