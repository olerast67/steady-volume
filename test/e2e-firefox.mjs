// End-to-end check in Firefox through WebDriver BiDi (installs the extension temporarily).
// node scripts/build.mjs --lint && node test/e2e-firefox.mjs ["C:/Program Files/Mozilla Firefox/firefox.exe"]
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const firefox = process.argv[2] || 'C:/Program Files/Mozilla Firefox/firefox.exe';
const PORT = 8767, BIDI = 9223;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, info = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${info}`); };

const server = spawn(process.execPath, [join(root, 'test/serve.mjs'), String(PORT)], { stdio: 'ignore' });
const profile = mkdtempSync(join(tmpdir(), 'sv-ff-'));
writeFileSync(join(profile, 'user.js'), [
  'user_pref("media.autoplay.default", 0);',          // allow audible autoplay, no gesture needed
  'user_pref("media.autoplay.blocking_policy", 0);',
  'user_pref("browser.shell.checkDefaultBrowser", false);',
  'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
].join('\n'));
const ff = spawn(firefox, ['--headless', '--no-remote', '--profile', profile, `--remote-debugging-port=${BIDI}`], { stdio: 'ignore' });

let ws, nextId = 1;
const pending = new Map();
async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      ws = new WebSocket(`ws://127.0.0.1:${BIDI}/session`);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      ws.onmessage = (m) => {
        const msg = JSON.parse(m.data);
        if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
      };
      return;
    } catch { await sleep(500); }
  }
  throw new Error('cannot connect to Firefox BiDi');
}
function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => pending.set(id, (m) => (m.type === 'error' ? rej(new Error(`${method}: ${m.error} ${m.message}`)) : res(m.result))));
}

try {
  await connect();
  await send('session.new', { capabilities: {} });
  const ext = await send('webExtension.install', { extensionData: { type: 'path', path: join(root, 'build', 'firefox') } });
  check('extension installed', !!ext.extension, ext.extension);
  const { contexts } = await send('browsingContext.getTree', {});
  const context = contexts[0].context;
  const evaluate = async (expression) => {
    const r = await send('script.evaluate', { expression, target: { context }, awaitPromise: true, userActivation: true });
    if (r.type === 'exception') throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  const status = async () => JSON.parse((await evaluate('document.documentElement.dataset.steadyVolume || "null"')) || 'null');

  await send('browsingContext.navigate', { context, url: `http://127.0.0.1:${PORT}/test/player.html#steady-volume-debug`, wait: 'complete' });
  await evaluate('document.getElementById("same").play().then(() => "ok")');
  await sleep(7000);
  let s = await status();
  check('same-origin audio connected', s?.active === 1 && s?.playing === 1, JSON.stringify(s));
  check('quiet dialog boosted (medium)', s?.gainDb > 6, `gainDb=${s?.gainDb?.toFixed(1)} loudness=${s?.loudness?.toFixed(1)}`);

  await evaluate('document.getElementById("same").currentTime = 13');
  await sleep(3000);
  s = await status();
  check('loud action cut', s?.gainDb < -3, `gainDb=${s?.gainDb?.toFixed(1)}`);

  await evaluate('document.getElementById("same").pause(); var a = document.getElementById("cross"); a.currentTime = 5; a.play().then(() => "ok")');
  await sleep(3000);
  let el = JSON.parse(await evaluate('var c = document.getElementById("cross"); JSON.stringify({ co: c.crossOrigin, t: c.currentTime, paused: c.paused })'));
  s = await status();
  check('non-CORS cross-origin media connected via header rule', el.co === 'use-credentials' && s?.active === 2 && !s.blocked.length, JSON.stringify({ ...el, active: s?.active, blocked: s?.blocked }));
  check('its sound reaches the processing (not silence)', s?.loudness > -50, `loudness=${s?.loudness}`);
  check('it resumed at its position and plays', !el.paused && el.t > 5, `t=${el.t}`);

  await evaluate('document.getElementById("cross").pause(); var a = document.getElementById("crossCors"); a.currentTime = 5; a.play().then(() => "ok")');
  await sleep(3000);
  el = JSON.parse(await evaluate('var c = document.getElementById("crossCors"); JSON.stringify({ co: c.crossOrigin, t: c.currentTime, paused: c.paused })'));
  s = await status();
  check('CORS cross-origin media connected', el.co === 'use-credentials' && s?.active === 3, JSON.stringify({ ...el, active: s?.active }));

  await evaluate('document.getElementById("crossCors").pause(); window.shadowAudio.play().then(() => "ok")');
  await sleep(3500);
  s = await status();
  check('media in closed shadow root connected', s?.active === 4 && s?.playing === 1, JSON.stringify({ active: s?.active, playing: s?.playing }));
  check('shadow root media sound reaches the processing', s?.loudness > -50, `loudness=${s?.loudness}`);
} catch (e) {
  check('run', false, e.message);
} finally {
  try { await send('session.end'); } catch {}
  ff.kill();
  server.kill();
  await sleep(1000);
  rmSync(profile, { recursive: true, force: true });
}
const failed = results.filter((ok) => !ok).length;
console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
process.exit(failed ? 1 : 0);
