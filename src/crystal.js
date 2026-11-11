// Snow crystal growth model + renderer.
//
// All six arms share one "template" arm, because in nature every arm of a
// crystal experiences the same air at the same moment - that is why real
// snowflakes are symmetric. Damage (a broken arm) is stored per arm as a
// radius cut. The arm's shape is a record of the flight: things near the
// centre grew early, things near the tips grew late.
//
// Habits (the kind of air the crystal is in):
//   D  Frost Mist      -15 C, humid      -> fast spine + side branches (fern-like at high humidity)
//   P  Plate Haze      -2 / -12 C        -> wide flat plates
//   N  Needle Drift    -5 C              -> long thin spikes
//   R  Cloud Droplets  supercooled fog   -> rime (frozen droplets) sticks to the crystal
//   Y  Dry air         (outside zones)   -> slow growth
//   W  Warm air                          -> melting

import { TAU } from './util.js';

const S60 = Math.sin(Math.PI / 3);
const C60 = 0.5;
export const RMAX = 150; // soft cap on crystal radius (crystal units)
const MAX_RIME = 140;

export class Crystal {
  constructor() {
    this.core = 2.4;
    this.len = 0;
    this.nodes = []; // spine nodes: {w: plate half-width, h: habit}
    this.branches = []; // {i: node index, len, fa, fb} fa..fb = part of the branch with fern sub-branches
    this.cuts = [Infinity, Infinity, Infinity, Infinity, Infinity, Infinity];
    this.twin = false;
    this.rime = []; // {a: arm, r: radius, o: offset}
    this.meltTotal = 0;
    this.lastBranchAt = 0;
    this.rimeAcc = 0;
    this.version = 0;
  }

  get radius() {
    return this.core + this.len;
  }

  nodeR(i) {
    return this.core + (i + 1);
  }

  get armsIntact() {
    let n = 0;
    for (const c of this.cuts) if (c === Infinity) n++;
    return n;
  }

  /** Grow for dt seconds in air of habit h with intensity q (0..1). Returns number of new branches. */
  grow(dt, h, q, boost = 0) {
    const R = this.radius;
    const cap = Math.max(0, 1 - R / RMAX);
    const g = dt * (0.35 + q) * (1 + boost) * cap;
    let newBranches = 0;
    switch (h) {
      case 'N':
        this.extend(g * 3.4, h, 0.75);
        this.growBranches(g * 0.25, 0);
        break;
      case 'P':
        this.extend(g * 1.05, h, 2.2 + 5.2 * q);
        if (this.len < 5) this.core = Math.min(this.core + g * 0.9, 8);
        break;
      case 'D':
        this.extend(g * 2.5, h, 0.9);
        newBranches = this.spawnBranches(q);
        this.growBranches(g * 1.9, q);
        break;
      case 'R':
        this.extend(g * 0.45, h, null);
        this.growBranches(g * 0.3, 0);
        this.addRime(dt, q);
        break;
      default: // dry air: slow growth that mostly thickens the hexagonal core
        this.extend(g * 0.18, 'Y', null);
        this.growBranches(g * 0.3, 0);
        this.core = Math.min(this.core + g * 0.3, 9);
    }
    this.version++;
    return newBranches;
  }

  extend(amount, h, wTarget) {
    if (amount <= 0) return;
    this.len += amount;
    const want = Math.floor(this.len);
    while (this.nodes.length < want) {
      const prev = this.nodes.length ? this.nodes[this.nodes.length - 1].w : Math.min(this.core * 0.85, 2.4);
      let w;
      if (wTarget == null) w = Math.max(0.7, prev * 0.9);
      else if (wTarget > prev) w = Math.min(wTarget, prev + 0.42);
      else w = Math.max(wTarget, prev - 0.9);
      this.nodes.push({ w, h });
    }
  }

  spawnBranches(q) {
    const spacing = 9.5 - 4.5 * q;
    if (this.len > 4 && this.len - this.lastBranchAt >= spacing && this.nodes.length > 0) {
      this.branches.push({ i: this.nodes.length - 1, len: 0.05, fa: -1, fb: -1 });
      this.lastBranchAt = this.len;
      return 1;
    }
    return 0;
  }

