// Flakefall - main controller: boot, game states, SDK integration, menus and HUD.
import * as sdk from './sdk.js';
import { audio } from './audio.js';
import { Input } from './input.js';
import { Run, PF, BASE_VIEW_H, LANDING } from './world.js';
import { Crystal, drawCrystal } from './crystal.js';
import { SKIES, SKY_BY_ID, AIR } from './skies.js';
import { SPECIES, SPECIES_BY_ID, diameterMM } from './species.js';
import { save, loadSave, persist, persistNow, UPGRADES, discoveredCount } from './save.js';
import { MenuScene, renderPhoto, demoCrystal, PHOTO_STYLE } from './scene.js';

const $ = (id) => document.getElementById(id);
const app = $('app');
const canvas = $('game');
const ctx = canvas.getContext('2d');
const hud = $('hud');
const input = new Input(canvas);
const menuScene = new MenuScene();
const isTouch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

const view = { s: 1, ox: 0, visW: PF, viewH: BASE_VIEW_H, dpr: 1, dt: 0 };
let W = 0, H = 0, landscape = true;
let mode = 'loading'; // menu | play | pause | fail | result | album | shop
let run = null;
let adActive = false;
let menuSky = 'village';
let lastResult = null;

// ------------------------------------------------------------------ layout
function resize() {
  W = app.clientWidth || window.innerWidth;
  H = app.clientHeight || window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  view.dpr = dpr;
  if (W / H > PF / BASE_VIEW_H) {
    view.s = H / BASE_VIEW_H;
    view.viewH = BASE_VIEW_H;
  } else {
    view.s = W / PF;
    view.viewH = H / view.s;
  }
  view.visW = W / view.s;
  view.ox = (W - PF * view.s) / 2;
  input.view = view;
  app.style.setProperty('--pf-l', Math.max(0, view.ox) + 'px');
  app.style.setProperty('--pf-r', Math.max(0, view.ox) + 'px');
  const wide = view.ox >= 170;
  hud.classList.toggle('hud-wide', wide);
  hud.classList.toggle('hud-compact', !wide);
  landscape = W / H > 1.15;
  app.classList.toggle('layout-land', landscape);
  app.classList.toggle('layout-port', !landscape);
  sizeLens();
}
window.addEventListener('resize', resize);

// ------------------------------------------------------------------ screens
const screens = ['loading', 'menu', 'album', 'shop', 'pause', 'fail', 'result'];
function showScreen(name) {
  for (const s of screens) $('scr-' + s).hidden = s !== name;
}

