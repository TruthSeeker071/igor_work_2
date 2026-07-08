/**
 * Client-side fallback helpers for profile building and portal snapshot.
 */
(function (global) {
  'use strict';

  var PENDING_ANALYSIS_MSG = 'Generating your analysis, check back soon.';

  var ID_FRAGMENTS = {
    unfinished: function (a) { return "you're working on " + trim(a); },
    friends: function (a) { return "people see you as strong at " + trim(a); },
    curious: function (a) { return "you're quietly curious about " + trim(a); },
    talk: function (a) { return 'you light up talking about ' + trim(a); },
    downtime: function (a) { return 'you choose ' + trim(a) + ' in your free time'; },
  };

  function trim(s) {
    var t = String(s || '').trim();
    if (!t) return 'something meaningful to you';
    if (t.length > 80) return t.slice(0, 77) + '…';
    return t;
  }

  function answerById(answers, id) {
    if (!Array.isArray(answers)) return null;
    for (var i = 0; i < answers.length; i++) {
      if (answers[i] && answers[i].id === id && answers[i].answer) return answers[i].answer;
    }
    return null;
  }

  function buildShortKnowYou(answers, context) {
    context = context || {};
    var bits = [];
    Object.keys(ID_FRAGMENTS).forEach(function (id) {
      var ans = answerById(answers, id);
      if (ans) bits.push(ID_FRAGMENTS[id](ans));
    });
    if (!bits.length) return '';
    var name = context.userName || context.name;
    var lead = name && name !== 'Student' ? name + ', ' : '';
    var text = lead + 'We hear that ' + bits.slice(0, 2).join(', and ') + '.';
    return text.length > 200 ? text.slice(0, 197) + '…' : text;
  }

  function topIndustryPicksFromQuiz(quiz, limit) {
    var scores = quiz.scores || {};
    return Object.entries(scores)
      .filter(function (e) { return Number(e[1]) > 0; })
      .sort(function (a, b) { return b[1] - a[1]; })
      .slice(0, limit || 4)
      .map(function (e) { return e[0]; });
  }

  function topIndustryPicksFromZoneFits(limit) {
    if (!global.FWHubZoneFit) return null;
    var rows = FWHubZoneFit.getCachedZoneFits();
    if (!rows || !rows.length) return null;
    return rows.slice(0, limit || 4).map(function (z) { return z.id; });
  }

  function topIndustryLabelsFromZoneFits(limit) {
    if (!global.FWHubZoneFit || typeof FWHubZoneFit.topZoneLabels !== 'function') return [];
    return FWHubZoneFit.topZoneLabels(limit || 3);
  }

  function buildFallbackPortalSnapshot(quiz, careerPool) {
    quiz = quiz || {};
    careerPool = Array.isArray(careerPool) ? careerPool : [];

    var knowYou = PENDING_ANALYSIS_MSG;
    var character = PENDING_ANALYSIS_MSG;
    var traits = Array.isArray(quiz.traits) ? quiz.traits.slice(0, 4) : [];
    var industryPicks = topIndustryPicksFromZoneFits(4)
      || topIndustryPicksFromQuiz(quiz, 4);

    var careerPicks = careerPool.slice(0, 3).map(function (c) {
      return {
        careerId: c.careerId,
        note: 'Strong quiz fit at ' + Math.round(c.score) + '%',
      };
    });

    var skillTags = [];
    careerPool.slice(0, 3).forEach(function (c) {
      (c.skills || []).forEach(function (s) {
        if (skillTags.length < 6 && skillTags.indexOf(s) === -1) skillTags.push(s);
      });
    });

    return {
      version: 1,
      source: 'fallback',
      knowYou: knowYou,
      characterAnalysis: character,
      traits: traits,
      careerPicks: careerPicks,
      industryPicks: industryPicks,
      skillTags: skillTags,
    };
  }

  function buildFallbackIdentityAnalysis(answers, context) {
    return buildShortKnowYou(answers, context);
  }

  function quizContextFromQuiz(quiz) {
    var ctx = {};
    if (!quiz) return ctx;
    if (quiz.name) ctx.userName = quiz.name;
    if (quiz.archetype) ctx.archetype = quiz.archetype;
    var zoneLabels = topIndustryLabelsFromZoneFits(3);
    if (zoneLabels.length) {
      ctx.topIndustries = zoneLabels;
    } else if (quiz.scores && typeof quiz.scores === 'object') {
      ctx.topIndustries = Object.entries(quiz.scores)
        .filter(function (e) { return Number(e[1]) > 0; })
        .sort(function (a, b) { return b[1] - a[1]; })
        .slice(0, 3)
        .map(function (e) {
          return String(e[0]).replace(/-/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
        });
    }
    return ctx;
  }

  function quizContextFromLocal() {
    try {
      if (global.FWAuth && typeof FWAuth.readLocalQuiz === 'function') {
        return quizContextFromQuiz(FWAuth.readLocalQuiz());
      }
    } catch (_) { /* ignore */ }
    return {};
  }

  global.FWProfileBuildingFallback = {
    PENDING_ANALYSIS_MSG: PENDING_ANALYSIS_MSG,
    buildShortKnowYou: buildShortKnowYou,
    buildFallbackPortalSnapshot: buildFallbackPortalSnapshot,
    buildFallbackIdentityAnalysis: buildFallbackIdentityAnalysis,
    quizContextFromLocal: quizContextFromLocal,
    quizContextFromQuiz: quizContextFromQuiz,
  };
})(typeof window !== 'undefined' ? window : globalThis);
