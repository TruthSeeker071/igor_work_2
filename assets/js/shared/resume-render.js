// Resume Builder v2 — Layer 2 (zero AI) pure renderers over the canonical
// resume JSON (schema v1, see docs/RESUME_BUILDER_V2_PLAN.md §3 and
// functions/_lib/resume-schema.js). No DOM, no globals beyond the exposed
// namespace. toHtml/toPlainText/toDocxXml all walk the resume in the exact
// same top-to-bottom order (name -> contact -> summary -> per section:
// heading -> per item: org/role/dates -> bullets -> skills) so the three
// renderers and the ATS parse-order oracle never drift apart.
(function () {
  'use strict';

  // Only these section kinds are understood. Anything else is skipped
  // rather than improvised, per the plan's hard requirement.
  var KNOWN_KINDS = { experience: true, education: true, projects: true, skills: true };

  var DATE_RE = /^[A-Za-z]{3,9} \d{4}$|^\d{4}$|^Present$/;

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escXml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function contactLine(contact) {
    var c = contact || {};
    var parts = [c.email, c.phone, c.location]
      .concat(Array.isArray(c.links) ? c.links : [])
      .filter(function (v) { return typeof v === 'string' && v.trim(); });
    return parts.join(' · '); // middle dot separator
  }

  function itemHeaderLine(item) {
    var it = item || {};
    var head = [it.role, it.org].filter(function (v) { return v; }).join(' — '); // em dash
    var dates = [it.start, it.end].filter(function (v) { return v; }).join(' – '); // en dash
    if (head && dates) return head + ' (' + dates + ')';
    if (head) return head;
    return dates;
  }

  // Walks the resume top-to-bottom, invoking visitor callbacks in the exact
  // order that toPlainText/toDocxXml must reproduce. Unknown section kinds
  // are skipped entirely.
  function walk(resume, visitor) {
    var r = resume || {};
    var contact = r.contact || {};
    visitor.onName(contact.name || '');
    visitor.onContact(contactLine(contact));
    if (r.summary) visitor.onSummary(r.summary);

    var sections = Array.isArray(r.sections) ? r.sections : [];
    for (var i = 0; i < sections.length; i++) {
      var section = sections[i];
      if (!section || typeof section !== 'object') continue;
      if (!KNOWN_KINDS[section.kind]) continue;

      visitor.onSectionHeading(section.heading || '', section.kind);

      if (section.kind === 'skills') {
        var flat = Array.isArray(section.flat) ? section.flat : [];
        visitor.onSkills(flat);
        continue;
      }

      var items = Array.isArray(section.items) ? section.items : [];
      for (var j = 0; j < items.length; j++) {
        var item = items[j] || {};
        visitor.onItem(itemHeaderLine(item), item);
        var bullets = Array.isArray(item.bullets) ? item.bullets : [];
        for (var k = 0; k < bullets.length; k++) {
          var b = bullets[k];
          if (b && typeof b.text === 'string' && b.text) visitor.onBullet(b.text, b);
        }
      }
    }
  }

  // --- toPlainText -----------------------------------------------------

  function toPlainText(resume) {
    var lines = [];
    walk(resume, {
      onName: function (name) { lines.push(name); },
      onContact: function (line) { if (line) lines.push(line); },
      onSummary: function (text) { lines.push(text); },
      onSectionHeading: function (heading) { lines.push(heading); },
      onItem: function (headerLine) { if (headerLine) lines.push(headerLine); },
      onBullet: function (text) { lines.push(text); },
      onSkills: function (flat) { if (flat.length) lines.push(flat.join(', ')); },
    });
    return lines.join('\n');
  }

  // --- toHtml ------------------------------------------------------------
  // Single-column semantic HTML, one inline <style> block, no tables, no
  // CSS columns/floats/position/grid.

  var STYLE = '' +
    '.fw-resume{font-family:Arial, Helvetica, sans-serif;color:#111;' +
    'font-size:14px;line-height:1.5;margin:0;padding:0;}' +
    '.fw-resume h1{font-size:22px;margin:0 0 4px 0;}' +
    '.fw-resume h2{font-size:16px;margin:18px 0 6px 0;border-bottom:1px solid #ccc;' +
    'padding-bottom:2px;}' +
    '.fw-resume p{margin:0 0 8px 0;}' +
    '.fw-resume ul{margin:0 0 10px 0;padding-left:20px;}' +
    '.fw-resume li{margin:0 0 4px 0;}' +
    '.fw-resume .fw-item-header{font-weight:bold;margin:10px 0 2px 0;}';

  function toHtml(resume) {
    var out = [];
    out.push('<div class="fw-resume">');
    out.push('<style>' + STYLE + '</style>');

    var openList = false;
    function closeListIfOpen() {
      if (openList) { out.push('</ul>'); openList = false; }
    }

    walk(resume, {
      onName: function (name) {
        out.push('<h1>' + escHtml(name) + '</h1>');
      },
      onContact: function (line) {
        if (line) out.push('<p class="fw-contact">' + escHtml(line) + '</p>');
      },
      onSummary: function (text) {
        out.push('<p class="fw-summary">' + escHtml(text) + '</p>');
      },
      onSectionHeading: function (heading) {
        closeListIfOpen();
        out.push('<h2>' + escHtml(heading) + '</h2>');
      },
      onItem: function (headerLine) {
        closeListIfOpen();
        if (headerLine) out.push('<p class="fw-item-header">' + escHtml(headerLine) + '</p>');
      },
      onBullet: function (text) {
        if (!openList) { out.push('<ul>'); openList = true; }
        out.push('<li>' + escHtml(text) + '</li>');
      },
      onSkills: function (flat) {
        if (flat.length) {
          out.push('<p class="fw-skills">' + escHtml(flat.join(', ')) + '</p>');
        }
      },
    });
    closeListIfOpen();
    out.push('</div>');
    return out.join('');
  }

  // --- toDocxXml -----------------------------------------------------
  // word/document.xml body: plain <w:p> paragraphs, headings via pStyle,
  // no tables/columns/headers/footers.

  var DOCX_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

  function docxPara(text, style) {
    var pPr = style ? '<w:pPr><w:pStyle w:val="' + style + '"/></w:pPr>' : '';
    return '<w:p>' + pPr + '<w:r><w:t xml:space="preserve">' + escXml(text) + '</w:t></w:r></w:p>';
  }

  function toDocxXml(resume) {
    var paras = [];
    walk(resume, {
      onName: function (name) { paras.push(docxPara(name, 'Heading1')); },
      onContact: function (line) { if (line) paras.push(docxPara(line)); },
      onSummary: function (text) { paras.push(docxPara(text)); },
      onSectionHeading: function (heading) { paras.push(docxPara(heading, 'Heading2')); },
      onItem: function (headerLine) { if (headerLine) paras.push(docxPara(headerLine)); },
      onBullet: function (text) { paras.push(docxPara(text)); },
      onSkills: function (flat) { if (flat.length) paras.push(docxPara(flat.join(', '))); },
    });
    return '<w:document ' + DOCX_NS + '><w:body>' + paras.join('') + '</w:body></w:document>';
  }

  // --- atsCheck -----------------------------------------------------

  function atsCheck(resume) {
    var issues = [];
    var score = 100;
    var r = resume || {};
    var contact = r.contact || {};

    if (!contact.name) { issues.push('Missing contact name'); score -= 10; }
    if (!contact.email) { issues.push('Missing contact email'); score -= 10; }
    if (!contact.phone) { issues.push('Missing contact phone'); score -= 5; }

    var sections = Array.isArray(r.sections) ? r.sections : [];
    for (var i = 0; i < sections.length; i++) {
      var section = sections[i];
      if (!section || typeof section !== 'object') continue;
      if (!KNOWN_KINDS[section.kind]) continue;
      var heading = section.heading || section.kind;

      if (section.kind === 'skills') {
        var flat = Array.isArray(section.flat) ? section.flat : [];
        if (flat.length === 0) {
          issues.push('Empty section: ' + heading);
          score -= 10;
        }
        continue;
      }

      var items = Array.isArray(section.items) ? section.items : [];
      if (items.length === 0) {
        issues.push('Empty section: ' + heading);
        score -= 10;
        continue;
      }

      for (var j = 0; j < items.length; j++) {
        var item = items[j];
        if (!item || typeof item !== 'object') continue;
        var label = heading + ' item ' + (j + 1) + (item.org ? ' (' + item.org + ')' : '');

        if (section.kind === 'experience' && !item.start && !item.end) {
          issues.push('Missing dates on experience item: ' + label);
          score -= 5;
        }
        if (item.start && !DATE_RE.test(item.start)) {
          issues.push('Malformed date "' + item.start + '" in ' + label);
          score -= 5;
        }
        if (item.end && !DATE_RE.test(item.end)) {
          issues.push('Malformed date "' + item.end + '" in ' + label);
          score -= 5;
        }

        var bullets = Array.isArray(item.bullets) ? item.bullets : [];
        for (var k = 0; k < bullets.length; k++) {
          var b = bullets[k];
          if (b && typeof b.text === 'string' && b.text.length > 220) {
            issues.push('Bullet too long (' + b.text.length + ' chars) in ' + label);
            score -= 5;
          }
        }
      }
    }

    if (score < 0) score = 0;
    if (score > 100) score = 100;
    return { score: score, issues: issues };
  }

  var FWResumeRender = {
    toHtml: toHtml,
    toPlainText: toPlainText,
    toDocxXml: toDocxXml,
    atsCheck: atsCheck,
  };

  if (typeof window !== 'undefined') {
    window.FWResumeRender = FWResumeRender;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = FWResumeRender;
  }
})();
