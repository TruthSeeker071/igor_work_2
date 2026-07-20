/**
 * Scoped career-switch advisor on the home page (inline + drawer).
 */
(function (global) {
  const API = '/career-switch-chat';
  const ADVISOR_TIMEOUT_MS = 90000;
  const GREETING = 'Hi! I can help you explore or switch your target career. What are you considering?';
  let state = {
    history: [],
    drawerOpen: false,
    sending: false,
    greeted: false,
    lastFocus: null,
    pendingProposal: null,
  };

  function signedIn() {
    return !!(global.FWAuth && FWAuth.authEmail && FWAuth.authEmail());
  }

  async function parseJson(resp) {
    const text = await resp.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch (_) {
      return { error: 'Invalid server response.' };
    }
  }

  // Server copy is only echoed when it reads as product copy (WS3) — dev-speak
  // like 'Invalid JSON body.' falls through to the contextual line.
  function trusted(data, fallback) {
    var msg = data && typeof data.error === 'string' ? data.error.trim() : '';
    return (global.FWErr && FWErr.looksLikeCopy(msg)) ? msg : fallback;
  }

  function mapError(status, data) {
    if (status === 401) return 'Sign in to use the career switch advisor.';
    if (status === 429) return trusted(data, 'Too many requests. Try again in a few minutes.');
    if (status === 502) return trusted(data, 'Advisor is busy, try again shortly.');
    return trusted(data, 'Something went wrong. Try again.');
  }

  function applySwitchPlaceholder(input) {
    if (!input) return;
    const text = global.FWCareerTarget && typeof FWCareerTarget.switchPlaceholderText === 'function'
      ? FWCareerTarget.switchPlaceholderText()
      : 'Thinking about another career instead?';
    input.placeholder = text;
  }

  function removeConfirmActions() {
    const wrap = document.getElementById('portal-career-chat-messages');
    if (!wrap) return;
    wrap.querySelectorAll('.career-chat-confirm-actions').forEach(function (el) { el.remove(); });
  }

  function appendConfirmActions() {
    removeConfirmActions();
    const wrap = document.getElementById('portal-career-chat-messages');
    if (!wrap || !state.pendingProposal) return;
    const row = document.createElement('div');
    row.className = 'career-chat-confirm-actions';
    row.innerHTML = '<button type="button" class="career-chat-confirm-yes">Yes, switch</button>'
      + '<button type="button" class="career-chat-confirm-no">Not now</button>';
    wrap.appendChild(row);
    wrap.scrollTop = wrap.scrollHeight;
    row.querySelector('.career-chat-confirm-yes').addEventListener('click', function () {
      sendText('yes');
    });
    row.querySelector('.career-chat-confirm-no').addEventListener('click', function () {
      sendText('no');
    });
  }

  function drawerFocusables() {
    var drawer = document.getElementById('portal-career-chat-drawer');
    if (!drawer) return [];
    return Array.from(drawer.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )).filter(function (el) { return !el.disabled && el.offsetParent !== null; });
  }

  function trapDrawerFocus(e) {
    if (!state.drawerOpen || e.key !== 'Tab') return;
    var nodes = drawerFocusables();
    if (!nodes.length) return;
    var first = nodes[0];
    var last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function onDrawerKeydown(e) {
    if (e.key === 'Escape' && state.drawerOpen) {
      e.preventDefault();
      closeDrawer();
    }
  }

  function ensureDrawer() {
    if (document.getElementById('portal-career-chat-drawer')) return;
    document.body.insertAdjacentHTML('beforeend',
      '<div id="portal-career-chat-backdrop" class="portal-career-chat-backdrop" hidden aria-hidden="true"></div>'
      + '<div id="portal-career-chat-drawer" class="career-chat-drawer portal-career-chat-drawer" hidden'
      + ' role="dialog" aria-modal="true" aria-labelledby="portal-career-chat-title" aria-hidden="true">'
      + '<div class="career-chat-header"><div>'
      + '<div class="career-chat-eye">Career switch advisor</div>'
      + '<h3 class="career-chat-title" id="portal-career-chat-title">Explore a new target</h3>'
      + '<p class="career-chat-sub">Career switching only — not full coaching</p>'
      + '</div>'
      + '<button type="button" class="career-chat-close" id="portal-career-chat-close" aria-label="Close">×</button></div>'
      + '<div class="career-chat-messages" id="portal-career-chat-messages"></div>'
      + '<div class="career-chat-input-row">'
      + '<textarea id="portal-career-chat-input" class="career-chat-input" rows="2" '
      + 'placeholder="" aria-label="Message"></textarea>'
      + '<button type="button" id="portal-career-chat-send" class="career-chat-send">Send</button>'
      + '</div></div>');

    document.getElementById('portal-career-chat-close').addEventListener('click', closeDrawer);
    document.getElementById('portal-career-chat-send').addEventListener('click', sendMessage);
    document.getElementById('portal-career-chat-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    var backdrop = document.getElementById('portal-career-chat-backdrop');
    if (backdrop) backdrop.addEventListener('click', closeDrawer);
    if (!document._fwCareerAdvisorKey) {
      document._fwCareerAdvisorKey = true;
      document.addEventListener('keydown', onDrawerKeydown);
    }
    applySwitchPlaceholder(document.getElementById('portal-career-chat-input'));
  }

  function showGreetingIfNeeded() {
    if (state.greeted || state.history.length > 0) return;
    const wrap = document.getElementById('portal-career-chat-messages');
    if (!wrap || wrap.querySelector('.career-chat-msg')) return;
    appendMsg('assistant', GREETING);
    state.history.push({ role: 'assistant', content: GREETING });
    state.greeted = true;
  }

  function openDrawer() {
    ensureDrawer();
    state.drawerOpen = true;
    var drawer = document.getElementById('portal-career-chat-drawer');
    var backdrop = document.getElementById('portal-career-chat-backdrop');
    if (drawer) {
      drawer.hidden = false;
      drawer.setAttribute('aria-hidden', 'false');
    }
    if (backdrop) {
      backdrop.hidden = false;
      backdrop.setAttribute('aria-hidden', 'false');
    }
    document.body.classList.add('portal-career-advisor-open');
    document.addEventListener('keydown', trapDrawerFocus);
    state.lastFocus = document.activeElement;
    applySwitchPlaceholder(document.getElementById('portal-career-chat-input'));
    showGreetingIfNeeded();
    var input = document.getElementById('portal-career-chat-input');
    if (input) input.focus();
  }

  function closeDrawer() {
    state.drawerOpen = false;
    var drawer = document.getElementById('portal-career-chat-drawer');
    var backdrop = document.getElementById('portal-career-chat-backdrop');
    if (drawer) {
      drawer.hidden = true;
      drawer.setAttribute('aria-hidden', 'true');
    }
    if (backdrop) {
      backdrop.hidden = true;
      backdrop.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('portal-career-advisor-open');
    document.removeEventListener('keydown', trapDrawerFocus);
    if (state.lastFocus && typeof state.lastFocus.focus === 'function') {
      state.lastFocus.focus();
    }
    state.lastFocus = null;
  }

  function appendMsg(role, text) {
    const wrap = document.getElementById('portal-career-chat-messages');
    if (!wrap) return;
    const div = document.createElement('div');
    div.className = 'career-chat-msg ' + role;
    div.textContent = text;
    wrap.appendChild(div);
    wrap.scrollTop = wrap.scrollHeight;
  }

  // Pillar W provenance UX: quiet "as of <date>" + source links when the
  // reply used live web evidence. DOM-built; titles/urls are untrusted.
  function appendSourcesLine(data) {
    if (!data || !data.grounded) return;
    const wrap = document.getElementById('portal-career-chat-messages');
    if (!wrap) return;
    const sources = Array.isArray(data.groundedSources) ? data.groundedSources : [];
    if (!sources.length) return; // no bare "Current as of" chip with nothing to cite
    const asOf = String(data.groundedAt || '').slice(0, 10);
    const line = document.createElement('div');
    line.className = 'career-chat-sources';
    if (asOf) {
      const chip = document.createElement('span');
      chip.textContent = 'Current as of ' + asOf;
      line.appendChild(chip);
    }
    sources.slice(0, 4).forEach((s) => {
      const url = String((s && s.url) || '');
      if (!/^https?:\/\//i.test(url)) return;
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = String((s && s.title) || url).slice(0, 60);
      line.appendChild(a);
    });
    wrap.appendChild(line);
    wrap.scrollTop = wrap.scrollHeight;
  }

  function showTyping() {
    const wrap = document.getElementById('portal-career-chat-messages');
    if (!wrap || document.getElementById('portal-career-chat-typing')) return;
    const div = document.createElement('div');
    div.id = 'portal-career-chat-typing';
    div.className = 'coach-typing';
    div.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
    wrap.appendChild(div);
    wrap.scrollTop = wrap.scrollHeight;
  }

  function hideTyping() {
    const el = document.getElementById('portal-career-chat-typing');
    if (el) el.remove();
  }

  function applyAdvisorResponse(data) {
    if (data.awaitingConfirmation && data.pendingProposal) {
      state.pendingProposal = data.pendingProposal;
      appendConfirmActions();
    } else {
      state.pendingProposal = null;
      removeConfirmActions();
    }

    if (data.careerFocusHistory && typeof FWAuth.writeCareerFocusHistory === 'function') {
      FWAuth.writeCareerFocusHistory(data.careerFocusHistory);
    }
    if (data.focusUpdated && data.focus && typeof FWAuth.writeCareerFocus === 'function') {
      FWAuth.writeCareerFocus(data.focus);
      state.pendingProposal = null;
      removeConfirmActions();
    }
    if (data.roadmap && typeof FWAuth.cacheRoadmap === 'function') {
      FWAuth.cacheRoadmap(data.roadmap);
    }
    if (data.focusUpdated && global.FWCareerTarget) {
      try {
        global.dispatchEvent(new CustomEvent(FWCareerTarget.FOCUS_EVENT, {
          detail: {
            focus: data.focus,
            roadmap: data.roadmap,
            roadmapRetargeted: data.roadmapRetargeted,
            source: 'home_advisor',
          },
        }));
      } catch (_) { /* ignore */ }
    }
    if (data.roadmapRetargeted) {
      if (global.FWFwToast && typeof FWFwToast.show === 'function') {
        FWFwToast.show('Roadmap updated for your new target.');
      } else if (global.FWRoadmap && typeof FWRoadmap.showToast === 'function') {
        FWRoadmap.showToast('Roadmap updated for your new target.');
      }
    }
  }

  async function sendText(msg) {
    const input = document.getElementById('portal-career-chat-input')
      || document.getElementById('portal-career-advisor-input');
    if (!input || state.sending || !signedIn()) return;
    const text = String(msg || '').trim();
    if (!text) return;

    if (!state.drawerOpen) openDrawer();

    input.disabled = true;
    const sendBtn = document.getElementById('portal-career-chat-send');
    const restoreSend = global.FWButtonBusy ? FWButtonBusy.start(sendBtn) : function () {};
    state.sending = true;

    state.history.push({ role: 'user', content: text });
    appendMsg('user', text);
    showTyping();

    try {
      if (!global.FWAuth || typeof FWAuth.authFetch !== 'function') {
        throw new Error('Sign in to use the career switch advisor.');
      }
      const resp = await FWAuth.authFetch(API, {
        method: 'POST',
        timeoutMs: ADVISOR_TIMEOUT_MS,
        body: {
          message: text,
          history: state.history.slice(0, -1),
          pendingProposal: state.pendingProposal,
        },
      });
      const data = await parseJson(resp);
      hideTyping();
      if (!resp.ok) throw new Error(mapError(resp.status, data));
      const reply = data.reply || 'Done.';
      state.history.push({ role: 'assistant', content: reply });
      appendMsg('assistant', reply);
      appendSourcesLine(data);
      if (state.history.length > 12) state.history = state.history.slice(-12);
      applyAdvisorResponse(data);
    } catch (err) {
      hideTyping();
      appendMsg('assistant', global.FWErr
        ? FWErr.forUser(err, 'Something went wrong. Try again.')
        : 'Something went wrong. Try again.');
    } finally {
      state.sending = false;
      input.disabled = false;
      restoreSend();
      input.focus();
    }
  }

  async function sendMessage() {
    const input = document.getElementById('portal-career-chat-input')
      || document.getElementById('portal-career-advisor-input');
    if (!input || state.sending || !signedIn()) return;
    const msg = (input.value || '').trim();
    if (!msg) return;
    input.value = '';
    await sendText(msg);
  }

  function mount(slot) {
    if (!slot || !signedIn()) {
      if (slot) slot.innerHTML = '';
      return;
    }
    slot.innerHTML = ''
      + '<div class="portal-advisor-inline" id="portal-advisor-inline">'
      + '<label class="portal-advisor-label" for="portal-career-advisor-input">Or describe a switch</label>'
      + '<div class="portal-advisor-input-row">'
      + '<input type="text" id="portal-career-advisor-input" class="portal-advisor-input" '
      + 'placeholder="" autocomplete="off" />'
      + '<button type="button" class="portal-advisor-send" id="portal-career-advisor-send">Ask</button>'
      + '</div></div>';

    const input = slot.querySelector('#portal-career-advisor-input');
    const btn = slot.querySelector('#portal-career-advisor-send');
    applySwitchPlaceholder(input);
    if (btn) btn.addEventListener('click', sendMessage);
    if (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); sendMessage(); }
      });
    }
  }

  global.FWPortalCareerAdvisor = { mount: mount, openDrawer: openDrawer, closeDrawer: closeDrawer };
})(typeof window !== 'undefined' ? window : globalThis);
