// Offline test bench: renders a synthetic "movie" (quiet dialog → loud action → quiet dialog)
// through LevelerEngine and reports loudness per segment, the dialog/action gap and peaks.
'use strict';

const SR = 48000;
const SEGMENTS = [
  { name: 'dialog1', from: 0, to: 12 },
  { name: 'action', from: 12, to: 24 },
  { name: 'dialog2', from: 24, to: 36 },
  { name: 'silence', from: 36, to: 40 },
];
const DURATION = 40;

function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296 * 2 - 1;
  };
}

// Speech-like: band-limited noise with syllable (~4 Hz) and phrase envelopes.
// Action: pink-ish broadband noise with explosion hits (sharp attack, 50 Hz body).
function makeMovie(dialogDb = -30, actionDb = -16) {
  const n = SR * DURATION;
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const r = rng(12345);
  let lp1 = 0, lp2 = 0, hp = 0, prev = 0;
  let b0 = 0, b1 = 0, b2 = 0;
  const dA = Math.pow(10, dialogDb / 20) * 3.2;
  const aA = Math.pow(10, actionDb / 20) * 1.6;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const w = r();
    let s = 0;
    if ((t < 12) || (t >= 24 && t < 36)) {
      // band-pass ~300..3000 Hz
      lp1 += 0.33 * (w - lp1);
      lp2 += 0.33 * (lp1 - lp2);
      hp = 0.96 * (hp + lp2 - prev);
      prev = lp2;
      const syll = Math.max(0, Math.sin(2 * Math.PI * 4.3 * t)) ** 0.7;
      const phrase = (t % 4) < 3.2 ? 1 : 0.05;
      s = hp * syll * phrase * dA;
      L[i] = s; R[i] = s;
    } else if (t >= 12 && t < 24) {
      // pink-ish noise
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      let pink = (b0 + b1 + b2 + w * 0.1848) * 0.2;
      const tt = (t - 12) % 3;
      const hit = tt < 1.2 ? Math.exp(-tt * 3) : 0;
      const boom = Math.sin(2 * Math.PI * 50 * t) * hit * 1.2;
      s = (pink * (0.6 + hit * 2) + boom) * aA;
      L[i] = s; R[i] = s * 0.9 + pink * aA * 0.1;
    }
  }
  return [L, R];
}

function loudnessDb(ch, from, to) {
  let sum = 0, cnt = 0;
  for (const c of ch) {
    for (let i = Math.floor(from * SR); i < Math.floor(to * SR); i++) { sum += c[i] * c[i]; cnt++; }
  }
  return cnt ? 10 * Math.log10(sum / cnt + 1e-20) : -Infinity;
}

// 400 ms blocks with speech-style gating (ignore blocks quieter than -60 dB), median per segment.
function segmentLevel(ch, seg) {
  const vals = [];
  for (let t = seg.from; t + 0.4 <= seg.to; t += 0.1) {
    const v = loudnessDb(ch, t, t + 0.4);
    if (v > -60) vals.push(v);
  }
  vals.sort((a, b) => a - b);
  return vals.length ? vals[Math.floor(vals.length / 2)] : -Infinity;
}

function peak(ch) {
  let m = 0;
  for (const c of ch) for (let i = 0; i < c.length; i++) m = Math.max(m, Math.abs(c[i]));
  return 20 * Math.log10(m + 1e-20);
}

async function render(settings, movie) {
  const ctx = new OfflineAudioContext(2, SR * DURATION, SR);
  const buf = ctx.createBuffer(2, SR * DURATION, SR);
  buf.copyToChannel(movie[0], 0);
  buf.copyToChannel(movie[1], 1);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const engine = new LevelerEngine(ctx);
  engine.apply(settings);
  src.connect(engine.input);
  src.start();
  const trace = [];
  const step = LevelerEngine.TICK_SECONDS;
  for (let t = step; t < DURATION; t += step) {
    ctx.suspend(t).then(() => {
      engine.tick();
      if (Math.abs((t * 10) % 10) < 0.01 || Math.abs((t * 10) % 10 - 10) < 0.01) {
        trace.push([+t.toFixed(1), +engine.gainDb.toFixed(1), +engine.momentary.toFixed(1)]);
      }
      ctx.resume();
    });
  }
  const out = await ctx.startRendering();
  return { out: [out.getChannelData(0), out.getChannelData(1)], trace };
}

