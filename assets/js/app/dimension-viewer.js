/**
 * Portal "O*NET Dimension Profile" section — user vs target-career coordinate
 * scores as labeled progress bars (biggest gaps, strengths, and all 161 dims
 * grouped by domain). Supplements the aggregate fit % shown elsewhere.
 */
(function (global) {
  var mounted = false;
  var unsubscribe = null;
  var expandedGroups = {};
  var allDimsOpen = false;
  var renderToken = 0;
  var groupRowsById = {};

  var DOMAIN_LABELS = {
    skills: 'Skills',
    knowledge: 'Knowledge',
    abilities: 'Abilities',
    workActivities: 'Work Activities',
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function humanizeDomain(domain) {
    if (DOMAIN_LABELS[domain]) return DOMAIN_LABELS[domain];
    var s = String(domain || '').trim();
    if (!s) return 'Other';
    return s
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function authEmail() {
    try {
      if (global.FWAuth && typeof FWAuth.authEmail === 'function') return FWAuth.authEmail();
    } catch (_) { /* ignore */ }
    return null;
  }

  function containerEl() {
    return document.getElementById('portal-dimension-profile');
  }

  // --- bar row markup -------------------------------------------------

  function dimRow(row) {
    var user = Math.max(0, Math.min(100, Number(row.user) || 0));
    var target = Math.max(0, Math.min(100, Number(row.target) || 0));
    var domainLabel = row.domain ? humanizeDomain(row.domain) : '';
    return ''
      + '<div class="dim-row">'
      + '<div class="dim-row-label">'
      + '<span class="dim-row-name">' + esc(row.name) + '</span>'
      + (domainLabel ? '<span class="dim-row-domain">' + esc(domainLabel) + '</span>' : '')
      + '</div>'
      + '<div class="dim-row-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" '
      + 'aria-valuenow="' + Math.round(user) + '" '
      + 'aria-label="' + esc(row.name) + ': you ' + Math.round(user) + ', target ' + Math.round(target) + '">'
      + '<div class="dim-row-fill" style="width:' + user + '%"></div>'
      + '<div class="dim-row-target-marker" style="left:' + target + '%"></div>'
      + '</div>'
      + '<span class="dim-row-nums">You ' + Math.round(user) + ' &middot; Target ' + Math.round(target) + '</span>'
      + '</div>';
  }

  function groupSection(domainKey, rows, groupId) {
    var isOpen = !!expandedGroups[groupId];
    var label = humanizeDomain(domainKey);
    groupRowsById[groupId] = rows;
    return ''
      + '<div class="dim-group">'
      + '<button type="button" class="dim-group-toggle" data-dim-group="' + esc(groupId) + '" '
      + 'aria-expanded="' + (isOpen ? 'true' : 'false') + '">'
      + '<span class="dim-group-title">' + esc(label) + '</span>'
      + '<span class="dim-group-count">' + rows.length + '</span>'
      + '<span class="dim-group-caret" aria-hidden="true">' + (isOpen ? '&#9660;' : '&#9654;') + '</span>'
      + '</button>'
      + '<div class="dim-group-body"' + (isOpen ? '' : ' hidden') + '>'
      + (isOpen ? rows.map(dimRow).join('') : '')
      + '</div>'
      + '</div>';
  }

  // --- empty states -----------------------------------------------------

  function emptyStateHtml(kind) {
    if (kind === 'no-target') {
      return '<p class="dim-empty">Pick a target career to compare your O*NET coordinates against it. '
        + 'Use the target picker above to choose one.</p>';
    }
    if (kind === 'no-vectors') {
      return '<p class="dim-empty">Take the Career Quiz to generate your O*NET profile. '
        + '<a href="quiz.html">Start the quiz &rarr;</a></p>';
    }
    return '<p class="dim-empty">Dimension data unavailable right now.</p>';
  }

  function sectionShell(bodyHtml, targetName) {
    var titleSuffix = targetName ? ' vs ' + esc(targetName) : '';
    return ''
      + '<div class="dim-profile-card">'
      + '<div class="dim-profile-head">'
      + '<h2 class="dim-profile-title" id="dim-profile-title">Dimension Profile' + titleSuffix + '</h2>'
      + '<p class="dim-profile-sub">O*NET coordinate scores (0&ndash;100) — how your quiz profile lines up with this '
      + 'career on individual skills, knowledge, abilities and work activities.</p>'
      + '</div>'
      + '<div class="dim-profile-body">' + bodyHtml + '</div>'
      + '</div>';
  }

  // --- render -----------------------------------------------------------

  function render() {
    var email = authEmail();
    var root = containerEl();
    if (!root) return;
    if (!email) {
      root.innerHTML = '';
      root.hidden = true;
      return;
    }
    root.hidden = false;

    var myToken = ++renderToken;

    var target = (global.FWCareerTarget && typeof FWCareerTarget.resolveTargetCareer === 'function')
      ? FWCareerTarget.resolveTargetCareer()
      : null;

    if (!target || !target.slug) {
      root.innerHTML = sectionShell(emptyStateHtml('no-target'), null);
      return;
    }

    var vecs = (global.FWOnetVectors && typeof FWOnetVectors.readQuizVectors === 'function')
      ? FWOnetVectors.readQuizVectors({ hydrate: true })
      : null;
    var personality = vecs && vecs.personality && vecs.personality.values;
    var objective = vecs && vecs.objective && vecs.objective.values;

    if (!personality || !personality.length) {
      root.innerHTML = sectionShell(emptyStateHtml('no-vectors'), target.name);
      return;
    }

    root.innerHTML = sectionShell('<p class="dim-loading">Loading dimension comparison&hellip;</p>', target.name);

    resolveSoc(target).then(function (soc) {
      if (myToken !== renderToken) return;
      if (!soc || !global.FWOnetVectors || typeof FWOnetVectors.userVsCareerDimensions !== 'function') {
        root.innerHTML = sectionShell(emptyStateHtml('error'), target.name);
        return;
      }
      return FWOnetVectors.userVsCareerDimensions(soc, personality, objective).then(function (result) {
        if (myToken !== renderToken) return;
        if (!result || !result.comparisons || !result.comparisons.length) {
          root.innerHTML = sectionShell(
            '<p class="dim-empty">No comparable O*NET dimensions found for this role yet.</p>',
            target.name
          );
          return;
        }
        root.innerHTML = sectionShell(bodyHtml(result), target.name);
        bindInteractions(root, result);
      });
    }).catch(function () {
      if (myToken !== renderToken) return;
      root.innerHTML = sectionShell(emptyStateHtml('error'), target.name);
    });
  }

  function resolveSoc(target) {
    if (target.soc) return Promise.resolve(target.soc);
    if (global.FWOnetVectors && typeof FWOnetVectors.resolveSocForSlug === 'function') {
      return FWOnetVectors.resolveSocForSlug(target.slug);
    }
    return Promise.resolve(null);
  }

  function bodyHtml(result) {
    var gaps = result.gaps || [];
    var strengths = result.strengths || [];
    var html = '';

    html += '<div class="dim-section" aria-labelledby="dim-gaps-title">'
      + '<h3 class="dim-section-title" id="dim-gaps-title">Biggest gaps</h3>'
      + (gaps.length
        ? gaps.slice(0, 5).map(dimRow).join('')
        : '<p class="dim-empty dim-empty--inline">No notable gaps — you are at or above target on the compared dimensions.</p>')
      + '</div>';

    html += '<div class="dim-section" aria-labelledby="dim-strengths-title">'
      + '<h3 class="dim-section-title" id="dim-strengths-title">Strengths</h3>'
      + (strengths.length
        ? strengths.slice(0, 5).map(dimRow).join('')
        : '<p class="dim-empty dim-empty--inline">No standout strengths above target yet on the compared dimensions.</p>')
      + '</div>';

    html += '<div class="dim-all-toggle-wrap">'
      + '<button type="button" class="dim-all-toggle" id="dim-all-toggle" aria-expanded="' + (allDimsOpen ? 'true' : 'false') + '" '
      + 'aria-controls="dim-all-body">'
      + (allDimsOpen ? 'Hide all dimensions' : 'Show all dimensions (' + result.comparisons.length + ')')
      + '</button>'
      + '</div>';

    html += '<div class="dim-all-body" id="dim-all-body"' + (allDimsOpen ? '' : ' hidden') + '>'
      + (allDimsOpen ? allDimensionsHtml(result.comparisons) : '')
      + '</div>';

    return html;
  }

  function allDimensionsHtml(comparisons) {
    var byDomain = {};
    var order = [];
    comparisons.forEach(function (row) {
      var key = row.domain || 'other';
      if (!byDomain[key]) {
        byDomain[key] = [];
        order.push(key);
      }
      byDomain[key].push(row);
    });
    order.sort(function (a, b) {
      return humanizeDomain(a).localeCompare(humanizeDomain(b));
    });
    return order.map(function (key) {
      var rows = byDomain[key].slice().sort(function (a, b) { return b.gap - a.gap; });
      return groupSection(key, rows, 'group-' + key);
    }).join('');
  }

  function bindInteractions(root, result) {
    var allToggle = root.querySelector('#dim-all-toggle');
    if (allToggle) {
      allToggle.addEventListener('click', function () {
        allDimsOpen = !allDimsOpen;
        var body = root.querySelector('#dim-all-body');
        if (!body) return;
        allToggle.setAttribute('aria-expanded', allDimsOpen ? 'true' : 'false');
        allToggle.textContent = allDimsOpen ? 'Hide all dimensions' : 'Show all dimensions (' + result.comparisons.length + ')';
        if (allDimsOpen) {
          body.innerHTML = allDimensionsHtml(result.comparisons);
          body.hidden = false;
          bindGroupToggles(root, result);
        } else {
          body.hidden = true;
          body.innerHTML = '';
        }
      });
    }
    bindGroupToggles(root, result);
  }

  function bindGroupToggles(root) {
    var toggles = root.querySelectorAll('.dim-group-toggle');
    toggles.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var groupId = btn.getAttribute('data-dim-group');
        expandedGroups[groupId] = !expandedGroups[groupId];
        var groupBody = btn.parentElement.querySelector('.dim-group-body');
        var caret = btn.querySelector('.dim-group-caret');
        var isOpen = !!expandedGroups[groupId];
        btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        if (caret) caret.innerHTML = isOpen ? '&#9660;' : '&#9654;';
        if (!groupBody) return;
        if (isOpen) {
          // Lazily populate rows only when expanded.
          var rows = groupRowsById[groupId];
          groupBody.innerHTML = rows ? rows.map(dimRow).join('') : '';
          groupBody.hidden = false;
        } else {
          groupBody.hidden = true;
          groupBody.innerHTML = '';
        }
      });
    });
  }

  function ensureSubscription() {
    if (unsubscribe || !global.FWCareerTarget || typeof FWCareerTarget.onCareerFocusChanged !== 'function') return;
    unsubscribe = FWCareerTarget.onCareerFocusChanged(function () {
      allDimsOpen = false;
      expandedGroups = {};
      render();
    });
  }

  function boot() {
    if (mounted) {
      render();
      return;
    }
    mounted = true;
    ensureSubscription();
    render();
  }

  global.FWDimensionViewer = {
    render: boot,
  };
})(typeof window !== 'undefined' ? window : globalThis);
