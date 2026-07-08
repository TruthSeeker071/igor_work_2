/**
 * Legacy career-focus migration: hub/quiz slugs → O*NET slug + soc.
 */
(function (global) {
  var bootPromise = null;
  var RETARGET_WEIGHT_MIN = 75;

  var SLUG_ALIASES = {
    'software-engineering': 'software-engineer',
    'data-science': 'data-scientist',
    'ux-design': 'ux-designer',
    'product-management': 'product-manager',
    'investment-banking': 'investment-banker',
    'financial-analysis': 'financial-analyst',
    'management-consulting': 'operations-manager',
    'marketing-strategy': 'content-strategist',
    'business-analytics': 'financial-analyst',
    'corporate-strategy': 'operations-manager',
    'healthcare-admin': 'nurse',
    'legal-operations': 'paralegal',
  };

  function normalizeSlug(slug) {
    var s = String(slug || '').trim().toLowerCase();
    if (!s) return '';
    if (global.FWOnetCatalog && typeof FWOnetCatalog.normalizeSlug === 'function') {
      return FWOnetCatalog.normalizeSlug(s) || s;
    }
    return SLUG_ALIASES[s] || s;
  }

  function slugsEquivalent(a, b) {
    if (!a || !b) return false;
    return normalizeSlug(a) === normalizeSlug(b) || a === b;
  }

  function resolveCanonical(slug, name, socHint) {
    if (global.FWOnetCatalog && typeof FWOnetCatalog.resolveCanonical === 'function') {
      return FWOnetCatalog.resolveCanonical(slug, socHint).then(function (canonical) {
        if (canonical) return canonical;
        if (global.FWOnetVectors && typeof FWOnetVectors.resolveLegacyHubSlugToOnet === 'function') {
          return FWOnetVectors.resolveLegacyHubSlugToOnet(slug);
        }
        return null;
      });
    }
    if (!global.FWOnetVectors) return Promise.resolve(null);
    if (socHint && typeof FWOnetVectors.resolveOnetCareerBySlug === 'function') {
      return FWOnetVectors.resolveOnetCareerBySlug(null, socHint).then(function (bySoc) {
        if (bySoc) return bySoc;
        if (typeof FWOnetVectors.resolveLegacyHubSlugToOnet === 'function') {
          return FWOnetVectors.resolveLegacyHubSlugToOnet(slug);
        }
        return null;
      });
    }
    if (typeof FWOnetVectors.resolveLegacyHubSlugToOnet !== 'function') {
      return Promise.resolve(null);
    }
    return FWOnetVectors.resolveLegacyHubSlugToOnet(slug);
  }

  function needsMigration(focus) {
    if (!focus || !focus.slug) return false;
    var normalized = normalizeSlug(focus.slug);
    if (normalized !== focus.slug) return true;
    if (!focus.soc) return true;
    if (focus.migratedAt && focus.slug && focus.soc) return false;
    if (global.FWOnetVectors && FWOnetVectors.getCachedOnetRank) {
      var cached = FWOnetVectors.getCachedOnetRank(782);
      if (cached && cached.length) {
        var onetHit = cached.find(function (m) {
          return m.slug === focus.slug || (focus.soc && m.soc === focus.soc);
        });
        if (!onetHit) return true;
      }
    }
    return false;
  }

  function enrichFromCanonical(focus, canonical, originalSlug) {
    if (!canonical || !canonical.slug) return null;
    var hubSlug = originalSlug && canonical.slug !== originalSlug ? originalSlug : (focus.hubSlug || null);
    if (hubSlug && normalizeSlug(hubSlug) === normalizeSlug(canonical.slug)) hubSlug = null;
    var displayName = focus.name || canonical.name;
    if (hubSlug && focus.name) displayName = focus.name;
    return {
      slug: canonical.slug,
      soc: canonical.soc || focus.soc || null,
      name: displayName,
      weight: Math.max(focus.weight || 0, RETARGET_WEIGHT_MIN),
      source: focus.source || 'legacy_migration',
      hubSlug: hubSlug || focus.hubSlug || null,
      migratedFrom: focus.migratedFrom || originalSlug || focus.slug,
      migratedAt: new Date().toISOString(),
    };
  }

  function migrateFocus(focus, opts) {
    opts = opts || {};
    if (!focus || !focus.slug) return Promise.resolve(focus);
    var originalSlug = focus.slug;
    var normalizedSlug = normalizeSlug(originalSlug);

    if (!needsMigration(focus) && focus.soc) {
      if (normalizedSlug !== focus.slug) {
        return Promise.resolve(Object.assign({}, focus, {
          slug: normalizedSlug,
          hubSlug: focus.hubSlug || originalSlug,
        }));
      }
      return Promise.resolve(focus);
    }

    return resolveCanonical(normalizedSlug, focus.name, focus.soc).then(function (canonical) {
      if (!canonical || !canonical.slug) {
        if (normalizedSlug !== originalSlug) {
          return Object.assign({}, focus, {
            slug: normalizedSlug,
            hubSlug: focus.hubSlug || originalSlug,
          });
        }
        return focus;
      }
      if (canonical.slug === focus.slug && focus.soc === canonical.soc && focus.migratedAt) {
        return focus;
      }
      return enrichFromCanonical(focus, canonical, originalSlug);
    });
  }

  function applyLocalFocus(focus) {
    if (!focus || !global.FWAuth || typeof FWAuth.writeCareerFocus !== 'function') return;
    FWAuth.writeCareerFocus(focus);
  }

  function reapplyClientFields(serverFocus, clientFields) {
    if (!serverFocus || !clientFields) return serverFocus;
    return Object.assign({}, serverFocus, {
      soc: clientFields.soc || serverFocus.soc || null,
      hubSlug: clientFields.hubSlug || serverFocus.hubSlug || null,
      migratedFrom: clientFields.migratedFrom || serverFocus.migratedFrom || null,
      migratedAt: clientFields.migratedAt || serverFocus.migratedAt || null,
    });
  }

  function persistMigration(migrated, prior) {
    if (!migrated || !global.FWAuth) return Promise.resolve(migrated);
    applyLocalFocus(migrated);
    if (!FWAuth.authEmail || !FWAuth.authEmail()
      || typeof FWAuth.recordCareerFocus !== 'function') {
      return Promise.resolve(migrated);
    }
    if (prior && prior.slug === migrated.slug && prior.soc === migrated.soc && prior.migratedAt) {
      return Promise.resolve(migrated);
    }
    return FWAuth.recordCareerFocus({
      slug: migrated.slug,
      name: migrated.name,
      source: 'legacy_migration',
      soc: migrated.soc || null,
      hubSlug: migrated.hubSlug || null,
      migratedFrom: migrated.migratedFrom || null,
      migratedAt: migrated.migratedAt || null,
    }).then(function (data) {
      var merged = reapplyClientFields(data && data.focus, migrated);
      if (merged) applyLocalFocus(merged);
      if (global.FWCareerTarget && typeof FWCareerTarget.dispatchFocusChanged === 'function') {
        FWCareerTarget.dispatchFocusChanged({ focus: merged, source: 'legacy_migration' });
      } else {
        try {
          global.dispatchEvent(new CustomEvent('fw:career-focus-changed', {
            detail: { focus: merged, source: 'legacy_migration' },
          }));
        } catch (_) { /* ignore */ }
      }
      return merged || migrated;
    }).catch(function (err) {
      console.warn('career focus migration persist failed', err);
      return migrated;
    });
  }

  function migrateQuiz(quiz, roadmap) {
    if (!quiz) return Promise.resolve({ quiz: quiz, roadmap: roadmap, changed: false });
    var focus = quiz.careerFocus;
    if (!focus || !focus.slug) return Promise.resolve({ quiz: quiz, roadmap: roadmap, changed: false });

    return migrateFocus(focus, { roadmap: roadmap }).then(function (migrated) {
      if (!migrated) return { quiz: quiz, roadmap: roadmap, changed: false };
      var changed = migrated.slug !== focus.slug
        || migrated.soc !== focus.soc
        || migrated.hubSlug !== focus.hubSlug
        || normalizeSlug(focus.slug) !== focus.slug;

      var nextQuiz = Object.assign({}, quiz, { careerFocus: migrated });
      var nextRoadmap = roadmap;

      if (roadmap && roadmap.targetCareerSlug
        && slugsEquivalent(roadmap.targetCareerSlug, focus.slug)
        && migrated.slug !== roadmap.targetCareerSlug) {
        nextRoadmap = Object.assign({}, roadmap, {
          targetCareerSlug: migrated.slug,
          targetCareerName: migrated.name || roadmap.targetCareerName,
        });
        if (global.FWAuth && typeof FWAuth.saveRoadmap === 'function') {
          FWAuth.saveRoadmap(nextRoadmap).catch(function () { /* ignore */ });
        }
        changed = true;
      }

      return { quiz: nextQuiz, roadmap: nextRoadmap, changed: changed, migrated: migrated, prior: focus };
    });
  }

  function mergeCareerFocus(localQuiz, serverQuiz) {
    if (!localQuiz || !serverQuiz) return serverQuiz || localQuiz;
    var localFocus = localQuiz.careerFocus;
    var serverFocus = serverQuiz.careerFocus;
    if (!localFocus || typeof localFocus !== 'object') return serverQuiz;
    if (!serverFocus || typeof serverFocus !== 'object') {
      return Object.assign({}, serverQuiz, { careerFocus: localFocus });
    }

    var localWeight = localFocus.weight || 0;
    var serverWeight = serverFocus.weight || 0;
    var localMigrated = !!(localFocus.migratedAt || localFocus.soc);
    var serverMigrated = !!(serverFocus.migratedAt || serverFocus.soc);
    var pickLocal = localWeight > serverWeight
      || (localMigrated && !serverMigrated)
      || (localMigrated && slugsEquivalent(localFocus.slug, serverFocus.slug));

    if (!pickLocal) {
      if (localFocus.soc && !serverFocus.soc) {
        return Object.assign({}, serverQuiz, {
          careerFocus: Object.assign({}, serverFocus, {
            soc: localFocus.soc,
            hubSlug: localFocus.hubSlug || serverFocus.hubSlug,
            migratedFrom: localFocus.migratedFrom || serverFocus.migratedFrom,
            migratedAt: localFocus.migratedAt || serverFocus.migratedAt,
          }),
        });
      }
      return serverQuiz;
    }

    return Object.assign({}, serverQuiz, {
      careerFocus: Object.assign({}, localFocus, {
        weight: Math.max(localWeight, serverWeight),
        updatedAt: serverFocus.updatedAt || localFocus.updatedAt,
      }),
    });
  }

  function runOnBoot() {
    if (bootPromise) return bootPromise;
    bootPromise = (function () {
      if (!global.FWAuth || !FWAuth.authEmail || !FWAuth.authEmail()) {
        return Promise.resolve(null);
      }
      var quiz = typeof FWAuth.readLocalQuiz === 'function' ? FWAuth.readLocalQuiz() : null;
      var roadmap = typeof FWAuth.readLocalRoadmap === 'function' ? FWAuth.readLocalRoadmap() : null;
      if (!quiz || !quiz.careerFocus) return Promise.resolve(null);

      return migrateQuiz(quiz, roadmap).then(function (result) {
        if (!result || !result.changed || !result.migrated) return result;
        return persistMigration(result.migrated, result.prior).then(function () {
          return result;
        });
      });
    })().finally(function () {
      bootPromise = null;
    });
    return bootPromise;
  }

  global.FWCareerFocusMigrate = {
    normalizeSlug: normalizeSlug,
    slugsEquivalent: slugsEquivalent,
    resolveCanonical: resolveCanonical,
    needsMigration: needsMigration,
    migrateFocus: migrateFocus,
    migrateQuiz: migrateQuiz,
    mergeCareerFocus: mergeCareerFocus,
    runOnBoot: runOnBoot,
    RETARGET_WEIGHT_MIN: RETARGET_WEIGHT_MIN,
  };
})(typeof window !== 'undefined' ? window : globalThis);
