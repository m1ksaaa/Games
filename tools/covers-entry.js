// Draws the CrazyGames cover images with the game's own crystal renderer (bundled by tools/covers.mjs).
import { Crystal, drawCrystal, randomCrystal } from '../src/crystal.js';
import { PHOTO_STYLE } from '../src/scene.js';
import { glowSprite, mistSprite } from '../src/sprites.js';
import { mulberry32, TAU } from '../src/util.js';

function heroCrystal() {
  const c = new Crystal();
  const script = [['P', 0.75, 3.2], ['Y', 0.3, 1], ['D', 0.97, 8], ['P', 0.6, 0.8], ['D', 0.95, 6], ['N', 0.7, 0.6], ['D', 0.9, 4]];
  for (const [h, q, secs] of script) for (let t = 0; t < secs; t += 0.05) c.grow(0.05, h, q, 0.7);
  return c;
}

function sky(ctx, W, H) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#060a22');
  g.addColorStop(0.55, '#142257');
  g.addColorStop(1, '#2c3f86');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const rng = mulberry32(5);
  ctx.fillStyle = '#fff';
  for (let i = 0; i < W * H / 9000; i++) {
    ctx.globalAlpha = 0.2 + rng() * 0.7;
    const r = 0.6 + rng() * 1.6;
    ctx.fillRect(rng() * W, rng() * H * 0.75, r, r);
  }
  ctx.globalAlpha = 1;
  // aurora wash
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const a = glowSprite('#3fe0a8', 128);
  ctx.globalAlpha = 0.18;
  ctx.drawImage(a, -W * 0.2, -H * 0.35, W * 1.4, H * 0.8);
  const b = glowSprite('#9a6bff', 128);
  ctx.globalAlpha = 0.12;
  ctx.drawImage(b, W * 0.3, -H * 0.3, W * 0.9, H * 0.7);
  ctx.restore();
}

function mists(ctx, list, unit) {
  for (const [x, y, rx, ry, col, alpha] of list) {
    ctx.globalAlpha = alpha;
    ctx.drawImage(mistSprite(col, 256), x - rx * unit, y - ry * unit, rx * 2 * unit, ry * 2 * unit);
  }
  ctx.globalAlpha = 1;
}

function village(ctx, W, H, scale) {
  const G = H;
  const rng = mulberry32(11);
  ctx.fillStyle = 'rgba(80,105,180,0.45)';
  ctx.beginPath();
  ctx.moveTo(0, G);
  for (let x = 0; x <= W; x += 30) ctx.lineTo(x, G - 150 * scale - Math.sin(x * 0.004 / scale + 1) * 60 * scale);
  ctx.lineTo(W, G);
  ctx.fill();
  for (let x = -40; x < W + 40;) {
    const house = rng() < 0.55;
    const w = (60 + rng() * 70) * scale;
    const h = (60 + rng() * 50) * scale;
    const base = G - 26 * scale;
    ctx.fillStyle = '#0d1433';
    if (house) {
      ctx.fillRect(x, base - h, w, h);
      ctx.beginPath();
      ctx.moveTo(x - 8 * scale, base - h);
      ctx.lineTo(x + w / 2, base - h - w * 0.45);
      ctx.lineTo(x + w + 8 * scale, base - h);
      ctx.fill();
      ctx.fillStyle = 'rgba(235,245,255,0.85)';
      ctx.beginPath();
      ctx.moveTo(x - 8 * scale, base - h);
      ctx.lineTo(x + w / 2, base - h - w * 0.45);
      ctx.lineTo(x + w + 8 * scale, base - h);
      ctx.lineTo(x + w / 2, base - h - w * 0.45 + 7 * scale);
      ctx.fill();
      ctx.fillStyle = '#ffd27a';
      ctx.fillRect(x + w * 0.2, base - h * 0.7, w * 0.22, h * 0.25);
      if (rng() < 0.6) ctx.fillRect(x + w * 0.58, base - h * 0.7, w * 0.22, h * 0.25);
    } else {
      const cx = x + w / 2, th = h * 1.5;
      for (let i = 0; i < 3; i++) {
        const yy = base - th * (0.25 + i * 0.28), ww = w * 0.7 * (1 - i * 0.25);
        ctx.fillStyle = '#0d1433';
        ctx.beginPath();
        ctx.moveTo(cx - ww / 2, yy + th * 0.2);
        ctx.lineTo(cx, yy - th * 0.25);
        ctx.lineTo(cx + ww / 2, yy + th * 0.2);
        ctx.fill();
        ctx.fillStyle = 'rgba(235,245,255,0.6)';
        ctx.beginPath();
        ctx.moveTo(cx - ww * 0.25, yy - th * 0.02);
        ctx.lineTo(cx, yy - th * 0.25);
        ctx.lineTo(cx + ww * 0.25, yy - th * 0.02);
        ctx.fill();
      }
    }
    x += w * (0.8 + rng() * 0.6);
  }
  const g = ctx.createLinearGradient(0, G - 40 * scale, 0, G);
  g.addColorStop(0, '#e9f3ff');
  g.addColorStop(1, '#a9bde6');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, G);
  for (let x = 0; x <= W; x += 30) ctx.lineTo(x, G - 30 * scale - Math.sin(x * 0.02) * 5 * scale);
  ctx.lineTo(W, G);
  ctx.fill();
}

