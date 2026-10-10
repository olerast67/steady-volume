// Writes test/movie.wav: 12 s quiet dialog, 12 s loud action, 12 s quiet dialog (same signal as harness.js).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const SR = 48000;
// reuse makeMovie() from the browser harness without a browser
const code = readFileSync(new URL('./harness.js', import.meta.url), 'utf8').split('function loudnessDb')[0];
const sandbox = { Math, Float32Array };
vm.runInNewContext(code + '\nthis.makeMovie = makeMovie;', sandbox);
const [L, R] = sandbox.makeMovie();

const n = L.length;
const buf = Buffer.alloc(44 + n * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8);
buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
const s16 = (v) => Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
for (let i = 0; i < n; i++) {
  buf.writeInt16LE(s16(L[i]), 44 + i * 4);
  buf.writeInt16LE(s16(R[i]), 46 + i * 4);
}
const out = fileURLToPath(new URL('./movie.wav', import.meta.url));
writeFileSync(out, buf);
console.log('wrote', out);
