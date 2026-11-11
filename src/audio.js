// Procedural audio (WebAudio). No audio files -> tiny download.
// Mute sources: CrazyGames muteAudio setting, ads, hidden tab, and the player's own toggles.

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const PENTA = [0, 2, 4, 7, 9];

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.mutes = { sdk: false, ad: false, hidden: false };
    this.musicOn = true;
    this.sfxOn = true;
    this.musicTimer = null;
    this.musicCfg = null;
    this.nextNoteTime = 0;
    this.step = 0;
    this.intensity = 0;
    this.lastSfx = {};
  }

  ensure() {
    if (this.ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      this.ctx = new AC();
    } catch (e) {
      return false;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 4;
    this.master.connect(this.comp).connect(ctx.destination);
    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    // Reverb with a generated impulse response for a frosty shimmer
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(2.8, 2.6);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.55;
    this.reverbSend.connect(this.reverb).connect(this.master);
    // shared white noise
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.applyGains(true);
    this.startLoops();
    return true;
  }

  makeImpulse(seconds, decay) {
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
    }
    return buf;
  }

  unlock() {
    if (!this.ensure()) return;
    if (this.ctx.state === 'suspended' && !this.mutes.hidden) this.ctx.resume().catch(() => {});
  }

  setMute(reason, on) {
    this.mutes[reason] = !!on;
    this.applyGains();
    if (this.ctx) {
      if (reason === 'hidden') {
        if (on) this.ctx.suspend().catch(() => {});
        else this.ctx.resume().catch(() => {});
      }
    }
  }

  setMusic(on) {
    this.musicOn = !!on;
    this.applyGains();
  }

  setSfx(on) {
    this.sfxOn = !!on;
    this.applyGains();
  }

  get muted() {
    return this.mutes.sdk || this.mutes.ad || this.mutes.hidden;
  }

  applyGains(instant) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const set = (param, v) => {
      param.cancelScheduledValues(t);
      if (instant) param.setValueAtTime(v, t);
      else param.setTargetAtTime(v, t, 0.05);
    };
    set(this.master.gain, this.muted ? 0 : 0.9);
    set(this.musicBus.gain, this.musicOn ? 0.55 : 0);
    set(this.sfxBus.gain, this.sfxOn ? 0.9 : 0);
  }

  // ---------------- continuous loops (wind, sizzle)
  startLoops() {
    const ctx = this.ctx;
    const mk = (type, freq, q) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.sfxBus);
      src.start();
      return { f, g };
    };
    this.windLoop = mk('lowpass', 420, 0.7);
    this.sizzleLoop = mk('bandpass', 3800, 1.2);
    this.airLoop = mk('bandpass', 900, 0.4); // soft falling "air" bed
  }

  setLoops(wind, sizzle, air) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.windLoop.g.gain.setTargetAtTime(Math.min(0.32, wind * 0.32), t, 0.15);
    this.windLoop.f.frequency.setTargetAtTime(300 + wind * 500, t, 0.2);
    this.sizzleLoop.g.gain.setTargetAtTime(Math.min(0.14, sizzle * 0.14), t, 0.05);
    this.airLoop.g.gain.setTargetAtTime(air * 0.035, t, 0.4);
  }

  // ---------------- primitives
  bell(freq, when, dur = 1.4, vol = 0.12, wet = 0.6, bus) {
    const ctx = this.ctx;
    const out = bus || this.sfxBus;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(vol, when + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    const o1 = ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = freq * 2.756; // inharmonic partial -> glassy bell
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(vol * 0.35, when);
    g2.gain.exponentialRampToValueAtTime(0.0001, when + dur * 0.35);
    o1.connect(g);
    o2.connect(g2).connect(g);
    g.connect(out);
    if (wet > 0) {
      const s = ctx.createGain();
      s.gain.value = wet;
      g.connect(s).connect(this.reverbSend);
    }
    o1.start(when);
    o2.start(when);
    o1.stop(when + dur + 0.05);
    o2.stop(when + dur + 0.05);
  }

  noiseBurst(when, dur, type, freq, vol, q = 1, sweepTo) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, when);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, when + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(vol, when + Math.min(0.02, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(when, Math.random() * Math.max(0, 1.9 - dur));
    src.stop(when + dur + 0.05);
  }

  tone(freq, when, dur, type, vol, toFreq) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, when);
    if (toFreq) o.frequency.exponentialRampToValueAtTime(toFreq, when + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(vol, when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g).connect(this.sfxBus);
    o.start(when);
    o.stop(when + dur + 0.05);
  }

  throttle(name, sec) {
    const now = this.ctx.currentTime;
    if (this.lastSfx[name] && now - this.lastSfx[name] < sec) return false;
    this.lastSfx[name] = now;
    return true;
  }

  // ---------------- sound effects
  sfx(name, arg) {
    if (!this.ctx || this.muted || !this.sfxOn) return;
    const t = this.ctx.currentTime + 0.005;
    const root = this.musicCfg ? this.musicCfg.root : 62;
    switch (name) {
      case 'collect': {
        const c = arg || 0;
        const deg = c % 5, oct = Math.floor(c / 5) % 3;
        this.bell(mtof(root + 24 + PENTA[deg] + oct * 12), t, 0.9, 0.09, 0.5);
        break;
      }
      case 'golden':
        [0, 4, 7, 12, 16].forEach((d, i) => this.bell(mtof(root + 24 + d), t + i * 0.06, 1.6, 0.08, 0.8));
        break;
      case 'branch':
        if (this.throttle('branch', 0.12)) this.bell(mtof(root + 36 + PENTA[Math.floor(Math.random() * 5)]), t, 0.35, 0.025, 0.7);
        break;
      case 'zone':
        if (this.throttle('zone', 0.3)) this.noiseBurst(t, 0.7, 'bandpass', 600, 0.12, 0.8, 2400);
        break;
      case 'hit':
        this.noiseBurst(t, 0.18, 'highpass', 2500, 0.5, 0.7);
        this.tone(220, t, 0.25, 'triangle', 0.25, 70);
        [3100, 4170, 5230].forEach((f) => this.tone(f, t + 0.01, 0.35, 'sine', 0.05));
        break;
      case 'shield':
        this.bell(mtof(root + 31), t, 0.8, 0.14, 0.5);
        this.noiseBurst(t, 0.12, 'highpass', 4000, 0.15);
        break;
      case 'gust':
        if (this.throttle('gust', 0.8)) this.noiseBurst(t, 1.2, 'bandpass', 300, 0.22, 0.6, 1200);
        break;
      case 'land': {
        const perfect = !!arg;
        const ch = perfect ? [0, 4, 7, 11, 14, 19] : [0, 7, 12];
        ch.forEach((d, i) => this.bell(mtof(root + 12 + d), t + i * 0.09, 2.2, 0.1, 0.8));
        break;
      }
      case 'species':
        [0, 2, 4, 7, 9, 12, 14, 16, 19, 24].forEach((d, i) => this.bell(mtof(root + 12 + d), t + i * 0.07, 1.8, 0.07, 0.8));
        break;
      case 'fail':
        [12, 7, 3, 0].forEach((d, i) => this.bell(mtof(root + d), t + i * 0.16, 1.6, 0.1, 0.7));
        break;
      case 'revive':
        [0, 4, 7, 12, 16, 19, 24].forEach((d, i) => this.bell(mtof(root + 12 + d), t + i * 0.05, 1.4, 0.08, 0.8));
        this.noiseBurst(t, 0.8, 'bandpass', 800, 0.1, 0.6, 6000);
        break;
      case 'click':
        this.tone(1100, t, 0.06, 'sine', 0.06, 900);
        break;
      case 'buy':
        this.bell(mtof(root + 19), t, 0.7, 0.12, 0.4);
        this.bell(mtof(root + 26), t + 0.08, 0.9, 0.12, 0.5);
        break;
      case 'deny':
        this.tone(240, t, 0.12, 'triangle', 0.08, 180);
        break;
      case 'shutter':
        this.noiseBurst(t, 0.05, 'highpass', 3000, 0.3);
        this.noiseBurst(t + 0.08, 0.06, 'highpass', 2000, 0.25);
        break;
      default:
        break;
    }
  }

  // ---------------- generative music
  playMusic(cfg, density = 0.35) {
    if (!this.ensure()) return;
    this.musicCfg = cfg;
    this.density = density;
    if (this.musicTimer) return;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    this.step = 0;
    this.musicTimer = setInterval(() => this.schedule(), 90);
  }

  setIntensity(v) {
    this.intensity = v;
  }

  stopMusic() {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  schedule() {
    if (!this.ctx || !this.musicCfg) return;
    if (this.ctx.state !== 'running') {
      this.nextNoteTime = this.ctx.currentTime + 0.1;
      return;
    }
    const spb = 60 / 72 / 2; // eighth notes at 72 bpm
    const cfg = this.musicCfg;
    while (this.nextNoteTime < this.ctx.currentTime + 0.35) {
      const t = this.nextNoteTime;
      const bar = Math.floor(this.step / 8);
      const chord = cfg.chords[Math.floor(bar / 2) % cfg.chords.length];
      if (this.step % 16 === 0) this.pad(chord.map((d) => mtof(cfg.root - 12 + d)), t, spb * 16);
      const dens = this.density + this.intensity * 0.3;
      if (Math.random() < dens) {
        const pool = chord.concat(PENTA.map((p) => p + 12));
        const d = pool[Math.floor(Math.random() * pool.length)];
        const oct = Math.random() < 0.3 ? 24 : 12;
        this.bell(mtof(cfg.root + oct + d), t, 2.2, 0.045, 0.9, this.musicBus);
      }
      this.nextNoteTime += spb;
      this.step++;
    }
  }

  pad(freqs, when, dur) {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.05, when + 2.2);
    g.gain.setValueAtTime(0.05, when + dur - 1.5);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur + 1.8);
    f.connect(g).connect(this.musicBus);
    const s = ctx.createGain();
    s.gain.value = 0.5;
    g.connect(s).connect(this.reverbSend);
    for (const fr of freqs) {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = fr;
        o.detune.value = det;
        o.connect(f);
        o.start(when);
        o.stop(when + dur + 2);
      }
    }
  }
}

export const audio = new AudioEngine();
