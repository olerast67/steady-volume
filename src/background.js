// Background: CORS header rules for media files and (Chromium) whole-tab audio capture.
// Chromium runs it as a service worker, Firefox as an event page, so no state lives in variables.
'use strict';

const api = globalThis.browser ?? globalThis.chrome;
const DEFAULTS = { enabled: true, volume: 100, leveling: 2, dialog: false, custom: {}, disabledSites: [] };
const canCapture = !!(api.tabCapture && api.offscreen);

// Stable 31-bit rule id for a (media host, page host) pair, so adding the same rule twice replaces it.
function ruleId(mediaHost, pageHost) {
  let h = 2166136261;
  for (const c of mediaHost + '|' + pageHost) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 1) || 1;
}

// Lets one page origin read media from one server, so Web Audio can process it.
// Only requests of type "media" started by that page's host get the headers.
async function allowCors(mediaUrl, pageOrigin) {
  const mediaHost = new URL(mediaUrl).hostname;
  const pageHost = new URL(pageOrigin).hostname;
  const id = ruleId(mediaHost, pageHost);
  await api.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [id],
    addRules: [{
      id,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        responseHeaders: [
          { header: 'access-control-allow-origin', operation: 'set', value: pageOrigin },
          { header: 'access-control-allow-credentials', operation: 'set', value: 'true' },
        ],
      },
      condition: { requestDomains: [mediaHost], initiatorDomains: [pageHost], resourceTypes: ['media'] },
    }],
  });
}

// ---- whole-tab capture (Chromium only) ----

async function capturedTabs() {
  const { captured = [] } = await api.storage.session.get('captured');
  return captured;
}

async function setCaptured(list) {
  await api.storage.session.set({ captured: list });
}

async function ensureOffscreen() {
  const has = await api.offscreen.hasDocument?.();
  if (has) return;
  try {
    await api.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Processes the captured tab audio with the volume leveler.',
    });
  } catch (e) {
    if (!String(e.message).includes('single offscreen')) throw e;
  }
}

async function settings() {
  return { ...DEFAULTS, ...(await api.storage.sync.get(DEFAULTS)) };
}

async function startCapture(tabId) {
  const list = await capturedTabs();
  if (list.includes(tabId)) return { ok: true };
  const streamId = await api.tabCapture.getMediaStreamId({ targetTabId: tabId });
  await ensureOffscreen();
  const res = await api.runtime.sendMessage({ target: 'offscreen', type: 'start', tabId, streamId, settings: await settings() });
  if (!res?.ok) throw new Error(res?.error || 'offscreen did not start');
  await setCaptured([...list, tabId]);
  await notifyTab(tabId, true);
  return { ok: true };
}

async function stopCapture(tabId) {
  const list = await capturedTabs();
  await setCaptured(list.filter((id) => id !== tabId));
  try { await api.runtime.sendMessage({ target: 'offscreen', type: 'stop', tabId }); } catch {}
  await notifyTab(tabId, false);
  if (list.length <= 1) { try { await api.offscreen.closeDocument(); } catch {} }
}

// Page scripts pass their own elements through unchanged while the whole tab is processed.
async function notifyTab(tabId, on) {
  try { await api.tabs.sendMessage(tabId, { type: 'capture', on }); } catch {}
}

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target === 'offscreen') return; // meant for the offscreen document
  (async () => {
    switch (msg?.type) {
      case 'allowCors':
        await allowCors(msg.mediaUrl, msg.pageOrigin);
        return { ok: true };
      case 'capabilities':
        return { capture: canCapture };
      case 'isCaptured':
        return { on: canCapture && (await capturedTabs()).includes(sender.tab?.id) };
      case 'startCapture':
        return startCapture(msg.tabId);
      case 'stopCapture':
        await stopCapture(msg.tabId);
        return { ok: true };
      case 'captureStatus': {
        if (!canCapture || !(await capturedTabs()).includes(msg.tabId)) return { on: false };
        try {
          return { on: true, ...(await api.runtime.sendMessage({ target: 'offscreen', type: 'status', tabId: msg.tabId })) };
        } catch {
          return { on: false };
        }
      }
      case 'captureEnded': // the capture stream ended: tab closed or navigated to a page that stopped it
        await stopCapture(msg.tabId);
        return { ok: true };
      default:
        return undefined;
    }
  })().then(sendResponse, (e) => sendResponse({ ok: false, error: String(e?.message || e) }));
  return true;
});

if (canCapture) {
  api.tabs.onRemoved.addListener(async (tabId) => {
    if ((await capturedTabs()).includes(tabId)) await stopCapture(tabId);
  });

  // Settings changes reach the offscreen engine, which has no storage access of its own.
  api.storage.onChanged.addListener(async (_changes, area) => {
    if (area !== 'sync' || !(await capturedTabs()).length) return;
    try { await api.runtime.sendMessage({ target: 'offscreen', type: 'settings', settings: await settings() }); } catch {}
  });

  // Keyboard shortcut: the key press counts as invoking the extension on the tab, which tabCapture requires.
  api.commands?.onCommand.addListener(async (command, tab) => {
    if (command !== 'toggle-capture' || !tab?.id) return;
    if ((await capturedTabs()).includes(tab.id)) await stopCapture(tab.id);
    else await startCapture(tab.id).catch(() => {});
  });
}
