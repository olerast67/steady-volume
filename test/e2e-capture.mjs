// Whole-tab capture check in Chromium (Edge/Chrome). tabCapture normally needs a click on the extension icon;
// the --allowlisted-extension-id switch lifts that for the test browser.
// node test/e2e-capture.mjs [msedge|chrome] [page-url]   (default page: the local test player)
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const ext = join(root, 'src');
const channel = process.argv[2] || 'msedge';
const PORT = 8770;
const pageUrl = process.argv[3] || `http://127.0.0.1:${PORT}/test/player.html`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, info = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${info}`); };

const server = spawn(process.execPath, [join(root, 'test/serve.mjs'), String(PORT)], { stdio: 'ignore' });
await sleep(500);

async function launch(extraArgs = []) {
  const profile = mkdtempSync(join(tmpdir(), 'sv-cap-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel, headless: false,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--autoplay-policy=no-user-gesture-required', ...extraArgs],
  });
  return { context, profile };
}

async function extensionId(context) {
  for (let i = 0; i < 20; i++) {
    const sw = context.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'));
    if (sw) return new URL(sw.url()).host;
    await sleep(250);
  }
  throw new Error('extension service worker not found');
}

let first = await launch();
const id = await extensionId(first.context);
await first.context.close();
rmSync(first.profile, { recursive: true, force: true });

const { context, profile } = await launch([`--allowlisted-extension-id=${id}`, `--whitelisted-extension-id=${id}`]);
try {
  const page = await context.newPage();
  await page.goto(pageUrl);
  await page.mouse.click(5, 5);
  if (pageUrl.includes('player.html')) await page.evaluate(() => document.getElementById('same').play());
  else {
    // external page: press its Load/Play button if it has one and let the player start
    await sleep(4000);
    const btn = page.locator('button:has-text("Load"), button:has-text("Play")').first();
    if (await btn.count()) await btn.click().catch(() => {});
    await sleep(8000);
    const v = await page.evaluate(() => { const v = document.querySelector('video'); return v && { paused: v.paused, drm: !!v.mediaKeys }; });
    check('external video plays', v && !v.paused, JSON.stringify(v));
  }
  await sleep(2000);

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup/popup.html`);
  const tabId = await popup.evaluate(async (url) => (await chrome.tabs.query({})).find((t) => t.url?.startsWith(url.split('#')[0].slice(0, 20)))?.id
    ?? (await chrome.tabs.query({})).find((t) => !t.url?.startsWith('chrome-extension://') && t.url !== 'about:blank')?.id, pageUrl);
  const caps = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'capabilities' }));
  check('capture available in Chromium', caps?.capture === true, JSON.stringify(caps));

  const started = await popup.evaluate((tabId) => chrome.runtime.sendMessage({ type: 'startCapture', tabId }), tabId);
  check('capture started', started?.ok === true, JSON.stringify(started));
  await page.bringToFront();
  await sleep(5000);
  const cs = await popup.evaluate((tabId) => chrome.runtime.sendMessage({ type: 'captureStatus', tabId }), tabId);
  check('captured sound reaches the processing', cs?.on && cs.loudness > -60, JSON.stringify(cs));
  check('capture adjusts the gain', cs?.on && Math.abs(cs.gainDb) > 1, `gainDb=${cs?.gainDb?.toFixed?.(1)}`);

  const stopped = await popup.evaluate((tabId) => chrome.runtime.sendMessage({ type: 'stopCapture', tabId }), tabId);
  const cs2 = await popup.evaluate((tabId) => chrome.runtime.sendMessage({ type: 'captureStatus', tabId }), tabId);
  check('capture stopped', stopped?.ok && cs2?.on === false, JSON.stringify(cs2));
} catch (e) {
  check('run', false, e.message);
} finally {
  await context.close();
  server.kill();
  rmSync(profile, { recursive: true, force: true });
}
const failed = results.filter((ok) => !ok).length;
console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
process.exit(failed ? 1 : 0);
