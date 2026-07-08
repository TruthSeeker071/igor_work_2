/**
 * Sector fit cheat sheet — canonical 24-sector profile (client).
 */
(function (global) {
  var SECTOR_KEYS = [
    'tech', 'healthcare', 'finance', 'creative', 'education', 'business', 'law',
    'engineering', 'science', 'startups', 'social', 'marketing', 'trades', 'media',
    'government', 'cybersecurity', 'operations', 'hospitality', 'aerospace',
    'pharmaceutical', 'sports', 'realestate', 'hr', 'agriculture',
  ];
  var SHEET_VERSION = 1;
  var HISTORY_MAX = 40;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function clampScore(n) {
    return Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
  }

  function sharpenSectorScores(scores) {
    var out = {};
    SECTOR_KEYS.forEach(function (k) {
      out[k] = clampScore(scores[k] || 0);
      if (out[k] < 15) out[k] = 0;
    });
    var ranked = SECTOR_KEYS
      .map(function (k) { return { key: k, score: out[k] }; })
      .filter(function (item) { return item.score > 0; })
      .sort(function (a, b) { return b.score - a.score; });
    if (!ranked.length) return out;
    var top = ranked.slice(0, 5);
    var max = top[0].score || 1;
    top.forEach(function (item) {
      out[item.key] = clampScore(Math.round((item.score / max) * 100));
    });
    SECTOR_KEYS.forEach(function (k) {
      if (!top.some(function (t) { return t.key === k; })) out[k] = 0;
    });
    return out;
  }

  function emptyScores() {
    var out = {};
    SECTOR_KEYS.forEach(function (k) { out[k] = 0; });
    return out;
  }

  function scoresFromQuiz(quiz) {
    var raw = (quiz && quiz.scores && typeof quiz.scores === 'object') ? quiz.scores : {};
    var out = emptyScores();
    SECTOR_KEYS.forEach(function (k) {
      if (typeof raw[k] === 'number' && isFinite(raw[k])) out[k] = clampScore(raw[k]);
    });
    return out;
  }

  function industryName(key) {
    if (global.QZ_IND && global.QZ_IND[key] && global.QZ_IND[key].name) {
      return global.QZ_IND[key].name;
    }
    return String(key || '').replace(/-/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function tierBarStyle(score) {
    if (global.FWCareerTarget && typeof FWCareerTarget.fitRarity === 'function') {
      return FWCareerTarget.fitRarity(score).base;
    }
    return 'rgb(var(--primary))';
  }

  function ensureSectorFitSheet(quiz) {
    if (!quiz || typeof quiz !== 'object') return null;
    var existing = quiz.sectorFitSheet;
    if (existing && existing.version === SHEET_VERSION && existing.scores) {
      var scores = emptyScores();
      SECTOR_KEYS.forEach(function (k) {
        scores[k] = clampScore(existing.scores[k]);
      });
      quiz.sectorFitSheet = {
        version: SHEET_VERSION,
        scores: scores,
        seededAt: existing.seededAt || existing.updatedAt || nowIso(),
        updatedAt: existing.updatedAt || existing.seededAt || nowIso(),
        history: Array.isArray(existing.history) ? existing.history.slice(-HISTORY_MAX) : [],
      };
      quiz.scores = Object.assign({}, quiz.sectorFitSheet.scores);
      return quiz.sectorFitSheet;
    }

    var seeded = scoresFromQuiz(quiz);
    var ts = nowIso();
    quiz.sectorFitSheet = {
      version: SHEET_VERSION,
      scores: seeded,
      seededAt: ts,
      updatedAt: ts,
      history: [],
    };
    quiz.scores = Object.assign({}, seeded);
    return quiz.sectorFitSheet;
  }

  function getCanonicalScores(quiz) {
    if (!quiz) return {};
    ensureSectorFitSheet(quiz);
    return Object.assign({}, quiz.sectorFitSheet.scores);
  }

  function applySectorPatches(sheet, patches, meta) {
    if (!sheet || !sheet.scores) return { sheet: sheet, changed: false, changes: [] };
    var source = String((meta && meta.source) || 'unknown').slice(0, 32);
    var changes = [];
    var list = Array.isArray(patches) ? patches : [];

    list.forEach(function (p) {
      var key = String(p && p.key || '').trim();
      if (SECTOR_KEYS.indexOf(key) === -1) return;
      var from = clampScore(sheet.scores[key]);
      var to = clampScore(p.score);
      if (Math.abs(to - from) < 1) return;
      sheet.scores[key] = to;
      changes.push({
        key: key,
        from: from,
        to: to,
        reason: String(p.reason || '').trim().slice(0, 120) || undefined,
      });
    });

    if (!changes.length) return { sheet: sheet, changed: false, changes: [] };

    var ts = nowIso();
    sheet.updatedAt = ts;
    if (!Array.isArray(sheet.history)) sheet.history = [];
    sheet.history.push({ at: ts, source: source, changes: changes });
    if (sheet.history.length > HISTORY_MAX) {
      sheet.history = sheet.history.slice(-HISTORY_MAX);
    }
    return { sheet: sheet, changed: true, changes: changes };
  }

  function recordLocalPatches(quiz, patches, source) {
    if (!quiz) return quiz;
    ensureSectorFitSheet(quiz);
    var result = applySectorPatches(quiz.sectorFitSheet, patches, { source: source });
    if (result.changed) {
      quiz.scores = Object.assign({}, quiz.sectorFitSheet.scores);
    }
    return quiz;
  }

  function applyServerSheet(quiz, sheet) {
    if (!quiz || !sheet || !sheet.scores) return quiz;
    quiz.sectorFitSheet = {
      version: SHEET_VERSION,
      scores: Object.assign(emptyScores(), sheet.scores),
      seededAt: sheet.seededAt || sheet.updatedAt || nowIso(),
      updatedAt: sheet.updatedAt || nowIso(),
      history: Array.isArray(sheet.history) ? sheet.history.slice(-HISTORY_MAX) : [],
    };
    quiz.scores = Object.assign({}, quiz.sectorFitSheet.scores);
    return quiz;
  }

  function topIndustriesFromSheet(sheet, n) {
    var scores = (sheet && sheet.scores) ? sheet.scores : {};
    return SECTOR_KEYS
      .map(function (k) { return { key: k, name: industryName(k), score: clampScore(scores[k]) }; })
      .filter(function (it) { return it.score > 0; })
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, n || 4);
  }

  function allSectorsFromSheet(sheet) {
    var scores = (sheet && sheet.scores) ? sheet.scores : emptyScores();
    return SECTOR_KEYS
      .map(function (k) { return { key: k, name: industryName(k), score: clampScore(scores[k]) }; })
      .sort(function (a, b) { return b.score - a.score; });
  }

  function formatSourceLabel(source) {
    var map = {
      quiz: 'Career quiz',
      'profile-building': 'Profile building',
      coach: 'Marco / coach',
      resume: 'Resume',
      'quiz-enrich': 'Quiz answers',
      refine: 'Sharpen matches',
      academics: 'Academics',
    };
    return map[source] || String(source || 'Update');
  }

  function recentHistoryHtml(sheet, limit) {
    var history = (sheet && Array.isArray(sheet.history)) ? sheet.history.slice().reverse() : [];
    if (!history.length) {
      return '<p class="portal-sector-history-empty">No sector updates yet beyond your quiz.</p>';
    }
    var items = history.slice(0, limit || 5).map(function (ev) {
      var when = '';
      try {
        when = new Date(ev.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      } catch (_) { when = ''; }
      var lines = (ev.changes || []).map(function (c) {
        var delta = c.to - c.from;
        var sign = delta > 0 ? '+' : '';
        return esc(industryName(c.key)) + ' ' + sign + delta + ' → ' + c.to;
      }).join('; ');
      return '<li class="portal-sector-history-item">'
        + '<span class="portal-sector-history-when">' + esc(when) + '</span> '
        + '<span class="portal-sector-history-src">' + esc(formatSourceLabel(ev.source)) + '</span>'
        + (lines ? '<span class="portal-sector-history-detail">' + lines + '</span>' : '')
        + '</li>';
    }).join('');
    return '<ul class="portal-sector-history-list">' + items + '</ul>';
  }

  function renderSectorCheatSheet(sheet, opts) {
    if (!sheet) return '';
    var sectors = allSectorsFromSheet(sheet);
    var rows = sectors.map(function (it) {
      var color = tierBarStyle(it.score);
      return '<div class="portal-sector-row">'
        + '<div class="portal-sector-head">'
        + '<span class="portal-sector-label">' + esc(it.name) + '</span>'
        + '<span class="portal-sector-score">' + it.score + '%</span>'
        + '</div>'
        + '<div class="portal-sector-bar-wrap">'
        + '<div class="portal-sector-bar" style="width:' + it.score + '%;background:' + color + '"></div>'
        + '</div>'
        + '</div>';
    }).join('');

    var showHistory = !(opts && opts.history === false);
    return '<div class="portal-sector-sheet">'
      + '<div class="portal-sector-sheet-grid">' + rows + '</div>'
      + (showHistory
        ? '<div class="portal-sector-history"><h4 class="portal-sector-history-title">Recent changes</h4>'
          + recentHistoryHtml(sheet, 5)
          + '</div>'
        : '')
      + '</div>';
  }

  function profileEntryHint(sheet) {
    if (!sheet || !Array.isArray(sheet.history) || !sheet.history.length) return '';
    var last = sheet.history[sheet.history.length - 1];
    if (!last || !last.at) return '';
    var age = Date.now() - Date.parse(last.at);
    if (Number.isNaN(age) || age > 7 * 24 * 3600 * 1000) return '';
    var n = (last.changes && last.changes.length) ? last.changes.length : 0;
    if (!n) return '';
    return 'Updated ' + n + ' sector' + (n === 1 ? '' : 's') + ' recently';
  }

  global.FWSectorFitSheet = {
    SECTOR_KEYS: SECTOR_KEYS,
    ensureSectorFitSheet: ensureSectorFitSheet,
    getCanonicalScores: getCanonicalScores,
    applyServerSheet: applyServerSheet,
    recordLocalPatches: recordLocalPatches,
    applySectorPatches: applySectorPatches,
    topIndustriesFromSheet: topIndustriesFromSheet,
    allSectorsFromSheet: allSectorsFromSheet,
    renderSectorCheatSheet: renderSectorCheatSheet,
    tierBarStyle: tierBarStyle,
    industryName: industryName,
    profileEntryHint: profileEntryHint,
    sharpenSectorScores: sharpenSectorScores,
  };
}(typeof window !== 'undefined' ? window : globalThis));
