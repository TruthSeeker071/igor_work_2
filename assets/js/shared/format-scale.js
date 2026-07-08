/**
 * Shared 0–100 score formatting for deep dive and O*NET surfaces.
 */
(function (global) {
  function formatScale100(n, decimals) {
    if (n == null || Number.isNaN(Number(n))) return '—';
    var d = decimals != null ? decimals : 1;
    return Number(n).toFixed(d) + '/100';
  }

  // Career lv vectors are already 0–100 at ETL ingest (lvTo100); display verbatim as X/100.
  function onetLevelToScale100(level, decimals) {
    return formatScale100(level, decimals != null ? decimals : 1);
  }

  function humanizeOnetDomain(domain) {
    var labels = {
      skills: 'Skills',
      knowledge: 'Knowledge',
      abilities: 'Abilities',
      workActivities: 'Work Activities',
      workactivities: 'Work Activities',
      WORKACTIVITIES: 'Work Activities',
    };
    if (labels[domain]) return labels[domain];
    var s = String(domain || '').trim();
    if (!s) return '';
    return s
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  global.FWFormatScale = {
    formatScale100: formatScale100,
    onetLevelToScale100: onetLevelToScale100,
    humanizeOnetDomain: humanizeOnetDomain,
  };
})(typeof window !== 'undefined' ? window : globalThis);
