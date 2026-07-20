/**
 * Shared resume upload: file/paste read, rules-based objective seed, server parse.
 */
(function (global) {
  'use strict';

  var MAX_RESUME_CHARS = 12000;
  var MIN_RESUME_CHARS = 40;
  var PARSE_TIMEOUT_MS = 60000;
  var PARSE_FILE_TIMEOUT_MS = 120000;
  var PARSE_RULES_TIMEOUT_MS = 15000;
  var PARSE_RULES_FILE_TIMEOUT_MS = 45000;
  var MAX_FILE_BYTES = 4 * 1024 * 1024;

  var pendingFile = null;

  var INDUSTRY_KEYWORDS = {
    finance: ['finance', 'accounting', 'investment', 'banking', 'equity', 'trading', 'financial analyst', 'cfa', 'cpa', 'bloomberg', 'goldman', 'morgan stanley', 'jp morgan', 'blackrock', 'hedge fund', 'private equity', 'portfolio', 'valuation'],
    tech: ['software', 'programming', 'python', 'javascript', 'typescript', 'java', 'react', 'node', 'developer', 'engineer', 'github', 'sql', 'machine learning', 'data science', 'api', 'aws', 'cloud', 'devops', 'backend', 'frontend', 'full stack', 'pytorch', 'tensorflow'],
    engineering: ['engineering', 'mechanical', 'electrical', 'civil', 'cad', 'solidworks', 'matlab', 'circuits', 'structural', 'manufacturing', 'hardware', 'embedded', 'systems engineer'],
    healthcare: ['healthcare', 'medical', 'hospital', 'clinical', 'patient', 'nursing', 'biology', 'chemistry', 'pre-med', 'mcat', 'research', 'lab', 'pharmacology', 'anatomy', 'public health', 'physician', 'intern'],
    law: ['law', 'legal', 'attorney', 'paralegal', 'policy', 'compliance', 'litigation', 'contract', 'regulatory', 'moot court', 'bar exam', 'judicial', 'legislation', 'amendment'],
    business: ['management', 'consulting', 'strategy', 'operations', 'mba', 'project management', 'leadership', 'business development', 'b2b', 'enterprise', 'stakeholder', 'p&l', 'revenue'],
    marketing: ['marketing', 'brand', 'social media', 'content', 'campaign', 'advertising', 'seo', 'growth', 'communications', 'pr', 'public relations', 'copywriting', 'influencer', 'email marketing'],
    startups: ['startup', 'founder', 'venture', 'entrepreneurship', 'product manager', 'innovation', 'launched', 'built', 'co-founded', 'y combinator', 'techstars', 'series a', 'seed', 'saas', 'mvp'],
    creative: ['design', 'creative', 'ux', 'ui', 'figma', 'adobe', 'photoshop', 'illustrator', 'art director', 'branding', 'typography', 'motion', 'creative director', 'portfolio'],
    education: ['teaching', 'tutoring', 'education', 'curriculum', 'mentoring', 'instructed', 'coach', 'academic', 'professor', 'lesson', 'classroom', 'school', 'pedagogy'],
    social: ['nonprofit', 'volunteer', 'community', 'social work', 'counseling', 'advocacy', 'outreach', 'humanitarian', 'ngo', 'foundation', 'mission', 'underserved'],
    science: ['research', 'laboratory', 'thesis', 'publication', 'experiment', 'analysis', 'biology', 'chemistry', 'physics', 'neuroscience', 'genomics', 'climate', 'geology', 'astronomy'],
    trades: ['electrician', 'plumber', 'welding', 'hvac', 'carpentry', 'construction', 'apprentice', 'journeyman', 'blueprint', 'fabrication'],
    media: ['broadcast', 'journalism', 'video production', 'podcast', 'filmmaking', 'reporter', 'anchor', 'documentary', 'editing', 'premiere'],
    government: ['public policy', 'municipal', 'federal', 'civil service', 'legislative', 'city council', 'public administration', 'grant writing'],
    cybersecurity: ['cybersecurity', 'infosec', 'penetration test', 'soc analyst', 'siem', 'incident response', 'cissp', 'security operations'],
    operations: ['supply chain', 'logistics', 'warehouse', 'procurement', 'inventory', 'lean six sigma', 'operations manager', 'fulfillment'],
    hospitality: ['hospitality', 'hotel management', 'restaurant', 'chef', 'culinary', 'event planning', 'tourism', 'guest services'],
    aerospace: ['aerospace', 'aviation', 'aircraft', 'flight test', 'nasa', 'spacex', 'boeing', 'pilot', 'aeronautical'],
    pharmaceutical: ['pharmaceutical', 'pharma', 'biotech', 'clinical trial', 'fda', 'pharmacology', 'drug development', 'gxp'],
    sports: ['athletics', 'coaching', 'sports management', 'kinesiology', 'personal trainer', 'ncaa', 'fitness', 'physical therapy'],
    realestate: ['real estate', 'realtor', 'broker', 'property management', 'leasing', 'commercial real estate', 'mls'],
    hr: ['human resources', 'talent acquisition', 'recruiting', 'people operations', 'onboarding', 'employee relations', 'hrbp'],
    agriculture: ['agriculture', 'sustainable farming', 'agtech', 'crop science', 'conservation', 'forestry', 'soil science'],
  };

  function isPdfFile(file) {
    if (!file) return false;
    var name = String(file.name || '').toLowerCase();
    return name.endsWith('.pdf') || file.type === 'application/pdf';
  }

  function isTxtFile(file) {
    if (!file) return false;
    var name = String(file.name || '').toLowerCase();
    return name.endsWith('.txt') || !file.type || file.type.indexOf('text') !== -1;
  }

  function emptyObjectiveVector() {
    if (global.FWOnetVectors && typeof FWOnetVectors.emptyVector === 'function') {
      return {
        schemaId: FWOnetVectors.SCHEMA || 'onet-lv-161-v1',
        values: FWOnetVectors.emptyVector(),
        sources: [],
        updatedAt: new Date().toISOString(),
        source: 'empty',
      };
    }
    return { schemaId: 'onet-lv-161-v1', values: new Array(161).fill(0), sources: [], source: 'empty' };
  }

  function skippedObjectiveVector() {
    var base = emptyObjectiveVector();
    base.source = 'skipped';
    base.skipped = true;
    base.updatedAt = new Date().toISOString();
    return base;
  }

  function parseIndustryBoosts(text) {
    var t = String(text || '').toLowerCase();
    var boosts = {};
    Object.keys(INDUSTRY_KEYWORDS).forEach(function (ind) {
      var hits = INDUSTRY_KEYWORDS[ind].filter(function (kw) { return t.indexOf(kw) !== -1; }).length;
      if (hits > 0) boosts[ind] = Math.min(hits * 2, 10);
    });
    return boosts;
  }

  function readFileAsText(file) {
    return new Promise(function (resolve, reject) {
      if (!file) return reject(new Error('No file selected.'));
      if (!isTxtFile(file)) {
        return reject(new Error('Upload a .txt or .pdf resume file.'));
      }
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(new Error('Could not read file.')); };
      reader.readAsText(file);
    });
  }

  function readFileAsBase64(file) {
    return new Promise(function (resolve, reject) {
      if (!file) return reject(new Error('No file selected.'));
      if (file.size > MAX_FILE_BYTES) {
        return reject(new Error('File is too large. Please use a resume under 4 MB.'));
      }
      var reader = new FileReader();
      reader.onload = function () {
        var dataUrl = String(reader.result || '');
        var comma = dataUrl.indexOf(',');
        resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
      };
      reader.onerror = function () { reject(new Error('Could not read file.')); };
      reader.readAsDataURL(file);
    });
  }

  function getPendingFile() {
    return pendingFile;
  }

  function clearPendingFile() {
    pendingFile = null;
  }

  function setPendingFile(file) {
    pendingFile = file || null;
  }

  function hasValidInput(text, file) {
    var trimmed = String(text || '').trim();
    if (trimmed.length >= MIN_RESUME_CHARS) return true;
    var pf = file || pendingFile;
    return !!(pf && pf.base64);
  }

  function processFile(file) {
    if (!file) return Promise.reject(new Error('No file selected.'));
    if (file.size > MAX_FILE_BYTES) {
      return Promise.reject(new Error('File is too large. Please use a resume under 4 MB.'));
    }
    if (isPdfFile(file)) {
      return readFileAsBase64(file).then(function (base64) {
        var entry = {
          name: file.name || 'resume.pdf',
          mimeType: file.type || 'application/pdf',
          base64: base64,
          isPdf: true,
        };
        pendingFile = entry;
        return { text: '', file: entry, fileName: entry.name };
      });
    }
    if (isTxtFile(file)) {
      return readFileAsText(file).then(function (text) {
        pendingFile = null;
        return { text: text, file: null, fileName: file.name || 'resume.txt' };
      });
    }
    return Promise.reject(new Error('Upload a .txt or .pdf resume file.'));
  }

  function applyRulesLocally(resumeText, quiz) {
    quiz = quiz || {};
    var text = String(resumeText || '').trim().slice(0, MAX_RESUME_CHARS);
    if (text.length < MIN_RESUME_CHARS) return null;
    quiz.resumeText = text;
    quiz.objectiveSkipped = false;
    quiz.resumeBoosts = parseIndustryBoosts(text);
    if (global.FWOnetVectors && typeof FWOnetVectors.applyResumeWithPersonalityBleed === 'function') {
      var base = quiz.objectiveVector || emptyObjectiveVector();
      var profiles = FWOnetVectors.getZoneProfilesSync ? FWOnetVectors.getZoneProfilesSync() : null;
      var pers = quiz.personalityVector || null;
      var applied = FWOnetVectors.applyResumeWithPersonalityBleed(base, pers, text, profiles);
      quiz.objectiveVector = applied.objective;
      if (applied.personality) quiz.personalityVector = applied.personality;
      if (FWOnetVectors.loadZoneDimensionProfiles) {
        // Zone profiles may still be the coarse fallback set; once the real
        // ones load, re-hydrate through the canonical path (which re-derives
        // objective + bleed from quiz.resumeText with the loaded profiles).
        FWOnetVectors.loadZoneDimensionProfiles().then(function (loaded) {
          if (loaded && typeof FWOnetVectors.persistQuizVectors === 'function') {
            var q = (global.FWAuth && FWAuth.readLocalQuiz && FWAuth.readLocalQuiz()) || null;
            if (q && String(q.resumeText || '').trim() === text) {
              FWOnetVectors.persistQuizVectors(q, { sync: true });
              dispatchUpdated();
            }
          }
        }).catch(function () { /* ignore */ });
      }
    } else if (global.FWOnetVectors && typeof FWOnetVectors.applyResumeToObjective === 'function') {
      var baseFallback = quiz.objectiveVector || emptyObjectiveVector();
      var profilesFallback = FWOnetVectors.getZoneProfilesSync ? FWOnetVectors.getZoneProfilesSync() : null;
      quiz.objectiveVector = FWOnetVectors.applyResumeToObjective(baseFallback, text, profilesFallback);
    }
    return quiz;
  }

  function writeQuiz(quiz) {
    if (global.FWAuth && typeof FWAuth.writeLocalQuiz === 'function') {
      FWAuth.writeLocalQuiz(quiz);
    }
  }

  function readQuiz() {
    if (global.FWAuth && typeof FWAuth.readLocalQuiz === 'function') {
      return FWAuth.readLocalQuiz() || {};
    }
    return {};
  }

  function dispatchUpdated() {
    try {
      global.dispatchEvent(new CustomEvent('fw-objective-updated'));
    } catch (_) { /* ignore */ }
    if (global.FWOnetHub && typeof FWOnetHub.invalidateViewport === 'function') {
      FWOnetHub.invalidateViewport();
    }
    if (global.FWOnetVectors && typeof FWOnetVectors.clearRankedCache === 'function') {
      FWOnetVectors.clearRankedCache();
    }
  }

  function applyServerResponse(data) {
    if (global.FWAuth && typeof FWAuth.applyObjectiveFromResponse === 'function') {
      FWAuth.applyObjectiveFromResponse(data);
    }
    if (global.FWAuth && typeof FWAuth.applyPersonalityFromResponse === 'function') {
      FWAuth.applyPersonalityFromResponse(data);
    }
    if (global.FWAuth && typeof FWAuth.applySectorFitFromResponse === 'function') {
      FWAuth.applySectorFitFromResponse(data);
    }
    if (data && data.extractedText) {
      pendingFile = null;
    }
    dispatchUpdated();
  }

  function parseOnServer(opts) {
    opts = opts || {};
    var text = String(opts.resumeText || '').trim().slice(0, MAX_RESUME_CHARS);
    var fileBase64 = String(opts.resumeFileBase64 || '').trim();
    var mimeType = opts.mimeType || 'application/pdf';

    if (text.length < MIN_RESUME_CHARS && !fileBase64) {
      return Promise.reject(new Error('Paste resume text or upload a .txt or .pdf file.'));
    }

    var body = {
      resumeText: text,
      userName: opts.userName || '',
      customAnswers: opts.customAnswers || [],
    };
    if (opts.rulesOnly) body.rulesOnly = true;
    if (fileBase64) {
      body.resumeFileBase64 = fileBase64;
      body.mimeType = mimeType;
    }

    var timeoutMs;
    if (opts.rulesOnly) {
      timeoutMs = fileBase64
        ? (opts.timeoutMs || PARSE_RULES_FILE_TIMEOUT_MS)
        : (opts.timeoutMs || PARSE_RULES_TIMEOUT_MS);
    } else {
      timeoutMs = fileBase64
        ? (opts.timeoutMs || PARSE_FILE_TIMEOUT_MS)
        : (opts.timeoutMs || PARSE_TIMEOUT_MS);
    }

    var fetchFn = (global.FWAuth && typeof FWAuth.authFetch === 'function')
      ? FWAuth.authFetch
      : fetch;
    var reqOpts = { method: 'POST', body: body, timeoutMs: timeoutMs };
    if (fetchFn === fetch) {
      reqOpts.credentials = 'include';
      reqOpts.headers = { 'Content-Type': 'application/json' };
      reqOpts.body = JSON.stringify(body);
    }

    return fetchFn('/resume-parse', reqOpts).then(function (resp) {
      return resp.json().then(function (data) {
        if (!resp.ok) {
          var errMsg = data.error || 'Resume analysis failed.';
          if (data.extractionFailed) {
            errMsg = data.error || 'PDF text extraction failed. Try pasting your resume or a different file.';
          }
          var err = new Error(errMsg);
          err.extractionFailed = !!data.extractionFailed;
          err.extractionMethod = data.extractionMethod || '';
          throw err;
        }
        return data;
      });
    }).then(function (data) {
      applyServerResponse(data);
      return data;
    });
  }

  function markSkipped() {
    clearPendingFile();
    var quiz = readQuiz();
    quiz.objectiveSkipped = true;
    quiz.resumeText = '';
    quiz.resumeSummary = '';
    quiz.resumeBoosts = {};
    quiz.objectiveVector = skippedObjectiveVector();
    if (global.FWOnetVectors && typeof FWOnetVectors.persistQuizVectors === 'function') {
      quiz = FWOnetVectors.persistQuizVectors(quiz, { sync: true });
    } else {
      writeQuiz(quiz);
    }
    dispatchUpdated();
    return quiz;
  }

  function bindUploadUi(root, opts) {
    opts = opts || {};
    if (!root) return;
    var textarea = root.querySelector('[data-resume-paste]');
    var fileInput = root.querySelector('[data-resume-file]');
    var uploadBtn = root.querySelector('[data-resume-upload-btn]');
    var dropZone = root.querySelector('[data-resume-drop]');
    var statusEl = root.querySelector('[data-resume-status]');

    function setStatus(msg, isErr) {
      if (!statusEl) return;
      statusEl.textContent = msg || '';
      statusEl.className = 'resume-ingest-status' + (isErr ? ' resume-ingest-status--err' : '');
    }

    function notifyReady(text, file, fileName) {
      var payload = {
        text: String(text || '').trim(),
        file: file || getPendingFile(),
        fileName: fileName || (file && file.name) || '',
      };
      if (typeof opts.onFileReady === 'function') opts.onFileReady(payload);
      if (typeof opts.onTextChange === 'function') opts.onTextChange(payload.text);
    }

    function handleText(text) {
      var trimmed = String(text || '').trim();
      if (textarea) textarea.value = trimmed;
      if (trimmed.length >= MIN_RESUME_CHARS) {
        clearPendingFile();
        setStatus(trimmed.length + ' characters ready');
        notifyReady(trimmed, null, '');
      } else if (getPendingFile()) {
        setStatus('PDF ready: ' + getPendingFile().name);
        notifyReady('', getPendingFile(), getPendingFile().name);
      } else if (trimmed.length) {
        setStatus('Add a bit more detail (' + MIN_RESUME_CHARS + '+ characters)', true);
        notifyReady(trimmed, null, '');
      } else {
        setStatus('');
        notifyReady('', null, '');
      }
    }

    function handleFile(file) {
      processFile(file).then(function (result) {
        if (result.file && result.file.isPdf) {
          setStatus('PDF ready: ' + result.fileName + ' — we\'ll extract text when you save');
          notifyReady('', result.file, result.fileName);
        } else {
          handleText(result.text);
        }
      }).catch(function (err) {
        var msg = global.FWErr
          ? FWErr.forUser(err, 'Could not read that file. Try another, or paste the text.')
          : 'Could not read that file. Try another, or paste the text.';
        setStatus(msg, true);
        if (typeof opts.onFileError === 'function') opts.onFileError(msg);
      });
    }

    if (textarea) {
      textarea.addEventListener('input', function () { handleText(textarea.value); });
    }

    if (uploadBtn && fileInput) {
      uploadBtn.addEventListener('click', function () { fileInput.click(); });
    }

    if (fileInput) {
      fileInput.addEventListener('change', function () {
        var file = fileInput.files && fileInput.files[0];
        if (!file) return;
        handleFile(file);
        fileInput.value = '';
      });
    }

    if (dropZone) {
      dropZone.addEventListener('dragover', function (e) {
        e.preventDefault();
        dropZone.classList.add('resume-ingest-drop--over');
      });
      dropZone.addEventListener('dragleave', function () {
        dropZone.classList.remove('resume-ingest-drop--over');
      });
      dropZone.addEventListener('drop', function (e) {
        e.preventDefault();
        dropZone.classList.remove('resume-ingest-drop--over');
        var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (!file) return;
        handleFile(file);
      });
    }
  }

  function uploadHtml(opts) {
    opts = opts || {};
    var summary = opts.summary ? '<p class="resume-ingest-current">' + String(opts.summary).replace(/</g, '&lt;') + '</p>' : '';
    return ''
      + '<div class="resume-ingest">'
      + summary
      + '<button type="button" class="resume-ingest-upload-btn" data-resume-upload-btn>Upload resume (.txt or .pdf)</button>'
      + '<input type="file" accept=".txt,.pdf,text/plain,application/pdf" data-resume-file class="resume-ingest-file-input" tabindex="-1" aria-hidden="true">'
      + '<label class="resume-ingest-label">Or paste resume text</label>'
      + '<textarea class="resume-ingest-textarea" data-resume-paste rows="8" placeholder="Paste your resume or experience summary…"></textarea>'
      + '<div class="resume-ingest-drop" data-resume-drop>'
      + '<span class="resume-ingest-drop-hint">.txt or .pdf — drag and drop here</span>'
      + '</div>'
      + '<p class="resume-ingest-status" data-resume-status aria-live="polite"></p>'
      + '</div>';
  }

  global.FWResumeIngest = {
    MAX_CHARS: MAX_RESUME_CHARS,
    MIN_CHARS: MIN_RESUME_CHARS,
    PARSE_TIMEOUT_MS: PARSE_TIMEOUT_MS,
    PARSE_FILE_TIMEOUT_MS: PARSE_FILE_TIMEOUT_MS,
    PARSE_RULES_TIMEOUT_MS: PARSE_RULES_TIMEOUT_MS,
    PARSE_RULES_FILE_TIMEOUT_MS: PARSE_RULES_FILE_TIMEOUT_MS,
    parseIndustryBoosts: parseIndustryBoosts,
    readFileAsText: readFileAsText,
    readFileAsBase64: readFileAsBase64,
    processFile: processFile,
    getPendingFile: getPendingFile,
    clearPendingFile: clearPendingFile,
    setPendingFile: setPendingFile,
    hasValidInput: hasValidInput,
    applyRulesLocally: applyRulesLocally,
    parseOnServer: parseOnServer,
    markSkipped: markSkipped,
    emptyObjectiveVector: emptyObjectiveVector,
    skippedObjectiveVector: skippedObjectiveVector,
    bindUploadUi: bindUploadUi,
    uploadHtml: uploadHtml,
    dispatchUpdated: dispatchUpdated,
  };
})(typeof window !== 'undefined' ? window : globalThis);
