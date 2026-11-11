// Cached procedural sprites (soft glows, mist blobs). Built once, reused every frame.
import { hexToRgb } from './util.js';

const cache = new Map();

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

/** Soft round glow, full colour at the centre fading to transparent. */
export function glowSprite(hex, size = 128) {
  const key = 'g' + hex + size;
  if (cache.has(key)) return cache.get(key);
  const c = makeCanvas(size);
  const g = c.getContext('2d');
  const [r, gg, b] = hexToRgb(hex);
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, `rgba(${r},${gg},${b},1)`);
  grad.addColorStop(0.25, `rgba(${r},${gg},${b},0.55)`);
  grad.addColorStop(0.6, `rgba(${r},${gg},${b},0.14)`);
  grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  cache.set(key, c);
  return c;
}

/** Mist blob used for air zones: wide, soft body with a brighter heart and faint rim. */
export function mistSprite(hex, size = 256) {
  const key = 'm' + hex + size;
  if (cache.has(key)) return cache.get(key);
  const c = makeCanvas(size);
  const g = c.getContext('2d');
  const [r, gg, b] = hexToRgb(hex);
  const h = size / 2;
  const grad = g.createRadialGradient(h, h, 0, h, h, h);
  grad.addColorStop(0, `rgba(${r},${gg},${b},0.62)`);
  grad.addColorStop(0.3, `rgba(${r},${gg},${b},0.40)`);
  grad.addColorStop(0.7, `rgba(${r},${gg},${b},0.20)`);
  grad.addColorStop(0.86, `rgba(${r},${gg},${b},0.12)`);
  grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  // faint rim so the boundary of the zone is readable
  g.strokeStyle = `rgba(${r},${gg},${b},0.22)`;
  g.lineWidth = size * 0.012;
  g.beginPath();
  g.arc(h, h, h * 0.86, 0, Math.PI * 2);
  g.stroke();
  cache.set(key, c);
  return c;
}
