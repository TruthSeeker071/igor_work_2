/**
 * Cross-page roadmap persist + live sync (portal focus ↔ roadmap canvas).
 */
(function (global) {
  'use strict';

  const EVENT = 'fw:roadmap-updated';
  const CHANNEL_NAME = 'fw-roadmap-v1';
  const SAVE_DEBOUNCE_MS = 400;

  let saveTimer = null;
  let pendingSave = null;
  let channel = null;

  try {
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(CHANNEL_NAME);
    }
  } catch (_) { /* ignore */ }

  function roadmapKey() {
    return (global.FWAuth && FWAuth.ROADMAP_KEY) || 'fw_roadmap_v1';
  }

  function read() {
    if (global.FWAuth && typeof FWAuth.readLocalRoadmap === 'function') {
      return FWAuth.readLocalRoadmap();
    }
    try {
      const raw = localStorage.getItem(roadmapKey());
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function withFocusTracker(rm) {
    if (!rm || rm.version !== 2) return rm;
    const q = global.FWAuth && typeof FWAuth.readLocalQuiz === 'function'
      ? FWAuth.readLocalQuiz() : null;
    const scores = q && q.scores ? q.scores : null;
    if (global.FWRoadmapTree && typeof FWRoadmapTree.ensureFocusTracker === 'function') {
      rm = FWRoadmapTree.ensureFocusTracker(rm, scores);
    }
    if (global.FWSkillGapTracker && typeof FWSkillGapTracker.syncProgress === 'function') {
      rm = FWSkillGapTracker.syncProgress(rm);
    }
    return rm;
  }

  function readPrepared() {
    return withFocusTracker(read());
  }

  function flushSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    const rm = pendingSave;
    pendingSave = null;
    if (!rm || !global.FWAuth || typeof FWAuth.saveRoadmap !== 'function') return Promise.resolve();
    if (!FWAuth.authEmail || !FWAuth.authEmail()) return Promise.resolve();
    return FWAuth.saveRoadmap(rm).catch(function (err) {
      console.warn('roadmap sync save failed', err);
    });
  }

  function debouncedSave(rm) {
    pendingSave = rm;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
  }

  function dispatchUpdated(tree, meta) {
    meta = meta || {};
    try {
      global.dispatchEvent(new CustomEvent(EVENT, {
        detail: { tree: tree, source: meta.source || '', localOnly: !!meta.localOnly },
      }));
    } catch (_) { /* ignore */ }
    if (channel && tree) {
      try {
        channel.postMessage({
          type: 'roadmap-updated',
          updatedAt: tree.updatedAt || null,
          source: meta.source || '',
        });
      } catch (_) { /* ignore */ }
    }
  }

  function publish(tree, opts) {
    opts = opts || {};
    if (!tree) return tree;
    let rm = withFocusTracker(tree);
    if (global.FWAuth && typeof FWAuth.cacheRoadmap === 'function') {
      FWAuth.cacheRoadmap(rm);
    } else {
      try { localStorage.setItem(roadmapKey(), JSON.stringify(rm)); } catch (_) { /* ignore */ }
    }
    if (opts.persist !== false) debouncedSave(rm);
    dispatchUpdated(rm, opts);
    return rm;
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') return function () {};

    function onEvent(e) {
      fn(e && e.detail ? e.detail : { tree: readPrepared() });
    }

    function onStorage(e) {
      if (e && e.key === roadmapKey()) {
        fn({ tree: readPrepared(), source: 'storage' });
      }
    }

    function onChannel(msg) {
      if (!msg || msg.type !== 'roadmap-updated') return;
      fn({ tree: readPrepared(), source: msg.source || 'channel' });
    }

    global.addEventListener(EVENT, onEvent);
    global.addEventListener('storage', onStorage);
    if (channel) channel.addEventListener('message', onChannel);

    return function unsubscribe() {
      global.removeEventListener(EVENT, onEvent);
      global.removeEventListener('storage', onStorage);
      if (channel) channel.removeEventListener('message', onChannel);
    };
  }

  function bindPageshowRefresh(fn) {
    if (typeof fn !== 'function') return;
    global.addEventListener('pageshow', function () {
      fn({ tree: readPrepared(), source: 'pageshow' });
    });
  }

  global.FWRoadmapSync = {
    EVENT: EVENT,
    read: read,
    readPrepared: readPrepared,
    publish: publish,
    subscribe: subscribe,
    bindPageshowRefresh: bindPageshowRefresh,
    flushSave: flushSave,
    dispatchUpdated: dispatchUpdated,
  };
})(typeof window !== 'undefined' ? window : globalThis);
