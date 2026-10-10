// Finds playing <video>/<audio> elements and routes them through LevelerEngine.
// Runs in every frame; each frame has its own AudioContext.
'use strict';

(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const DEFAULTS = { enabled: true, volume: 100, leveling: 2, dialog: false, custom: {}, disabledSites: [] };

  // Open a page with #steady-volume-debug to see the live status in <html data-steady-volume> (used by test/e2e-firefox.mjs).
  const DEBUG = location.hash === '#steady-volume-debug';

  let settings = { ...DEFAULTS };
  let ctx = null;
  let engine = null;
  let timer = null;
  let captured = false;            // the whole tab is processed by the background capture (Chromium)
  const sources = new WeakMap();   // element → MediaElementAudioSourceNode
  const hooked = new Set();        // elements routed through the engine (for status)
  const waiting = new Set();       // elements waiting for a user gesture to start the AudioContext
  const blocked = new Map();       // element → reason it was left alone
  const upgradeTried = new WeakSet(); // elements already reloaded with crossorigin once
  const upgraded = new WeakSet();     // elements we switched to crossorigin="use-credentials"
  const shadowRoots = new WeakSet();  // shadow roots that already have our play listener

  // Per-site switch is keyed by the tab's top-level host, also inside cross-origin player iframes.
  const topHost = (() => {
    try { return window.top.location.hostname || 'file'; } catch {}
    const anc = location.ancestorOrigins; // Chromium only
    if (anc && anc.length) { try { return new URL(anc[anc.length - 1]).hostname; } catch {} }
    try { return new URL(document.referrer).hostname; } catch {}
    return location.hostname;
  })();

  const siteOn = () => settings.enabled && !settings.disabledSites.includes(topHost);
  const processing = () => siteOn() && !captured;

  // Reasons Web Audio would output silence instead of the element's sound.
  function unsafeReason(el) {
    if (el.srcObject) return 'stream';  // calls (Meet, Discord): leave WebRTC audio alone
    if (el.mediaKeys) return 'drm';     // protected video: the browser hides decoded audio from Web Audio
    const src = el.currentSrc || el.src;
    if (!src) return null;
    let url;
    try { url = new URL(src, location.href); } catch { return null; }
    if (url.protocol === 'blob:' || url.protocol === 'data:') return null;
    if (url.origin === location.origin) return null;
    if (el.crossOrigin !== null) return null; // loaded with CORS, otherwise it wouldn't play at all
    return 'cors';
  }

  function ensureEngine() {
    if (engine) return;
    ctx = new AudioContext({ latencyHint: 'interactive' });
    engine = new LevelerEngine(ctx);
    engine.apply({ ...settings, enabled: processing() });
  }

  async function contextRunning() {
    if (ctx.state === 'running') return true;
    try {
      await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 300))]);
    } catch {}
    return ctx.state === 'running';
  }

  // Cross-origin file without crossorigin attribute. The background adds CORS headers for this page and
  // this media server (only for media requests), then the element is reloaded with crossorigin at the same
  // position and Web Audio may process it. use-credentials keeps sending the cookies the player sent before.
  async function corsUpgrade(el) {
    if (upgradeTried.has(el)) return false;
    upgradeTried.add(el);
    const src = el.currentSrc;
    const hadSrcAttr = el.hasAttribute('src');
    try {
      const r = await api.runtime.sendMessage({ type: 'allowCors', mediaUrl: src, pageOrigin: location.origin });
      if (!r?.ok) return false;
    } catch {
      return false;
    }
    if (el.currentSrc !== src) return false;

    const time = el.currentTime;
    const rate = el.playbackRate;
    const wasPlaying = !el.paused;
    const reload = () => { if (hadSrcAttr) el.src = src; else el.load(); };
    const restore = () => {
      try { el.currentTime = time; } catch {}
      el.playbackRate = rate;
      if (wasPlaying) el.play().catch(() => {});
    };
    return new Promise((resolve) => {
      const done = (success) => {
        clearTimeout(guard);
        el.removeEventListener('loadedmetadata', onMeta);
        el.removeEventListener('error', onError, true);
        if (!success) {
          upgraded.delete(el);
          el.removeAttribute('crossorigin');
          reload();
        }
        restore();
        resolve(success);
      };
      const onMeta = () => done(true);
      const onError = () => done(false);
      const guard = setTimeout(onError, 8000);
      el.addEventListener('loadedmetadata', onMeta);
      el.addEventListener('error', onError, true); // capture: errors of <source> children too
      upgraded.add(el);
      el.crossOrigin = 'use-credentials';
      reload();
    });
  }

  async function attach(el) {
    if (sources.has(el) || !el.isConnected && el.paused) return;
    if (!processing()) return;
    let reason = unsafeReason(el);
    if (reason === 'cors' && await corsUpgrade(el)) reason = unsafeReason(el);
    if (sources.has(el)) return;
    if (reason) { blocked.set(el, reason); return; }
    blocked.delete(el);

    ensureEngine();
    // Routing into a suspended context would mute the element, so wait for a click or key press.
    if (!(await contextRunning())) {
      waiting.add(el);
      listenForGesture();
      return;
    }
    if (sources.has(el)) return;
    waiting.delete(el);
    try {
      const node = ctx.createMediaElementSource(el);
      node.connect(engine.input);
      sources.set(el, node);
      hooked.add(el);
      if (upgraded.has(el)) el.addEventListener('error', () => blocked.set(el, 'lost'));
      startTimer();
    } catch {
      blocked.set(el, 'busy'); // the page already feeds this element into its own Web Audio graph
    }
  }

  let gestureListening = false;
  function listenForGesture() {
    if (gestureListening) return;
    gestureListening = true;
    const onGesture = async () => {
      if (!(await contextRunning())) return;
      for (const ev of ['pointerdown', 'keydown']) removeEventListener(ev, onGesture, true);
      gestureListening = false;
      for (const el of [...waiting]) attach(el);
    };
    for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, onGesture, true);
  }

  function startTimer() {
    if (timer) return;
    timer = setInterval(() => {
      for (const el of hooked) if (!el.isConnected && el.paused) hooked.delete(el);
      engine.tick();
      if (DEBUG) document.documentElement.dataset.steadyVolume = JSON.stringify(status());
    }, LevelerEngine.TICK_SECONDS * 1000);
  }

  // Players built as web components (VK Video and others) keep <video> inside a shadow root, where the
  // document never sees its events. Closed roots are reachable from content scripts through these APIs.
  // (Chromium: chrome.dom.openOrClosedShadowRoot(el); Firefox: the el.openOrClosedShadowRoot property.)
  // The Chromium API is looked up by name: Firefox has no chrome.dom and its linter flags the direct call.
  const domApi = globalThis.chrome?.['dom'];
  const shadowOf = domApi?.openOrClosedShadowRoot
    ? (el) => domApi.openOrClosedShadowRoot(el)
    : (el) => ('openOrClosedShadowRoot' in el ? el.openOrClosedShadowRoot : el.shadowRoot);

  const onPlay = (e) => {
    const el = e.composedPath ? e.composedPath()[0] : e.target;
    if (el instanceof HTMLMediaElement) attach(el);
  };

  function scan(root = document) {
    for (const el of root.querySelectorAll('*')) {
      if (el instanceof HTMLMediaElement) {
        if (!el.paused) attach(el);
        continue;
      }
      const sr = el.localName.includes('-') || el.shadowRoot ? shadowOf(el) : null;
      if (!sr) continue;
      if (!shadowRoots.has(sr)) {
        shadowRoots.add(sr);
        sr.addEventListener('play', onPlay, true);
      }
      scan(sr);
    }
  }

  function applySettings() {
    if (engine) engine.apply({ ...settings, enabled: processing() });
    if (processing()) scan();
  }

  // Media events don't bubble, but the capture phase on the document still sees them.
  document.addEventListener('play', onPlay, true);
  // Shadow roots appear while the page builds its player, so look for new ones now and then.
  setInterval(() => { if (processing()) scan(); }, 2000);

  // Whole-tab capture runs in the background (Chromium); the page's own elements then pass through unchanged.
  api.runtime.sendMessage({ type: 'isCaptured' }).then((r) => {
    captured = !!r?.on;
    applySettings();
  }, () => {});

  api.storage.sync.get(DEFAULTS).then((stored) => {
    settings = { ...DEFAULTS, ...stored };
    applySettings();
  });

  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const [k, { newValue }] of Object.entries(changes)) settings[k] = newValue ?? DEFAULTS[k];
    applySettings();
  });

  function status() {
    const playing = [...hooked].filter((el) => !el.paused);
    const reasons = [...blocked.entries()].filter(([el]) => el.isConnected).map(([, r]) => r);
    if (!hooked.size && !reasons.length && !waiting.size) return null;
    return {
      host: topHost,
      active: hooked.size,
      playing: playing.length,
      waiting: waiting.size,
      blocked: reasons,
      gainDb: engine && processing() && engine.preset ? engine.gainDb : 0,
      loudness: engine ? engine.shortTerm : -Infinity, // 3 s window: steadier to read than momentary
      limiter: engine ? engine.limiterReduction() : 0,
    };
  }
  // Content scripts run in an isolated world, so this is visible to the e2e test but not to the page.
  globalThis.__steadyVolumeStatus = status;

  // Popup asks for status. Only frames that have met media answer, so the popup hears from the one that matters.
  api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'capture') {
      captured = msg.on;
      applySettings();
      return;
    }
    if (msg?.type !== 'status') return;
    const s = status();
    if (s) sendResponse(s);
  });
})();