  growBranches(a, q) {
    if (a <= 0) return;
    for (const b of this.branches) {
      const r0 = this.nodeR(b.i);
      const max = r0 * 0.78;
      if (b.len >= max) continue;
      const before = b.len;
      b.len = Math.min(max, b.len + a);
      if (q > 0.8 && b.len > 2) {
        if (b.fa < 0) b.fa = Math.max(1, before);
        b.fb = b.len;
      }
    }
  }

  addRime(dt, q) {
    this.rimeAcc += dt * (2 + q * 9);
    while (this.rimeAcc >= 1 && this.rime.length < MAX_RIME) {
      this.rimeAcc -= 1;
      const R = this.radius;
      this.rime.push({
        a: Math.floor(Math.random() * 6),
        r: this.core * 0.4 + Math.random() * (R - this.core * 0.4),
        o: (Math.random() * 2 - 1) * Math.min(3.2, 1 + R * 0.05),
      });
    }
    if (this.rime.length >= MAX_RIME) this.rimeAcc = 0;
  }

  /** Melt m crystal units. */
  melt(m) {
    if (m <= 0) return;
    this.meltTotal += m;
    for (const b of this.branches) {
      b.len -= m * 0.9;
      if (b.fb > b.len) b.fb = b.len;
      if (b.fb - b.fa < 0.5) b.fa = b.fb = -1;
    }
    this.len = Math.max(0, this.len - m);
    const keep = Math.floor(this.len);
    if (this.nodes.length > keep) this.nodes.length = keep;
    this.branches = this.branches.filter((b) => b.len > 0.2 && b.i < this.nodes.length);
    for (const n of this.nodes) n.w = Math.max(0.6, n.w - m * 0.22);
    if (this.len <= 0.5) this.core = Math.max(0, this.core - m * 0.4);
    this.lastBranchAt = Math.min(this.lastBranchAt, this.len);
    const R = this.radius;
    this.rime = this.rime.filter((d) => d.r < R);
    this.version++;
  }

  get melted() {
    return this.core < 1.2;
  }

  /** Break arm k. Keeps a stump of frac * current radius. */
  breakArm(k, frac) {
    const R = this.radius;
    this.cuts[k] = Math.max(this.core + 0.8, R * frac);
    this.version++;
  }

  /** Repair every arm (used by the "Refreeze" revive). */
  repair() {
    this.cuts = this.cuts.map(() => Infinity);
    if (this.core < 3) this.core = 3;
    if (this.len < 4) this.extend(4 - this.len, 'Y', null);
    this.version++;
  }

  symmetry() {
    const span = this.len;
    if (span < 2) return 1;
    let sum = 0;
    for (const c of this.cuts) sum += Math.min(1, Math.max(0, (Math.min(c, this.radius) - this.core) / span));
    return sum / 6;
  }

  stats() {
    const n = this.nodes.length;
    let plate = 0, needle = 0;
    for (const nd of this.nodes) {
      if (nd.w > 2.6) plate++;
      if (nd.h === 'N') needle++;
    }
    let nB = 0, nFern = 0;
    for (const b of this.branches) {
      if (b.len > 2.5) nB++;
      if (b.fa >= 0 && b.fb - b.fa > 2) nFern++;
    }
    const brokenIdx = [];
    this.cuts.forEach((c, i) => c !== Infinity && brokenIdx.push(i));
    return {
      R: this.radius,
      len: this.len,
      core: this.core,
      plateFrac: n ? plate / n : 0,
      needleFrac: n ? needle / n : 0,
      nB,
      nFern,
      rime: Math.max(this.rime.length, this._rimeCount || 0),
      twin: this.twin,
      melt: this.meltTotal,
      sym: this.symmetry(),
      broken: brokenIdx.length,
      brokenIdx,
    };
  }

  // ---- Compact serialisation for the album (cloud save friendly)
  toData() {
    const r1 = (v) => Math.round(v * 10);
    return {
      c: r1(this.core),
      l: r1(this.len),
      w: this.nodes.map((n) => r1(n.w)),
      h: this.nodes.map((n) => n.h).join(''),
      b: this.branches.flatMap((b) => [b.i, r1(b.len), b.fa < 0 ? -1 : r1(b.fa), b.fb < 0 ? -1 : r1(b.fb)]),
      k: this.cuts.map((c) => (c === Infinity ? -1 : r1(c))),
      t: this.twin ? 1 : 0,
      r: this.rime.slice(0, 80).flatMap((d) => [d.a, r1(d.r), r1(d.o)]),
      rn: this.rime.length,
      m: Math.round(this.meltTotal),
    };
  }

