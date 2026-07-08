(function () {
  function pageFromPath() {
    var path = (location.pathname || '').split('/').pop() || '';
    if (path === 'portal.html') return 'home';
    if (path === 'coach.html') return 'advisor';
    if (path === 'quiz.html') return 'quiz';
    if (path === 'roadmap.html') return 'roadmap';
    if (path === 'profile-build.html') return null;
    if (path === 'auth.html') return null;
    if (path === 'career.html') return null;
    return null;
  }

  function pageFromDom() {
    if (document.body.classList.contains('hub-page')) return 'hub';
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

  window.FWAppNav = { sync: sync, pageFromDom: pageFromDom };

  function boot() {
    sync();
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
