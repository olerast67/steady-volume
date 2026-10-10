// Finds playing <video>/<audio> elements and routes them through LevelerEngine.
// Runs in every frame; each frame has its own AudioContext.
'use strict';

(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const DEFAULTS = { enabled: true, volume: 100, leveling: 2, dialog: false, disabledSites: [] };

  // Open a page with #steady-volume-debug to see the live status in <html data-steady-volume> (used by test/e2e-firefox.mjs).
  const DEBUG = location.hash === '#steady-volume-debug';

  let settings = { ...DEFAULTS };
  let ctx = null;
  let engine = null;
  let timer = null;
  const sources = new WeakMap();   // element → MediaElementAudioSourceNode
  const hooked = new Set();        // elements routed through the engine (for status)
  const waiting = new Set();       // elements waiting for a user gesture to start the AudioContext
  const blocked = new Map();       // element → reason it was left alone

  // Per-site switch is keyed by the tab's top-level host, also inside cross-origin player iframes.
  const topHost = (() => {
    try { return window.top.location.hostname || 'file'; } catch {}
    const anc = location.ancestorOrigins; // Chromium only
    if (anc && anc.length) { try { return new URL(anc[anc.length - 1]).hostname; } catch {} }
    try { return new URL(document.referrer).hostname; } catch {}
    return location.hostname;
  })();

  const siteOn = () => settings.enabled && !settings.disabledSites.includes(topHost);

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
    engine.apply({ ...settings, enabled: siteOn() });
  }

  async function contextRunning() {
    if (ctx.state === 'running') return true;
    try {
      await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 300))]);
    } catch {}
    return ctx.state === 'running';
  }

  async function attach(el) {
    if (sources.has(el) || !el.isConnected && el.paused) return;
    if (!siteOn()) return;
    const reason = unsafeReason(el);
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

  function scan() {
    for (const el of document.querySelectorAll('video, audio')) {
      if (!el.paused) attach(el);
    }
  }

  function applySettings() {
    if (engine) engine.apply({ ...settings, enabled: siteOn() });
    if (siteOn()) scan();
  }

  // Media events don't bubble, but the capture phase on the document still sees them.
  document.addEventListener('play', (e) => {
    if (e.target instanceof HTMLMediaElement) attach(e.target);
  }, true);

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
      gainDb: engine && siteOn() && engine.preset ? engine.gainDb : 0,
      loudness: engine ? engine.momentary : -Infinity,
      limiter: engine ? engine.limiterReduction() : 0,
    };
  }
  // Content scripts run in an isolated world, so this is visible to the e2e test but not to the page.
  globalThis.__steadyVolumeStatus = status;

  // Popup asks for status. Only frames that have met media answer, so the popup hears from the one that matters.
  api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'status') return;
    const s = status();
    if (s) sendResponse(s);
  });
})();
