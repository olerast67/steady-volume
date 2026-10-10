// Takes popup screenshots in Russian and English while the test file is being processed.
// node scripts/screenshots.mjs [msedge|chrome|chromium]   (run `node test/make-movie.mjs` first)
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const ext = join(root, 'src');
const channel = process.argv[2] || 'msedge';
const PORT = 8768;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, [join(root, 'test/serve.mjs'), String(PORT)], { stdio: 'ignore' });
await sleep(500);

// Extra languages after the channel are saved to test/out for a layout check: node scripts/screenshots.mjs msedge de fr ar
const extra = process.argv.slice(3);
const runs = extra.length ? extra.map((l) => [l, '-' + l, join(root, 'test', 'out')]) : [['ru', '', join(root, 'docs')], ['en-US', '-en', join(root, 'docs')]];
mkdirSync(join(root, 'test', 'out'), { recursive: true });
for (const [lang, suffix, outDir] of runs) {
  const profile = mkdtempSync(join(tmpdir(), 'sv-shot-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: channel === 'chromium' ? undefined : channel,
    headless: false,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--mute-audio', `--lang=${lang}`, '--autoplay-policy=no-user-gesture-required'],
    locale: lang,
  });
  try {
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/test/player.html`);
    await page.evaluate(() => { const a = document.getElementById('same'); a.currentTime = 4; a.play(); });
    await sleep(5000);
    const id = await findId(context, page);
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 320, height: 200 });
    await popup.goto(`chrome-extension://${id}/popup/popup.html`);
    // tab URLs are hidden from the extension, so take the tab whose page script answers the status request
    const tabId = await popup.evaluate(async () => {
      for (const t of await chrome.tabs.query({})) {
        try { if (await chrome.tabs.sendMessage(t.id, { type: 'status' })) return t.id; } catch {}
      }
      return null;
    });
    await popup.goto(`chrome-extension://${id}/popup/popup.html?tab=${tabId}`);
    await sleep(2500);
    await popup.screenshot({ path: join(outDir, `popup${suffix}.png`), fullPage: true });
    await popup.click('#advanced summary');
    await sleep(300);
    await popup.screenshot({ path: join(outDir, `popup-advanced${suffix}.png`), fullPage: true });
    console.log('saved', lang);
  } finally {
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  }
}
server.kill();

// Fallback: read chrome.runtime.id from the content script's isolated world.
async function findId(context, page) {
  const cdp = await context.newCDPSession(page);
  const ids = [];
  cdp.on('Runtime.executionContextCreated', ({ context: c }) => { if (c.auxData?.type === 'isolated') ids.push(c.id); });
  await cdp.send('Runtime.enable');
  await sleep(300);
  for (const ctxId of ids) {
    const r = await cdp.send('Runtime.evaluate', { expression: 'chrome.runtime.id', contextId: ctxId, returnByValue: true });
    if (r.result?.value) return r.result.value;
  }
  throw new Error('extension id not found');
}
