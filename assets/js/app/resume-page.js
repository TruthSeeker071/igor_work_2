/**
 * FlightWay 2.0 — Resume Builder v2, Phase 2: resume.html editor controller.
 *
 * In-memory editor state holds the canonical schema-v1 resume object (see
 * functions/_lib/resume-schema.js). Autosaves a draft to localStorage
 * (fw_resume_draft_v1, debounced), loads/saves/deletes via /resume-doc
 * (FWAuth.authFetch), and renders a live single-column ATS-safe preview using
 * FWResumeRender.toHtml when available, else a minimal internal fallback.
 * No AI calls in this phase. Premium gating is enforced server-side (402);
 * client-side FWEnt.gate() mirrors the pattern used by resume-builder.js.
 */
(function (global) {
  'use strict';

  // Display gate (WS3): only FWErr-marked copy prints verbatim.
  function fwErr(err, fallback) {
    return global.FWErr ? FWErr.forUser(err, fallback) : fallback;
  }

  var DRAFT_KEY = 'fw_resume_draft_v1';
  var AUTOSAVE_MS = 800;
  var SECTION_KINDS = ['experience', 'education', 'projects', 'skills'];
  var SECTION_HEADINGS = {
    experience: 'Work Experience',
    education: 'Education',
    projects: 'Projects',
    skills: 'Skills',
  };
  var SRC_VALUES = ['manual', 'dossier', 'resume', 'artifact', 'sim_trial', 'experience'];

  var els = {};
  var state = {
    id: null,
    title: 'My resume',
    resume: emptyResume(),
    updatedAt: null,
    draftSavedAt: 0,
    resumes: [],
    busy: false,
    variants: [],          // in-memory tailored variants for the current resume
    activeVariantId: null, // null = base resume is active
    tailorBusy: false,
    template: null,        // chosen template/variant id, mirrored onto resume.template
    formatProfile: null,   // last /resume-format response's `profile`
  };
  var autosaveTimer = null;
  var atsTimer = null;
  var ATS_DEBOUNCE_MS = 400;
  var TAILOR_TIMEOUT_MS = 60000;
  var JOB_TEXT_MIN = 40;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function emptyResume() {
    return {
      v: 1,
      contact: { name: '', email: '', phone: '', location: '', links: [] },
      summary: '',
      sections: [
        { kind: 'experience', heading: SECTION_HEADINGS.experience, items: [] },
        { kind: 'education', heading: SECTION_HEADINGS.education, items: [] },
        { kind: 'projects', heading: SECTION_HEADINGS.projects, items: [] },
        { kind: 'skills', heading: SECTION_HEADINGS.skills, flat: [] },
      ],
    };
  }

  function sectionByKind(kind) {
    var found = null;
    (state.resume.sections || []).forEach(function (s) { if (s.kind === kind) found = s; });
    if (!found) {
      found = kind === 'skills' ? { kind: kind, heading: SECTION_HEADINGS[kind], flat: [] } : { kind: kind, heading: SECTION_HEADINGS[kind], items: [] };
      state.resume.sections.push(found);
    }
    return found;
  }

  function emptyBullet(src) {
    return { text: '', src: SRC_VALUES.indexOf(src) >= 0 ? src : 'manual', dims: [] };
  }

  function emptyItem() {
    return { org: '', role: '', start: '', end: '', bullets: [] };
  }

  // ---- network ----

  function apiFetch(path, opts) {
    if (global.FWAuth && typeof FWAuth.authFetch === 'function') return FWAuth.authFetch(path, opts);
    var o = Object.assign({ credentials: 'include' }, opts || {});
    if (o.body && typeof o.body === 'object') {
      o.headers = Object.assign({ 'Content-Type': 'application/json' }, o.headers || {});
      o.body = JSON.stringify(o.body);
    }
    return fetch(path, o);
  }

  function apiGet() { return apiFetch('/resume-doc', { method: 'GET' }); }
  function apiGetById(id) { return apiFetch('/resume-doc?id=' + encodeURIComponent(id), { method: 'GET' }); }
  function apiSave(body) { return apiFetch('/resume-doc', { method: 'POST', body: body }); }
  function apiDelete(id) { return apiFetch('/resume-doc', { method: 'DELETE', body: { id: id } }); }
  function apiTailor(body) { return apiFetch('/resume-tailor', { method: 'POST', body: body, timeoutMs: TAILOR_TIMEOUT_MS }); }
  function apiVariants(resumeId) { return apiFetch('/resume-tailor?resumeId=' + encodeURIComponent(resumeId), { method: 'GET' }); }
  function apiSuggest(body) { return apiFetch('/resume-builder', { method: 'POST', body: body, timeoutMs: TAILOR_TIMEOUT_MS }); }
  // Public, unauthenticated reference data — plain fetch, no session cookie needed.
  function apiFormat(soc, careerName) {
    var qs = 'soc=' + encodeURIComponent(soc || '') + '&career=' + encodeURIComponent(careerName || '');
    return fetch('/resume-format?' + qs, { method: 'GET' });
  }

  // ---- active document ----

  function activeVariant() {
    var found = null;
    state.variants.forEach(function (v) { if (v.id === state.activeVariantId) found = v; });
    return found;
  }

  // Either the base editor state or the JSON of the currently selected
  // tailored variant. Every renderer (preview, ATS check, DOCX export, print)
  // reads through this single accessor so they never drift apart.
  function activeResume() {
    if (state.activeVariantId) {
      var v = activeVariant();
      if (v && v.json) return v.json;
    }
    return state.resume;
  }

  // ---- format profile & template (progressive disclosure) ----
  // The recommended template is applied automatically on load — the first
  // screen never asks the student to choose anything. The <details> section
  // is purely optional, collapsed disclosure for changing it.

  function templateVariants() {
    return (state.formatProfile && Array.isArray(state.formatProfile.templateVariants))
      ? state.formatProfile.templateVariants : [];
  }

  function recommendedTemplateId() {
    var rec = null;
    templateVariants().forEach(function (v) { if (v.recommended) rec = v.id; });
    return rec || 'classic';
  }

  // Reconciles state.template once the format profile is known: a
  // previously-saved choice wins if it is still a valid variant for this
  // profile, otherwise the profile's recommended variant is applied.
  function applyDefaultTemplate() {
    if (!state.formatProfile) return;
    var ids = templateVariants().map(function (v) { return v.id; });
    if (!state.template || ids.indexOf(state.template) === -1) {
      state.template = recommendedTemplateId();
    }
    if (state.resume) state.resume.template = state.template;
    renderFormatDetails();
    updateTexButtonVisibility();
    renderPreview();
  }

  function renderFormatDetails() {
    if (!els.formatWhy || !els.templatePicker) return;
    var profile = state.formatProfile;
    if (!profile) { els.formatWhy.textContent = ''; els.templatePicker.innerHTML = ''; return; }
    els.formatWhy.textContent = 'Auto-picked ' + profile.label + ' formatting — ' + (profile.tone || '');
    els.templatePicker.innerHTML = '';
    templateVariants().forEach(function (v) {
      var row = document.createElement('label');
      row.className = 'resume-template-option';
      var radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'resume-template';
      radio.value = v.id;
      radio.checked = state.template === v.id;
      radio.addEventListener('change', function () {
        if (!radio.checked) return;
        state.template = v.id;
        if (state.resume) state.resume.template = v.id;
        renderPreview();
        scheduleAutosave();
      });
      var text = document.createElement('span');
      text.innerHTML = '<strong>' + esc(v.label) + '</strong>'
        + (v.recommended ? ' <span class="resume-template-rec">Recommended</span>' : '')
        + '<br><span class="resume-template-desc">' + esc(v.description || '') + '</span>';
      row.appendChild(radio);
      row.appendChild(text);
      els.templatePicker.appendChild(row);
    });
  }

  function updateTexButtonVisibility() {
    if (!els.texBtn) return;
    els.texBtn.hidden = !templateVariants().some(function (v) { return v.engine === 'latex'; });
  }

  // Only 'project-forward' has an HTML rendering; a LaTeX-recommended
  // template (e.g. finance's latex-onepager) previews as classic HTML —
  // the actual LaTeX layout only appears in the downloaded .tex file.
  function htmlVariantForTemplate(templateId) {
    return templateId === 'project-forward' ? 'project-forward' : 'classic';
  }

  // Picks up a previously-saved template choice from state.resume.template
  // (draft or server doc) before applyDefaultTemplate() validates/defaults it.
  function syncTemplateFromResume() {
    if (state.resume && typeof state.resume.template === 'string' && state.resume.template) {
      state.template = state.resume.template;
    }
  }

  function loadFormatProfile() {
    var focus = currentFocus();
    apiFormat(focus && focus.soc, focus && focus.name)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.profile) return;
        state.formatProfile = d.profile;
        applyDefaultTemplate();
      })
      .catch(function () { /* format profile is an enhancement — stay silent */ });
  }

  // ---- draft (localStorage) ----

  function loadDraft() {
    try {
      var raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (parsed && parsed.resume && typeof parsed.resume === 'object') return parsed;
    } catch (_) { /* ignore */ }
    return null;
  }

  function saveDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        id: state.id, title: state.title, resume: state.resume, savedAt: Date.now(),
      }));
    } catch (_) { /* ignore */ }
  }

  function scheduleAutosave() {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(function () {
      saveDraft();
      renderPreview();
    }, AUTOSAVE_MS);
    scheduleAtsCheck();
  }

  // ---- rendering ----

  function fallbackToHtml(resume) {
    var c = resume.contact || {};
    var lines = [];
    lines.push('<h1>' + esc(c.name || '') + '</h1>');
    var contactBits = [c.email, c.phone, c.location].filter(Boolean).map(esc);
    if (contactBits.length) lines.push('<p>' + contactBits.join(' &middot; ') + '</p>');
    if (c.links && c.links.length) lines.push('<p>' + c.links.map(esc).join(' &middot; ') + '</p>');
    if (resume.summary) lines.push('<p>' + esc(resume.summary) + '</p>');
    (resume.sections || []).forEach(function (sec) {
      lines.push('<h2>' + esc(sec.heading || '') + '</h2>');
      if (sec.kind === 'skills') {
        lines.push('<p>' + (sec.flat || []).map(esc).join(', ') + '</p>');
        return;
      }
      (sec.items || []).forEach(function (item) {
        var head = [item.role, item.org].filter(Boolean).map(esc).join(', ');
        var dates = [item.start, item.end].filter(Boolean).map(esc).join(' – ');
        lines.push('<p><strong>' + head + '</strong>' + (dates ? ' (' + dates + ')' : '') + '</p>');
        if (item.bullets && item.bullets.length) {
          lines.push('<ul>' + item.bullets.map(function (b) { return '<li>' + esc(b.text) + '</li>'; }).join('') + '</ul>');
        }
      });
    });
    return lines.join('\n');
  }

  function renderPreview() {
    if (!els.preview) return;
    var resume = activeResume();
    var html;
    try {
      if (global.FWResumeRender && typeof FWResumeRender.toHtml === 'function') {
        html = FWResumeRender.toHtml(resume, { variant: htmlVariantForTemplate(state.template) });
      } else {
        html = fallbackToHtml(resume);
      }
    } catch (_) {
      html = fallbackToHtml(resume);
    }
    els.preview.innerHTML = html;
  }

  // ---- ATS score (near the preview; recomputed on edit + on active-doc switch) ----

  // atsCheck() emits machine-readable issue strings that scripts/test-resume-ats.cjs
  // asserts on. They are the wrong voice for a person reading a resume, so the
  // display layer rewrites the four stable prefixes and passes anything else through.
  function humanizeAtsIssue(issue) {
    var s = String(issue || '');
    var m = s.match(/^Missing contact (name|email|phone)$/);
    if (m) return 'Add your ' + m[1] + ' so a recruiter can reach you.';
    m = s.match(/^Empty section: (.+)$/);
    if (m) return m[1] + ' has no entries yet.';
    m = s.match(/^Missing dates on experience item: (.+)$/);
    if (m) return 'Add start and end dates to ' + m[1] + '.';
    m = s.match(/^Malformed date "(.+)" in (.+)$/);
    if (m) return 'The date "' + m[1] + '" in ' + m[2] + ' is not in a format parsers read.';
    m = s.match(/^Bullet too long \((\d+) chars\) in (.+)$/);
    if (m) return 'A bullet in ' + m[2] + ' runs ' + m[1] + ' characters — tighten it to about 200.';
    return s;
  }

  function atsVerdict(score) {
    if (score >= 90) return 'Ready to send';
    if (score >= 70) return 'Nearly there';
    if (score >= 40) return 'Needs work';
    return 'Just getting started';
  }

  function renderAtsBox() {
    if (!els.atsScore || !els.atsIssues) return;
    var result = null;
    try {
      if (global.FWResumeRender && typeof FWResumeRender.atsCheck === 'function') {
        result = FWResumeRender.atsCheck(activeResume());
      }
    } catch (_) { result = null; }
    if (!result) {
      // Never show a fake perfect score when the checker isn't available.
      els.atsScore.textContent = '— / 100';
      if (els.atsVerdict) els.atsVerdict.textContent = 'Check unavailable';
      if (els.atsMeterFill) els.atsMeterFill.style.width = '0%';
      els.atsIssues.innerHTML = '';
      return;
    }
    els.atsScore.textContent = result.score + ' / 100';
    if (els.atsVerdict) els.atsVerdict.textContent = atsVerdict(result.score);
    if (els.atsMeterFill) els.atsMeterFill.style.width = result.score + '%';
    els.atsIssues.innerHTML = '';
    if (!result.issues || !result.issues.length) {
      var ok = document.createElement('li');
      ok.className = 'resume-ats-ok';
      ok.textContent = 'Nothing an applicant tracking system would trip on.';
      els.atsIssues.appendChild(ok);
      return;
    }
    result.issues.forEach(function (issue) {
      var li = document.createElement('li');
      li.textContent = humanizeAtsIssue(issue);
      els.atsIssues.appendChild(li);
    });
  }

  function scheduleAtsCheck() {
    if (atsTimer) clearTimeout(atsTimer);
    atsTimer = setTimeout(renderAtsBox, ATS_DEBOUNCE_MS);
  }

  // ---- tailored variants ----

  function variantLabel(v) {
    return (v && v.jobTitle && String(v.jobTitle).trim()) || 'Untitled job';
  }

  function setActiveDoc(variantId) {
    state.activeVariantId = variantId;
    renderVariants();
    renderPreview();
    renderAtsBox();
  }

  function renderVariants() {
    if (!els.variantList) return;
    els.variantList.innerHTML = '';

    var baseBtn = document.createElement('button');
    baseBtn.type = 'button';
    baseBtn.className = 'resume-variant-base-btn';
    baseBtn.textContent = 'Base resume';
    baseBtn.setAttribute('aria-pressed', state.activeVariantId ? 'false' : 'true');
    baseBtn.addEventListener('click', function () { setActiveDoc(null); });
    els.variantList.appendChild(baseBtn);

    state.variants.forEach(function (v) {
      var card = document.createElement('div');
      card.className = 'resume-variant-card' + (v.id === state.activeVariantId ? ' resume-variant-card--active' : '');

      var head = document.createElement('div');
      head.className = 'resume-variant-head';
      var selectBtn = document.createElement('button');
      selectBtn.type = 'button';
      selectBtn.className = 'resume-variant-select';
      selectBtn.textContent = variantLabel(v);
      selectBtn.setAttribute('aria-pressed', v.id === state.activeVariantId ? 'true' : 'false');
      selectBtn.addEventListener('click', function () { setActiveDoc(v.id); });
      head.appendChild(selectBtn);

      var match = (v.score && typeof v.score.match === 'number') ? v.score.match : 0;
      var scoreEl = document.createElement('span');
      scoreEl.className = 'resume-variant-score';
      scoreEl.textContent = match + '/100 match';
      head.appendChild(scoreEl);
      card.appendChild(head);

      var matched = (v.score && Array.isArray(v.score.matched)) ? v.score.matched : [];
      if (matched.length) {
        var chipsWrap = document.createElement('div');
        chipsWrap.className = 'resume-variant-chips';
        matched.forEach(function (kw) {
          var chip = document.createElement('span');
          chip.className = 'resume-variant-chip';
          chip.textContent = kw;
          chipsWrap.appendChild(chip);
        });
        card.appendChild(chipsWrap);
      }

      var omittedRoles = (v.score && Array.isArray(v.score.omittedRoles)) ? v.score.omittedRoles : [];
      if (omittedRoles.length) {
        var noteEl = document.createElement('p');
        noteEl.className = 'resume-variant-note';
        var n = omittedRoles.length;
        noteEl.textContent = n + (n === 1 ? ' role omitted — its bullets didn\'t match this posting.' : ' roles omitted — their bullets didn\'t match this posting.');
        card.appendChild(noteEl);
      }

      var gaps = (v.score && Array.isArray(v.score.gaps)) ? v.score.gaps : [];
      if (gaps.length) {
        var gapList = document.createElement('ul');
        gapList.className = 'resume-variant-gaps';
        gaps.forEach(function (gap) {
          var li = document.createElement('li');
          li.className = 'resume-gap-item';
          var textSpan = document.createElement('span');
          textSpan.className = 'resume-gap-text';
          textSpan.textContent = 'This posting wants: ' + gap;
          var subSpan = document.createElement('span');
          subSpan.className = 'resume-gap-sub';
          subSpan.textContent = 'Nothing in your resume shows this yet.';
          li.appendChild(textSpan);
          li.appendChild(subSpan);
          gapList.appendChild(li);
        });
        card.appendChild(gapList);
      }

      els.variantList.appendChild(card);
    });
  }

  function showTailorMsg(msg, isError) {
    if (!els.tailorMsg) return;
    els.tailorMsg.textContent = msg || '';
    els.tailorMsg.className = 'resume-tailor-msg' + (isError ? ' resume-tailor-msg--error' : '');
  }

  function setTailorBusy(busy) {
    state.tailorBusy = busy;
    if (els.tailorBtn) {
      els.tailorBtn.disabled = busy;
      els.tailorBtn.textContent = busy ? 'Tailoring…' : 'Tailor to this job';
    }
  }

  function runTailor() {
    if (state.tailorBusy) return;
    var jobTitle = els.tailorTitle ? els.tailorTitle.value.trim() : '';
    var jobText = els.tailorJobText ? els.tailorJobText.value : '';
    if (!jobText || jobText.trim().length < JOB_TEXT_MIN) {
      showTailorMsg('Paste the full job posting (at least ' + JOB_TEXT_MIN + ' characters).', true);
      return;
    }
    showTailorMsg('');
    setTailorBusy(true);
    // Save first: tailoring runs against the SERVER copy, so unsaved edits
    // (or a never-saved resume) would otherwise tailor stale/absent content.
    saveNow().then(function (saved) {
      if (!saved || !state.id) {
        setTailorBusy(false);
        showTailorMsg('Could not save your resume — fix that first, then tailor.', true);
        return;
      }
      tailorRequest(jobTitle, jobText);
    });
  }

  /**
   * S12 — arriving from an application card in the tracker
   * (`resume.html?tailorRole=…&tailorCompany=…`). It fills the job TITLE and
   * puts the cursor in the posting box; it deliberately does NOT invent posting
   * text, because the tailor's whole anti-fabrication design rests on matching
   * against a real posting, and a fabricated one would produce a confident
   * variant tuned to nothing. The params are stripped afterwards so a refresh
   * does not re-scroll the page out from under someone mid-edit.
   */
  function applyTailorPrefill() {
    if (!els.tailorTitle || !global.location) return;
    var role = '';
    var company = '';
    try {
      var q = new URLSearchParams(global.location.search || '');
      role = (q.get('tailorRole') || '').slice(0, 120);
      company = (q.get('tailorCompany') || '').slice(0, 120);
    } catch (_) { return; }
    if (!role) return;
    els.tailorTitle.value = company ? role + ' — ' + company : role;
    try {
      history.replaceState(null, '', location.pathname + location.hash);
    } catch (_) { /* non-browser host */ }
    var card = els.tailorBtn && els.tailorBtn.closest ? els.tailorBtn.closest('.resume-tailor-card') : null;
    if (card && card.scrollIntoView) {
      try { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) { card.scrollIntoView(); }
    }
    if (els.tailorJobText) setTimeout(function () { els.tailorJobText.focus(); }, 240);
    showTailorMsg('Paste the posting for this role and we will tailor against it.');
  }

  function tailorRequest(jobTitle, jobText) {
    apiTailor({ resumeId: state.id, jobTitle: jobTitle, jobText: jobText })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        setTailorBusy(false);
        if (!res.ok) {
          if (res.d && res.d.upgrade && global.FWPlanSurface && typeof FWPlanSurface.capCard === 'function') {
            var tailorHost = els.tailorBtn && els.tailorBtn.closest('.resume-tailor-card');
            if (tailorHost) { FWPlanSurface.capCard(tailorHost, res.d.feature || 'resume-tailor', res.d.error); return; }
          }
          showTailorMsg((res.d && res.d.error) || 'Could not tailor this resume — try again.', true);
          return;
        }
        state.variants.push(res.d);
        state.activeVariantId = res.d.id;
        if (els.tailorJobText) els.tailorJobText.value = '';
        renderVariants();
        renderPreview();
        renderAtsBox();
        showTailorMsg('Variant ready.');
        try { if (global.FWEvents) FWEvents.log('resume_tailor', { resumeId: state.id }); } catch (_) {}
      })
      .catch(function (err) {
        setTailorBusy(false);
        showTailorMsg(fwErr(err, 'Could not tailor this resume — check your connection.'), true);
      });
  }

  // ---- AI bullet suggestions (seeding path: /resume-builder + artifacts + sim trials) ----

  // Same focused-career resolution as the v1 portal panel (resume-builder.js).
  function currentFocus() {
    try {
      var q = (global.FWAuth && FWAuth.readLocalQuiz) ? FWAuth.readLocalQuiz() : null;
      var f = q && q.careerFocus;
      if (f && f.soc) return { soc: f.soc, name: f.name || f.title || '' };
    } catch (_) {}
    try {
      if (global.FWCareerTarget && typeof FWCareerTarget.resolveTargetCareer === 'function') {
        var t = FWCareerTarget.resolveTargetCareer();
        if (t && t.soc) return { soc: t.soc, name: t.name || '' };
      }
    } catch (_) {}
    return null;
  }

  // Sim trials live client-side only (fw_sim_history_v2) by privacy decision —
  // sent in the request body at generation time, mapped exactly like the
  // Mirror's payload in sim-engine.js. Server re-sanitizes regardless.
  function readSimTrials() {
    try {
      var raw = localStorage.getItem('fw_sim_history_v2');
      if (!raw) return [];
      var trials = JSON.parse(raw);
      if (!Array.isArray(trials)) return [];
      return trials.filter(function (t) { return t && t.tier !== 'taxi'; }).slice(0, 12).map(function (t) {
        return {
          role: t.simTitle, domain: t.domain, familiarity: t.tag,
          predictedEnjoyment: t.predicted, experiencedEnjoyment: t.experienced, gap: t.gap,
          minutesSpent: Math.round((t.seconds || 0) / 60),
          colleagueMessagesSent: t.depthMsgs, hintsUsed: t.hintsUsed,
          energizedBy: t.energizers, drainedBy: t.drainers,
          surpriseNote: t.surprise, workExcerpt: t.artifactExcerpt,
        };
      });
    } catch (_) { return []; }
  }

  function showSuggestMsg(msg, isError) {
    if (!els.suggestMsg) return;
    els.suggestMsg.textContent = msg || '';
    els.suggestMsg.className = 'resume-tailor-msg' + (isError ? ' resume-tailor-msg--error' : '');
  }

  function setSuggestBusy(busy) {
    if (els.suggestBtn) {
      els.suggestBtn.disabled = busy;
      els.suggestBtn.textContent = busy ? 'Drafting…' : 'Suggest bullets';
    }
  }

  // Append a suggested bullet to the first experience item (created if needed).
  // The bullet keeps its evidence value as src — provenance travels with it.
  function addSuggestedBullet(s) {
    var section = sectionByKind('experience');
    section.items = section.items || [];
    if (!section.items.length) section.items.push(emptyItem());
    var item = section.items[0];
    item.bullets = item.bullets || [];
    item.bullets.push({
      text: s.text,
      src: SRC_VALUES.indexOf(s.evidence) >= 0 ? s.evidence : 'dossier',
      dims: Array.isArray(s.dims) ? s.dims.slice(0, 2) : [],
    });
    renderSection('experience');
    scheduleAutosave();
  }

  function renderSuggestions(bullets) {
    if (!els.suggestList) return;
    els.suggestList.innerHTML = '';
    bullets.forEach(function (s) {
      var row = document.createElement('div');
      row.className = 'resume-suggest-row';
      var text = document.createElement('p');
      text.className = 'resume-suggest-text';
      text.textContent = s.text;
      var meta = document.createElement('div');
      meta.className = 'resume-suggest-meta';
      var chip = document.createElement('span');
      chip.className = 'resume-src-chip';
      chip.textContent = s.evidence || 'dossier';
      meta.appendChild(chip);
      (Array.isArray(s.dims) ? s.dims : []).forEach(function (d) {
        var dim = document.createElement('span');
        dim.className = 'resume-variant-chip';
        dim.textContent = d;
        meta.appendChild(dim);
      });
      var add = document.createElement('button');
      add.type = 'button';
      add.className = 'resume-add-btn';
      add.textContent = '+ Add to experience';
      add.addEventListener('click', function () {
        addSuggestedBullet(s);
        add.disabled = true;
        add.textContent = 'Added ✓';
      });
      meta.appendChild(add);
      row.appendChild(text);
      row.appendChild(meta);
      els.suggestList.appendChild(row);
    });
  }

  function runSuggest() {
    var focus = currentFocus();
    if (!focus || !focus.soc) {
      showSuggestMsg('Set a target career on your roadmap first — suggestions are tuned to it.', true);
      return;
    }
    setSuggestBusy(true);
    showSuggestMsg('');
    var body = { soc: focus.soc, careerName: focus.name, includeArtifacts: true };
    var trials = readSimTrials();
    if (trials.length) body.simTrials = trials;
    var freeText = els.suggestFacts ? els.suggestFacts.value.trim().slice(0, 2500) : '';
    if (freeText) body.freeText = freeText;
    apiSuggest(body)
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        setSuggestBusy(false);
        if (!res.ok) {
          // V2 §4: bullet suggestions are free (only mode='draft-doc' is metered),
          // so `upgrade` can no longer arrive here. The old full-page FWEnt.gate
          // is removed rather than left dead — if anything ever did set it, that
          // branch would wall the whole builder over a free feature.
          showSuggestMsg((res.d && res.d.error) || 'Could not draft suggestions — try again.', true);
          return;
        }
        var bullets = Array.isArray(res.d.bullets) ? res.d.bullets : [];
        if (!bullets.length) { showSuggestMsg('No suggestions right now — add more to your profile first.', true); return; }
        renderSuggestions(bullets);
        renderSuggestQuestions(res.d.questions);
        renderSuggestProvenance(res.d);
        var covered = res.d.coverage && res.d.coverage.covered;
        var total = res.d.coverage && res.d.coverage.total;
        showSuggestMsg(typeof covered === 'number' && total
          ? 'These cover ' + covered + '/' + total + ' of what ' + (res.d.careerName || 'this career') + ' weighs most.'
          : 'Drafts ready — every bullet keeps its source.');
      })
      .catch(function (err) {
        setSuggestBusy(false);
        showSuggestMsg(fwErr(err, 'Could not draft suggestions — check your connection.'), true);
      });
  }

  // Clarifying questions the AI needs answered to quantify bullets further —
  // answering them in the facts textarea above and regenerating tightens
  // the next draft.
  function renderSuggestQuestions(questions) {
    if (!els.suggestQuestionsWrap || !els.suggestQuestions) return;
    var list = Array.isArray(questions) ? questions.filter(function (q) { return typeof q === 'string' && q.trim(); }) : [];
    els.suggestQuestions.innerHTML = '';
    if (!list.length) { els.suggestQuestionsWrap.hidden = true; return; }
    list.forEach(function (q) {
      var li = document.createElement('li');
      li.textContent = q;
      els.suggestQuestions.appendChild(li);
    });
    els.suggestQuestionsWrap.hidden = false;
  }

  function isoDatePart(iso) {
    var m = String(iso || '').match(/^\d{4}-\d{2}-\d{2}/);
    return m ? m[0] : '';
  }

  // Quiet provenance line — only shown when the draft is grounded in
  // real-time search (gemini-grounded.js), never fabricated as a claim.
  function renderSuggestProvenance(d) {
    if (!els.suggestProvenance) return;
    if (!d || !d.grounded) { els.suggestProvenance.hidden = true; els.suggestProvenance.innerHTML = ''; return; }
    els.suggestProvenance.innerHTML = '';
    var label = document.createElement('span');
    label.textContent = 'Industry guidance as of ' + (isoDatePart(d.fetchedAt) || 'today') + '. ';
    els.suggestProvenance.appendChild(label);
    var sources = Array.isArray(d.sources) ? d.sources : [];
    sources.forEach(function (s, idx) {
      if (!s || typeof s.url !== 'string' || !/^https?:\/\//i.test(s.url)) return;
      var a = document.createElement('a');
      a.href = s.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = (s.title && String(s.title).trim()) || s.url;
      els.suggestProvenance.appendChild(a);
      if (idx < sources.length - 1) els.suggestProvenance.appendChild(document.createTextNode(', '));
    });
    els.suggestProvenance.hidden = false;
  }

  // ---- Guided AI build (R.5): modal Q&A → full-document draft ----
  // Mirrors the Roadmap's fw-qwiz clarifying-question wizard (roadmap.js):
  // POST {mode:'questions'} proposes up to 5 questions with clickable options,
  // the student answers one at a time (typed answers always possible), a final
  // step picks the template, then POST {mode:'draft-doc'} lands the complete
  // resume in the editor. Progress persists in localStorage + on the server's
  // saved doc, so a reload resumes mid-flow instead of starting over.

  var GUIDED_KEY = 'fw_resume_guided_v1';

  function apiBuilderGet(soc) {
    return apiFetch('/resume-builder?soc=' + encodeURIComponent(soc), { method: 'GET' });
  }

  function loadGuidedState() {
    try {
      var parsed = JSON.parse(localStorage.getItem(GUIDED_KEY));
      if (parsed && Array.isArray(parsed.questions) && parsed.questions.length) return parsed;
    } catch (_) { /* ignore */ }
    return null;
  }

  function saveGuidedState(s) {
    try { localStorage.setItem(GUIDED_KEY, JSON.stringify(s)); } catch (_) { /* ignore */ }
  }

  function clearGuidedState() {
    try { localStorage.removeItem(GUIDED_KEY); } catch (_) { /* ignore */ }
  }

  function resumeIsEmpty() {
    var r = state.resume || {};
    if (r.summary && r.summary.trim()) return false;
    var hasContent = false;
    (r.sections || []).forEach(function (s) {
      if (s.kind === 'skills') { if ((s.flat || []).length) hasContent = true; return; }
      (s.items || []).forEach(function (it) {
        if (it.org || it.role || (it.bullets || []).length) hasContent = true;
      });
    });
    return !hasContent;
  }

  function showGuidedMsg(msg, isError) {
    if (!els.guidedMsg) return;
    els.guidedMsg.textContent = msg || '';
    els.guidedMsg.className = 'resume-tailor-msg' + (isError ? ' resume-tailor-msg--error' : '');
  }

  function setGuidedBusy(busy, label) {
    if (!els.guidedBtn) return;
    els.guidedBtn.disabled = busy;
    els.guidedBtn.textContent = busy ? (label || 'Working…') : guidedCtaLabel();
  }

  function guidedCtaLabel() {
    var pending = loadGuidedState();
    if (pending && pending.idx < pending.questions.length) {
      return 'Continue building (' + (pending.questions.length - pending.idx) + ' questions left)';
    }
    return resumeIsEmpty() ? 'Build my resume with AI' : 'Rebuild with AI';
  }

  function updateGuidedCard() {
    if (!els.guidedCard) return;
    var empty = resumeIsEmpty();
    els.guidedCard.classList.toggle('resume-guided-card--hero', empty);
    if (els.guidedCopy) {
      els.guidedCopy.textContent = empty
        ? 'FlightWay drafts your complete resume — summary, experience, projects, skills — from everything it knows about you, asking a few quick questions along the way. Start here rather than with the blank sections below: a draft you argue with beats a page you stare at.'
        : 'Re-run the guided build any time — it rebuilds the sections below from your profile and your answers. Contact info is never touched.';
    }
    if (els.guidedBtn && !els.guidedBtn.disabled) els.guidedBtn.textContent = guidedCtaLabel();
  }

  function runGuided() {
    var focus = currentFocus();
    if (!focus || !focus.soc) {
      showGuidedMsg('Set a target career on your roadmap first — the resume is built for it.', true);
      return;
    }
    var pending = loadGuidedState();
    if (pending && pending.soc === focus.soc && pending.idx < pending.questions.length) {
      openGuidedWizard(pending);
      return;
    }
    if (!resumeIsEmpty()
      && !global.confirm('Rebuild your resume with AI? Section content below will be replaced by the new draft (contact info stays). Your answers guide the rebuild.')) {
      return;
    }
    showGuidedMsg('');
    setGuidedBusy(true, 'Preparing questions…');
    var body = { mode: 'questions', soc: focus.soc, careerName: focus.name };
    var trials = readSimTrials();
    if (trials.length) body.simTrials = trials;
    var freeText = els.suggestFacts ? els.suggestFacts.value.trim().slice(0, 2500) : '';
    if (freeText) body.freeText = freeText;
    apiSuggest(body)
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        setGuidedBusy(false);
        if (!res.ok || !Array.isArray(res.d.questions) || !res.d.questions.length) {
          // Questions are an enhancement — a failure falls through to a
          // direct build rather than blocking the whole flow.
          finishGuided(focus, [], null);
          return;
        }
        var s = { soc: focus.soc, careerName: focus.name, questions: res.d.questions, answers: [], idx: 0 };
        saveGuidedState(s);
        openGuidedWizard(s);
      })
      .catch(function () {
        setGuidedBusy(false);
        finishGuided(focus, [], null);
      });
  }

  // One question at a time in a modal (fw-qwiz styles are global CSS).
  // Every answer is persisted immediately, so closing/reloading resumes here.
  function openGuidedWizard(s) {
    var overlay = document.createElement('div');
    overlay.className = 'fw-qwiz-overlay';
    overlay.innerHTML = '<div class="fw-qwiz" role="dialog" aria-modal="true" aria-labelledby="fw-qwiz-q">'
      + '<p class="fw-qwiz-eyebrow">Let’s build your resume</p>'
      + '<p class="fw-qwiz-progress" id="fw-qwiz-progress"></p>'
      + '<h3 class="fw-qwiz-question" id="fw-qwiz-q"></h3>'
      + '<div class="fw-qwiz-options" id="fw-qwiz-options"></div>'
      + '<div class="fw-qwiz-other" id="fw-qwiz-other" hidden>'
      + '<input type="text" class="fw-qwiz-other-input" id="fw-qwiz-other-input" maxlength="200" placeholder="Type your answer…">'
      + '<button type="button" class="cta-btn fw-qwiz-other-submit" id="fw-qwiz-other-submit">Answer</button>'
      + '</div>'
      + '<div class="fw-qwiz-foot">'
      + '<button type="button" class="fw-qwiz-skip" id="fw-qwiz-skip">Skip the rest — build now</button>'
      + '</div></div>';
    document.body.appendChild(overlay);

    var qEl = overlay.querySelector('#fw-qwiz-q');
    var progEl = overlay.querySelector('#fw-qwiz-progress');
    var optsEl = overlay.querySelector('#fw-qwiz-options');
    var otherWrap = overlay.querySelector('#fw-qwiz-other');
    var otherInput = overlay.querySelector('#fw-qwiz-other-input');
    var otherSubmit = overlay.querySelector('#fw-qwiz-other-submit');
    var skipBtn = overlay.querySelector('#fw-qwiz-skip');
    var TEMPLATE_STEP = s.questions.length;
    var focus = { soc: s.soc, name: s.careerName };

    function close() {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
    }

    // Escape pauses (state is saved) — the CTA offers "Continue building".
    function onKey(e) { if (e.key === 'Escape') { close(); updateGuidedCard(); } }

    function templateChoices() {
      return templateVariants().map(function (v) {
        return { id: v.id, label: v.label + (v.recommended ? ' (Recommended)' : '') };
      });
    }

    function finishWith(templateId) {
      close();
      finishGuided(focus, s.answers, templateId);
    }

    function answer(text) {
      var t = String(text || '').trim();
      if (t) s.answers.push({ prompt: s.questions[s.idx].question, answer: t.slice(0, 200) });
      s.idx += 1;
      saveGuidedState(s);
      paint();
    }

    function paint() {
      otherWrap.hidden = true;
      otherInput.value = '';
      optsEl.innerHTML = '';
      if (s.idx >= TEMPLATE_STEP) {
        var choices = templateChoices();
        if (!choices.length) { finishWith(null); return; }
        progEl.textContent = 'Last step';
        qEl.textContent = 'Which resume style do you prefer?';
        choices.forEach(function (c) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'fw-qwiz-option';
          btn.textContent = c.label;
          btn.addEventListener('click', function () { finishWith(c.id); });
          optsEl.appendChild(btn);
        });
        skipBtn.textContent = 'Use the recommended style';
        return;
      }
      var q = s.questions[s.idx];
      progEl.textContent = 'Question ' + (s.idx + 1) + ' of ' + s.questions.length;
      qEl.textContent = q.question;
      (Array.isArray(q.options) ? q.options : []).forEach(function (opt) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'fw-qwiz-option';
        btn.textContent = opt;
        btn.addEventListener('click', function () { answer(opt); });
        optsEl.appendChild(btn);
      });
      var other = document.createElement('button');
      other.type = 'button';
      other.className = 'fw-qwiz-option fw-qwiz-option--other';
      other.textContent = 'Type my own answer…';
      other.addEventListener('click', function () {
        otherWrap.hidden = false;
        otherInput.focus();
      });
      optsEl.appendChild(other);
    }

    otherSubmit.addEventListener('click', function () { answer(otherInput.value); });
    otherInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); answer(otherInput.value); }
    });
    skipBtn.addEventListener('click', function () {
      if (s.idx >= TEMPLATE_STEP) { finishWith(null); return; }
      s.idx = TEMPLATE_STEP;
      saveGuidedState(s);
      paint();
    });
    document.addEventListener('keydown', onKey);
    paint();
  }

  function finishGuided(focus, answers, templateId) {
    setGuidedBusy(true, 'Building your resume…');
    showGuidedMsg('This takes ~20 seconds — drafting every section from your profile and answers.');
    var body = { mode: 'draft-doc', soc: focus.soc, careerName: focus.name, answers: answers || [] };
    if (templateId) body.template = templateId;
    var trials = readSimTrials();
    if (trials.length) body.simTrials = trials;
    var freeText = els.suggestFacts ? els.suggestFacts.value.trim().slice(0, 2500) : '';
    if (freeText) body.freeText = freeText;
    apiSuggest(body)
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        setGuidedBusy(false);
        if (!res.ok || !res.d || !res.d.resume) {
          if (res.d && res.d.upgrade && els.guidedCard && global.FWPlanSurface && typeof FWPlanSurface.capCard === 'function') {
            FWPlanSurface.capCard(els.guidedCard, res.d.feature || 'resume-draft', res.d.error);
            return;
          }
          showGuidedMsg((res.d && res.d.error) || 'Could not build the resume — your answers are saved, try again.', true);
          return;
        }
        var built = res.d.resume;
        // Contact stays the student's own — the AI never generates it.
        built.contact = state.resume.contact || built.contact;
        state.resume = built;
        state.template = res.d.template || state.template;
        state.resume.template = state.template;
        clearGuidedState();
        renderAll();
        applyDefaultTemplate();
        renderSuggestQuestions(res.d.questions);
        saveNow();
        showGuidedMsg('Your resume is built — refine anything below, then save or export.');
        try { if (global.FWEvents) FWEvents.log('resume_guided_build', { soc: focus.soc, answered: (answers || []).length }); } catch (_) { /* ignore */ }
      })
      .catch(function () {
        setGuidedBusy(false);
        showGuidedMsg('Could not build the resume — your answers are saved, try again.', true);
      });
  }

  // On load: restore server-side guided questions (cross-device) and any
  // saved gap-questions from the suggest flow (fix plan 2.3) — a reload never
  // silently discards either.
  function restorePendingState() {
    var focus = currentFocus();
    if (!focus || !focus.soc) return;
    apiBuilderGet(focus.soc)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var saved = d && d.saved;
        if (!saved) return;
        if (Array.isArray(saved.questions) && saved.questions.length) {
          renderSuggestQuestions(saved.questions);
        }
        var g = saved.guided;
        if (g && Array.isArray(g.questions) && g.questions.length && !g.completedAt && !loadGuidedState()) {
          saveGuidedState({ soc: focus.soc, careerName: saved.careerName || focus.name, questions: g.questions, answers: [], idx: 0 });
        }
        updateGuidedCard();
      })
      .catch(function () { /* pending state is an enhancement — stay silent */ });
  }

  function bulletRow(item, sectionKind, itemIdx, bulletIdx) {
    var row = document.createElement('div');
    row.className = 'resume-bullet-row';
    var ta = document.createElement('textarea');
    ta.value = item.bullets[bulletIdx].text || '';
    ta.rows = 1;
    ta.addEventListener('input', function () {
      // Editing text does NOT reset src — provenance records where the bullet
      // came from, and an edited artifact bullet is still artifact-derived.
      item.bullets[bulletIdx].text = ta.value;
      scheduleAutosave();
    });
    var chip = document.createElement('span');
    chip.className = 'resume-src-chip';
    chip.textContent = item.bullets[bulletIdx].src || 'manual';
    var rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'resume-remove-btn';
    rm.innerHTML = lucide.svg('x');
    rm.setAttribute('aria-label', 'Remove bullet');
    rm.addEventListener('click', function () {
      item.bullets.splice(bulletIdx, 1);
      renderSection(sectionKind);
      scheduleAutosave();
    });
    row.appendChild(ta);
    row.appendChild(chip);
    row.appendChild(rm);
    return row;
  }

  function itemCard(section, item, sectionKind, itemIdx) {
    var card = document.createElement('div');
    card.className = 'resume-item-card';

    var fieldsRow = document.createElement('div');
    fieldsRow.className = 'resume-item-fields';
    [['org', 'Organization'], ['role', 'Role / title'], ['start', 'Start'], ['end', 'End']].forEach(function (pair) {
      var input = document.createElement('input');
      input.type = 'text';
      input.placeholder = pair[1];
      input.maxLength = pair[0] === 'start' || pair[0] === 'end' ? 40 : 140;
      input.value = item[pair[0]] || '';
      input.addEventListener('input', function () {
        item[pair[0]] = input.value;
        scheduleAutosave();
      });
      fieldsRow.appendChild(input);
    });
    card.appendChild(fieldsRow);

    var bulletsWrap = document.createElement('div');
    bulletsWrap.className = 'resume-bullets-wrap';
    (item.bullets || []).forEach(function (_b, bulletIdx) {
      bulletsWrap.appendChild(bulletRow(item, sectionKind, itemIdx, bulletIdx));
    });
    card.appendChild(bulletsWrap);

    var addBullet = document.createElement('button');
    addBullet.type = 'button';
    addBullet.className = 'resume-add-btn';
    addBullet.textContent = '+ Add bullet';
    addBullet.addEventListener('click', function () {
      item.bullets = item.bullets || [];
      item.bullets.push(emptyBullet('manual'));
      renderSection(sectionKind);
      scheduleAutosave();
    });
    card.appendChild(addBullet);

    var removeItem = document.createElement('button');
    removeItem.type = 'button';
    removeItem.className = 'resume-remove-btn';
    removeItem.textContent = 'Remove entry';
    removeItem.addEventListener('click', function () {
      section.items.splice(itemIdx, 1);
      renderSection(sectionKind);
      scheduleAutosave();
    });
    card.appendChild(removeItem);

    return card;
  }

  function renderSection(kind) {
    var host = els.sectionsHost[kind];
    if (!host) return;
    var section = sectionByKind(kind);
    host.innerHTML = '';
    (section.items || []).forEach(function (item, idx) {
      host.appendChild(itemCard(section, item, kind, idx));
    });
  }

  function renderAllSections() {
    SECTION_KINDS.filter(function (k) { return k !== 'skills'; }).forEach(renderSection);
    renderSkills();
  }

  function renderSkills() {
    var section = sectionByKind('skills');
    section.flat = section.flat || [];
    var host = els.skillTags;
    if (!host) return;
    host.innerHTML = '';
    section.flat.forEach(function (skill, idx) {
      var tag = document.createElement('span');
      tag.className = 'resume-skill-tag';
      tag.innerHTML = '<span>' + esc(skill) + '</span>';
      var rm = document.createElement('button');
      rm.type = 'button';
      rm.innerHTML = lucide.svg('x');
      rm.setAttribute('aria-label', 'Remove skill');
      rm.addEventListener('click', function () {
        section.flat.splice(idx, 1);
        renderSkills();
        scheduleAutosave();
      });
      tag.appendChild(rm);
      host.appendChild(tag);
    });
  }

  function renderContactAndSummary() {
    var c = state.resume.contact || {};
    if (els.contactName) els.contactName.value = c.name || '';
    if (els.contactEmail) els.contactEmail.value = c.email || '';
    if (els.contactPhone) els.contactPhone.value = c.phone || '';
    if (els.contactLocation) els.contactLocation.value = c.location || '';
    if (els.contactLinks) els.contactLinks.value = (c.links || []).join(', ');
    if (els.summary) els.summary.value = state.resume.summary || '';
    if (els.titleInput) els.titleInput.value = state.title || '';
  }

  function renderSwitcher() {
    if (!els.switcher) return;
    els.switcher.innerHTML = '';
    if (!state.resumes.length) {
      var none = document.createElement('p');
      none.className = 'resume-switcher-empty';
      none.textContent = 'No saved resumes yet — this one appears here once you save it.';
      els.switcher.appendChild(none);
      return;
    }
    state.resumes.forEach(function (r) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = r.title || 'Untitled';
      if (r.id === state.id) btn.setAttribute('aria-current', 'true');
      btn.addEventListener('click', function () { loadResumeById(r.id); });
      els.switcher.appendChild(btn);
    });
  }

  function renderAll() {
    renderContactAndSummary();
    renderAllSections();
    renderSwitcher();
    renderVariants();
    renderPreview();
    renderAtsBox();
    updateGuidedCard();
  }

  // ---- DOCX export ----
  // Wraps FWResumeRender.toDocxXml() — which already emits a full
  // <w:document xmlns:w="..."> ... </w:document> — with the static OOXML
  // package skeleton (content types, package rel, styles) and zips it via
  // the vendored FWZip writer. STORE-only zip; a fully valid .docx.

  var DOCX_CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
    + '</Types>';

  var DOCX_PACKAGE_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    + '</Relationships>';

  var DOCX_DOCUMENT_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    + '</Relationships>';

  var DOCX_STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr/><w:rPr><w:sz w:val="22"/></w:rPr></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>'
    + '<w:pPr><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr>'
    + '<w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/>'
    + '<w:pPr><w:spacing w:before="200" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr>'
    + '<w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>'
    + '</w:styles>';

  function buildDocxDocumentXml(resume) {
    var doc = (global.FWResumeRender && typeof FWResumeRender.toDocxXml === 'function')
      ? FWResumeRender.toDocxXml(resume)
      : '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body></w:body></w:document>';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + doc;
  }

  function sanitizeFilename(name) {
    var cleaned = String(name || 'resume').replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/\s+/g, '-');
    return (cleaned || 'resume').slice(0, 80);
  }

  function activeDocTitle() {
    if (state.activeVariantId) {
      var v = activeVariant();
      if (v) return variantLabel(v);
    }
    return state.title || 'My resume';
  }

  function exportDocx() {
    if (!global.FWZip || typeof FWZip.zip !== 'function') {
      showError('DOCX export is unavailable right now.');
      return;
    }
    var files = {
      '[Content_Types].xml': DOCX_CONTENT_TYPES,
      '_rels/.rels': DOCX_PACKAGE_RELS,
      'word/document.xml': buildDocxDocumentXml(activeResume()),
      'word/_rels/document.xml.rels': DOCX_DOCUMENT_RELS,
      'word/styles.xml': DOCX_STYLES,
    };
    var bytes;
    try {
      bytes = FWZip.zip(files);
    } catch (_) {
      showError('Could not build the .docx file.');
      return;
    }
    var blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = sanitizeFilename(activeDocTitle()) + '.docx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // ---- LaTeX export (only offered when the profile has a latex variant) ----

  function exportLatex() {
    if (!global.FWResumeRender || typeof FWResumeRender.toLatex !== 'function') {
      showError('LaTeX export is unavailable right now.');
      return;
    }
    var tex = FWResumeRender.toLatex(activeResume());
    var blob = new Blob([tex], { type: 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = sanitizeFilename(activeDocTitle()) + '.tex';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // ---- state <-> fields ----

  function collectContactAndSummary() {
    state.resume.contact = {
      name: els.contactName ? els.contactName.value.trim() : '',
      email: els.contactEmail ? els.contactEmail.value.trim() : '',
      phone: els.contactPhone ? els.contactPhone.value.trim() : '',
      location: els.contactLocation ? els.contactLocation.value.trim() : '',
      links: els.contactLinks
        ? els.contactLinks.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean)
        : [],
    };
    state.resume.summary = els.summary ? els.summary.value : '';
    state.title = els.titleInput ? els.titleInput.value.trim() || 'My resume' : state.title;
  }

  // ---- save / load / delete ----

  function setSaveState(text) {
    if (els.saveState) els.saveState.textContent = text || '';
  }

  function showError(msg) {
    if (!els.error) return;
    els.error.textContent = msg || 'Something went wrong.';
    els.error.hidden = false;
    setTimeout(function () { els.error.hidden = true; }, 5000);
  }

  function saveNow() {
    collectContactAndSummary();
    saveDraft();
    setSaveState('Saving…');
    var body = { title: state.title, json: state.resume };
    if (state.id) body.id = state.id;
    return apiSave(body).then(function (r) {
      return r.json().then(function (d) { return { ok: r.ok, d: d }; });
    }).then(function (res) {
      if (!res.ok) {
        setSaveState('');
        showError((res.d && res.d.error) || 'Could not save.');
        return false;
      }
      state.id = res.d.id;
      state.updatedAt = res.d.updated_at;
      setSaveState('Saved ' + new Date(state.updatedAt).toLocaleTimeString());
      return refreshList().then(function () { return true; });
    }).catch(function () {
      setSaveState('');
      showError('Could not save — check your connection.');
      return false;
    });
  }

  function applyResumeDoc(doc) {
    state.id = doc.id;
    state.title = doc.title || 'My resume';
    state.resume = (doc.json && typeof doc.json === 'object') ? doc.json : emptyResume();
    state.updatedAt = doc.updated_at || null;
    // A saved template choice wins over any default; applyDefaultTemplate()
    // (called once the format profile is known) validates it against the
    // profile's variant list and falls back to the recommendation otherwise.
    syncTemplateFromResume();
    // Variants are per-resume; server-persisted ones are refetched below.
    state.variants = [];
    state.activeVariantId = null;
    renderAll();
    applyDefaultTemplate();
    loadVariants();
  }

  // Tailored variants persist server-side (resume_versions); reload them so a
  // page refresh doesn't lose the tailored set.
  function loadVariants() {
    if (!state.id) return;
    var forId = state.id;
    apiVariants(forId).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || !Array.isArray(d.versions)) return;
      if (state.id !== forId) return; // switched resumes while in flight
      state.variants = d.versions;
      renderVariants();
    }).catch(function () { /* variants are enhancement — stay silent */ });
  }

  function loadResumeById(id) {
    if (id === state.id) return;
    apiGetById(id).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); }).then(function (res) {
      if (res.ok && res.d && res.d.doc) applyResumeDoc(res.d.doc);
      else showError((res.d && res.d.error) || 'Could not load that resume.');
    }).catch(function () { showError('Could not load that resume.'); });
  }

  function refreshList() {
    return apiGet().then(function (r) { return r.json(); }).then(function (d) {
      state.resumes = Array.isArray(d.resumes) ? d.resumes : [];
      renderSwitcher();
    }).catch(function () { /* ignore */ });
  }

  function deleteCurrent() {
    if (!state.id) { showError('Nothing to delete yet.'); return; }
    if (!global.confirm('Delete this resume? This cannot be undone.')) return;
    apiDelete(state.id).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.ok) { showError('Could not delete.'); return; }
      state.id = null;
      state.title = 'My resume';
      state.resume = emptyResume();
      state.updatedAt = null;
      state.variants = [];
      state.activeVariantId = null;
      renderAll();
      refreshList();
    }).catch(function () { showError('Could not delete.'); });
  }

  function boot() {
    var draft = loadDraft();
    apiGet().then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); }).then(function (res) {
      if (!res.ok) {
        showError((res.d && res.d.error) || 'Could not load your resumes.');
        if (draft) { state.resume = draft.resume; state.title = draft.title || state.title; state.id = draft.id || null; syncTemplateFromResume(); renderAll(); applyDefaultTemplate(); }
        return;
      }
      state.resumes = Array.isArray(res.d.resumes) ? res.d.resumes : [];
      var serverLatest = res.d.latest;
      var serverTs = serverLatest && serverLatest.updated_at ? Date.parse(serverLatest.updated_at) : 0;
      var draftTs = draft && draft.savedAt ? draft.savedAt : 0;
      if (serverLatest && serverTs >= draftTs) {
        applyResumeDoc(serverLatest);
      } else if (draft) {
        state.id = draft.id || (serverLatest ? serverLatest.id : null);
        state.title = draft.title || (serverLatest ? serverLatest.title : 'My resume');
        state.resume = draft.resume;
        state.updatedAt = null;
        syncTemplateFromResume();
        renderAll();
        applyDefaultTemplate();
        loadVariants();
      } else {
        renderAll();
        applyDefaultTemplate();
      }
    }).catch(function () {
      if (draft) { state.resume = draft.resume; state.title = draft.title || state.title; state.id = draft.id || null; syncTemplateFromResume(); renderAll(); applyDefaultTemplate(); }
      else { renderAll(); applyDefaultTemplate(); }
    });
  }

  function bindStaticFields() {
    ['contactName', 'contactEmail', 'contactPhone', 'contactLocation', 'contactLinks', 'summary', 'titleInput'].forEach(function (key) {
      var el = els[key];
      if (!el) return;
      el.addEventListener('input', function () {
        collectContactAndSummary();
        scheduleAutosave();
      });
    });
  }

  function bindAddButtons() {
    var buttons = document.querySelectorAll('[data-add-item]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', function (e) {
        var kind = e.currentTarget.getAttribute('data-add-item');
        var section = sectionByKind(kind);
        section.items = section.items || [];
        section.items.push(emptyItem());
        renderSection(kind);
        scheduleAutosave();
      });
    }
  }

  // Commits on Enter, comma, or blur — typing a skill and clicking away used
  // to silently discard it (Enter was the only commit gesture). Comma-separated
  // pastes ("Python, SQL, Excel") split into individual tags.
  function commitSkillInput() {
    if (!els.skillInput) return;
    var parts = els.skillInput.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (!parts.length) return;
    var section = sectionByKind('skills');
    section.flat = section.flat || [];
    parts.forEach(function (p) {
      if (section.flat.indexOf(p) === -1) section.flat.push(p);
    });
    els.skillInput.value = '';
    renderSkills();
    renderPreview();
    scheduleAutosave();
  }

  function bindSkillInput() {
    if (!els.skillInput) return;
    els.skillInput.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ',') return;
      e.preventDefault();
      commitSkillInput();
    });
    els.skillInput.addEventListener('blur', commitSkillInput);
  }

  function init() {
    els.gateHost = document.getElementById('resume-gate-host');
    els.titleInput = document.getElementById('resume-title-input');
    els.saveBtn = document.getElementById('resume-save-btn');
    els.saveState = document.getElementById('resume-save-state');
    els.printBtn = document.getElementById('resume-print-btn');
    els.deleteBtn = document.getElementById('resume-delete-btn');
    els.switcher = document.getElementById('resume-switcher');
    els.error = document.getElementById('resume-error');
    els.contactName = document.getElementById('resume-contact-name');
    els.contactEmail = document.getElementById('resume-contact-email');
    els.contactPhone = document.getElementById('resume-contact-phone');
    els.contactLocation = document.getElementById('resume-contact-location');
    els.contactLinks = document.getElementById('resume-contact-links');
    els.summary = document.getElementById('resume-summary');
    els.skillTags = document.getElementById('resume-skill-tags');
    els.skillInput = document.getElementById('resume-skill-input');
    els.preview = document.getElementById('resume-preview-pane');
    els.sectionsHost = {
      experience: document.querySelector('[data-items="experience"]'),
      education: document.querySelector('[data-items="education"]'),
      projects: document.querySelector('[data-items="projects"]'),
    };
    els.tailorTitle = document.getElementById('resume-tailor-title');
    els.tailorJobText = document.getElementById('resume-tailor-jobtext');
    els.tailorBtn = document.getElementById('resume-tailor-btn');
    els.tailorMsg = document.getElementById('resume-tailor-msg');
    els.suggestBtn = document.getElementById('resume-suggest-btn');
    els.suggestMsg = document.getElementById('resume-suggest-msg');
    els.suggestList = document.getElementById('resume-suggest-list');
    els.variantList = document.getElementById('resume-variant-list');
    els.atsScore = document.getElementById('resume-ats-score');
    els.atsVerdict = document.getElementById('resume-ats-verdict');
    els.atsMeterFill = document.getElementById('resume-ats-meter-fill');
    els.atsIssues = document.getElementById('resume-ats-issues');
    els.docxBtn = document.getElementById('resume-docx-btn');
    els.texBtn = document.getElementById('resume-tex-btn');
    els.formatWhy = document.getElementById('resume-format-why');
    els.templatePicker = document.getElementById('resume-template-picker');
    els.suggestFacts = document.getElementById('resume-suggest-facts');
    els.suggestQuestionsWrap = document.getElementById('resume-suggest-questions-wrap');
    els.suggestQuestions = document.getElementById('resume-suggest-questions');
    els.suggestProvenance = document.getElementById('resume-suggest-provenance');
    els.guidedCard = document.getElementById('resume-guided-card');
    els.guidedBtn = document.getElementById('resume-guided-btn');
    els.guidedMsg = document.getElementById('resume-guided-msg');
    els.guidedCopy = document.getElementById('resume-guided-copy');

    if (els.saveBtn) els.saveBtn.addEventListener('click', saveNow);
    // Render fresh right before printing so the active document (base or
    // selected variant) is always what ends up on paper.
    if (els.printBtn) els.printBtn.addEventListener('click', function () { renderPreview(); global.print(); });
    if (els.deleteBtn) els.deleteBtn.addEventListener('click', deleteCurrent);
    if (els.tailorBtn) els.tailorBtn.addEventListener('click', runTailor);
    applyTailorPrefill();
    if (els.suggestBtn) els.suggestBtn.addEventListener('click', runSuggest);
    if (els.guidedBtn) els.guidedBtn.addEventListener('click', runGuided);
    if (els.docxBtn) els.docxBtn.addEventListener('click', exportDocx);
    if (els.texBtn) els.texBtn.addEventListener('click', exportLatex);

    bindStaticFields();
    bindAddButtons();
    bindSkillInput();

    boot();
    loadFormatProfile();
    restorePendingState();
  }

  global.FWResumePage = { init: init };
})(typeof window !== 'undefined' ? window : globalThis);
