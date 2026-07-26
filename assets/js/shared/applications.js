/**
 * FlightWay V2 S12 — Application Tracker, client API (D13).
 *
 * The server contract lives in functions/tracker.js +
 * functions/_lib/application-core.js and is authoritative — this file is a
 * thin, never-throwing wrapper over it, same idiom as deadline-radar.js's
 * afetch() and commitments-panel.js's postCommitment(): FWAuth.authFetch when
 * present, a credentialed fetch() otherwise (copied from the afetch() helper
 * at the top of assets/js/app/artifacts.js).
 *
 * Every method here RESOLVES, never rejects — a network failure or a thrown
 * authFetch AbortError becomes `{ok:false, status:0, error:'…'}` rather than
 * an unhandled rejection, so assets/js/app/applications-board.js never needs
 * a top-level .catch of its own. Error copy goes through FWErr exactly as
 * artifacts.js:305 does: a server 4xx's product copy survives, a 5xx (or no
 * FWErr at all) collapses to one friendly fallback line.
 *
 * Events (application_saved / application_stage_change / application_removed)
 * are already registered server-side (functions/_lib/events.js) and are
 * logged from here, wrapped in try/catch, exactly like every other FWEvents
 * call site in this codebase. tailorUrl()/practiceUrl() build a URL and never
 * log anything — the tracker_tailor_click/tracker_practice_click events belong
 * to whoever actually navigates (applications-board.js), not to the builder.
 */
