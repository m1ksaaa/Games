// One fall ("run"): world generation, simulation and rendering.
//
// Coordinates: x in [0, PF] (playfield, logical units), y grows downwards in world space.
// The camera follows the flake; near the end it stops so the ground comes into view.

import { Crystal, CrystalSprite } from './crystal.js';
import { AIR } from './skies.js';
import { classify, beautyScore } from './species.js';
import { mulberry32, clamp, lerp, smooth, pickWeighted, TAU, rgba, mixHex } from './util.js';
import { glowSprite, mistSprite } from './sprites.js';

export const PF = 760;
export const BASE_VIEW_H = 1000;
const ANCHOR = 0.3;
const CHUNK = 620;
const GROUND_ZONE = 1750; // no regular weather this close to the ground

export const LANDING = {
  velvet: { mult: 2, label: 'PERFECT PHOTO' },
  mitten: { mult: 1.5, label: 'MITTEN CATCH' },
  snow: { mult: 1, label: 'SOFT LANDING' },
  warm: { mult: 0.6, label: 'TOO WARM...' },
};

export class Run {
  constructor(sky, up, opts = {}) {
    this.sky = sky;
    this.up = up;
    this.seed = opts.seed != null ? opts.seed : (Math.random() * 1e9) | 0;
    this.rng = mulberry32(this.seed);
    this.length = Math.round(sky.length * (1 + 0.12 * (up.high || 0)));
    this.groundY = this.length;
    this.crystal = new Crystal();
    this.sprite = new CrystalSprite();
    this.f = { x: PF / 2, y: -60, vx: 0, rot: Math.random() * TAU, inv: 0, shields: up.armor || 0, hitR: 11, dispR: 19 };
    this.zones = [];
    this.motes = [];
    this.hazards = [];
    this.gusts = [];
    this.ribbons = [];
    this.parts = [];
    this.zid = 0;
    this.genY = 420;
    this.chunkIdx = 0;
    this.state = 'fall'; // fall | final | landed | failed
    this.t = 0;
    this.endT = 0;
    this.boost = 0;
    this.combo = 0;
    this.comboT = 0;
    this.events = [];
    this.habit = 'Y';
    this.q = 0.3;
    this.zoneId = 0;
    this.wind = 0;
    this.meltLevel = 0;
    this.viewH = BASE_VIEW_H;
    this.camY = this.f.y - ANCHOR * BASE_VIEW_H;
    this.revived = false;
    this.twinSpawned = false;
    this.landed = null;
    this.failReason = null;
    this.shake = 0;
    this.estimate = 'hex';
    this.estT = 0;
    this.stats = { motes: 0, hits: 0, branches: 0 };
    this.buildGround();
    this.buildDecor();
  }

  get progress() {
    return clamp(this.f.y / this.groundY, 0, 1);
  }

  speed() {
    return this.sky.speed * (1 + 0.16 * this.progress);
  }

  // ---------------------------------------------------------------- generation
  genChunk() {
    const rng = this.rng;
    const sky = this.sky;
    const y0 = this.genY;
    const idx = this.chunkIdx++;
    this.genY += CHUNK;
    const prog = y0 / this.groundY;
    const nearGround = y0 > this.groundY - GROUND_ZONE;

    if (!nearGround) {
      const n = 1 + (rng() < 0.72 ? 1 : 0) + (rng() < 0.15 + prog * 0.25 ? 1 : 0);
      let warm = 0;
      for (let i = 0; i < n; i++) {
        const w = { ...sky.zones };
        if (idx < 3) w.W = 0;
        w.W *= 0.6 + prog;
        if (warm >= (prog < 0.5 ? 1 : 2)) w.W = 0;
        if (idx < 1) w.R = 0;
        const type = pickWeighted(rng, w) || 'D';
        const isW = type === 'W';
        const rx = isW ? 80 + rng() * 70 : 120 + rng() * 115;
        const ry = isW ? 110 + rng() * 100 : 150 + rng() * 160;
        let x = 0, y = 0, ok = false;
        for (let tries = 0; tries < 10 && !ok; tries++) {
          x = rx * 0.45 + rng() * (PF - rx * 0.9);
          y = y0 + rng() * CHUNK;
          ok = true;
          for (let j = Math.max(0, this.zones.length - 8); j < this.zones.length; j++) {
            const p = this.zones[j];
            const dx = (p.x - x) / (p.rx + rx), dy = (p.y - y) / (p.ry + ry);
            if (dx * dx + dy * dy < 0.4) { ok = false; break; }
          }
        }
        if (!ok) continue;
        const z = { id: ++this.zid, type, x, y, rx, ry, power: isW ? 1 : 0.86 + rng() * 0.14, ph: rng() * TAU };
        this.zones.push(z);
        if (isW) warm++;
        else if (rng() < 0.75) this.moteTrail(z);
      }
    }

    const ns = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < ns; i++) this.motes.push({ x: 40 + rng() * (PF - 80), y: y0 + rng() * CHUNK, ph: rng() * TAU, type: 'vapor' });

