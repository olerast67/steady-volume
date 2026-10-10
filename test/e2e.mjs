// End-to-end check in a real Chromium with the unpacked extension loaded.
// node test/e2e.mjs [msedge|chrome|chromium]   (run `node test/make-movie.mjs` first)
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const ext = join(root, 'src');
const PORT = 8766;
const channel = process.argv[2] || 'chromium';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${info}`); };

const server = spawn(process.execPath, [join(root, 'test/serve.mjs'), String(PORT)], { stdio: 'ignore' });
const profile = mkdtempSync(join(tmpdir(), 'sv-e2e-'));
mkdirSync(join(root, 'test', 'out'), { recursive: true });
await sleep(500);

const context = await chromium.launchPersistentContext(profile, {
  channel: channel === 'chromium' ? undefined : channel,
  headless: false,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--mute-audio'],
});

try {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const worlds = new Map(); // frameId -> isolated execution context id of our content script
  cdp.on('Runtime.executionContextCreated', ({ context: c }) => {
    if (c.auxData?.type === 'isolated' && /Steady|Ровный/.test(c.name)) worlds.set(c.auxData.frameId, c.id);
  });
  cdp.on('Runtime.executionContextsCleared', () => worlds.clear());
  await cdp.send('Runtime.enable');

  const inExt = async (expr) => {
    const id = [...worlds.values()][0];
    if (!id) throw new Error('content script world not found: extension did not load');
    const r = await cdp.send('Runtime.evaluate', { expression: expr, contextId: id, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const status = () => inExt('__steadyVolumeStatus()');

  await page.goto(`http://127.0.0.1:${PORT}/test/player.html`);
  await sleep(500);
  check('content script injected', worlds.size > 0, `worlds=${worlds.size}`);

  // A real click gives the page user activation, as when a person presses play.
  await page.mouse.click(5, 5);
  await page.evaluate(() => document.getElementById('same').play());
  await sleep(7000);
  let s = await status();
  check('same-origin audio connected', s?.active === 1 && s?.playing === 1, JSON.stringify(s));
  check('loudness measured', Number.isFinite(s?.loudness) && s.loudness > -50, `loudness=${s?.loudness?.toFixed(1)}`);
  check('quiet dialog boosted (medium)', s?.gainDb > 6, `gainDb=${s?.gainDb?.toFixed(1)}`);

  await page.evaluate(() => { document.getElementById('same').currentTime = 13; });
  await sleep(3000);
  s = await status();
  check('loud action cut', s?.gainDb < -3, `gainDb=${s?.gainDb?.toFixed(1)}`);

  await page.evaluate(() => { document.getElementById('same').currentTime = 25; });
  await sleep(3000);
  s = await status();
  check('dialog after action recovers', s?.gainDb > 3, `gainDb=${s?.gainDb?.toFixed(1)}`);

  // cross-origin without CORS: must be left alone and keep playing
  await page.evaluate(() => { document.getElementById('same').pause(); document.getElementById('cross').play(); });
  await sleep(1500);
  const t0 = await page.evaluate(() => document.getElementById('cross').currentTime);
  await sleep(1000);
  const t1 = await page.evaluate(() => document.getElementById('cross').currentTime);
  s = await status();
  check('cross-origin media not hooked', s?.blocked.includes('cors') && s.active === 1, JSON.stringify(s?.blocked));
  check('cross-origin media still plays', t1 > t0, `${t0.toFixed(2)} -> ${t1.toFixed(2)}`);

  // cross-origin with CORS headers on the server: reloaded with crossorigin at the same position and processed
  await page.evaluate(() => { const c = document.getElementById('cross'); c.pause(); const a = document.getElementById('crossCors'); a.currentTime = 5; a.play(); });
  await sleep(3000);
  const cc = await page.evaluate(() => { const a = document.getElementById('crossCors'); return { co: a.crossOrigin, t: a.currentTime, paused: a.paused }; });
  s = await status();
  check('CORS-enabled cross-origin media upgraded', cc.co === 'anonymous' && s?.active === 2, JSON.stringify({ ...cc, active: s?.active }));
  check('upgraded media resumed at its position', !cc.paused && cc.t > 5, `t=${cc.t.toFixed(2)}`);
  await page.evaluate(() => document.getElementById('crossCors').pause());

  // settings: turn the site off through storage, the engine must go to bypass without a reload
  const extId = await inExt('chrome.runtime.id');
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 320, height: 520 });
  await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
  await sleep(500);
  const ruOrEn = await popup.textContent('h1');
  check('popup renders', !!ruOrEn && !ruOrEn.includes('__MSG'), ruOrEn);
  await popup.click('#leveling button[data-value="3"]');
  await sleep(300);
  const stored = await popup.evaluate(() => chrome.storage.sync.get(null));
  check('popup saves leveling', stored.leveling === 3, JSON.stringify(stored));
  await popup.click('#advanced summary');
  await popup.evaluate(() => { const f = document.getElementById('f_target'); f.value = -16; f.dispatchEvent(new Event('input')); });
  await sleep(600);
  const stored2 = await popup.evaluate(() => chrome.storage.sync.get(null));
  check('fine-tuning switches to custom mode', stored2.leveling === 4 && stored2.custom?.target === -16 && stored2.custom?.ratio === 6, JSON.stringify(stored2));
  await popup.screenshot({ path: join(root, 'test', 'out', 'popup-advanced.png'), fullPage: true });
  await popup.click('#reset');
  await popup.click('#advanced summary');
  await sleep(300);
  await popup.screenshot({ path: join(root, 'test', 'out', 'popup.png') });

  await popup.evaluate(() => chrome.storage.sync.set({ disabledSites: ['127.0.0.1'] }));
  await page.bringToFront();
  await page.evaluate(() => { const a = document.getElementById('same'); a.currentTime = 2; a.play(); });
  await sleep(2000);
  s = await status();
  check('site off: no adjustment', s?.gainDb === 0, JSON.stringify(s));
  await popup.evaluate(() => chrome.storage.sync.set({ disabledSites: [] }));
  await sleep(4000);
  s = await status();
  check('site back on: adjusting again', s?.gainDb > 3, `gainDb=${s?.gainDb?.toFixed(1)}`);
} catch (e) {
  check('run', false, e.message);
} finally {
  await context.close();
  server.kill();
  rmSync(profile, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
process.exit(failed ? 1 : 0);