(function (global) {
  'use strict';

  // The route is `/tracker`, not `/applications` — load-bearing, see
  // functions/tracker.js's own header comment. A Pages Function shadows a
  // static asset at the same path, and Pages 308s `/applications.html` to
  // `/applications`; a Function there would make the page itself unreachable.
  var ENDPOINT = '/tracker';
  var NET_ERROR = 'Could not reach FlightWay. Check your connection and try again.';

  /** Copied verbatim from assets/js/app/artifacts.js's own afetch(). */
  function afetch(url, bodyObj) {
    var useAuth = global.FWAuth && typeof FWAuth.authFetch === 'function';
    if (useAuth) {
      var o = { method: bodyObj ? 'POST' : 'GET' };
      if (bodyObj) o.body = bodyObj;
      return FWAuth.authFetch(url, o);
    }
    var f = { method: bodyObj ? 'POST' : 'GET', credentials: 'include' };
    if (bodyObj) { f.headers = { 'Content-Type': 'application/json' }; f.body = JSON.stringify(bodyObj); }
    return fetch(url, f);
  }

  function arr(v) { return Array.isArray(v) ? v : []; }

  /**
   * Never rejects: a thrown/rejected afetch (network down, authFetch's
   * AbortError on timeout, even a synchronous throw from a misbehaving
   * FWAuth) all land in the same `{netError:true}` branch as a plain
   * network failure.
   */
  function request(bodyObj) {
    return Promise.resolve()
      .then(function () { return afetch(ENDPOINT, bodyObj); })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          return { ok: r.ok, status: r.status, d: d || {} };
        });
      })
      .catch(function () {
        return { ok: false, status: 0, d: {}, netError: true };
      });
  }

  /** Through FWErr exactly as artifacts.js:305 does. */
  function errFor(res, fallback) {
    return global.FWErr
      ? FWErr.forUser(FWErr.fromResponse(res.status, res.d, fallback), fallback)
      : fallback;
  }

  function logEvent(name, data) {
    try { if (global.FWEvents) FWEvents.log(name, data); } catch (_) { /* fire-and-forget */ }
  }

  // ---- public API -----------------------------------------------------

  function list() {
    return request(null).then(function (res) {
      if (res.netError) {
        return { ok: false, status: 0, error: NET_ERROR, applications: [], statuses: [], counts: null, max: null };
      }
      if (!res.ok) {
        return {
          ok: false, status: res.status, error: errFor(res, 'Could not load your applications.'),
          applications: [], statuses: [], counts: null, max: null,
        };
      }
      return {
        ok: true, status: res.status,
        applications: arr(res.d.applications),
        statuses: arr(res.d.statuses),
        counts: res.d.counts || null,
        max: res.d.max != null ? res.d.max : null,
      };
    });
  }

  function save(payload) {
    var body = Object.assign({ action: 'save' }, payload || {});
    return request(body).then(function (res) {
      if (res.netError) {
        return { ok: false, status: 0, error: NET_ERROR, duplicate: false, application: null, applications: [], statuses: [], counts: null };
      }
      if (!res.ok) {
        return {
          ok: false, status: res.status, error: errFor(res, 'Could not save that application.'),
          duplicate: false, application: null, applications: [], statuses: [], counts: null,
        };
      }
      var application = res.d.application || null;
      logEvent('application_saved', {
        source: (application && application.source) || body.source || '',
        duplicate: !!res.d.duplicate,
      });
      return {
        ok: true, status: res.status,
        duplicate: !!res.d.duplicate,
        application: application,
        applications: arr(res.d.applications),
        statuses: arr(res.d.statuses),
        counts: res.d.counts || null,
      };
    });
  }

  function setStatus(id, status) {
    return request({ action: 'status', id: id, status: status }).then(function (res) {
      if (res.netError) {
        return { ok: false, status: 0, error: NET_ERROR, application: null, advanced: false, from: null };
      }
      if (!res.ok) {
        return {
          ok: false, status: res.status, error: errFor(res, 'Could not update that application.'),
          application: null, advanced: false, from: null,
        };
      }
      if (res.d.changed) {
        logEvent('application_stage_change', {
          from: res.d.from || null,
          to: (res.d.application && res.d.application.status) || res.d.status || status,
          advanced: !!res.d.advanced,
        });
      }
      return {
        ok: true, status: res.status,
        application: res.d.application || null,
        advanced: !!res.d.advanced,
        from: res.d.from || null,
      };
    });
  }

  function update(id, patch) {
    var body = Object.assign({ action: 'update', id: id }, patch || {});
    return request(body).then(function (res) {
      if (res.netError) return { ok: false, status: 0, error: NET_ERROR, application: null };
      if (!res.ok) return { ok: false, status: res.status, error: errFor(res, 'Could not save that change.'), application: null };
      return { ok: true, status: res.status, application: res.d.application || null };
    });
  }

  function remove(id) {
    return request({ action: 'delete', id: id }).then(function (res) {
      if (res.netError) return { ok: false, status: 0, error: NET_ERROR, applications: [], counts: null };
      if (!res.ok) {
        return { ok: false, status: res.status, error: errFor(res, 'Could not remove that application.'), applications: [], counts: null };
      }
      logEvent('application_removed', {});
      return { ok: true, status: res.status, applications: arr(res.d.applications), counts: res.d.counts || null };
    });
  }

  /**
   * Both URL builders share one rule: role always present, company appended
   * only when there is one, values encoded so a role/company lifted verbatim
   * off a web page can never break out of the query string.
   */
  function query(role, company, roleKey, companyKey) {
    var qs = roleKey + '=' + encodeURIComponent(String(role || ''));
    if (company) qs += '&' + companyKey + '=' + encodeURIComponent(String(company));
    return qs;
  }

  function tailorUrl(app) {
    var a = app || {};
    return 'resume.html?' + query(a.role, a.company, 'tailorRole', 'tailorCompany');
  }

  function practiceUrl(app) {
    var a = app || {};
    return 'coach.html?' + query(a.role, a.company, 'ivRole', 'ivCompany') + '#practice';
  }

  global.FWApplications = {
    list: list,
    save: save,
    setStatus: setStatus,
    update: update,
    remove: remove,
    tailorUrl: tailorUrl,
    practiceUrl: practiceUrl,
  };
})(typeof window !== 'undefined' ? window : globalThis);