    if (!nearGround && idx >= 2) {
      const diff = 0.6 + prog * 0.9;
      if (rng() < sky.birds * diff) this.spawnBird(y0 + rng() * CHUNK);
      if (rng() < sky.birds * diff * 0.35) this.spawnBird(y0 + rng() * CHUNK);
      if (rng() < sky.drones * diff) this.spawnDrone(y0 + rng() * CHUNK);
      if (rng() < sky.lanterns * diff) this.spawnLantern(y0 + rng() * CHUNK);
      if (rng() < sky.wind * (0.5 + prog)) {
        this.gusts.push({ y: y0 + rng() * CHUNK, h: 200 + rng() * 160, force: (rng() < 0.5 ? -1 : 1) * (150 + rng() * 120), ph: rng() * TAU, warned: false });
      }
    }
    if (sky.aurora && !nearGround && idx >= 1 && rng() < sky.aurora) {
      this.ribbons.push({ y: y0 + rng() * CHUNK, h: 70 + rng() * 40, amp: 50 + rng() * 60, freq: 0.006 + rng() * 0.006, ph: rng() * TAU, hue: rng() });
    }
    if (!this.twinSpawned && idx >= 3 && prog < 0.45) {
      const p = sky.twin >= 1 ? 1 : sky.twin;
      if (rng() < p) {
        this.twinSpawned = true;
        this.motes.push({ x: 90 + rng() * (PF - 180), y: y0 + rng() * CHUNK, ph: 0, type: 'twin' });
      }
    }
  }

  moteTrail(z) {
    const rng = this.rng;
    const n = 5 + Math.floor(rng() * 5);
    const x0 = z.x + (rng() - 0.5) * z.rx * 1.6;
    const x1 = z.x + (rng() - 0.5) * z.rx * 0.4;
    const ya = z.y - z.ry * 0.95, yb = z.y + z.ry * 0.5;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      this.motes.push({ x: clamp(lerp(x0, x1, smooth(t)), 30, PF - 30), y: lerp(ya, yb, t), ph: rng() * TAU, type: 'vapor' });
    }
  }

  spawnBird(y) {
    const rng = this.rng;
    const left = rng() < 0.5;
    const eagle = this.sky.id === 'peaks' && rng() < 0.55;
    const sp = eagle ? 190 + rng() * 80 : 105 + rng() * 75;
    this.hazards.push({ type: eagle ? 'eagle' : 'bird', x: left ? -70 : PF + 70, y, vx: left ? sp : -sp, r: eagle ? 21 : 15, ph: rng() * TAU, amp: 25 + rng() * 30, entered: false });
  }

  spawnDrone(y) {
    const rng = this.rng;
    this.hazards.push({ type: 'drone', x: 70 + rng() * (PF - 140), y, vx: (rng() < 0.5 ? -1 : 1) * (60 + rng() * 70), r: 16, ph: rng() * TAU, entered: true });
  }

  spawnLantern(y) {
    const rng = this.rng;
    this.hazards.push({ type: 'lantern', id: ++this.zid, x: 70 + rng() * (PF - 140), y, vy: -(26 + rng() * 22), r: 11, warmR: 64, ph: rng() * TAU, entered: true });
  }

  buildGround() {
    const rng = this.rng;
    const G = this.groundY;
    const kind = this.sky.ground;
    this.surfaces = [];
    this.groundItems = [];
    const taken = [];
    const free = (x, w) => taken.every(([a, b]) => x + w / 2 < a - 26 || x - w / 2 > b + 26);
    const place = (w, tries = 40) => {
      for (let i = 0; i < tries; i++) {
        const x = 70 + w / 2 + rng() * (PF - 140 - w);
        if (free(x, w)) { taken.push([x - w / 2, x + w / 2]); return x; }
      }
      return -1;
    };
    // the photographer's black velvet board (best landing)
    const bx = place(124);
    this.surfaces.push({ type: 'velvet', x0: bx - 62, x1: bx + 62, y: G - 64 });
    this.groundItems.push({ kind: 'board', x: bx, y: G - 64, w: 124 });
    // a child holding up a dark mitten
    const mx = place(70);
    if (mx > 0) {
      this.surfaces.push({ type: 'mitten', x0: mx - 30, x1: mx + 30, y: G - 128 });
      this.groundItems.push({ kind: 'kid', x: mx, y: G - 128 });
    }
    // warm spots (chimneys, vents, campfires) with rising warm air
    const warmN = kind === 'peaks' ? 1 : 2;
    for (let i = 0; i < warmN; i++) {
      const wx = place(56);
      if (wx < 0) continue;
      const top = kind === 'village' ? G - 170 - rng() * 50 : kind === 'city' ? G - 210 - rng() * 60 : G - 34;
      this.surfaces.push({ type: 'warm', x0: wx - 24, x1: wx + 24, y: top });
      this.groundItems.push({ kind: kind === 'village' ? 'chimney' : kind === 'city' ? 'vent' : 'fire', x: wx, y: top });
      this.zones.push({ id: ++this.zid, type: 'W', x: wx, y: top - 230, rx: 46, ry: 250, power: 0.9, ph: rng() * TAU, smoke: true });
    }
  }

  buildDecor() {
    // background silhouettes beyond and behind the playfield (purely visual)
    const rng = this.rng;
    const kind = this.sky.ground;
    this.decor = [];
    for (let x = -900; x < PF + 900; ) {
      const w = kind === 'city' ? 70 + rng() * 90 : 60 + rng() * 80;
      const h = kind === 'city' ? 160 + rng() * 260 : kind === 'peaks' ? 60 + rng() * 120 : 70 + rng() * 60;
      const type = kind === 'village' ? (rng() < 0.55 ? 'house' : 'tree') : kind === 'city' ? 'tower' : kind === 'peaks' ? 'pine' : rng() < 0.15 ? 'tent' : 'pine';
      this.decor.push({ type, x, w, h, seed: rng() });
      x += w * (0.75 + rng() * 0.6);
    }
    this.stars = [];
    for (let i = 0; i < 90; i++) this.stars.push({ x: rng(), y: rng(), r: 0.5 + rng() * 1.3, tw: rng() * TAU });
    this.snow = [];
    for (let i = 0; i < 70; i++) this.snow.push({ x: rng(), y: rng(), r: 0.8 + rng() * 2.2, z: 0.3 + rng() * 0.9, ph: rng() * TAU });
  }

  // ---------------------------------------------------------------- simulation
  update(dt, steer, viewH) {
    this.viewH = viewH;
    this.updateParticles(dt);
    this.shake = Math.max(0, this.shake - dt * 3);
    if (this.state === 'landed' || this.state === 'failed') {
      this.endT += dt;
      return;
    }
    this.t += dt;
    const f = this.f, c = this.crystal, up = this.up;
    f.dispR = 17 + c.radius * 0.5;
    f.hitR = f.dispR * 0.58;

    while (this.genY < this.camY + viewH + 520 && this.genY < this.groundY - 150) this.genChunk();

    // steering
    const maxV = 470 * (1 + 0.12 * (up.agility || 0));
    const desired = steer.mode === 'target' ? clamp((steer.x - f.x) * 8, -maxV, maxV) : steer.dir * maxV;
    f.vx += (desired - f.vx) * Math.min(1, dt * (steer.mode === 'target' ? 14 : 9));

    // wind gusts
    let wind = 0;
    for (const g of this.gusts) {
      const d = Math.abs(f.y - g.y);
      if (d < g.h / 2) wind += g.force * smooth(1 - d / (g.h / 2));
      if (!g.warned && g.y - f.y < 420 && g.y > f.y) { g.warned = true; this.events.push({ t: 'gust' }); }
    }
    this.wind = wind;
    f.x += (f.vx + wind) * dt;
    const m = f.hitR + 4;
    if (f.x < m) { f.x = m; if (f.vx < 0) f.vx = 0; }
    if (f.x > PF - m) { f.x = PF - m; if (f.vx > 0) f.vx = 0; }
    f.rot += dt * (0.22 + f.vx * 0.0011);
    if (f.inv > 0) f.inv -= dt;

    const prevY = f.y;
    f.y += this.speed() * dt;
    const camMax = this.groundY + 70 - viewH;
    this.camY = Math.min(f.y - ANCHOR * viewH, camMax);
    if (this.state === 'fall' && this.camY >= camMax - 0.5) {
      this.state = 'final';
      this.events.push({ t: 'final' });
    }

    this.sampleAir();
    if (this.habit === 'W') {
      const mr = this.q * 6.5 * (1 - 0.14 * (up.frost || 0));
      c.melt(mr * dt);
      this.meltLevel = this.q;
      if (Math.random() < dt * 14) this.parts.push({ kind: 'drop', x: f.x + (Math.random() - 0.5) * f.dispR, y: f.y + f.dispR * 0.3, vx: 0, vy: 60, life: 0.8, max: 0.8, r: 2 + Math.random() * 2 });
      if (c.melted) { this.fail('melt'); return; }
    } else {
      this.meltLevel = 0;
      const nb = c.grow(dt, this.habit, this.q, this.boost);
      if (nb) {
        this.stats.branches += nb;
        this.events.push({ t: 'branch' });
        this.sparkle(f.x, f.y, 4, AIR.D.color, f.dispR);
      }
    }
    // aurora ribbons: shimmering boost
    for (const rb of this.ribbons) {
      const cy = rb.y + Math.sin(f.x * rb.freq + rb.ph + this.t * 0.6) * rb.amp;
      if (Math.abs(f.y - cy) < rb.h / 2) {
        this.boost = Math.min(2.6, this.boost + dt * 2.2);
        if (Math.random() < dt * 20) this.sparkle(f.x, f.y, 1, rb.hue < 0.5 ? '#7dffb2' : '#c48bff', f.dispR);
      }
    }
    this.boost = Math.max(0, this.boost - dt * 0.55);
    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.combo = 0;
    }

    this.updateMotes(dt);
    this.updateHazards(dt);
    this.cleanup();

    this.estT -= dt;
    if (this.estT <= 0) {
      this.estT = 0.35;
      this.estimate = classify(c.stats());
    }
    this.checkLanding(prevY);
  }

  sampleAir() {
    const f = this.f;
    let best = null, bq = 0;
    for (const z of this.zones) {
      const dx = (f.x - z.x) / z.rx, dy = (f.y - z.y) / z.ry;
      const d2 = dx * dx + dy * dy;
      if (d2 < 1) {
        let q = Math.pow(1 - d2, 0.6) * z.power;
        if (z.type === 'W') q *= 1.15; // warm air wins when overlapping
        if (q > bq) { bq = q; best = z; }
      }
    }
    for (const h of this.hazards) {
      if (h.type !== 'lantern') continue;
      const d = Math.hypot(f.x - h.x, f.y - h.y) - f.hitR * 0.5;
      if (d < h.warmR) {
        const q = 0.35 + 0.75 * (1 - d / h.warmR);
        if (q > bq) { bq = q; best = { id: h.id, type: 'W' }; }
      }
    }
    const prev = this.habit;
    if (best) {
      this.habit = best.type;
      this.q = clamp(bq, 0, 1);
      if (best.id !== this.zoneId) {
        this.zoneId = best.id;
        this.events.push({ t: 'zone', habit: best.type, fresh: prev !== best.type });
      }
    } else {
      this.habit = 'Y';
      this.q = 0.3;
      this.zoneId = 0;
    }
  }

  updateMotes(dt) {
    const f = this.f;
    const pullR = f.hitR + 34 + (this.up.magnet || 0) * 16;
    for (const m of this.motes) {
      if (m.dead) continue;
      m.ph += dt * 2;
      const dx = f.x - m.x, dy = f.y - m.y;
      const d = Math.hypot(dx, dy) || 0.001;
      if (d < pullR) {
        const k = Math.min(d, (1 - d / pullR) * 1100 * dt + 60 * dt);
        m.x += (dx / d) * k;
        m.y += (dy / d) * k;
      }
      if (d < f.hitR + 9) this.collect(m);
    }
  }

  collect(m) {
    const f = this.f, c = this.crystal;
    m.dead = true;
    if (m.type === 'twin') {
      if (this.progress < 0.55) c.twin = true;
      this.boost = 2.6;
      this.events.push({ t: 'twin', ok: c.twin });
      this.burst(m.x, m.y, 26, '#ffd36b');
      return;
    }
    this.stats.motes++;
    this.boost = Math.min(2.2, this.boost + 0.24);
    this.combo++;
    this.comboT = 1.3;
    if (this.habit !== 'W') c.grow(0.14, this.habit, Math.max(this.q, 0.5), this.boost);
    this.events.push({ t: 'collect', combo: this.combo });
    this.sparkle(m.x, m.y, 5, '#bfe9ff', 4);
    this.parts.push({ kind: 'ring', x: f.x, y: f.y, vx: 0, vy: 0, life: 0.35, max: 0.35, r: f.dispR * 0.9, color: '#bfe9ff' });
  }

  updateHazards(dt) {
    const f = this.f;
    for (const h of this.hazards) {
      h.ph += dt;
      if (h.type === 'bird' || h.type === 'eagle') {
        h.x += h.vx * dt;
        h.y += Math.cos(h.ph * 2.2) * h.amp * dt;
      } else if (h.type === 'drone') {
        h.x += h.vx * dt;
        h.y += Math.sin(h.ph * 3) * 18 * dt;
        if (h.x < 40 && h.vx < 0) h.vx = -h.vx;
        if (h.x > PF - 40 && h.vx > 0) h.vx = -h.vx;
      } else if (h.type === 'lantern') {
        h.y += h.vy * dt;
        h.x += Math.sin(h.ph * 0.9) * 14 * dt;
        continue; // lanterns melt via sampleAir instead of breaking arms
      }
      if (h.dead) continue;
      if (f.inv <= 0 && Math.hypot(f.x - h.x, f.y - h.y) < f.hitR + h.r) this.hit(h);
    }
  }

  hit(h) {
    const f = this.f, c = this.crystal;
    this.stats.hits++;
    f.inv = 1.1;
    this.shake = 1;
    f.vx = (Math.sign(f.x - h.x) || 1) * 380;
    if (f.shields > 0) {
      f.shields--;
      this.events.push({ t: 'shield' });
      this.parts.push({ kind: 'ring', x: f.x, y: f.y, vx: 0, vy: 0, life: 0.5, max: 0.5, r: f.dispR * 1.6, color: '#7fd8ff' });
      return;
    }
    const ang = Math.atan2(h.y - f.y, h.x - f.x);
    let k = Math.round((ang - f.rot + Math.PI / 2) / (Math.PI / 3));
    k = ((k % 6) + 6) % 6;
    if (c.cuts[k] !== Infinity) {
      const order = [1, -1, 2, -2, 3];
      let found = -1;
      for (const o of order) {
        const j = (k + o + 6) % 6;
        if (c.cuts[j] === Infinity) { found = j; break; }
      }
      if (found < 0) { this.fail('shatter'); return; }
      k = found;
    }
    c.breakArm(k, 0.35 + Math.random() * 0.3);
    const a = f.rot + k * (Math.PI / 3) - Math.PI / 2;
    for (let i = 0; i < 9; i++) {
      const sp = 120 + Math.random() * 200;
      const aa = a + (Math.random() - 0.5) * 0.9;
      this.parts.push({ kind: 'shard', x: f.x + Math.cos(a) * f.dispR * 0.6, y: f.y + Math.sin(a) * f.dispR * 0.6, vx: Math.cos(aa) * sp, vy: Math.sin(aa) * sp, life: 0.9, max: 0.9, r: 2 + Math.random() * 3, rot: Math.random() * TAU });
    }
    this.events.push({ t: 'hit', arms: c.armsIntact });
    if (c.armsIntact === 0) this.fail('shatter');
  }

  fail(reason) {
    if (this.state === 'failed') return;
    this.state = 'failed';
    this.failReason = reason;
    this.endT = 0;
    this.events.push({ t: 'fail', reason });
    const f = this.f;
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * TAU, sp = 60 + Math.random() * 220;
      this.parts.push(
        reason === 'melt'
          ? { kind: 'drop', x: f.x, y: f.y, vx: Math.cos(a) * sp * 0.4, vy: Math.sin(a) * sp * 0.3 + 40, life: 1.2, max: 1.2, r: 2 + Math.random() * 3 }
          : { kind: 'shard', x: f.x, y: f.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1.1, max: 1.1, r: 2 + Math.random() * 3, rot: Math.random() * TAU }
      );
    }
  }

  revive() {
    const c = this.crystal, f = this.f;
    this.revived = true;
    c.repair();
    f.inv = 2.5;
    const camMax = this.groundY + 70 - this.viewH;
    this.state = this.camY >= camMax - 0.5 ? 'final' : 'fall';
    // clear the immediate danger around the flake
    this.hazards = this.hazards.filter((h) => Math.abs(h.y - f.y) > 700);
    this.zones = this.zones.filter((z) => !(z.type === 'W' && !z.smoke && Math.abs(z.y - f.y) < 700));
    this.zoneId = 0;
    this.burst(f.x, f.y, 30, '#9fe6ff');
    this.events.push({ t: 'revive' });
  }

  checkLanding(prevY) {
    const f = this.f;
    const foot = f.hitR * 0.55;
    for (const s of this.surfaces) {
      if (f.x >= s.x0 && f.x <= s.x1 && f.y + foot >= s.y && prevY + foot <= s.y + 2) {
        this.land(s);
        return;
      }
    }
    if (f.y + foot >= this.groundY) this.land({ type: 'snow', y: this.groundY });
  }

  land(s) {
    const f = this.f, c = this.crystal;
    this.state = 'landed';
    this.landed = s;
    this.endT = 0;
    f.y = s.y - f.hitR * 0.55;
    if (s.type === 'warm') c.melt(Math.min(c.len * 0.35, 12));
    this.burst(f.x, f.y, s.type === 'velvet' ? 30 : 14, s.type === 'warm' ? '#ff9a5c' : '#dff4ff');
    this.events.push({ t: 'land', surface: s.type });
  }

  result() {
    const st = this.crystal.stats();
    const species = classify(st);
    const surface = this.landed ? this.landed.type : null;
    const mult = surface ? LANDING[surface].mult : 0.35;
    return { st, species, surface, mult, score: beautyScore(st, mult), failed: !this.landed, reason: this.failReason };
  }

  cleanup() {
    const top = this.camY - 380;
    const keep = (o) => o.y > top;
    if (this.motes.length > 60) this.motes = this.motes.filter((m) => !m.dead && keep(m));
    this.zones = this.zones.filter((z) => z.y + z.ry > top);
    this.hazards = this.hazards.filter((h) => {
      if (h.y < top - 200) return false;
      if (h.type === 'bird' || h.type === 'eagle') {
        if (h.vx > 0 && h.x > PF + 140) return false;
        if (h.vx < 0 && h.x < -140) return false;
      }
      return true;
    });
    this.gusts = this.gusts.filter((g) => g.y + g.h > top);
    this.ribbons = this.ribbons.filter((r) => r.y + r.amp + r.h > top);
  }

  sparkle(x, y, n, color, spread) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const r = Math.random() * spread;
      this.parts.push({ kind: 'spark', x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, vx: Math.cos(a) * 30, vy: Math.sin(a) * 30 - 20, life: 0.6, max: 0.6, r: 5 + Math.random() * 6, color });
    }
  }

  burst(x, y, n, color) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, sp = 60 + Math.random() * 260;
      this.parts.push({ kind: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.9, max: 0.9, r: 6 + Math.random() * 8, color });
    }
  }

  updateParticles(dt) {
    for (const p of this.parts) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'drop') p.vy += 500 * dt;
      else if (p.kind === 'shard') { p.vy += 300 * dt; p.rot += dt * 8; }
      else { p.vx *= 1 - dt * 2; p.vy *= 1 - dt * 2; }
    }
    if (this.parts.length) this.parts = this.parts.filter((p) => p.life > 0);
    if (this.parts.length > 400) this.parts.splice(0, this.parts.length - 400);
  }

  hud() {
    const f = this.f;
    const air = AIR[this.habit];
    const alt = Math.max(0, Math.round((1 - this.progress) * this.sky.alt * (1 + 0.12 * (this.up.high || 0))));
    const qT = this.habit === 'Y' ? 0 : this.q;
    return {
      alt,
      temp: air.temp,
      hum: Math.round(lerp(AIR.Y.hum, air.hum, qT)),
      air: air.name,
      habit: this.habit,
      q: this.q,
      progress: this.progress,
      arms: this.crystal.armsIntact,
      shields: f.shields,
      score: beautyScore(this.crystal.stats(), 1),
      estimate: this.estimate,
      combo: this.combo,
      boost: this.boost,
      twin: this.crystal.twin,
    };
  }

  // ---------------------------------------------------------------- rendering
  draw(ctx, V) {
    const sky = this.sky;
    const sx = (Math.random() - 0.5) * this.shake * 10;
    const sy = (Math.random() - 0.5) * this.shake * 10;
    ctx.setTransform(V.dpr * V.s, 0, 0, V.dpr * V.s, V.dpr * (V.ox + sx * V.s), V.dpr * sy * V.s);
    const xl = -V.ox / V.s - 20, xr = xl + V.visW + 40;
    this.drawBackground(ctx, xl, xr, V);
    ctx.save();
    ctx.translate(0, -this.camY);
    this.drawGroundBack(ctx, xl, xr);
    // weather and hazards live inside the playfield only
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, this.camY - 200, PF, this.viewH + 400);
    ctx.clip();
    this.drawZones(ctx, V);
    this.drawRibbons(ctx);
    this.drawGusts(ctx);
    ctx.restore();
    this.drawGroundFront(ctx, xl, xr, V);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, this.camY - 200, PF, this.viewH + 400);
    ctx.clip();
    this.drawMotes(ctx);
    this.drawHazards(ctx);
    ctx.restore();
    this.drawFlake(ctx, V);
    this.drawParticles(ctx);
    ctx.restore();
    this.drawForeground(ctx, xl, xr, V);
  }

  drawBackground(ctx, xl, xr, V) {
    const c = this.sky.colors;
    const p = this.progress;
    const H = this.viewH;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, mixHex(c.top, c.mid, p * 0.8));
    g.addColorStop(1, mixHex(c.mid, c.bottom, 0.25 + p * 0.75));
    ctx.fillStyle = g;
    ctx.fillRect(xl, 0, xr - xl, H);
    // stars, fading out as we descend into the clouds
    const starA = 0.85 * (1 - p * 0.7);
    if (starA > 0.05) {
      ctx.fillStyle = '#ffffff';
      const w = xr - xl;
      for (const s of this.stars) {
        const y = ((s.y * H - this.camY * 0.02) % H + H) % H;
        ctx.globalAlpha = starA * (0.45 + 0.55 * Math.sin(this.t * 1.5 + s.tw) ** 2);
        ctx.fillRect(xl + s.x * w, y, s.r, s.r);
      }
      ctx.globalAlpha = 1;
    }
    // far haze blobs
    const haze = glowSprite(c.far, 128);
    ctx.globalAlpha = 0.18;
    for (let i = 0; i < 6; i++) {
      const y = (((i * 380 - this.camY * 0.12) % 2280) + 2280) % 2280 - 300;
      const x = xl + ((i * 0.37 + 0.1) % 1) * (xr - xl);
      ctx.drawImage(haze, x - 420, y - 160, 840, 320);
    }
    ctx.globalAlpha = 1;
    // background snow (slow layer)
    const w = xr - xl;
    ctx.fillStyle = '#dbe9ff';
    for (const s of this.snow) {
      if (s.z > 0.7) continue;
      const y = ((s.y * (H + 40) - this.camY * s.z * 0.5 + this.t * 20 * s.z) % (H + 40) + H + 40) % (H + 40) - 20;
      const x = xl + ((s.x * w + Math.sin(this.t * 0.6 + s.ph) * 14) % w + w) % w;
      ctx.globalAlpha = 0.25 + s.z * 0.35;
      ctx.beginPath();
      ctx.arc(x, y, s.r * s.z, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawZones(ctx) {
    const top = this.camY - 50, bot = this.camY + this.viewH + 50;
    for (const z of this.zones) {
      if (z.y + z.ry * 1.2 < top || z.y - z.ry * 1.2 > bot) continue;
      const air = AIR[z.type];
      const breathe = 1 + Math.sin(this.t * 1.3 + z.ph) * 0.035;
      const rx = z.rx * 1.18 * breathe, ry = z.ry * 1.18 * breathe;
      const spr = mistSprite(air.color, 256);
      ctx.globalAlpha = z.smoke ? 0.55 : 0.9;
      ctx.drawImage(spr, z.x - rx, z.y - ry, rx * 2, ry * 2);
      if (z.type === 'D' || z.type === 'W') {
        // brighter heart
        ctx.globalAlpha = z.type === 'D' ? 0.35 : 0.3;
        const g = glowSprite(z.type === 'D' ? '#a8e6ff' : '#ffb27a', 128);
        ctx.drawImage(g, z.x - rx * 0.45, z.y - ry * 0.45, rx * 0.9, ry * 0.9);
      }
      ctx.globalAlpha = 1;
      this.drawZoneDetail(ctx, z, air);
    }
  }

  drawZoneDetail(ctx, z, air) {
    const t = this.t;
    ctx.save();
    ctx.translate(z.x, z.y);
    if (z.type === 'W') {
      // heat shimmer
      ctx.strokeStyle = 'rgba(255,190,140,0.35)';
      ctx.lineWidth = 2;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        const x0 = i * z.rx * 0.28;
        for (let k = 0; k <= 10; k++) {
          const yy = -z.ry * 0.6 + (k / 10) * z.ry * 1.2;
          const xx = x0 + Math.sin(yy * 0.05 - t * 4 + i) * 6;
          if (k === 0) ctx.moveTo(xx, yy);
          else ctx.lineTo(xx, yy);
        }
        ctx.stroke();
      }
    } else {
      // drifting sparkles
      ctx.fillStyle = '#ffffff';
      const n = z.type === 'R' ? 14 : 7;
      for (let i = 0; i < n; i++) {
        const a = z.ph * 10 + i * 2.39996 + t * (0.15 + (i % 3) * 0.05);
        const rr = (0.2 + ((i * 0.618) % 0.7)) ;
        const x = Math.cos(a) * z.rx * rr, y = Math.sin(a) * z.ry * rr;
        ctx.globalAlpha = 0.25 + 0.5 * Math.sin(t * 2 + i) ** 2;
        const s = z.type === 'R' ? 2.6 : 1.8;
        ctx.fillRect(x - s / 2, y - s / 2, s, s);
      }
      ctx.globalAlpha = 0.5;
      drawAirIcon(ctx, z.type, 16, '#ffffff');
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  drawRibbons(ctx) {
    if (!this.ribbons.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const rb of this.ribbons) {
      if (rb.y + rb.amp + rb.h < this.camY || rb.y - rb.amp - rb.h > this.camY + this.viewH) continue;
      const green = rb.hue < 0.5;
      const rgb = green ? '90,255,170' : '190,120,255';
      const yAt = (x) => rb.y + Math.sin(x * rb.freq + rb.ph + this.t * 0.6) * rb.amp;
      // curtain rays hanging from the ribbon
      ctx.lineWidth = 6;
      for (let x = 4; x <= PF; x += 14) {
        const cy = yAt(x);
        const a = 0.05 + 0.05 * Math.sin(x * 0.05 + this.t * 2.2) ** 2;
        ctx.strokeStyle = `rgba(${rgb},${a})`;
        ctx.beginPath();
        ctx.moveTo(x, cy - rb.h * 1.1);
        ctx.lineTo(x, cy + rb.h * 0.35);
        ctx.stroke();
      }
      // soft band + bright core
      for (const [w, a] of [[rb.h, 0.13], [rb.h * 0.45, 0.16], [3, 0.55]]) {
        ctx.lineWidth = w;
        ctx.strokeStyle = w === 3 ? `rgba(230,255,245,${a})` : `rgba(${rgb},${a})`;
        ctx.beginPath();
        for (let x = -10; x <= PF + 10; x += 12) {
          if (x === -10) ctx.moveTo(x, yAt(x));
          else ctx.lineTo(x, yAt(x));
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawGusts(ctx) {
    for (const g of this.gusts) {
      if (g.y + g.h < this.camY || g.y - g.h > this.camY + this.viewH) continue;
      const dir = Math.sign(g.force);
      ctx.strokeStyle = 'rgba(220,235,255,0.28)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 12; i++) {
        const span = PF + 300;
        const x = ((((this.t * Math.abs(g.force) * 1.6 + i * 131) % span) + span) % span) - 150;
        const xx = dir > 0 ? x : PF - x;
        const y = g.y + Math.sin(i * 1.7 + g.ph) * g.h * 0.38;
        ctx.moveTo(xx, y);
        ctx.lineTo(xx - dir * (40 + (i % 3) * 25), y);
      }
      ctx.stroke();
      // chevrons at the edges warn about the push direction
      ctx.fillStyle = 'rgba(220,235,255,0.35)';
      for (const ex of [26, PF - 26]) {
        ctx.save();
        ctx.translate(ex, g.y);
        ctx.scale(dir, 1);
        ctx.beginPath();
        ctx.moveTo(-8, -12);
        ctx.lineTo(6, 0);
        ctx.lineTo(-8, 12);
        ctx.lineTo(-3, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
  }

  drawMotes(ctx) {
    const top = this.camY - 30, bot = this.camY + this.viewH + 30;
    const glow = glowSprite('#bfe9ff', 64);
    const gold = glowSprite('#ffd36b', 128);
    for (const m of this.motes) {
      if (m.dead || m.y < top || m.y > bot) continue;
      if (m.type === 'twin') {
        const s = 46 + Math.sin(this.t * 5) * 8;
        ctx.drawImage(gold, m.x - s, m.y - s, s * 2, s * 2);
        ctx.save();
        ctx.translate(m.x, m.y);
        ctx.rotate(this.t * 1.5);
        drawStar(ctx, 12, '#fff3c4');
        ctx.rotate(Math.PI / 6);
        drawStar(ctx, 8, '#ffd36b');
        ctx.restore();
        continue;
      }
      const s = 10 + Math.sin(m.ph) * 2;
      ctx.drawImage(glow, m.x - s, m.y - s, s * 2, s * 2);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(m.x, m.y, 2.2, 0, TAU);
      ctx.fill();
    }
  }

  drawHazards(ctx) {
    const top = this.camY - 60, bot = this.camY + this.viewH + 60;
    for (const h of this.hazards) {
      if (h.y < top || h.y > bot) continue;
      ctx.save();
      ctx.translate(h.x, h.y);
      if (h.type === 'bird' || h.type === 'eagle') drawBird(ctx, h, this.t);
      else if (h.type === 'drone') drawDrone(ctx, h, this.t);
      else if (h.type === 'lantern') drawLantern(ctx, h, this.t);
      ctx.restore();
    }
  }

  drawFlake(ctx, V) {
    const f = this.f, c = this.crystal;
    if (this.state === 'failed' && this.failReason === 'shatter') return;
    if (this.state === 'failed' && this.failReason === 'melt') {
      // a sad little raindrop
      ctx.fillStyle = 'rgba(150,200,255,0.8)';
      ctx.beginPath();
      ctx.arc(f.x, f.y + this.endT * 40, 5, 0, TAU);
      ctx.fill();
      return;
    }
    const glowCol = this.meltLevel > 0 ? '#ff9a5c' : this.boost > 1.2 ? '#bff0ff' : '#7fc8ff';
    const g = glowSprite(glowCol, 128);
    const gr = f.dispR * (2 + this.boost * 0.25);
    ctx.globalAlpha = 0.28 + this.boost * 0.08 + this.meltLevel * 0.3;
    ctx.drawImage(g, f.x - gr, f.y - gr, gr * 2, gr * 2);
    ctx.globalAlpha = 1;
    const s = f.dispR / Math.max(1, c.radius);
    const style = this.meltLevel > 0 ? MELT_STYLE : null;
    this.sprite.update(c, s * V.s, V.dpr, V.dt, style || undefined);
    let alpha = 1;
    if (f.inv > 0 && this.state !== 'landed') alpha = 0.45 + 0.55 * (Math.sin(f.inv * 30) > 0 ? 1 : 0);
    this.sprite.draw(ctx, f.x, f.y, f.rot, alpha, 1 / V.s);
    // shields: thin hexagonal rings
    for (let i = 0; i < f.shields; i++) {
      ctx.strokeStyle = `rgba(127,216,255,${0.35 - i * 0.08})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const r = f.dispR + 6 + i * 5;
      for (let k = 0; k < 6; k++) {
        const a = k * (Math.PI / 3) + this.t * 0.4;
        const x = f.x + Math.cos(a) * r, y = f.y + Math.sin(a) * r;
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }

  drawParticles(ctx) {
    const spark = glowSprite('#dff4ff', 64);
    for (const p of this.parts) {
      const a = Math.max(0, p.life / p.max);
      if (p.kind === 'spark') {
        ctx.globalAlpha = a;
        const img = p.color ? glowSprite(p.color, 64) : spark;
        const s = p.r * (0.5 + a * 0.5);
        ctx.drawImage(img, p.x - s, p.y - s, s * 2, s * 2);
      } else if (p.kind === 'shard') {
        ctx.globalAlpha = a;
        ctx.fillStyle = '#e8f6ff';
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.beginPath();
        ctx.moveTo(0, -p.r);
        ctx.lineTo(p.r * 0.6, p.r);
        ctx.lineTo(-p.r * 0.6, p.r);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else if (p.kind === 'drop') {
        ctx.globalAlpha = a * 0.8;
        ctx.fillStyle = '#9fd0ff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, TAU);
        ctx.fill();
      } else if (p.kind === 'ring') {
        ctx.globalAlpha = a * 0.7;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (1.6 - a * 0.6), 0, TAU);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---- ground
  drawGroundBack(ctx, xl, xr) {
    const G = this.groundY;
    if (this.camY + this.viewH < G - 700) return;
    const col = this.sky.colors;
    // distant silhouettes (slight parallax)
    const par = (this.camY + this.viewH - (G - 700)) * 0.25;
    ctx.save();
    ctx.translate(0, 120 - par * 0.5);
    ctx.fillStyle = rgba(col.far, 0.55);
    ctx.beginPath();
    ctx.moveTo(xl, G);
    for (let x = xl; x <= xr; x += 60) {
      const h = 150 + Math.sin(x * 0.004 + this.seed) * 70 + Math.sin(x * 0.011) * 40;
      ctx.lineTo(x, G - h);
    }
    ctx.lineTo(xr, G);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    for (const d of this.decor) {
      if (d.x + d.w < xl || d.x > xr) continue;
      drawDecor(ctx, d, G, col, this.t);
    }
  }

  drawGroundFront(ctx, xl, xr, V) {
    const G = this.groundY;
    if (this.camY + this.viewH < G - 400) return;
    const col = this.sky.colors;
    for (const it of this.groundItems) drawGroundItem(ctx, it, G, col, this.t, this.state === 'final' || this.state === 'fall');
    // snowy ground
    const g = ctx.createLinearGradient(0, G - 10, 0, G + 120);
    g.addColorStop(0, '#e9f3ff');
    g.addColorStop(1, '#9fb4dd');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(xl, G + 200);
    ctx.lineTo(xl, G);
    for (let x = xl; x <= xr; x += 40) ctx.lineTo(x, G - 6 + Math.sin(x * 0.03) * 4);
    ctx.lineTo(xr, G + 200);
    ctx.closePath();
    ctx.fill();
    // landing guide
    if (this.state === 'final' || (this.state === 'fall' && this.camY + this.viewH > G - 200)) {
      const b = this.surfaces[0];
      const cx = (b.x0 + b.x1) / 2;
      const bob = Math.sin(this.t * 6) * 6;
      ctx.fillStyle = 'rgba(255,230,140,0.95)';
      for (let i = 0; i < 2; i++) {
        const y = b.y - 70 - i * 22 + bob;
        ctx.beginPath();
        ctx.moveTo(cx - 13, y - 8);
        ctx.lineTo(cx, y + 5);
        ctx.lineTo(cx + 13, y - 8);
        ctx.lineTo(cx + 13, y - 2);
        ctx.lineTo(cx, y + 11);
        ctx.lineTo(cx - 13, y - 2);
        ctx.closePath();
        ctx.globalAlpha = 0.5 + i * 0.4;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.font = '600 20px Fredoka, "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff1c2';
      ctx.fillText('PHOTO x2', cx, b.y - 112 + bob);
    }
  }

  drawForeground(ctx, xl, xr, V) {
    const H = this.viewH;
    const w = xr - xl;
    ctx.fillStyle = '#eef6ff';
    for (const s of this.snow) {
      if (s.z <= 0.7) continue;
      const y = ((s.y * (H + 60) - this.camY * s.z * 1.1 + this.t * 30) % (H + 60) + H + 60) % (H + 60) - 30;
      const x = xl + ((s.x * w + Math.sin(this.t * 0.8 + s.ph) * 20) % w + w) % w;
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.arc(x, y, s.r * 1.4, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // frosted edges of the playfield (only visible when there is room on the sides)
    if (V.ox > 4) {
      for (const [x0, dir] of [[0, -1], [PF, 1]]) {
        const g = ctx.createLinearGradient(x0, 0, x0 + dir * 60, 0);
        g.addColorStop(0, 'rgba(200,225,255,0.18)');
        g.addColorStop(1, 'rgba(200,225,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(Math.min(x0, x0 + dir * 60), 0, 60, H);
        ctx.fillStyle = 'rgba(220,238,255,0.35)';
        ctx.fillRect(x0 - 1, 0, 2, H);
      }
    }
    // warm vignette while melting / cold flash on hit
    if (this.meltLevel > 0 || this.shake > 0.2) {
      const g = ctx.createRadialGradient(PF / 2, H / 2, H * 0.3, PF / 2, H / 2, H * 0.85);
      const col = this.meltLevel > 0 ? `rgba(255,120,60,${0.25 * this.meltLevel})` : `rgba(160,220,255,${0.22 * this.shake})`;
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, col);
      ctx.fillStyle = g;
      ctx.fillRect(xl, 0, w, H);
    }
  }
}

const MELT_STYLE = {
  fill: 'rgba(170,205,255,0.28)',
  inner: 'rgba(200,225,255,0.35)',
  edge: 'rgba(205,228,255,0.85)',
  ridge: 'rgba(235,245,255,0.8)',
  glow: 'rgba(255,170,120,0.8)',
  glowBlur: 6,
  minLine: 1,
};

// ------------------------------------------------------------------ drawing helpers
export function drawAirIcon(ctx, type, r, color) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1.5, r * 0.12);
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (type === 'D') {
    for (let k = 0; k < 6; k++) {
      const a = k * (Math.PI / 3) - Math.PI / 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      ctx.moveTo(0, 0);
      ctx.lineTo(ca * r, sa * r);
      const bx = ca * r * 0.55, by = sa * r * 0.55;
      for (const s of [-1, 1]) {
        const b = a + s * (Math.PI / 3);
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + Math.cos(b) * r * 0.32, by + Math.sin(b) * r * 0.32);
      }
    }
    ctx.stroke();
  } else if (type === 'P') {
    for (let k = 0; k < 6; k++) {
      const a = k * (Math.PI / 3) - Math.PI / 2;
      if (k === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = k * (Math.PI / 3) - Math.PI / 2;
      if (k === 0) ctx.moveTo(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5);
      else ctx.lineTo(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5);
    }
    ctx.closePath();
    ctx.stroke();
  } else if (type === 'N') {
    for (let k = 0; k < 6; k++) {
      const a = k * (Math.PI / 3) - Math.PI / 2;
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * r * 1.15, Math.sin(a) * r * 1.15);
    }
    ctx.stroke();
  } else if (type === 'R') {
    for (const [x, y] of [[0, 0], [-0.6, -0.4], [0.6, -0.3], [-0.3, 0.6], [0.5, 0.5]]) {
      ctx.moveTo(x * r + r * 0.18, y * r);
      ctx.arc(x * r, y * r, r * 0.18, 0, TAU);
    }
    ctx.fill();
  } else if (type === 'W') {
    ctx.moveTo(0, -r);
    ctx.bezierCurveTo(r * 0.8, -r * 0.2, r * 0.6, r * 0.8, 0, r);
    ctx.bezierCurveTo(-r * 0.6, r * 0.8, -r * 0.8, -r * 0.2, 0, -r);
    ctx.fill();
  }
}

function drawStar(ctx, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    const rr = i % 2 === 0 ? r : r * 0.4;
    if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

function drawBird(ctx, h, t) {
  const big = h.type === 'eagle';
  const s = big ? 1.5 : 1;
  const flap = Math.sin(t * (big ? 7 : 11) + h.ph);
  ctx.scale(h.vx > 0 ? s : -s, s);
  ctx.fillStyle = big ? '#1b1626' : '#141a33';
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  // body
  ctx.beginPath();
  ctx.ellipse(0, 0, 13, 6, 0, 0, TAU);
  ctx.fill();
  // head + beak
  ctx.beginPath();
  ctx.arc(11, -3, 5, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#f2b04a';
  ctx.beginPath();
  ctx.moveTo(15, -4);
  ctx.lineTo(21, -2);
  ctx.lineTo(15, -1);
  ctx.closePath();
  ctx.fill();
  // wings
  ctx.fillStyle = big ? '#2a2236' : '#1d2547';
  ctx.beginPath();
  ctx.moveTo(-4, -2);
  ctx.quadraticCurveTo(-2, -16 * flap - 4, -16, -20 * flap - 2);
  ctx.quadraticCurveTo(-8, -6 * flap, 6, -1);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // tail
  ctx.fillStyle = big ? '#1b1626' : '#141a33';
  ctx.beginPath();
  ctx.moveTo(-12, -1);
  ctx.lineTo(-21, -5);
  ctx.lineTo(-20, 3);
  ctx.closePath();
  ctx.fill();
  // eye
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(12.5, -4, 1.3, 0, TAU);
  ctx.fill();
}

function drawDrone(ctx, h, t) {
  ctx.fillStyle = '#2a2f45';
  ctx.strokeStyle = '#8a93b8';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(-10, -5, 20, 10, 3) : ctx.rect(-10, -5, 20, 10);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-10, -3);
  ctx.lineTo(-18, -8);
  ctx.moveTo(10, -3);
  ctx.lineTo(18, -8);
  ctx.stroke();
  const spin = Math.abs(Math.sin(t * 40));
  ctx.fillStyle = 'rgba(200,210,240,0.6)';
  for (const x of [-18, 18]) {
    ctx.beginPath();
    ctx.ellipse(x, -9, 9 * spin + 2, 2, 0, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = Math.sin(t * 8 + h.ph) > 0 ? '#ff4d6a' : '#5affb0';
  ctx.beginPath();
  ctx.arc(0, 0, 2.2, 0, TAU);
  ctx.fill();
}

function drawLantern(ctx, h, t) {
  const g = glowSprite('#ff9a4a', 128);
  const fl = 1 + Math.sin(t * 9 + h.ph) * 0.06;
  ctx.globalAlpha = 0.55;
  ctx.drawImage(g, -h.warmR * fl, -h.warmR * fl, h.warmR * 2 * fl, h.warmR * 2 * fl);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#ffb35c';
  ctx.beginPath();
  ctx.moveTo(-9, -12);
  ctx.lineTo(9, -12);
  ctx.lineTo(7, 10);
  ctx.lineTo(-7, 10);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ffe2a6';
  ctx.fillRect(-4, -8, 8, 14);
  ctx.fillStyle = '#c4572a';
  ctx.fillRect(-7, 10, 14, 2);
}

function drawDecor(ctx, d, G, col, t) {
  const base = G + 8;
  if (d.type === 'house') {
    const w = d.w, h = d.h;
    ctx.fillStyle = col.ground;
    ctx.fillRect(d.x, base - h, w, h);
    ctx.beginPath();
    ctx.moveTo(d.x - 8, base - h);
    ctx.lineTo(d.x + w / 2, base - h - w * 0.45);
    ctx.lineTo(d.x + w + 8, base - h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(235,245,255,0.85)';
    ctx.beginPath();
    ctx.moveTo(d.x - 8, base - h);
    ctx.lineTo(d.x + w / 2, base - h - w * 0.45);
    ctx.lineTo(d.x + w + 8, base - h);
    ctx.lineTo(d.x + w + 2, base - h + 4);
    ctx.lineTo(d.x + w / 2, base - h - w * 0.45 + 6);
    ctx.lineTo(d.x - 2, base - h + 4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = d.seed > 0.3 ? '#ffd27a' : '#3b4570';
    ctx.fillRect(d.x + w * 0.2, base - h * 0.7, w * 0.22, h * 0.25);
    ctx.fillStyle = d.seed > 0.6 ? '#ffc864' : '#3b4570';
    ctx.fillRect(d.x + w * 0.58, base - h * 0.7, w * 0.22, h * 0.25);
  } else if (d.type === 'tree' || d.type === 'pine') {
    const w = d.w * 0.7, h = d.h * (d.type === 'pine' ? 1.6 : 1.3);
    const cx = d.x + d.w / 2;
    ctx.fillStyle = col.ground;
    for (let i = 0; i < 3; i++) {
      const yy = base - h * (0.25 + i * 0.28);
      const ww = w * (1 - i * 0.25);
      ctx.beginPath();
      ctx.moveTo(cx - ww / 2, yy + h * 0.2);
      ctx.lineTo(cx, yy - h * 0.25);
      ctx.lineTo(cx + ww / 2, yy + h * 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(235,245,255,0.6)';
      ctx.beginPath();
      ctx.moveTo(cx - ww * 0.25, yy - h * 0.02);
      ctx.lineTo(cx, yy - h * 0.25);
      ctx.lineTo(cx + ww * 0.25, yy - h * 0.02);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = col.ground;
    }
  } else if (d.type === 'tower') {
    ctx.fillStyle = col.ground;
    ctx.fillRect(d.x, base - d.h, d.w, d.h);
    ctx.fillStyle = 'rgba(255,214,130,0.75)';
    const cols = Math.max(2, Math.floor(d.w / 16));
    const rows = Math.floor(d.h / 22);
    for (let r = 1; r < rows; r++) {
      for (let c2 = 0; c2 < cols; c2++) {
        const lit = Math.sin(d.seed * 999 + r * 7.1 + c2 * 3.3) > 0.2;
        if (!lit) continue;
        ctx.fillRect(d.x + 6 + c2 * ((d.w - 12) / cols), base - d.h + r * 22, 6, 9);
      }
    }
    ctx.fillStyle = 'rgba(235,245,255,0.8)';
    ctx.fillRect(d.x - 2, base - d.h - 4, d.w + 4, 5);
  } else if (d.type === 'tent') {
    const cx = d.x + d.w / 2;
    ctx.fillStyle = '#c8462f';
    ctx.beginPath();
    ctx.moveTo(cx - 34, base);
    ctx.lineTo(cx, base - 52);
    ctx.lineTo(cx + 34, base);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffd27a';
    ctx.beginPath();
    ctx.moveTo(cx - 8, base);
    ctx.lineTo(cx, base - 26);
    ctx.lineTo(cx + 8, base);
    ctx.closePath();
    ctx.fill();
  }
}

function drawGroundItem(ctx, it, G, col, t, guide) {
  if (it.kind === 'board') {
    // stand
    ctx.strokeStyle = '#6b5a4a';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(it.x - 30, G);
    ctx.lineTo(it.x - 10, it.y + 8);
    ctx.moveTo(it.x + 30, G);
    ctx.lineTo(it.x + 10, it.y + 8);
    ctx.stroke();
    // black velvet board with soft sheen
    const g = ctx.createLinearGradient(it.x - it.w / 2, it.y, it.x + it.w / 2, it.y + 14);
    g.addColorStop(0, '#05060c');
    g.addColorStop(0.5, '#1a1c2c');
    g.addColorStop(1, '#05060c');
    ctx.fillStyle = g;
    ctx.fillRect(it.x - it.w / 2, it.y, it.w, 14);
    ctx.strokeStyle = guide ? `rgba(255,225,140,${0.5 + 0.4 * Math.sin(t * 6)})` : 'rgba(255,225,140,0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(it.x - it.w / 2, it.y, it.w, 14);
    // photographer with a camera next to it
    const px = it.x + it.w / 2 + 26;
    ctx.fillStyle = '#1a1830';
    ctx.fillRect(px - 9, G - 62, 18, 54);
    ctx.beginPath();
    ctx.arc(px, G - 72, 10, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#2d2b48';
    ctx.fillRect(px - 20, G - 70, 12, 9);
    ctx.fillStyle = '#9ad8ff';
    ctx.beginPath();
    ctx.arc(px - 20, G - 65.5, 2.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#c23b4a';
    ctx.fillRect(px - 11, G - 84, 22, 6);
  } else if (it.kind === 'kid') {
    const x = it.x;
    ctx.fillStyle = '#2b3b7a';
    ctx.fillRect(x - 13, G - 70, 26, 62);
    ctx.fillStyle = '#f2c9a0';
    ctx.beginPath();
    ctx.arc(x, G - 82, 11, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#e04a5f';
    ctx.beginPath();
    ctx.arc(x, G - 88, 11, Math.PI, TAU);
    ctx.fill();
    ctx.fillRect(x - 11, G - 88, 22, 4);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, G - 101, 4, 0, TAU);
    ctx.fill();
    // raised arm + dark mitten (landing surface)
    ctx.strokeStyle = '#2b3b7a';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + 10, G - 62);
    ctx.lineTo(x + 6, it.y + 18);
    ctx.stroke();
    ctx.fillStyle = '#1e1a3a';
    ctx.beginPath();
    ctx.ellipse(x, it.y + 6, 30, 8, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  } else if (it.kind === 'chimney' || it.kind === 'vent') {
    const wide = it.kind === 'vent';
    ctx.fillStyle = col.ground;
    // the building underneath
    ctx.fillRect(it.x - (wide ? 70 : 55), it.y + 30, wide ? 140 : 110, G - it.y);
    ctx.fillStyle = wide ? '#3a3550' : '#5a2f2f';
    ctx.fillRect(it.x - 20, it.y, 40, 34);
    ctx.fillStyle = 'rgba(235,245,255,0.85)';
    ctx.fillRect(it.x - 24, it.y - 4, 48, 6);
    ctx.fillRect(it.x - (wide ? 72 : 57), it.y + 26, wide ? 144 : 114, 6);
    const g = glowSprite('#ff8a4c', 64);
    ctx.globalAlpha = 0.6 + 0.2 * Math.sin(t * 7);
    ctx.drawImage(g, it.x - 30, it.y - 30, 60, 40);
    ctx.globalAlpha = 1;
  } else if (it.kind === 'fire') {
    const g = glowSprite('#ff8a4c', 128);
    ctx.globalAlpha = 0.7;
    ctx.drawImage(g, it.x - 50, it.y - 60, 100, 100);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#5a3a2a';
    ctx.fillRect(it.x - 22, it.y + 22, 44, 8);
    for (let i = 0; i < 3; i++) {
      const fl = Math.sin(t * 10 + i * 2) * 4;
      ctx.fillStyle = i === 1 ? '#ffd27a' : '#ff7a3c';
      ctx.beginPath();
      ctx.moveTo(it.x - 14 + i * 14 - 8, it.y + 24);
      ctx.quadraticCurveTo(it.x - 14 + i * 14 + fl, it.y - 10 - (i === 1 ? 10 : 0), it.x - 14 + i * 14 + 8, it.y + 24);
      ctx.fill();
    }
  }
}
