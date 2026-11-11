// Menu backdrop (falling crystals + hero snowflake) and "photograph" rendering.
import { Crystal, CrystalSprite, drawCrystal, randomCrystal } from './crystal.js';
import { glowSprite } from './sprites.js';
import { mulberry32, TAU, mixHex } from './util.js';

export const PHOTO_STYLE = {
  fill: 'rgba(170,215,255,0.16)',
  inner: 'rgba(205,235,255,0.42)',
  edge: 'rgba(242,250,255,0.98)',
  ridge: 'rgba(255,255,255,0.95)',
  rime: 'rgba(255,255,255,0.95)',
  glow: 'rgba(120,195,255,0.9)',
  glowBlur: 9,
  minLine: 1.1,
};

/** A pretty, deterministic fern dendrite for the menu before the player owns one. */
export function demoCrystal() {
  const c = new Crystal();
  const script = [
    ['P', 0.7, 3], ['Y', 0.3, 1.5], ['D', 0.95, 7], ['N', 0.6, 1], ['D', 0.9, 6], ['P', 0.5, 1.2], ['D', 0.85, 4],
  ];
  for (const [h, q, secs] of script) for (let t = 0; t < secs; t += 0.05) c.grow(0.05, h, q, 0.6);
  return c;
}

export class MenuScene {
  constructor() {
    this.t = 0;
    this.flakes = [];
    this.sprites = [];
    this.hero = null;
    this.heroSprite = new CrystalSprite();
    this.stars = [];
  }

  init(hero) {
    const rng = mulberry32(1337);
    for (let i = 0; i < 6; i++) {
      const c = randomCrystal(rng, 70 + i * 18);
      const s = new CrystalSprite();
      s.update(c, 30 / Math.max(1, c.radius), 2, 1, { glowBlur: 3 });
      this.sprites.push(s);
    }
    for (let i = 0; i < 28; i++) {
      this.flakes.push({ x: rng(), y: rng(), z: 0.25 + rng() * 0.75, spr: i % 6, rot: rng() * TAU, vr: (rng() - 0.5) * 0.8, ph: rng() * TAU });
    }
    for (let i = 0; i < 80; i++) this.stars.push({ x: rng(), y: rng() * 0.7, r: 0.5 + rng() * 1.2, tw: rng() * TAU });
    this.setHero(hero);
  }

  setHero(c) {
    this.hero = c;
    this.heroSprite.version = -1;
  }

  draw(ctx, W, H, dpr, dt, sky, landscape) {
    this.t += dt;
    const t = this.t;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const col = sky.colors;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, col.top);
    g.addColorStop(0.6, col.mid);
    g.addColorStop(1, mixHex(col.mid, col.bottom, 0.7));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#fff';
    for (const s of this.stars) {
      ctx.globalAlpha = 0.25 + 0.6 * Math.sin(t * 1.2 + s.tw) ** 2;
      ctx.fillRect(s.x * W, s.y * H, s.r, s.r);
    }
    ctx.globalAlpha = 1;

    // soft snowy hills
    ctx.fillStyle = mixHex(col.far, '#ffffff', 0.15);
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W + 40; x += 40) ctx.lineTo(x, H * 0.86 - Math.sin(x * 0.004 + 1) * H * 0.05 - Math.sin(x * 0.011) * H * 0.02);
    ctx.lineTo(W, H);
    ctx.fill();
    ctx.globalAlpha = 1;
    const hill = ctx.createLinearGradient(0, H * 0.88, 0, H);
    hill.addColorStop(0, '#dfeaff');
    hill.addColorStop(1, '#8ea3d6');
    ctx.fillStyle = hill;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W + 40; x += 40) ctx.lineTo(x, H * 0.93 - Math.sin(x * 0.006 + 3) * H * 0.025);
    ctx.lineTo(W, H);
    ctx.fill();

    // falling background flakes (behind hero)
    this.drawFlakes(ctx, W, H, dt, false);

    // hero
    if (this.hero) {
      const hx = landscape ? W * 0.29 : W * 0.5;
      const hy = landscape ? H * 0.52 : H * 0.43;
      const r = landscape ? Math.min(W * 0.2, H * 0.34) : Math.min(W * 0.36, H * 0.19);
      const glow = glowSprite('#7fc8ff', 128);
      ctx.globalAlpha = 0.35 + 0.08 * Math.sin(t * 1.4);
      ctx.drawImage(glow, hx - r * 2, hy - r * 2, r * 4, r * 4);
      ctx.globalAlpha = 1;
      this.heroSprite.update(this.hero, r / Math.max(1, this.hero.radius), dpr, dt, PHOTO_STYLE, 1);
      this.heroSprite.draw(ctx, hx, hy + Math.sin(t * 0.9) * r * 0.04, t * 0.07);
    }
    this.drawFlakes(ctx, W, H, dt, true);
  }

  drawFlakes(ctx, W, H, dt, front) {
    for (const f of this.flakes) {
      if ((f.z > 0.75) !== front) continue;
      f.y += ((14 + f.z * 38) * dt) / H;
      f.rot += f.vr * dt;
      if (f.y > 1.08) { f.y = -0.08; f.x = Math.random(); }
      const x = f.x * W + Math.sin(this.t * 0.5 + f.ph) * 24 * f.z;
      const y = f.y * H;
      const spr = this.sprites[f.spr];
      const k = (5 + f.z * 22) / 34;
      ctx.globalAlpha = 0.25 + f.z * 0.55;
      spr.draw(ctx, x, y, f.rot, 1, k);
    }
    ctx.globalAlpha = 1;
  }
}

/** Render a crystal as a photograph on black velvet (results, album). */
export function renderPhoto(canvas, crystal, size, dpr, opts = {}) {
  const px = Math.round(size * dpr);
  if (canvas.width !== px) canvas.width = canvas.height = px;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  if (opts.background !== false) {
    const g = ctx.createRadialGradient(size / 2, size * 0.45, size * 0.05, size / 2, size / 2, size * 0.75);
    g.addColorStop(0, opts.tint || '#1a2142');
    g.addColorStop(1, '#04050c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    // velvet fibres
    const rng = mulberry32(42);
    for (let i = 0; i < size * 2.5; i++) {
      ctx.fillStyle = `rgba(255,255,255,${rng() * 0.05})`;
      ctx.fillRect(rng() * size, rng() * size, 1, 1);
    }
  }
  if (crystal) {
    const R = Math.max(5, crystal.radius);
    const s = (size * (opts.fill || 0.43)) / R;
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(opts.rot || 0);
    drawCrystal(ctx, crystal, s, { ...PHOTO_STYLE, glowBlur: Math.max(4, size * 0.022), minLine: size > 200 ? 1.2 : 0.8 });
    ctx.restore();
  }
  if (opts.locked) {
    ctx.fillStyle = 'rgba(160,190,240,0.35)';
    ctx.font = `600 ${Math.round(size * 0.38)}px Fredoka, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', size / 2, size / 2 + size * 0.03);
  }
  if (opts.background !== false) {
    const v = ctx.createRadialGradient(size / 2, size / 2, size * 0.35, size / 2, size / 2, size * 0.72);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, size, size);
  }
}
