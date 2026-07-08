/**
 * Portal resume upload drawer — update objective vector from resume.
 */
(function (global) {
  'use strict';

  var drawerOpen = false;
  var saving = false;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function readQuiz() {
    if (global.FWAuth && typeof FWAuth.readLocalQuiz === 'function') {
      return FWAuth.readLocalQuiz() || {};
    }
    return {};
  }

  function ensureShell() {
    if (document.getElementById('portal-resume-drawer')) return;
    var shell = document.createElement('div');
    shell.innerHTML = ''
      + '<div id="portal-resume-drawer-backdrop" class="portal-resume-backdrop" hidden aria-hidden="true"></div>'
      + '<aside id="portal-resume-drawer" class="portal-resume-drawer" role="dialog" aria-modal="true" aria-labelledby="portal-resume-drawer-title" hidden>'
      + '<header class="portal-resume-drawer-head">'
      + '<h2 id="portal-resume-drawer-title" class="portal-resume-drawer-title">Update your resume</h2>'
      + '<button type="button" class="portal-resume-drawer-close" id="portal-resume-drawer-close" aria-label="Close">✕</button>'
      + '</header>'
      + '<div class="portal-resume-drawer-body" id="portal-resume-drawer-body"></div>'
      + '</aside>';
    document.body.appendChild(shell.firstElementChild);
    document.body.appendChild(shell.lastElementChild);

    var backdrop = document.getElementById('portal-resume-drawer-backdrop');
    var closeBtn = document.getElementById('portal-resume-drawer-close');
    if (backdrop && !backdrop._fwBound) {
      backdrop._fwBound = true;
      backdrop.addEventListener('click', close);
    }
    if (closeBtn && !closeBtn._fwBound) {
      closeBtn._fwBound = true;
      closeBtn.addEventListener('click', close);
    }
    if (!document._fwResumeDrawerKey) {
      document._fwResumeDrawerKey = true;
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && drawerOpen) close();
      });
    }
  }

  function renderBody() {
    var body = document.getElementById('portal-resume-drawer-body');
    if (!body || !global.FWResumeIngest) return;
    var quiz = readQuiz();
    body.innerHTML = ''
      + '<p class="portal-resume-intro">Upload or paste your resume to refresh your <strong>objective fit</strong> scores across careers.</p>'
      + FWResumeIngest.uploadHtml({ summary: quiz.resumeSummary || '' })
      + '<div class="portal-resume-drawer-actions">'
      + '<button type="button" class="cta-btn" id="portal-resume-save">Update objective vector</button>'
      + '<button type="button" class="portal-resume-skip-btn" id="portal-resume-clear">I don\'t have relevant experience</button>'
      + '</div>'
      + '<p class="portal-resume-status" id="portal-resume-status" aria-live="polite"></p>';

    var currentText = quiz.resumeText || '';
    FWResumeIngest.bindUploadUi(body, {
      onTextChange: function (text) {
        var status = document.getElementById('portal-resume-status');
        if (status && text.length >= FWResumeIngest.MIN_CHARS) {
          status.textContent = '';
        }
      },
    });
    var ta = body.querySelector('[data-resume-paste]');
    if (ta && currentText) ta.value = currentText;

    var saveBtn = document.getElementById('portal-resume-save');
    var clearBtn = document.getElementById('portal-resume-clear');
    if (saveBtn) saveBtn.addEventListener('click', onSave);
    if (clearBtn) clearBtn.addEventListener('click', onClear);
  }

  async function tryRecoverResumeSave(opts) {
    opts = opts || {};
    if (!global.FWAuth || typeof FWAuth.syncQuizProfile !== 'function') return false;
    try {
      await FWAuth.syncQuizProfile();
    } catch (syncErr) {
      console.warn('resume save recovery sync failed', syncErr);
      return false;
    }
    var after = readQuiz();
    var text = String(opts.resumeText || '').trim();
    var beforeSummary = String(opts.beforeSummary || '');
    var beforeVecAt = opts.beforeObjectiveUpdatedAt || '';
    var summaryChanged = !!(after.resumeSummary && after.resumeSummary !== beforeSummary);
    var textSaved = text.length >= 40
      && String(after.resumeText || '').trim() === text.slice(0, FWResumeIngest.MAX_CHARS);
    var vecChanged = !!(after.objectiveVector && after.objectiveVector.updatedAt
      && after.objectiveVector.updatedAt !== beforeVecAt);
    if (!summaryChanged && !vecChanged && !textSaved) return false;

    if (global.FWAuth && typeof FWAuth.refreshPortalSnapshot === 'function') {
      await FWAuth.refreshPortalSnapshot({ force: true });
    }
    if (global.FWPortal && typeof FWPortal.refreshPortalCareerUi === 'function') {
      FWPortal.refreshPortalCareerUi();
    }
    return true;
  }

  async function onSave() {
    if (saving) return;
    var body = document.getElementById('portal-resume-drawer-body');
    var ta = body && body.querySelector('[data-resume-paste]');
    var status = document.getElementById('portal-resume-status');
    var saveBtn = document.getElementById('portal-resume-save');
    var text = ta ? String(ta.value || '').trim() : '';
    var pending = global.FWResumeIngest ? FWResumeIngest.getPendingFile() : null;
    var hasFile = !!(pending && pending.base64);
    if (!global.FWResumeIngest || !FWResumeIngest.hasValidInput(text, pending)) {
      if (status) status.textContent = 'Paste resume text or upload a .txt or .pdf file.';
      return;
    }
    saving = true;
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Analyzing…'; }
    if (status) {
      status.textContent = hasFile && pending.isPdf
        ? 'Extracting and analyzing PDF — this can take up to 2 minutes…'
        : 'Applying rules and AI analysis…';
    }

    try {
      var quiz = readQuiz();
      var beforeSummary = quiz.resumeSummary || '';
      var beforeObjectiveUpdatedAt = (quiz.objectiveVector && quiz.objectiveVector.updatedAt) || '';
      if (text.length >= FWResumeIngest.MIN_CHARS) {
        FWResumeIngest.applyRulesLocally(text, quiz);
        // Canonical persist (not a raw write) so the rules-applied vectors
        // hydrate consistently and sync to D1 even if the AI parse fails.
        if (global.FWOnetVectors && typeof FWOnetVectors.persistQuizVectors === 'function') {
          quiz = FWOnetVectors.persistQuizVectors(quiz, { sync: true });
        } else if (global.FWAuth && typeof FWAuth.writeLocalQuiz === 'function') {
          FWAuth.writeLocalQuiz(quiz);
        }
      }
      var parseOpts = {
        resumeText: text,
        userName: quiz.name || 'Student',
      };
      if (hasFile) {
        parseOpts.resumeFileBase64 = pending.base64;
        parseOpts.mimeType = pending.mimeType || 'application/pdf';
      }
      var data = await FWResumeIngest.parseOnServer(parseOpts);
      if (data && data.extractedText && ta) {
        ta.value = String(data.extractedText).slice(0, FWResumeIngest.MAX_CHARS);
      }
      if (global.FWAuth && typeof FWAuth.refreshPortalSnapshot === 'function') {
        await FWAuth.refreshPortalSnapshot({ force: true });
      }
      if (global.FWPortal && typeof FWPortal.refreshPortalCareerUi === 'function') {
        FWPortal.refreshPortalCareerUi();
      }
      if (status) {
        status.textContent = (data && (data.objectiveGeminiSkipped || data.industryAnalysisDegraded))
          ? 'Objective vector updated (rules-based — AI refinement skipped while models are busy).'
          : 'Objective vector updated.';
      }
      setTimeout(close, 600);
    } catch (err) {
      var recovered = await tryRecoverResumeSave({
        resumeText: text,
        beforeSummary: beforeSummary,
        beforeObjectiveUpdatedAt: beforeObjectiveUpdatedAt,
      });
      if (recovered && status) {
        status.textContent = 'Objective vector updated (saved on server; refresh was slow).';
        setTimeout(close, 600);
      } else if (status) {
        status.textContent = (err && err.message) ? err.message : 'Update failed. Try again.';
      }
    }
    saving = false;
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Update objective vector'; }
  }

  function onClear() {
    if (saving) return;
    FWResumeIngest.markSkipped();
    if (global.FWAuth && typeof FWAuth.refreshPortalSnapshot === 'function') {
      FWAuth.refreshPortalSnapshot({ force: true }).catch(function () {});
    }
    if (global.FWPortal && typeof FWPortal.refreshPortalCareerUi === 'function') {
      FWPortal.refreshPortalCareerUi();
    }
    close();
  }

  function open() {
    ensureShell();
    renderBody();
    var drawer = document.getElementById('portal-resume-drawer');
    var backdrop = document.getElementById('portal-resume-drawer-backdrop');
    if (!drawer || !backdrop) return;
    drawerOpen = true;
    drawer.hidden = false;
    backdrop.hidden = false;
    document.body.classList.add('portal-resume-drawer-open');
    var ta = drawer.querySelector('[data-resume-paste]');
    if (ta) ta.focus();
  }

  function close() {
    var drawer = document.getElementById('portal-resume-drawer');
    var backdrop = document.getElementById('portal-resume-drawer-backdrop');
    drawerOpen = false;
    if (drawer) drawer.hidden = true;
    if (backdrop) backdrop.hidden = true;
    document.body.classList.remove('portal-resume-drawer-open');
  }

  global.FWPortalResume = { open: open, close: close };
})(typeof window !== 'undefined' ? window : globalThis);