let toastTimer = 0;
function toast(html, ms = 2200) {
  const el = $('toast');
  el.innerHTML = html;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function flash() {
  const el = $('flash');
  el.classList.remove('go');
  void el.offsetWidth;
  el.classList.add('go');
}

const fmt = (n) => Math.round(n).toLocaleString('en-US');

function tutorial(key, html, ms = 3200) {
  if (save.tut[key]) return false;
  save.tut[key] = 1;
  persist();
  toast(html, ms);
  return true;
}

// ------------------------------------------------------------------ audio settings
const ICONS = {
  music: '<svg viewBox="0 0 24 24"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>',
  sfx: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 010 6M19 6a8 8 0 010 12"/></svg>',
};
function refreshToggles() {
  const tm = $('tg-music'), ts = $('tg-sfx');
  tm.innerHTML = ICONS.music;
  ts.innerHTML = ICONS.sfx;
  tm.classList.toggle('off', !save.music);
  ts.classList.toggle('off', !save.sfx);
  $('pz-music').textContent = save.music ? 'Music: On' : 'Music: Off';
  $('pz-sfx').textContent = save.sfx ? 'Sound: On' : 'Sound: Off';
  audio.setMusic(save.music);
  audio.setSfx(save.sfx);
}
function toggleMusic() {
  save.music = !save.music;
  persist();
  refreshToggles();
  audio.sfx('click');
}
function toggleSfx() {
  save.sfx = !save.sfx;
  persist();
  refreshToggles();
  audio.sfx('click');
}

// ------------------------------------------------------------------ menu
function heroCrystal() {
  let best = null;
  for (const id in save.species) {
    const e = save.species[id];
    if (e.flake && (!best || e.best > best.best)) best = e;
  }
  return best ? Crystal.fromData(best.flake) : demoCrystal();
}

function skyUnlocked(sky) {
  return discoveredCount() >= sky.need;
}

function refreshMenu() {
  $('menu-frost').textContent = fmt(save.frost);
  $('album-count').textContent = `${discoveredCount()}/${SPECIES.length}`;
  const sky = SKY_BY_ID[menuSky];
  const open = skyUnlocked(sky);
  $('sky-name').textContent = sky.name;
  $('sky-desc').textContent = open ? sky.desc : '';
  const best = save.skies[sky.id] && save.skies[sky.id].best;
  $('sky-lock').textContent = open ? (best ? `Best beauty: ${fmt(best)}` : '') : `Discover ${sky.need} snowflake species to unlock`;
  $('sky-card').classList.toggle('locked', !open);
  $('btn-play').disabled = !open;
  $('controls-hint').textContent = isTouch ? 'Drag anywhere to steer' : 'Mouse, A/D or arrow keys to steer';
}

function cycleSky(dir) {
  const i = SKIES.findIndex((s) => s.id === menuSky);
  menuSky = SKIES[(i + dir + SKIES.length) % SKIES.length].id;
  if (skyUnlocked(SKY_BY_ID[menuSky])) {
    save.sky = menuSky;
    persist();
  }
  audio.sfx('click');
  refreshMenu();
}

function goMenu() {
  mode = 'menu';
  run = null;
  hud.hidden = true;
  sdk.gameplayStop();
  menuSky = save.sky;
  menuScene.setHero(heroCrystal());
  showScreen('menu');
  refreshMenu();
  refreshToggles();
  audio.setLoops(0, 0, 0);
  audio.setIntensity(0);
  audio.playMusic(SKY_BY_ID[save.sky].music, 0.22);
}

// ------------------------------------------------------------------ album
function openAlbum() {
  mode = 'album';
  showScreen('album');
  $('album-detail').hidden = true;
  const grid = $('album-grid');
  grid.innerHTML = '';
  const dpr = view.dpr;
  $('album-count2').textContent = `${discoveredCount()}/${SPECIES.length}`;
  for (const sp of SPECIES) {
    const entry = save.species[sp.id];
    const card = document.createElement('button');
    card.className = 'card' + (entry ? '' : ' locked');
    const cv = document.createElement('canvas');
    card.appendChild(cv);
    const name = document.createElement('b');
    name.textContent = entry ? sp.name : '???';
    card.appendChild(name);
    const rar = document.createElement('span');
    rar.className = 'rarity r-' + sp.rarity.split(' ')[0];
    rar.textContent = sp.rarity;
    card.appendChild(rar);
    if (!entry) {
      const h = document.createElement('span');
      h.className = 'hint-txt';
      h.textContent = sp.hint;
      card.appendChild(h);
    }
    renderPhoto(cv, entry && entry.flake ? Crystal.fromData(entry.flake) : null, 92, dpr, { locked: !entry, fill: 0.44 });
    card.addEventListener('click', () => openDetail(sp));
    grid.appendChild(card);
  }
}

function openDetail(sp) {
  audio.sfx('click');
  const entry = save.species[sp.id];
  $('album-detail').hidden = false;
  const r = $('detail-rarity');
  r.className = 'rarity r-' + sp.rarity.split(' ')[0];
  r.textContent = sp.rarity;
  $('detail-name').textContent = entry ? sp.name : 'Undiscovered';
  $('detail-fact').textContent = entry ? sp.fact : 'Hint: ' + sp.hint;
  $('detail-meta').textContent = entry
    ? `Found ${entry.count}x · Best beauty ${fmt(entry.best)} · ${SKY_BY_ID[entry.sky] ? SKY_BY_ID[entry.sky].name : ''}`
    : '';
  renderPhoto($('detail-canvas'), entry && entry.flake ? Crystal.fromData(entry.flake) : null, 300, view.dpr, { locked: !entry });
}

// ------------------------------------------------------------------ workshop
function openShop() {
  mode = 'shop';
  showScreen('shop');
  renderShop();
}

function renderShop() {
  $('shop-frost').textContent = fmt(save.frost);
  const list = $('shop-list');
  list.innerHTML = '';
  for (const u of UPGRADES) {
    const lvl = save.up[u.id] || 0;
    const li = document.createElement('li');
    const info = document.createElement('div');
    info.className = 'info';
    info.innerHTML = `<b></b><p></p><div class="pips">${Array.from({ length: u.max }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('')}</div>`;
    info.querySelector('b').textContent = u.name;
    info.querySelector('p').textContent = u.desc;
    li.appendChild(info);
    const btn = document.createElement('button');
    btn.className = 'btn';
    if (lvl >= u.max) {
      btn.textContent = 'MAX';
      btn.disabled = true;
    } else {
      const cost = u.cost[lvl];
      btn.innerHTML = `<i class="frost-ico"></i>${fmt(cost)}`;
      if (save.frost < cost) btn.classList.add('ghost');
      btn.addEventListener('click', () => {
        if (save.frost < cost) {
          audio.sfx('deny');
          return;
        }
        save.frost -= cost;
        save.up[u.id] = lvl + 1;
        persistNow();
        audio.sfx('buy');
        renderShop();
      });
    }
    li.appendChild(btn);
    list.appendChild(li);
  }
}

// ------------------------------------------------------------------ HUD
const hudCache = {};
function setText(id, v) {
  if (hudCache[id] === v) return;
  hudCache[id] = v;
  $(id).textContent = v;
}

function buildLegend(sky) {
  const ul = $('hud-legend');
  ul.innerHTML = '';
  const items = [['D', 'branches'], ['P', 'wide plates'], ['N', 'long spikes'], ['R', 'rime'], ['W', 'melts you!']];
  for (const [k, eff] of items) {
    if (k !== 'W' && !(sky.zones[k] > 0)) continue;
    const li = document.createElement('li');
    li.innerHTML = `<i style="background:${AIR[k].color}"></i><span></span>`;
    li.querySelector('span').textContent = `${AIR[k].name}: ${eff}`;
    ul.appendChild(li);
  }
}

function updateArms(arms, shields) {
  const key = arms + ':' + shields;
  if (hudCache.arms === key) return;
  hudCache.arms = key;
  let html = '';
  for (let i = 0; i < 6; i++) html += `<i class="${i < arms ? '' : 'broken'}"></i>`;
  for (let i = 0; i < shields; i++) html += '<i class="shield"></i>';
  $('hud-arms').innerHTML = html;
}

const lens = $('lens');
const lctx = lens.getContext('2d');
let lensVersion = -1, lensT = 0, lensSize = 160;
function sizeLens() {
  const r = lens.getBoundingClientRect();
  lensSize = Math.max(48, Math.round(r.width || 160));
  const px = Math.round(lensSize * view.dpr);
  if (lens.width !== px) {
    lens.width = lens.height = px;
    lensVersion = -1;
  }
}

function drawLens(dt) {
  lensT -= dt;
  const c = run.crystal;
  if (lensT > 0 || c.version === lensVersion) return;
  lensT = 0.1;
  lensVersion = c.version;
  const size = lensSize;
  lctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  lctx.clearRect(0, 0, size, size);
  lctx.save();
  lctx.translate(size / 2, size / 2);
  const R = Math.max(6, c.radius);
  drawCrystal(lctx, c, (size * 0.42) / R, { ...PHOTO_STYLE, glowBlur: 4, minLine: 0.8 });
  lctx.restore();
}

function updateHUD(dt) {
  const h = run.hud();
  setText('hud-score', fmt(h.score));
  setText('hud-species', SPECIES_BY_ID[h.estimate].name);
  setText('hud-air', h.air);
  setText('hud-temp', `${h.temp} °C`);
  setText('hud-hum', `${h.hum}% humidity`);
  setText('hud-alt', `${fmt(h.alt)} m above ground`);
  if (hudCache.dot !== h.habit) {
    hudCache.dot = h.habit;
    const dot = $('hud-air-dot');
    dot.style.background = AIR[h.habit].color;
    dot.style.color = AIR[h.habit].color;
  }
  const pct = Math.round(h.progress * 1000) / 10;
  if (hudCache.alt !== pct) {
    hudCache.alt = pct;
    $('hud-alt-fill').style.width = pct + '%';
  }
  updateArms(h.arms, h.shields);
  const combo = $('combo');
  if (h.combo >= 3) {
    setText('combo', `Vapor chain x${h.combo}`);
    combo.classList.add('show');
  } else combo.classList.remove('show');
  drawLens(dt);
}

// ------------------------------------------------------------------ run lifecycle
function startRun() {
  const sky = SKY_BY_ID[save.sky] || SKIES[0];
  run = new Run(sky, save.up);
  lastResult = null;
  mode = 'play';
  showScreen(null);
  hud.hidden = false;
  for (const k in hudCache) delete hudCache[k];
  lensVersion = -1;
  buildLegend(sky);
  sizeLens();
  input.reset();
  save.runs++;
  persist();
  audio.playMusic(sky.music, 0.3);
  sdk.gameplayStart();
  if (!tutorial('steer', isTouch ? 'Drag anywhere to steer' : 'Move the mouse (or A/D) to steer', 3000)) {
    toast(`${sky.name}<small>${fmt(sky.alt * (1 + 0.12 * (save.up.high || 0)))} m to the ground</small>`, 2000);
  }
}

function handleEvents() {
  const evs = run.events;
  if (!evs.length) return;
  run.events = [];
  for (const e of evs) {
    switch (e.t) {
      case 'collect':
        audio.sfx('collect', e.combo);
        break;
      case 'branch':
        audio.sfx('branch');
        break;
      case 'zone':
        if (e.fresh) audio.sfx('zone');
        if (AIR[e.habit] && AIR[e.habit].tip) tutorial('air' + e.habit, `<span style="color:${AIR[e.habit].color}">${AIR[e.habit].name}</span><small>${AIR[e.habit].tip}</small>`, 2600);
        break;
      case 'hit':
        audio.sfx('hit');
        if (e.arms > 0 && e.arms <= 2) toast(`Careful! ${e.arms} arm${e.arms > 1 ? 's' : ''} left`, 1600);
        else tutorial('hit', 'Ouch! Hits break off an arm<small>Broken arms ruin the symmetry</small>', 2400);
        break;
      case 'shield':
        audio.sfx('shield');
        toast('Ice Shield blocked the hit!', 1400);
        break;
      case 'gust':
        audio.sfx('gust');
        tutorial('gust', 'Wind gust ahead!<small>It pushes you sideways</small>', 2200);
        break;
      case 'twin':
        audio.sfx('golden');
        toast(e.ok ? '<span style="color:#ffd36b">Twin Spark!</span><small>Your crystal now grows 12 arms</small>' : '<span style="color:#ffd36b">Golden boost!</span>', 2400);
        break;
      case 'final':
        toast('Land on the <span style="color:#ffd36b">black velvet board</span><small>for a perfect photo (x2)</small>', 2600);
        break;
      case 'land':
        audio.sfx('land', e.surface === 'velvet');
        audio.setLoops(0, 0, 0);
        sdk.gameplayStop();
        toast(`<span style="color:${e.surface === 'warm' ? '#ff8a4c' : '#ffd36b'}">${LANDING[e.surface].label}</span>`, 1600);
        break;
      case 'fail':
        audio.sfx('fail');
        audio.setLoops(0, 0, 0);
        sdk.gameplayStop();
        break;
      case 'revive':
        audio.sfx('revive');
        break;
    }
  }
}

function stepRun(dt) {
  const steer = input.steer(run.f.x);
  run.update(dt, steer, view.viewH);
  handleEvents();
  if (run.state === 'fall' || run.state === 'final') {
    audio.setLoops(Math.min(1, Math.abs(run.wind) / 260), run.meltLevel, 1);
    audio.setIntensity(Math.min(1, run.boost / 2));
  }
  updateHUD(dt);
  if (run.state === 'landed' && run.endT > 1.3) showResult();
  else if (run.state === 'failed' && run.endT > 0.9) showFail();
}

function pause(auto = false) {
  if (mode !== 'play' || !run || run.state === 'landed' || run.state === 'failed') return;
  mode = 'pause';
  showScreen('pause');
  refreshToggles();
  audio.setLoops(0, 0, 0);
  // CrazyGames handles focus loss itself, so only report real pause-menu breaks
  if (!auto) sdk.gameplayStop();
}

function resume() {
  if (mode !== 'pause') return;
  mode = 'play';
  showScreen(null);
  input.reset();
  sdk.gameplayStart();
}

input.onPause = () => {
  if (mode === 'play') pause();
  else if (mode === 'pause') resume();
};

function showFail() {
  if (run.revived) {
    showResult();
    return;
  }
  mode = 'fail';
  const melt = run.failReason === 'melt';
  $('fail-title').textContent = melt ? 'Your snowflake melted!' : 'Your snowflake shattered!';
  $('fail-text').textContent = 'Watch a short ad to refreeze it and keep falling.';
  $('btn-revive').disabled = false;
  showScreen('fail');
}

async function showAd(type) {
  adActive = true;
  const ok = await sdk.requestAd(type, {
    onStart: () => audio.setMute('ad', true),
    onEnd: () => audio.setMute('ad', false),
  });
  audio.setMute('ad', false);
  adActive = false;
  return ok;
}

async function doRevive() {
  const btn = $('btn-revive');
  btn.disabled = true;
  const ok = await showAd('rewarded');
  if (ok && run && mode === 'fail') {
    run.revive();
    mode = 'play';
    hud.hidden = false;
    showScreen(null);
    input.reset();
    sdk.gameplayStart();
  } else {
    $('fail-text').textContent = 'No ad is available right now. Try again in a moment.';
    btn.disabled = false;
  }
}

function showResult() {
  if (mode === 'result') return;
  mode = 'result';
  hud.hidden = true;
  sdk.gameplayStop();
  const r = run.result();
  lastResult = r;
  const sp = SPECIES_BY_ID[r.species];
  let frost = Math.max(1, Math.round(r.score / 45));
  let isNew = false;
  const beforeCount = discoveredCount();
  if (!r.failed) {
    const entry = save.species[r.species];
    isNew = !entry;
    if (isNew) frost += 40;
    const data = run.crystal.toData();
    if (!entry) save.species[r.species] = { count: 1, best: r.score, flake: data, sky: run.sky.id };
    else {
      entry.count++;
      if (r.score > entry.best) Object.assign(entry, { best: r.score, flake: data, sky: run.sky.id });
    }
  }
  const skyRec = save.skies[run.sky.id] || (save.skies[run.sky.id] = { best: 0 });
  const newBest = !r.failed && r.score > skyRec.best;
  if (newBest) skyRec.best = r.score;
  save.specimen++;
  save.frost += frost;
  r.frost = frost;
  persistNow();

  // UI
  flash();
  audio.sfx('shutter');
  if (isNew) {
    setTimeout(() => audio.sfx('species'), 350);
    sdk.happytime();
  }
  $('res-new').hidden = !isNew;
  const rar = $('res-rarity');
  rar.className = 'rarity r-' + sp.rarity.split(' ')[0];
  rar.textContent = r.failed ? 'Lost' : sp.rarity;
  $('res-name').textContent = r.failed ? (r.reason === 'melt' ? 'A Little Raindrop' : 'Ice Shards') : sp.name;
  $('res-specimen').textContent = `Specimen #${String(save.specimen).padStart(4, '0')} · ${run.sky.name}`;
  const st = r.st;
  const stats = [
    ['Diameter', `${diameterMM(st.R)} mm`],
    ['Arms', `${6 - st.broken}/6${st.twin ? ' (+6)' : ''}`],
    ['Branches', `${st.nB * 2 * 6}`],
    ['Symmetry', `${Math.round(st.sym * 100)}%`],
  ];
  $('res-stats').innerHTML = stats.map(([k, v]) => `<li><span>${k}</span><b>${v}</b></li>`).join('');
  const land = $('res-landing');
  if (r.failed) {
    land.textContent = r.reason === 'melt' ? 'Melted before landing - x0.35' : 'Shattered before landing - x0.35';
    land.classList.add('bad');
  } else {
    land.textContent = `${LANDING[r.surface].label} - x${LANDING[r.surface].mult}`;
    land.classList.toggle('bad', r.surface === 'warm');
  }
  $('res-frost').textContent = fmt(frost);
  $('res-best').textContent = newBest ? 'New best in this sky!' : isNew ? '(includes +40 new species bonus)' : '';
  // count-up for the score
  const scoreEl = $('res-score');
  const t0 = performance.now();
  const tick = (now) => {
    const k = Math.min(1, (now - t0) / 900);
    scoreEl.textContent = fmt(r.score * (1 - Math.pow(1 - k, 3)));
    if (k < 1 && mode === 'result') requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  // unlocks
  const afterCount = discoveredCount();
  const unlocked = SKIES.filter((s) => s.need > beforeCount && s.need <= afterCount);
  const un = $('res-unlock');
  un.hidden = !unlocked.length;
  if (unlocked.length) un.textContent = `New sky unlocked: ${unlocked.map((s) => s.name).join(', ')}!`;
  const dbl = $('btn-double');
  dbl.disabled = false;
  dbl.hidden = false;
  showScreen('result');
  const photo = $('photo');
  const size = Math.round(photo.getBoundingClientRect().width) || 360;
  renderPhoto(photo, run.crystal, size, view.dpr, { rot: run.f.rot, tint: r.surface === 'velvet' ? '#1d2650' : '#1a2142' });
}

async function doDouble() {
  const btn = $('btn-double');
  if (!lastResult || btn.disabled) return;
  btn.disabled = true;
  const ok = await showAd('rewarded');
  if (ok && lastResult) {
    save.frost += lastResult.frost;
    persistNow();
    $('res-frost').textContent = `${fmt(lastResult.frost * 2)}`;
    $('res-best').textContent = 'Doubled!';
    btn.hidden = true;
    audio.sfx('buy');
  } else {
    btn.disabled = false;
    $('res-best').textContent = 'No ad available right now.';
  }
}

async function nextFlake() {
  if (adActive) return;
  await showAd('midgame'); // natural break between falls; the SDK handles ad pacing
  startRun();
}

async function toMenuAfterResult() {
  if (adActive) return;
  await showAd('midgame');
  goMenu();
}

// ------------------------------------------------------------------ wiring
function on(id, fn) {
  $(id).addEventListener('click', (e) => {
    audio.unlock();
    fn(e);
  });
}
on('btn-play', () => {
  audio.sfx('click');
  startRun();
});
on('btn-album', openAlbum);
on('btn-shop', () => {
  audio.sfx('click');
  openShop();
});
on('sky-prev', () => cycleSky(-1));
on('sky-next', () => cycleSky(1));
on('tg-music', toggleMusic);
on('tg-sfx', toggleSfx);
on('pz-music', toggleMusic);
on('pz-sfx', toggleSfx);
on('btn-pause', () => pause());
on('btn-resume', () => {
  audio.sfx('click');
  resume();
});
on('btn-quit', () => {
  audio.sfx('click');
  goMenu();
});
on('btn-revive', doRevive);
on('btn-giveup', () => {
  audio.sfx('click');
  showResult();
});
on('btn-double', doDouble);
on('btn-next', nextFlake);
on('btn-menu', toMenuAfterResult);
on('detail-close', () => ($('album-detail').hidden = true));
$('album-detail').addEventListener('click', (e) => {
  if (e.target === $('album-detail')) $('album-detail').hidden = true;
});
document.querySelectorAll('[data-back]').forEach((b) =>
  b.addEventListener('click', () => {
    audio.sfx('click');
    goMenu();
  })
);
window.addEventListener('pointerdown', () => audio.unlock(), { passive: true });
window.addEventListener('keydown', () => audio.unlock());

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    audio.setMute('hidden', true);
    if (mode === 'play') pause(true);
  } else audio.setMute('hidden', false);
});

