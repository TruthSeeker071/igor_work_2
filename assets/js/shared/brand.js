(function () {
  var PLANE_SVG =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" style="transform:rotate(-45deg)">' +
    '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>' +
    '</svg>';

  function brandMarkup(href, label) {
    label = label || 'FlightWay';
    var tag = href
      ? '<a href="' + href + '" class="fw-brand">'
      : '<span class="fw-brand">';
    var end = href ? '</a>' : '</span>';
    return tag +
      '<span class="fw-brand-icon">' + PLANE_SVG + '</span>' +
      '<span class="fw-brand-text">' + label + '</span>' +
      end;
  }

  window.FWBrand = {
    planeSvg: PLANE_SVG,
    markup: brandMarkup,
    upgrade: function (root) {
      root = root || document;
      root.querySelectorAll('[data-fw-brand]').forEach(function (el) {
        var href = el.getAttribute('data-fw-brand-href');
        var label = el.getAttribute('data-fw-brand-label') || 'FlightWay';
        el.innerHTML =
          '<span class="fw-brand-icon">' + PLANE_SVG + '</span>' +
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
