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

  var DRAFT_KEY = 'fw_resume_draft_v1';
  var AUTOSAVE_MS = 800;
  var SECTION_KINDS = ['experience', 'education', 'projects', 'skills'];
  var SECTION_HEADINGS = {
    experience: 'Work Experience',
    education: 'Education',
    projects: 'Projects',
    skills: 'Skills',
  };
  var SRC_VALUES = ['manual', 'dossier', 'resume', 'artifact', 'sim_trial'];

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
        html = FWResumeRender.toHtml(resume);
      } else {
        html = fallbackToHtml(resume);
      }
    } catch (_) {
      html = fallbackToHtml(resume);
    }
    els.preview.innerHTML = html;
  }

  // ---- ATS score (near the preview; recomputed on edit + on active-doc switch) ----

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
      els.atsIssues.innerHTML = '';
      return;
    }
    els.atsScore.textContent = result.score + ' / 100';
    els.atsIssues.innerHTML = '';
    if (!result.issues || !result.issues.length) {
      var ok = document.createElement('li');
      ok.className = 'resume-ats-ok';
      ok.textContent = 'No ATS issues found.';
      els.atsIssues.appendChild(ok);
      return;
    }
    result.issues.forEach(function (issue) {
      var li = document.createElement('li');
      li.textContent = issue;
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

  function tailorRequest(jobTitle, jobText) {
    apiTailor({ resumeId: state.id, jobTitle: jobTitle, jobText: jobText })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        setTailorBusy(false);
        if (!res.ok) {
          if (res.d && res.d.upgrade) {
            if (els.gateHost && global.FWEnt && typeof FWEnt.gate === 'function') FWEnt.gate(els.gateHost, 'resume-builder');
            showTailorMsg('Tailoring is a Flight Plan feature.', true);
            return;
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
        showTailorMsg((err && err.message) || 'Could not tailor this resume — check your connection.', true);
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
    apiSuggest(body)
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        setSuggestBusy(false);
        if (!res.ok) {
          if (res.d && res.d.upgrade && els.gateHost && global.FWEnt && typeof FWEnt.gate === 'function') {
            FWEnt.gate(els.gateHost, 'resume-builder');
          }
          showSuggestMsg((res.d && res.d.error) || 'Could not draft suggestions — try again.', true);
          return;
        }
        var bullets = Array.isArray(res.d.bullets) ? res.d.bullets : [];
        if (!bullets.length) { showSuggestMsg('No suggestions right now — add more to your profile first.', true); return; }
        renderSuggestions(bullets);
        var covered = res.d.coverage && res.d.coverage.covered;
        var total = res.d.coverage && res.d.coverage.total;
        showSuggestMsg(typeof covered === 'number' && total
          ? 'These cover ' + covered + '/' + total + ' of what ' + (res.d.careerName || 'this career') + ' weighs most.'
          : 'Drafts ready — every bullet keeps its source.');
      })
      .catch(function (err) {
        setSuggestBusy(false);
        showSuggestMsg((err && err.message) || 'Could not draft suggestions — check your connection.', true);
      });
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
    rm.textContent = '✕';
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
      rm.textContent = '✕';
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
    // Variants are per-resume; server-persisted ones are refetched below.
    state.variants = [];
    state.activeVariantId = null;
    renderAll();
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
        if (res.d && res.d.upgrade) {
          if (els.gateHost && global.FWEnt && typeof FWEnt.gate === 'function') FWEnt.gate(els.gateHost, 'resume-builder');
        } else {
          showError((res.d && res.d.error) || 'Could not load your resumes.');
        }
        if (draft) { state.resume = draft.resume; state.title = draft.title || state.title; state.id = draft.id || null; renderAll(); }
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
        renderAll();
        loadVariants();
      } else {
        renderAll();
      }
    }).catch(function () {
      if (draft) { state.resume = draft.resume; state.title = draft.title || state.title; state.id = draft.id || null; renderAll(); }
      else renderAll();
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

  function bindSkillInput() {
    if (!els.skillInput) return;
    els.skillInput.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      var val = els.skillInput.value.trim();
      if (!val) return;
      var section = sectionByKind('skills');
      section.flat = section.flat || [];
      section.flat.push(val);
      els.skillInput.value = '';
      renderSkills();
      renderPreview();
      scheduleAutosave();
    });
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
    els.atsIssues = document.getElementById('resume-ats-issues');
    els.docxBtn = document.getElementById('resume-docx-btn');

    if (els.saveBtn) els.saveBtn.addEventListener('click', saveNow);
    // Render fresh right before printing so the active document (base or
    // selected variant) is always what ends up on paper.
    if (els.printBtn) els.printBtn.addEventListener('click', function () { renderPreview(); global.print(); });
    if (els.deleteBtn) els.deleteBtn.addEventListener('click', deleteCurrent);
    if (els.tailorBtn) els.tailorBtn.addEventListener('click', runTailor);
    if (els.suggestBtn) els.suggestBtn.addEventListener('click', runSuggest);
    if (els.docxBtn) els.docxBtn.addEventListener('click', exportDocx);

    bindStaticFields();
    bindAddButtons();
    bindSkillInput();

    if (global.FWEnt && typeof FWEnt.boot === 'function') {
      FWEnt.boot().then(function () {
        if (els.gateHost && !FWEnt.has('premium')) FWEnt.gate(els.gateHost, 'resume-builder');
      });
    }

    boot();
  }

  global.FWResumePage = { init: init };
})(typeof window !== 'undefined' ? window : globalThis);