  static fromData(d) {
    const c = new Crystal();
    if (!d) return c;
    const u = (v) => v / 10;
    c.core = u(d.c || 24);
    c.len = u(d.l || 0);
    const h = d.h || '';
    c.nodes = (d.w || []).map((w, i) => ({ w: u(w), h: h[i] || 'Y' }));
    const b = d.b || [];
    for (let i = 0; i + 3 < b.length; i += 4) {
      c.branches.push({ i: b[i], len: u(b[i + 1]), fa: b[i + 2] < 0 ? -1 : u(b[i + 2]), fb: b[i + 3] < 0 ? -1 : u(b[i + 3]) });
    }
    c.cuts = (d.k || [-1, -1, -1, -1, -1, -1]).map((v) => (v < 0 ? Infinity : u(v)));
    c.twin = !!d.t;
    const r = d.r || [];
    for (let i = 0; i + 2 < r.length; i += 3) c.rime.push({ a: r[i], r: u(r[i + 1]), o: u(r[i + 2]) });
    // keep the rime count for classification even if only a sample of dots was stored
    c._rimeCount = d.rn || c.rime.length;
    c.meltTotal = d.m || 0;
    return c;
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const DEFAULT_STYLE = {
  fill: 'rgba(175,220,255,0.20)',
  inner: 'rgba(210,238,255,0.35)',
  edge: 'rgba(236,248,255,0.95)',
  ridge: 'rgba(255,255,255,0.9)',
  rime: 'rgba(255,255,255,0.92)',
  glow: 'rgba(130,200,255,0.85)',
  glowBlur: 6, // in screen px
  minLine: 1, // minimum line width in screen px
};

/**
 * Draw crystal centred at the current origin of ctx.
 * @param {number} s scale: screen px per crystal unit
 */
// One arm is rendered once into this scratch canvas and stamped six (or twelve) times.
// All arms share the same geometry, so this is ~6x cheaper than drawing each arm.
let armCanvas = null;
let armCtx = null;

export function drawCrystal(ctx, c, s, style = DEFAULT_STYLE) {
  const st = style === DEFAULT_STYLE ? style : { ...DEFAULT_STYLE, ...style };
  const m = ctx.getTransform ? ctx.getTransform() : null;
  const dev = m ? Math.hypot(m.a, m.b) || 1 : 1; // device px per ctx unit
  const px = 1 / s; // crystal units per (css) pixel
  const R = Math.max(1, c.radius);
  const k = s * dev; // device px per crystal unit
  const pad = Math.ceil(st.glowBlur * dev * 2 + 3);
  const halfH = Math.ceil(R * 0.72 * k) + pad;
  const aw = Math.ceil(R * k) + pad * 2;
  const ah = halfH * 2;

  if (!armCanvas) {
    armCanvas = document.createElement('canvas');
    armCtx = armCanvas.getContext('2d');
  }
  if (armCanvas.width < aw || armCanvas.height < ah) {
    armCanvas.width = Math.max(armCanvas.width, aw);
    armCanvas.height = Math.max(armCanvas.height, ah);
  }
  const a = armCtx;
  a.setTransform(1, 0, 0, 1, 0, 0);
  a.clearRect(0, 0, aw + 2, ah + 2);
  a.setTransform(k, 0, 0, k, pad, halfH);
  a.lineJoin = 'round';
  a.lineCap = 'round';
  if (st.glowBlur > 0) {
    a.shadowColor = st.glow;
    a.shadowBlur = st.glowBlur * dev; // shadowBlur is in device px and ignores the transform
  } else {
    a.shadowBlur = 0;
  }
  drawArm(a, c, px, st);
  a.shadowBlur = 0;

  ctx.save();
  const sets = c.twin ? [[Math.PI / 6, 0.8], [0, 1]] : [[0, 1]];
  const iw = aw / dev, ih = ah / dev, ix = -pad / dev, iy = -halfH / dev;
  for (const [rot, sc] of sets) {
    const primary = sc === 1;
    for (let i = 0; i < 6; i++) {
      ctx.save();
      ctx.rotate(rot + i * (Math.PI / 3) - Math.PI / 2);
      if (!primary) ctx.scale(sc, sc);
      const cut = primary ? c.cuts[i] : Infinity;
      if (cut !== Infinity) {
        ctx.beginPath();
        ctx.arc(0, 0, cut * s, 0, TAU);
        ctx.clip();
      }
      ctx.drawImage(armCanvas, 0, 0, aw, ah, ix, iy, iw, ih);
      ctx.restore();
    }
  }
  // rime dots are random per arm, so they are drawn directly
  ctx.scale(s, s);
  if (c.rime.length) drawRime(ctx, c, px, st);
  if (st.glowBlur > 0) {
    ctx.shadowColor = st.glow;
    ctx.shadowBlur = st.glowBlur * dev;
  }
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  drawCore(ctx, c, px, st);
  ctx.restore();
}

function drawRime(ctx, c, px, st) {
  const rr = Math.max(0.7, 1.1 * px);
  ctx.fillStyle = st.rime;
  for (let i = 0; i < 6; i++) {
    const cut = c.cuts[i];
    const ang = i * (Math.PI / 3) - Math.PI / 2;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    ctx.beginPath();
    for (const d of c.rime) {
      if (d.a !== i || d.r > cut) continue;
      const x = ca * d.r - sa * d.o, y = sa * d.r + ca * d.o;
      ctx.moveTo(x + rr, y);
      ctx.arc(x, y, rr, 0, TAU);
    }
    ctx.fill();
  }
}

function lw(units, minPx, px) {
  return Math.max(units, minPx * px);
}

function drawArm(ctx, c, px, st) {
  const core = c.core;
  const nodes = c.nodes;
  const n = nodes.length;
  const tip = core + c.len;

  // plate body (outline doubles as the spine for thin segments)
  if (c.len > 0.05) {
    ctx.beginPath();
    ctx.moveTo(core * 0.45, 0);
    for (let i = 0; i < n; i++) ctx.lineTo(core + i + 1, nodes[i].w);
    ctx.lineTo(tip, 0);
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(core + i + 1, -nodes[i].w);
    ctx.closePath();
    ctx.fillStyle = st.fill;
    ctx.fill();
    ctx.lineWidth = lw(0.32, st.minLine * 0.75, px);
    ctx.strokeStyle = st.edge;
    ctx.stroke();

    // inner facet line on wide plate sections
    let open = false;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const w = nodes[i].w;
      if (w > 2.4) {
        const x = core + i + 1;
        if (!open) {
          ctx.moveTo(x, w * 0.55);
          open = true;
        } else ctx.lineTo(x, w * 0.55);
      } else open = false;
    }
    open = false;
    for (let i = 0; i < n; i++) {
      const w = nodes[i].w;
      if (w > 2.4) {
        const x = core + i + 1;
        if (!open) {
          ctx.moveTo(x, -w * 0.55);
          open = true;
        } else ctx.lineTo(x, -w * 0.55);
      } else open = false;
    }
    ctx.lineWidth = lw(0.22, st.minLine * 0.5, px);
    ctx.strokeStyle = st.inner;
    ctx.stroke();
  }

  // side branches (always mirrored at +-60 deg, the hexagonal lattice directions)
  if (c.branches.length) {
    ctx.beginPath();
    for (const b of c.branches) {
      if (b.i >= n) continue;
      const r0 = core + b.i + 1;
      const ex = r0 + b.len * C60;
      const ey = b.len * S60;
      ctx.moveTo(r0, 0);
      ctx.lineTo(ex, ey);
      ctx.moveTo(r0, 0);
      ctx.lineTo(ex, -ey);
    }
    ctx.lineWidth = lw(0.85, st.minLine, px);
    ctx.strokeStyle = st.edge;
    ctx.stroke();

    // fern-like sub-branches
    ctx.beginPath();
    let any = false;
    for (const b of c.branches) {
      if (b.fa < 0 || b.i >= n) continue;
      const r0 = core + b.i + 1;
      // keep sub-branches at least ~2.4 px apart: denser ticks are invisible and costly
      const stepT = Math.max(1.7, 2.4 * px);
      for (let t = b.fa + 0.8; t < b.fb - 0.4; t += stepT) {
        const bx = r0 + t * C60;
        const by = t * S60;
        const tl = Math.min(2.2, (b.len - t) * 0.45 + 0.5);
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + tl, by);
        ctx.moveTo(bx, by);
        ctx.lineTo(bx - tl * C60, by + tl * S60);
        ctx.moveTo(bx, -by);
        ctx.lineTo(bx + tl, -by);
        ctx.moveTo(bx, -by);
        ctx.lineTo(bx - tl * C60, -by - tl * S60);
        any = true;
      }
    }
    if (any) {
      ctx.lineWidth = lw(0.45, st.minLine * 0.6, px);
      ctx.stroke();
    }
  }

