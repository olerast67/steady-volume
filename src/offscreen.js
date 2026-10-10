// Offscreen document (Chromium): plays captured tab audio through LevelerEngine.
// Capturing a tab mutes it for the user, so this document is what they hear.
'use strict';

const sessions = new Map(); // tabId -> { stream, ctx, engine, timer }

async function start(tabId, streamId, settings) {
  stop(tabId);
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    video: false,
  });
  const ctx = new AudioContext({ latencyHint: 'interactive' });
  const engine = new LevelerEngine(ctx);
  engine.apply(settings);
  ctx.createMediaStreamSource(stream).connect(engine.input);
  const timer = setInterval(() => engine.tick(), LevelerEngine.TICK_SECONDS * 1000);
  for (const track of stream.getAudioTracks()) {
    track.addEventListener('ended', () => {
      stop(tabId);
      chrome.runtime.sendMessage({ type: 'captureEnded', tabId });
    });
  }
  sessions.set(tabId, { stream, ctx, engine, timer });
}

function stop(tabId) {
  const s = sessions.get(tabId);
  if (!s) return;
  clearInterval(s.timer);
  for (const t of s.stream.getTracks()) t.stop();
  s.ctx.close();
  sessions.delete(tabId);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return;
  switch (msg.type) {
    case 'start':
      start(msg.tabId, msg.streamId, msg.settings).then(
        () => sendResponse({ ok: true }),
        (e) => sendResponse({ ok: false, error: String(e?.message || e) }),
      );
      return true;
    case 'stop':
      stop(msg.tabId);
      sendResponse({ ok: true });
      return;
    case 'settings':
      for (const s of sessions.values()) s.engine.apply(msg.settings);
      sendResponse({ ok: true });
      return;
    case 'status': {
      const s = sessions.get(msg.tabId);
      sendResponse(s ? {
        gainDb: s.engine.preset ? s.engine.gainDb : 0,
        loudness: s.engine.shortTerm,
        limiter: s.engine.limiterReduction(),
      } : null);
      return;
    }
  }
});
