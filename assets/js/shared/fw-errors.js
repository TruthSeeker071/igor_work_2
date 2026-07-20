/**
 * FWErr — the gate between internal error text and the UI.
 *
 * Nothing reaches a user unless it was explicitly written for one. An Error is
 * user-facing only when it carries `userFacing === true`, which only
 * FWErr.friendly() / FWErr.fromResponse() set. Everything else — server
 * dev-speak ('Invalid JSON body.', 'socs required'), client throws that embed
 * a status or a URL, browser-native 'Failed to fetch', JSON parse errors —
 * falls back to the call site's own copy.
 *
 * Globals: FWErr.friendly(msg) -> Error
 *          FWErr.forUser(err, fallback) -> string
 *          FWErr.fromResponse(status, data, fallback) -> Error
 */
(function (global) {
  var GENERIC = 'Something went wrong. Please try again.';

  // Anything that smells like it was written for a developer, not a user.
  var DEV_SPEAK = /(https?:\/\/|\/[a-z0-9._-]+\/|\b(HTTP|JSON|fetch|SQL|API|soc|socs|SOC|undefined|null|NaN|stack|Error|Exception|TypeError|SyntaxError|status|timeout|body|payload|token|param|params)\b|[a-z][A-Z]|[_{}[\]<>=]|\b\d{3,}\b)/;

  // Product copy is a capitalised, punctuated sentence of at least four words.
  function looksLikeCopy(msg) {
    if (!msg || msg.length < 12 || msg.length > 200) return false;
    if (DEV_SPEAK.test(msg)) return false;
    if (!/^[A-Z]/.test(msg)) return false;
    if (!/[.!?…]$/.test(msg)) return false;
    return msg.split(/\s+/).length >= 4;
  }

  function friendly(message) {
    var err = new Error(message || GENERIC);
    err.userFacing = true;
    return err;
  }

  function forUser(err, fallback) {
    if (err && err.userFacing === true && err.message) return err.message;
    return fallback || GENERIC;
  }

  function fromResponse(status, data, fallback) {
    var serverMsg = data && typeof data.error === 'string' ? data.error.trim() : '';
    var contextual = fallback || '';

    // 401 on a form ("Invalid email or password.") reads nothing like 401 on a
    // stale session, so the call site's own copy wins when it has any.
    if (status === 401) return friendly(contextual || 'Please sign in again.');
    // Plan gating: 402/403 copy is product-written, so it is preferred.
    if (status === 402 || status === 403) {
      return friendly(looksLikeCopy(serverMsg) ? serverMsg : (contextual || 'Your plan doesn\'t include this yet.'));
    }
    if (status === 429) return friendly('FlightWay is busy right now — try again in a moment.');
    if (status >= 500) return friendly('Something went wrong on our end. Please try again.');
    if (status === 404) return friendly(contextual || GENERIC);
    if (status >= 400 && looksLikeCopy(serverMsg)) return friendly(serverMsg);
    return friendly(contextual || GENERIC);
  }

  global.FWErr = {
    GENERIC: GENERIC,
    friendly: friendly,
    forUser: forUser,
    fromResponse: fromResponse,
    looksLikeCopy: looksLikeCopy,
  };
})(typeof window !== 'undefined' ? window : globalThis);
