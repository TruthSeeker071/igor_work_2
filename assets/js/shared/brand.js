(function () {
  // The FlightWay bird mark. A transparent PNG (orange line-art, white
  // background removed) so it sits directly on the page and reads in both
  // light and dark mode — no badge box behind it. The favicon keeps a solid
  // badge (see assets/favicon.png) for tab-size visibility.
  var BIRD_SRC = 'assets/logo-bird.png?v=20260717g';
  function iconHtml() {
    return '<span class="fw-brand-icon">' +
      '<img class="fw-brand-bird" src="' + BIRD_SRC + '" alt="" aria-hidden="true" draggable="false">' +
      '</span>';
  }

  function brandMarkup(href, label) {
    label = label || 'FlightWay';
    var tag = href
      ? '<a href="' + href + '" class="fw-brand">'
      : '<span class="fw-brand">';
    var end = href ? '</a>' : '</span>';
    return tag +
      iconHtml() +
      '<span class="fw-brand-text">' + label + '</span>' +
      end;
  }

  window.FWBrand = {
    birdSrc: BIRD_SRC,
    markup: brandMarkup,
    upgrade: function (root) {
      root = root || document;
      root.querySelectorAll('[data-fw-brand]').forEach(function (el) {
        var href = el.getAttribute('data-fw-brand-href');
        var label = el.getAttribute('data-fw-brand-label') || 'FlightWay';
        el.innerHTML =
          iconHtml() +
          '<span class="fw-brand-text">' + label + '</span>';
        if (href) {
          el.classList.add('fw-brand');
          if (el.tagName !== 'A') {
            var a = document.createElement('a');
            a.href = href;
            a.className = el.className;
            a.innerHTML = el.innerHTML;
            el.replaceWith(a);
          }
        } else {
          el.classList.add('fw-brand');
        }
      });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { FWBrand.upgrade(); });
  } else {
    FWBrand.upgrade();
  }
})();
