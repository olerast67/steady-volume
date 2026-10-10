import { chromium } from 'playwright-core';
import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
const ext = 'C:/projects/plugin-compressor/src';
const url = process.argv[2];
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(),'vk-')), { channel:'msedge', headless:false,
  args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`,'--mute-audio','--autoplay-policy=no-user-gesture-required'] });
const page = await ctx.newPage();
await page.goto(url, { timeout: 45000 }).catch(e => console.log('goto', e.message.slice(0,80)));
await page.waitForTimeout(15000);
for (const f of page.frames()) {
  const info = await f.evaluate(() => { const all = []; const walk = (root, depth) => { for (const el of root.querySelectorAll('*')) { if (el.tagName === 'VIDEO' || el.tagName === 'AUDIO') all.push({ depth, host: root.host?.tagName, src: (el.currentSrc||'').slice(0,60), co: el.crossOrigin, paused: el.paused, t: +el.currentTime.toFixed(1), keys: !!el.mediaKeys }); if (el.shadowRoot) walk(el.shadowRoot, depth + 1); } }; walk(document, 0); return { all, st: document.documentElement.dataset.steadyVolume }; }).catch((e) => 'ERR ' + e.message.slice(0,60));
  console.log('frame', f.url().slice(0, 70), JSON.stringify(info));
}
await page.screenshot({ path: 'test/out/vk.png' });
await ctx.close();
