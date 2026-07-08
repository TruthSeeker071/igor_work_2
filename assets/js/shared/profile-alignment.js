/**
 * Profile alignment — drift check on load + large-pivot review modal.
 */
(function (global) {
  var CHECK_KEY = 'fw_align_check_at';
  var CHECK_INTERVAL_MS = 10 * 60 * 1000;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function authFetch(path, opts) {
    if (!global.FWAuth || typeof FWAuth.authFetch !== 'function') return Promise.reject(new Error('Not signed in'));
    return FWAuth.authFetch(path, opts);
  }

  function shouldThrottle() {
    try {
      var last = Number(sessionStorage.getItem(CHECK_KEY) || 0);
      return last && (Date.now() - last) < CHECK_INTERVAL_MS;
    } catch (_) {
      return false;
    }
  }

  function markChecked() {
    try { sessionStorage.setItem(CHECK_KEY, String(Date.now())); } catch (_) {}
  }

  function afterAlignSideEffects() {
    if (global.FWAuth && typeof FWAuth.bumpDossierFingerprint === 'function') {
      FWAuth.bumpDossierFingerprint();
    }
    if (global.FWAuth && typeof FWAuth.refreshPortalSnapshot === 'function') {
      FWAuth.refreshPortalSnapshot({ force: true }).catch(function () {});
    }
    if (global.FWAuth && typeof FWAuth.syncQuizProfile === 'function') {
      FWAuth.syncQuizProfile().catch(function () {});
    }
    if (global.FWPortal && typeof FWPortal.render === 'function') {
      FWPortal.render();
    }
  }

  function ensureModalShell() {
    var el = document.getElementById('fw-align-modal');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'fw-align-modal';
    el.className = 'fw-align-modal';
    el.hidden = true;
    el.innerHTML = ''
      + '<div class="fw-align-modal-backdrop" data-act="dismiss"></div>'
      + '<div class="fw-align-modal-card" role="dialog" aria-labelledby="fw-align-modal-title" aria-modal="true">'
      + '<h2 id="fw-align-modal-title" class="fw-align-modal-title">Align your profile?</h2>'
      + '<p class="fw-align-modal-sub" id="fw-align-modal-sub"></p>'
      + '<div class="fw-align-modal-diff" id="fw-align-modal-diff"></div>'
      + '<div class="fw-align-modal-actions">'
      + '<button type="button" class="cta-btn fw-align-approve" data-act="approve">Update profile</button>'
      + '<button type="button" class="portal-identity-update" data-act="dismiss">Not now</button>'
      + '</div></div>';
    document.body.appendChild(el);
    el.addEventListener('click', function (e) {
      var act = e.target.closest('[data-act]');
      if (!act) return;
      var action = act.getAttribute('data-act');
      var proposal = el._proposal;
      if (action === 'approve' && proposal && proposal.id) {
        applyProposal(proposal.id).then(function () { hideModal(); });
      } else if (action === 'dismiss') {
        dismissProposal().then(function () { hideModal(); });
      }
    });
    return el;
  }

  function renderDiff(proposal) {
    if (!proposal || !proposal.before) return '';
    var patches = proposal.dossierPatches || {};
    var fields = ['top_industries', 'goals', 'interests', 'career_signals'];
    return fields.map(function (key) {
      var before = proposal.before[key];
      var after = patches[key];
      if (!after || before === after) return '';
      return '<div class="fw-align-diff-row">'
        + '<div class="fw-align-diff-label">' + esc(key.replace(/_/g, ' ')) + '</div>'
        + '<div class="fw-align-diff-before">' + esc(before || '—') + '</div>'
        + '<div class="fw-align-diff-arrow">→</div>'
        + '<div class="fw-align-diff-after">' + esc(after) + '</div>'
        + '</div>';
    }).join('');
  }

  function showModal(proposal) {
    if (!proposal) return;
    var el = ensureModalShell();
    el._proposal = proposal;
    var sub = document.getElementById('fw-align-modal-sub');
    var diff = document.getElementById('fw-align-modal-diff');
    if (sub) sub.textContent = proposal.summary || 'Your target career and profile goals look out of sync. Update active goals to match your new focus?';
    if (diff) diff.innerHTML = renderDiff(proposal);
    el.hidden = false;
  }

  function hideModal() {
    var el = document.getElementById('fw-align-modal');
    if (el) {
      el.hidden = true;
      el._proposal = null;
    }
  }

  function fetchPropose() {
    return authFetch('/profile-align', {
      method: 'POST',
      body: { action: 'propose' },
    }).then(function (resp) {
      return resp.json().then(function (data) {
        if (!resp.ok) throw new Error(data.error || 'Could not propose alignment');
        return data;
      });
    });
  }

  function applyProposal(proposalId) {
    return authFetch('/profile-align', {
      method: 'POST',
      body: { action: 'apply', proposalId: proposalId },
    }).then(function (resp) {
      return resp.json().then(function (data) {
        if (!resp.ok) throw new Error(data.error || 'Could not apply alignment');
        afterAlignSideEffects();
        return data;
      });
    });
  }

  function dismissProposal() {
    return authFetch('/profile-align', {
      method: 'POST',
      body: { action: 'dismiss' },
    }).then(function (resp) { return resp.json(); });
  }

  function handleCheckResult(data) {
    if (!data) return;
    if (data.appliedSmall) afterAlignSideEffects();
    var proposal = data.proposal;
    if (data.severity === 'large') {
      if (proposal) {
        showModal(proposal);
      } else {
        fetchPropose().then(function (res) {
          if (res.proposal) showModal(res.proposal);
        }).catch(function (err) { console.warn('align propose failed', err); });
      }
    }
  }

  function handleAlignmentResponse(data) {
    if (!data || !data.alignment) return;
    handleCheckResult(data.alignment);
  }

  function checkOnLoad() {
    if (!global.FWAuth || typeof FWAuth.authEmail !== 'function' || !FWAuth.authEmail()) return Promise.resolve();
    if (shouldThrottle()) return Promise.resolve();
    markChecked();
    return authFetch('/profile-align', {
      method: 'POST',
      body: { action: 'check' },
    }).then(function (resp) {
      return resp.json().then(function (data) {
        if (!resp.ok) return;
        if (data.appliedSmall) afterAlignSideEffects();
        if (data.severity === 'large') {
          if (data.proposal) {
            showModal(data.proposal);
          } else {
            return fetchPropose().then(function (res) {
              if (res.proposal) showModal(res.proposal);
            });
          }
        }
      });
    }).catch(function (err) {
      console.warn('profile align check failed', err);
    });
  }

  global.FWProfileAlignment = {
    checkOnLoad: checkOnLoad,
    handleAlignmentResponse: handleAlignmentResponse,
    showModal: showModal,
    hideModal: hideModal,
    applyProposal: applyProposal,
  };
}(typeof window !== 'undefined' ? window : globalThis));