// ------------------------------------------------------------------ main loop
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  view.dt = dt;
  try {
    if (run && (mode === 'play' || mode === 'pause' || mode === 'fail' || mode === 'result')) {
      if (mode === 'play' && !adActive) stepRun(dt);
      else if ((mode === 'fail' || mode === 'result') && !adActive) run.update(dt, { mode: 'dir', dir: 0 }, view.viewH);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      run.draw(ctx, view);
    } else if (mode !== 'loading') {
      menuScene.draw(ctx, W, H, view.dpr, dt, SKY_BY_ID[menuSky] || SKIES[0], landscape);
    } else {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#070b24';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  } catch (err) {
    console.error(err);
  }
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ boot
async function boot() {
  resize();
  requestAnimationFrame(frame);
  await sdk.initSDK();
  sdk.loadingStart();
  audio.setMute('sdk', sdk.sdkSettings().muteAudio);
  sdk.onSettingsChange((s) => audio.setMute('sdk', s.muteAudio));
  await loadSave();
  if (!SKY_BY_ID[save.sky] || !skyUnlocked(SKY_BY_ID[save.sky])) save.sky = 'village';
  try {
    if (document.fonts && document.fonts.load) {
      await Promise.race([
        Promise.all([document.fonts.load('600 20px Fredoka'), document.fonts.load('800 16px Nunito')]),
        new Promise((r) => setTimeout(r, 1500)),
      ]);
    }
  } catch (e) {
    /* fonts are optional */
  }
  menuScene.init(heroCrystal());
  sdk.loadingStop();
  goMenu();
  if (/[?&]ffdebug/.test(location.search)) exposeDebug();
}

function exposeDebug() {
  window.__ff = {
    get mode() { return mode; },
    get run() { return run; },
    save,
    startRun,
    showResult,
    /** Average ms to re-render the in-game crystal sprite and the HUD lens. */
    perf(n = 20) {
      // worst case: a big fern dendrite (many branches + sub-branches)
      const c = new Crystal();
      for (let t = 0; t < 70; t += 0.05) c.grow(0.05, 'D', 0.97, 1);
      const real = run.crystal;
      run.crystal = c;
      const s = (17 + c.radius * 0.5) / c.radius;
      let t0 = performance.now();
      for (let i = 0; i < n; i++) {
        run.sprite.version = -2;
        run.sprite.age = 1;
        run.sprite.update(c, s * view.s, view.dpr, 1);
        run.sprite.ctx.getImageData(0, 0, 1, 1); // force rasterisation
      }
      const sprite = (performance.now() - t0) / n;
      t0 = performance.now();
      for (let i = 0; i < n; i++) {
        lensVersion = -1;
        lensT = 0;
        drawLens(0);
        lctx.getImageData(0, 0, 1, 1);
      }
      const lensMs = (performance.now() - t0) / n;
      run.crystal = real;
      run.sprite.version = -1;
      return { sprite, lens: lensMs, R: c.radius, branches: c.branches.length };
    },
    /** Simulate `seconds` of play with a simple bot that steers towards nearby mist. */
    sim(seconds, bot = true, stopAt = null) {
      if (!run) return null;
      const steps = Math.round(seconds * 60);
      for (let i = 0; i < steps && (run.state === 'fall' || run.state === 'final') && run.state !== stopAt; i++) {
        let target = run.f.x;
        if (bot) {
          let best = null, bd = 1e9;
          for (const z of run.zones) {
            if (z.type === 'W' || z.y < run.f.y - 50) continue;
            const d = z.y - run.f.y + Math.abs(z.x - run.f.x) * 0.5;
            if (d < bd) { bd = d; best = z; }
          }
          if (best) target = best.x;
          if (run.state === 'final') target = (run.surfaces[0].x0 + run.surfaces[0].x1) / 2;
        }
        run.update(1 / 60, { mode: 'target', x: target }, view.viewH);
        handleEvents();
      }
      return run.state;
    },
  };
}

boot();
