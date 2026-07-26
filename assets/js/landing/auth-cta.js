/**
 * Auth-aware landing header. One /auth/me check on the marketing page; if the
 * visitor has a session, swap CTAs for a single enlarged "Open FlightWay" link.
 * Default markup is the signed-out version, so logged-out users see no flash.
 */
(function () {
  function buildNav(actions) {
    actions.querySelectorAll('a.fw-btn').forEach(function (a) { a.remove(); });
    var home = document.createElement('a');
    home.href = 'portal.html';
    home.className = 'fw-btn fw-btn-primary fw-btn-lg fw-btn-nav-home';
    home.textContent = 'Open FlightWay';
    actions.appendChild(home);
  }

  function buildMobile(ctas) {
    ctas.innerHTML = '';
    var home = document.createElement('a');
    home.href = 'portal.html';
    home.className = 'fw-btn fw-btn-primary fw-btn-md fw-btn-nav-home';
    home.textContent = 'Open FlightWay';
    ctas.appendChild(home);
  }

  function buildHero() {
    var hero = document.getElementById('fw-hero-ctas');
    if (!hero) return;
    hero.innerHTML = '';
    var home = document.createElement('a');
    home.href = 'portal.html';
    home.className = 'fw-btn fw-btn-primary fw-btn-lg';
    home.textContent = 'Open FlightWay';
    hero.appendChild(home);
  }

  function applySignedIn() {
    var actions = document.getElementById('fw-nav-actions');
    var ctas = document.getElementById('fw-mobile-ctas');
    if (actions) buildNav(actions);
    if (ctas) buildMobile(ctas);
    buildHero();
  }

  fetch('/auth/me', { credentials: 'include' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (data && data.email) applySignedIn();
    })
    .catch(function () { /* signed-out: leave default markup */ });
})();