function smallFlakes(ctx, W, H, n, maxR, seed, avoid) {
  const rng = mulberry32(seed);
  const crystals = [0, 1, 2, 3, 4].map((i) => randomCrystal(mulberry32(100 + i), 80 + i * 15));
  for (let i = 0; i < n; i++) {
    const x = rng() * W, y = rng() * H * 0.85;
    if (avoid && Math.hypot(x - avoid[0], y - avoid[1]) < avoid[2]) continue;
    const r = maxR * (0.25 + rng() * 0.75);
    const c = crystals[i % crystals.length];
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rng() * TAU);
    ctx.globalAlpha = 0.35 + rng() * 0.5;
    drawCrystal(ctx, c, r / c.radius, { ...PHOTO_STYLE, glowBlur: 3, minLine: 1 });
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function hero(ctx, c, x, y, r) {
  ctx.globalAlpha = 0.55;
  const g = glowSprite('#7fc8ff', 128);
  ctx.drawImage(g, x - r * 2, y - r * 2, r * 4, r * 4);
  ctx.globalAlpha = 1;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(0.08);
  drawCrystal(ctx, c, r / c.radius, { ...PHOTO_STYLE, glowBlur: Math.max(8, r * 0.035), minLine: 2 });
  ctx.restore();
}

function title(ctx, x, y, size, align = 'center') {
  ctx.save();
  ctx.font = `600 ${size}px Fredoka`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  const flake = 'Flake', fall = 'fall';
  const wFlake = ctx.measureText(flake).width, wAll = ctx.measureText(flake + fall).width;
  let x0 = align === 'center' ? x - wAll / 2 : align === 'right' ? x - wAll : x;
  ctx.textAlign = 'left';
  for (const [txt, dx, col] of [[flake, 0, '#ffffff'], [fall, wFlake, '#7fd8ff']]) {
    ctx.fillStyle = '#2b5fae';
    ctx.fillText(txt, x0 + dx, y + size * 0.06);
    ctx.shadowColor = 'rgba(127,216,255,0.8)';
    ctx.shadowBlur = size * 0.25;
    ctx.fillStyle = col;
    ctx.fillText(txt, x0 + dx, y);
    ctx.shadowBlur = 0;
  }
  ctx.restore();
}

window.drawCover = (kind) => {
  const sizes = { landscape: [1920, 1080], portrait: [800, 1200], square: [800, 800] };
  const [W, H] = sizes[kind];
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');
  const c = heroCrystal();
  sky(ctx, W, H);
  if (kind === 'landscape') {
    mists(ctx, [[420, 200, 260, 200, '#58c8ff', 0.7], [780, 560, 200, 260, '#c39bff', 0.55], [260, 760, 220, 180, '#5ff0bf', 0.5], [1500, 240, 300, 220, '#58c8ff', 0.35]], 1);
    smallFlakes(ctx, W, H, 26, 34, 3, [600, 520, 420]);
    village(ctx, W, H, 1.6);
    hero(ctx, c, 600, 500, 380);
    title(ctx, 1430, 560, 230);
  } else if (kind === 'portrait') {
    mists(ctx, [[180, 520, 200, 220, '#58c8ff', 0.6], [640, 760, 180, 200, '#c39bff', 0.5], [600, 380, 150, 140, '#5ff0bf', 0.4]], 1);
    smallFlakes(ctx, W, H, 16, 26, 7, [400, 620, 330]);
    village(ctx, W, H, 0.9);
    hero(ctx, c, 400, 640, 300);
    title(ctx, 400, 230, 168);
  } else {
    mists(ctx, [[170, 300, 190, 190, '#58c8ff', 0.6], [650, 520, 170, 170, '#c39bff', 0.45]], 1);
    smallFlakes(ctx, W, H, 12, 24, 9, [400, 350, 300]);
    village(ctx, W, H, 0.8);
    hero(ctx, c, 400, 345, 255);
    title(ctx, 400, 720, 150);
  }
  return cv.toDataURL('image/png');
};
