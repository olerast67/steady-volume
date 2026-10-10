// Audio processing chain. Shared by the content script and the test harness.
// Uses only built-in Web Audio nodes (no AudioWorklet), so strict page CSP can't break it.
//
// input ─┬─ low shelf ─ presence ─ AGC gain ─ compressor ─ volume ─ limiter ─ soft clip ─ output
//        ├─ (bypass) ──────────────────────────────────────────────────────────────────┘
//        └─ K-weighting ─ analyser   (loudness meter that drives the AGC gain)
'use strict';

(() => {
  const dbToGain = (db) => Math.pow(10, db / 20);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // AGC aims the input at this loudness (LUFS, measured before the compressor).
  const TARGET_LUFS = -20;
  // Below this momentary loudness the AGC holds its gain, so silence and room tone are not pumped up.
  const GATE_LUFS = -50;
  const TICK_SECONDS = 0.1;
  const MOMENTARY_TICKS = 4;   // ~400 ms, as in EBU R128 momentary loudness
  const SHORT_TERM_TICKS = 30; // ~3 s, as in EBU R128 short-term loudness

  // DynamicsCompressorNode adds automatic makeup gain (+3.6 / +6.9 / +11.8 dB for these presets, see test/),
  // which is kept: stronger leveling is also louder overall.
  const PRESETS = [
    null, // off: no AGC, no compressor
    { maxBoost: 6, maxCut: 6, attack: 0.5, release: 3,
      comp: { threshold: -16, knee: 8, ratio: 2, attack: 0.01, release: 0.3 } },
    { maxBoost: 12, maxCut: 12, attack: 0.3, release: 2,
      comp: { threshold: -22, knee: 10, ratio: 3, attack: 0.006, release: 0.25 } },
    { maxBoost: 20, maxCut: 20, attack: 0.2, release: 1.5,
      comp: { threshold: -28, knee: 10, ratio: 6, attack: 0.003, release: 0.2 } },
  ];
  const LIMITER = { threshold: -2, knee: 0, ratio: 20, attack: 0.001, release: 0.08 };

  function setParams(node, p) {
    for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) node[k].value = p[k];
  }

  // Linear up to 0.8, then a smooth knee that never exceeds 1.0.
  function softClipCurve() {
    const n = 4097;
    const curve = new Float32Array(n);
    const knee = 0.8;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      const a = Math.abs(x);
      const y = a <= knee ? a : knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee));
      curve[i] = Math.sign(x) * y;
    }
    return curve;
  }

  class LevelerEngine {
    constructor(ctx, destination = ctx.destination) {
      this.ctx = ctx;
      this.input = ctx.createGain();
      this.output = ctx.createGain();
      this.output.connect(destination);

      this.lowShelf = ctx.createBiquadFilter();
      this.lowShelf.type = 'lowshelf';
      this.lowShelf.frequency.value = 160;
      this.lowShelf.gain.value = 0;
      this.presence = ctx.createBiquadFilter();
      this.presence.type = 'peaking';
      this.presence.frequency.value = 2800;
      this.presence.Q.value = 0.8;
      this.presence.gain.value = 0;

      this.agc = ctx.createGain();
      this.comp = ctx.createDynamicsCompressor();
      this.volume = ctx.createGain();
      this.limiter = ctx.createDynamicsCompressor();
      setParams(this.limiter, LIMITER);
      this.clipper = ctx.createWaveShaper();
      this.clipper.curve = softClipCurve();

      this.lowShelf.connect(this.presence);
      this.presence.connect(this.agc);
      this.agc.connect(this.comp);
      this.comp.connect(this.volume);
      this.volume.connect(this.limiter);
      this.limiter.connect(this.clipper);
      this.clipper.connect(this.output);

      // K-weighting (ITU-R BS.1770): high shelf +4 dB around 1.7 kHz, then a high-pass at 38 Hz.
      this.kShelf = ctx.createBiquadFilter();
      this.kShelf.type = 'highshelf';
      this.kShelf.frequency.value = 1681;
      this.kShelf.gain.value = 4;
      this.kHighpass = ctx.createBiquadFilter();
      this.kHighpass.type = 'highpass';
      this.kHighpass.frequency.value = 38;
      this.kHighpass.Q.value = 0.5;
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 8192;
      this.analyser.smoothingTimeConstant = 0;
      // A silent sink keeps the analyser in the rendered graph in every browser.
      this.sink = ctx.createGain();
      this.sink.gain.value = 0;
      this.input.connect(this.kShelf);
      this.kShelf.connect(this.kHighpass);
      this.kHighpass.connect(this.analyser);
      this.analyser.connect(this.sink);
      this.sink.connect(destination);

      this.buf = new Float32Array(this.analyser.fftSize);
      this.history = [];
      this.gainDb = 0;
      this.lastTick = null;
      this.momentary = -Infinity;
      this.shortTerm = -Infinity;
      this.bypassed = null;
      this.preset = null;
      this.apply({ enabled: true, volume: 100, leveling: 2, dialog: false });
    }

    apply({ enabled, volume, leveling, dialog }) {
      this.setBypass(!enabled);
      this.preset = PRESETS[clamp(leveling | 0, 0, PRESETS.length - 1)];
      const p = this.preset;
      if (p) {
        setParams(this.comp, p.comp);
      } else {
        // ratio 1 turns the compressor into a pass-through
        setParams(this.comp, { threshold: 0, knee: 0, ratio: 1, attack: 0.003, release: 0.25 });
        this.gainDb = 0;
        this.agc.gain.setTargetAtTime(1, this.ctx.currentTime, 0.05);
      }
      this.volume.gain.setTargetAtTime(clamp(volume, 0, 1000) / 100, this.ctx.currentTime, 0.03);
      this.lowShelf.gain.value = dialog ? -4 : 0;
      this.presence.gain.value = dialog ? 4 : 0;
    }

    setBypass(on) {
      if (this.bypassed === on) return;
      this.bypassed = on;
      try { this.input.disconnect(this.lowShelf); } catch {}
      try { this.input.disconnect(this.output); } catch {}
      this.input.connect(on ? this.output : this.lowShelf);
    }

    // Measures loudness and moves the AGC gain. Call every TICK_SECONDS.
    tick() {
      const now = this.ctx.currentTime;
      const dt = this.lastTick === null ? TICK_SECONDS : clamp(now - this.lastTick, 0, 1);
      this.lastTick = now;

      this.analyser.getFloatTimeDomainData(this.buf);
      let sum = 0;
      for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
      this.history.push(sum / this.buf.length);
      if (this.history.length > SHORT_TERM_TICKS) this.history.shift();

      this.momentary = lufs(mean(this.history.slice(-MOMENTARY_TICKS)));
      this.shortTerm = lufs(mean(this.history));

      const p = this.preset;
      if (!p || this.bypassed || dt === 0) return;
      if (this.momentary < GATE_LUFS) return;

      // Momentary loudness drives the gain; attack/release time constants do the averaging.
      // (A 3 s window kept the gain down for seconds after an explosion, burying the next line of dialog.)
      const level = this.momentary;
      const desired = clamp(TARGET_LUFS - level, -p.maxCut, p.maxBoost);
      // Far below the desired gain (dialog right after an explosion) recover faster, near it move gently.
      const tc = desired < this.gainDb ? p.attack : p.release * (desired - this.gainDb > 8 ? 0.35 : 1);
      this.gainDb += (desired - this.gainDb) * (1 - Math.exp(-dt / tc));
      this.agc.gain.setTargetAtTime(dbToGain(this.gainDb), now, 0.04);
    }

    // Gain the limiter is currently taking off, dB (<= 0).
    limiterReduction() {
      return this.limiter.reduction;
    }
  }

  function mean(a) {
    let s = 0;
    for (const v of a) s += v;
    return a.length ? s / a.length : 0;
  }

  // The analyser downmixes stereo to mono (average), so identical L/R read 3 dB lower than BS.1770's channel sum.
  function lufs(meanSquare) {
    return meanSquare > 0 ? -0.691 + 10 * Math.log10(meanSquare) + 3.01 : -Infinity;
  }

  globalThis.LevelerEngine = LevelerEngine;
  globalThis.LevelerEngine.TICK_SECONDS = TICK_SECONDS;
  globalThis.LevelerEngine.PRESETS = PRESETS;
})();
