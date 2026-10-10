// End-to-end check in Firefox through WebDriver BiDi (installs the extension temporarily).
// node test/e2e-firefox.mjs ["C:/Program Files/Mozilla Firefox/firefox.exe"]
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
  const ext = await send('webExtension.install', { extensionData: { type: 'path', path: join(root, 'src') } });
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

  await evaluate('document.getElementById("same").pause(); document.getElementById("cross").play().then(() => "ok")');
  await sleep(1500);
  const t0 = await evaluate('document.getElementById("cross").currentTime');
  await sleep(1000);
  const t1 = await evaluate('document.getElementById("cross").currentTime');
  s = await status();
  check('cross-origin media not hooked', s?.blocked?.includes('cors') && s.active === 1, JSON.stringify(s?.blocked));
  check('cross-origin media still plays', t1 > t0, `${t0} -> ${t1}`);
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
