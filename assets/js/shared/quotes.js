/**
 * FlightWay V2 S19 — the approved-testimonial slot (D28).
 *
 * Mounts into any `[data-fw-quotes]` container on the marketing pages (index,
 * pricing). Server contract: `GET /testimonials?limit=N` → `{ quotes: [{ id,
 * quote, name?, school? }] }`, already filtered to approved/featured and
 * already consent-redacted at write time — `name` and `school` are absent
 * unless the student ticked the box.
 *
 * Two rules:
 *
 *  1. **An empty list renders NOTHING.** The container starts hidden and is
 *     only revealed once there is at least one real quote. No skeleton, no
 *     placeholder, no "trusted by students everywhere" — the whole point of the
 *     feature is that it replaces the invented proof the audits flagged, and a
 *     fake placeholder would reintroduce exactly that.
 *  2. **Every string goes in through textContent.** These are student-written
 *     sentences on the highest-traffic page in the product; one of them will
 *     eventually contain a `<`.
 */
(function (global) {
  'use strict';

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function attributionOf(q) {
    // "Name, School" / "Name" / "School" / "" — never a stray comma, and never
    // a placeholder for the half we were not given permission to print.
    var bits = [];
    if (q.name) bits.push(q.name);
    if (q.school) bits.push(q.school);
    return bits.join(', ');
  }

  function render(host, quotes) {
    var list = el('div', 'fw-quote-list');
    quotes.forEach(function (q) {
      if (!q || !q.quote) return;
      var fig = el('figure', 'fw-quote');
      fig.appendChild(el('blockquote', 'fw-quote-text', q.quote));
      var who = attributionOf(q);
      // A quote with no consented attribution still runs — anonymous is an
      // honest label, and dropping it would silently bias the wall toward the
      // students who were comfortable being named.
      fig.appendChild(el('figcaption', 'fw-quote-who', who || 'A FlightWay student'));
      list.appendChild(fig);
    });
    if (!list.childNodes.length) return;
    var slot = host.querySelector('[data-fw-quotes-slot]') || host;
    slot.appendChild(list);
    host.hidden = false;
  }

  function mount(host) {
    if (!host || host.getAttribute('data-fw-quotes-mounted') === '1') return;
    host.setAttribute('data-fw-quotes-mounted', '1');
    var limit = parseInt(host.getAttribute('data-fw-quotes'), 10);
    if (!(limit > 0)) limit = 3;
    fetch('/testimonials?limit=' + limit)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !Array.isArray(d.quotes) || !d.quotes.length) return;
        render(host, d.quotes);
      })
      .catch(function () { /* the section simply stays hidden */ });
  }

  function boot() {
    var hosts = document.querySelectorAll('[data-fw-quotes]');
    for (var i = 0; i < hosts.length; i += 1) mount(hosts[i]);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  global.FWQuotes = { mount: mount };
}(window));
