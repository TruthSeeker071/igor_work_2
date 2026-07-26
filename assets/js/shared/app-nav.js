(function () {
  function pageFromPath() {
    var path = (location.pathname || '').split('/').pop() || '';
    if (path === 'portal.html') return 'home';
    if (path === 'flightplan.html') return 'plan';
    if (path === 'coach.html') return 'advisor';
    if (path === 'quiz.html') return 'quiz';
    if (path === 'roadmap.html') return 'roadmap';
    if (path === 'profile-build.html') return null;
    if (path === 'auth.html') return null;
    if (path === 'career.html') return null;
    return null;
  }

  function pageFromDom() {
    // S7: the hub IS the Explore tab now — same page, new nav key.
    if (document.body.classList.contains('hub-page')) return 'explore';
    var fromPath = pageFromPath();
    if (fromPath) return fromPath;
    var hash = (location.hash || '').replace(/^#/, '').split('?')[0];
    if (hash === 'coach') return 'advisor';
    if (hash === 'quiz') return 'quiz';
    if (hash === 'roadmap') return 'roadmap';
    var active = document.querySelector('.page.active');
    if (!active) return null;
    if (active.id === 'page-coach') return 'advisor';
    if (active.id === 'page-quiz') return 'quiz';
    if (active.id === 'page-roadmap') return 'roadmap';
    if (active.id === 'page-portal') return 'home';
    return null;
  }

  function sync(active) {
    active = active || pageFromDom();
    document.querySelectorAll('[data-app-nav]').forEach(function (el) {
      var key = el.getAttribute('data-app-nav');
      var on = key === active;
      el.classList.toggle('is-active', on);
      if (el.tagName === 'A') {
        el.setAttribute('aria-current', on ? 'page' : 'false');
      } else {
        el.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    });
  }

  // The nav rails scroll on x with their scrollbar hidden, so at narrow widths a
  // pill cut in half was the only sign more tabs existed. Fade whichever edge
  // still has tabs behind it, and only while the rail actually overflows.
  function syncRailEdges(rail) {
    var slack = rail.scrollWidth - rail.clientWidth;
    if (slack <= 1) {
      rail.classList.remove('is-scroll-start');
      rail.classList.remove('is-scroll-end');
      return;
    }
    rail.classList.toggle('is-scroll-start', rail.scrollLeft > 1);
    rail.classList.toggle('is-scroll-end', rail.scrollLeft < slack - 1);
  }

  function bindRails() {
    var rails = document.querySelectorAll('.app-nav');
    for (var i = 0; i < rails.length; i++) {
      bindRail(rails[i]);
    }
  }

  function bindRail(rail) {
    var run = function () { syncRailEdges(rail); };
    rail.addEventListener('scroll', run, { passive: true });
    if (window.ResizeObserver) new ResizeObserver(run).observe(rail);
    else window.addEventListener('resize', run);
    // auth-nav.js hides the sign-in tab after boot, which changes scrollWidth
    // without changing the rail's own box — ResizeObserver never fires for it.
    window.addEventListener('load', run);
    run();
  }

  window.FWAppNav = { sync: sync, pageFromDom: pageFromDom };

  function boot() {
    sync();
    bindRails();
    // One delegated listener, bound in boot() because boot() runs once — sync()
    // re-runs on hashchange/popstate, so binding per tab there would stack a
    // handler per navigation, and auth-nav.js swaps tabs after boot anyway. Log
    // the stable key, never the visible label, which gets rewritten. The tab
    // navigates away immediately; events.js flushes by beacon on pagehide.
    document.addEventListener('click', function (e) {
      var t = e.target;
      var el = (t && t.closest) ? t.closest('[data-app-nav]') : null;
      if (!el) return;
      var key = el.getAttribute('data-app-nav');
      if (!key) return;
      try { if (window.FWEvents) FWEvents.log('nav_click', { tab: key }); } catch (_) {}
    });
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