  // central ridge
  if (c.len > 0.5) {
    ctx.beginPath();
    ctx.moveTo(core * 0.5, 0);
    ctx.lineTo(tip, 0);
    ctx.lineWidth = lw(0.4, st.minLine * 0.6, px);
    ctx.strokeStyle = st.ridge;
    ctx.stroke();
  }

}

function hexPath(ctx, r) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = i * (Math.PI / 3) - Math.PI / 2;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawCore(ctx, c, px, st) {
  const r = Math.max(0.6, c.core);
  hexPath(ctx, r);
  ctx.fillStyle = st.inner;
  ctx.fill();
  ctx.lineWidth = lw(0.35, st.minLine * 0.8, px);
  ctx.strokeStyle = st.edge;
  ctx.stroke();
  if (r > 2.2) {
    hexPath(ctx, r * 0.55);
    ctx.lineWidth = lw(0.25, st.minLine * 0.5, px);
    ctx.strokeStyle = st.inner;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(0, 0, Math.max(0.35, r * 0.16), 0, TAU);
  ctx.fillStyle = st.ridge;
  ctx.fill();
}

/**
 * Cached sprite of a crystal, re-rendered at most every `interval` seconds when it changes.
 */
export class CrystalSprite {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.version = -1;
    this.age = 1e9;
    this.half = 0;
    this.scale = 1;
  }

  /** @param s screen px per crystal unit, @param dpr device pixel ratio */
  update(c, s, dpr, dt, style, interval = 0.08) {
    this.age += dt;
    const sameScale = Math.abs(this.scale - s) / s < 0.06;
    if (this.version === c.version && sameScale) return;
    if (this.age < interval && sameScale && this.version !== -1) return;
    this.age = 0;
    this.version = c.version;
    this.scale = s;
    const R = c.radius;
    const blur = (style && style.glowBlur) || DEFAULT_STYLE.glowBlur;
    const half = Math.ceil(R * s + blur * 2 + 4);
    const size = Math.ceil(half * 2 * dpr);
    if (this.canvas.width < size || this.canvas.width > size * 1.6) {
      this.canvas.width = this.canvas.height = size;
    } else {
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
    this.half = this.canvas.width / 2 / dpr;
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, this.canvas.width / 2, this.canvas.height / 2);
    drawCrystal(ctx, c, s, style || DEFAULT_STYLE);
  }

  /** k converts sprite css px into the units of ctx (e.g. 1 / viewScale). */
  draw(ctx, x, y, rot, alpha = 1, k = 1) {
    if (this.version === -1) return;
    const h = this.half * k;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.globalAlpha *= alpha;
    ctx.drawImage(this.canvas, -h, -h, h * 2, h * 2);
    ctx.restore();
  }
}

/** Grow a random decorative crystal (used for menu snowfall, covers, etc.). */
export function randomCrystal(rng = Math.random, steps = 120) {
  const c = new Crystal();
  const habits = ['D', 'D', 'D', 'P', 'N', 'Y'];
  let h = habits[Math.floor(rng() * habits.length)];
  let q = 0.5 + rng() * 0.5;
  for (let i = 0; i < steps; i++) {
    if (rng() < 0.06) {
      h = habits[Math.floor(rng() * habits.length)];
      q = 0.4 + rng() * 0.6;
    }
    c.grow(0.25, h, q, 0.3);
  }
  return c;
}
