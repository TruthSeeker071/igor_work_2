(function () {
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function initNavEntrance() {
    var nav = document.getElementById('fw-nav');
    if (!nav || reduced) return;
    nav.classList.add('fw-nav-enter');
    nav.addEventListener('animationend', function (e) {
      if (e.animationName !== 'fw-nav-slide') return;
      nav.classList.remove('fw-nav-enter');
      nav.style.removeProperty('transform');
      nav.style.removeProperty('opacity');
    }, { once: true });
  }

  function initScrollReveal() {
    if (reduced) {
      document.querySelectorAll('.fw-reveal, .fw-reveal-item').forEach(function (el) {
        el.classList.add('is-visible');
      });
      return;
    }
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('is-visible');
          obs.unobserve(e.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

    document.querySelectorAll('.fw-reveal').forEach(function (el) { obs.observe(el); });
    document.querySelectorAll('.fw-reveal-stagger').forEach(function (parent) {
      var items = parent.querySelectorAll('.fw-reveal-item');
      items.forEach(function (item, i) {
        item.style.setProperty('--fw-stagger', String(i * 0.08));
      });
      obs.observe(parent);
    });
  }

  function initHeroReveal() {
    var hero = document.querySelector('.fw-hero');
    if (!hero) return;
    hero.classList.add('fw-hero-ready');
    if (reduced) {
      hero.classList.add('fw-hero-instant', 'fw-hero-settled');
      return;
    }

    var masks = hero.querySelectorAll('.fw-mask-inner');
    var pending = masks.length;
    if (!pending) {
      hero.classList.add('fw-hero-settled');
      return;
    }

    masks.forEach(function (el) {
      el.addEventListener('animationend', function (e) {
        if (e.animationName !== 'fw-rise-word') return;
        pending -= 1;
        if (pending <= 0) hero.classList.add('fw-hero-settled');
      }, { once: true });
    });

    window.setTimeout(function () {
      hero.classList.add('fw-hero-settled');
    }, 1400);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      initNavEntrance();
      initHeroReveal();
      initScrollReveal();
    });
  } else {
    initNavEntrance();
    initHeroReveal();
    initScrollReveal();
  }
})();