// Gain of a node chain on a quiet 1 kHz sine: shows the compressor's automatic makeup gain.
async function quietGain(params) {
  const ctx = new OfflineAudioContext(1, SR, SR);
  const osc = ctx.createOscillator();
  osc.frequency.value = 1000;
  const g = ctx.createGain();
  g.gain.value = Math.pow(10, -50 / 20);
  const comp = ctx.createDynamicsCompressor();
  for (const k of Object.keys(params)) comp[k].value = params[k];
  osc.connect(g).connect(comp).connect(ctx.destination);
  osc.start();
  const out = await ctx.startRendering();
  const d = out.getChannelData(0);
  let s = 0;
  for (let i = SR / 2; i < SR; i++) s += d[i] * d[i];
  const rms = Math.sqrt(s / (SR / 2));
  return 20 * Math.log10(rms / (Math.pow(10, -50 / 20) / Math.SQRT2));
}

async function runAll() {
  const report = { makeup: {}, cases: [] };
  for (let i = 1; i < LevelerEngine.PRESETS.length; i++) {
    const p = LevelerEngine.PRESETS[i];
    report.makeup['preset' + i] = +(await quietGain({ threshold: p.threshold, knee: p.knee, ratio: p.ratio, attack: p.compAttack, release: p.compRelease })).toFixed(2);
  }
  report.makeup.limiter = +(await quietGain({ threshold: -2, knee: 0, ratio: 20, attack: 0.001, release: 0.08 })).toFixed(2);

  const movie = makeMovie();
  const input = {};
  for (const s of SEGMENTS.slice(0, 3)) input[s.name] = +segmentLevel(movie, s).toFixed(1);
  report.input = { ...input, gap: +(input.action - (input.dialog1 + input.dialog2) / 2).toFixed(1), peak: +peak(movie).toFixed(1) };

  const configs = [
    { label: 'bypass', enabled: false, volume: 100, leveling: 0, dialog: false },
    { label: 'off, 100%', enabled: true, volume: 100, leveling: 0, dialog: false },
    { label: 'off, 300%', enabled: true, volume: 300, leveling: 0, dialog: false },
    { label: 'light', enabled: true, volume: 100, leveling: 1, dialog: false },
    { label: 'medium', enabled: true, volume: 100, leveling: 2, dialog: false },
    { label: 'strong', enabled: true, volume: 100, leveling: 3, dialog: false },
    { label: 'strong, 200%', enabled: true, volume: 200, leveling: 3, dialog: false },
    { label: 'custom: target -16, ceiling -6', enabled: true, volume: 100, leveling: 4, dialog: false, custom: { target: -16, ceiling: -6 } },
  ];
  for (const c of configs) {
    const { out, trace } = await render(c, movie);
    const lv = {};
    for (const s of SEGMENTS.slice(0, 3)) lv[s.name] = +segmentLevel(out, s).toFixed(1);
    report.cases.push({
      label: c.label, ...lv,
      gap: +(lv.action - (lv.dialog1 + lv.dialog2) / 2).toFixed(1),
      // dialog right after the action scene, relative to the rest of that dialog: shows recovery speed
      afterAction: +(segmentLevel(out, { from: 24, to: 26 }) - lv.dialog2).toFixed(1),
      peak: +peak(out).toFixed(2),
      trace: window.SHOW_TRACE && c.label === 'medium' ? trace.filter((_, i) => i % 2 === 0) : undefined,
    });
  }
  return report;
}

window.runAll = runAll;
runAll().then((r) => {
  window.report = r;
  document.getElementById('out').textContent = JSON.stringify(r, null, 1);
}).catch((e) => {
  document.getElementById('out').textContent = 'ERROR ' + e.stack;
});
