// Player progress. Stored through the CrazyGames data module (cloud save) with a localStorage fallback.
import { dataGet, dataSet } from './sdk.js';

const KEY = 'flakefall_save_v1';

export const UPGRADES = [
  { id: 'agility', name: 'Nimble Drift', desc: 'Steer faster.', max: 5, cost: [40, 90, 170, 280, 430] },
  { id: 'magnet', name: 'Vapor Pull', desc: 'Attract vapor from further away.', max: 5, cost: [50, 110, 200, 320, 480] },
  { id: 'frost', name: 'Frost Heart', desc: 'Melt slower in warm air.', max: 5, cost: [60, 130, 230, 360, 520] },
  { id: 'armor', name: 'Ice Shield', desc: 'Block one hit per fall, per level.', max: 3, cost: [120, 300, 600] },
  { id: 'high', name: 'Higher Clouds', desc: 'Start higher: longer fall, bigger flakes.', max: 5, cost: [80, 170, 300, 470, 700] },
];

export function defaultSave() {
  return {
    v: 1,
    frost: 0,
    up: { agility: 0, magnet: 0, frost: 0, armor: 0, high: 0 },
    species: {}, // id -> {count, best, flake, sky}
    skies: {}, // id -> {best}
    sky: 'village',
    music: true,
    sfx: true,
    tut: {}, // tutorial hints already shown
    runs: 0,
    specimen: 0,
  };
}

export const save = defaultSave();

export async function loadSave() {
  const raw = await dataGet(KEY);
  if (!raw) return save;
  try {
    const d = JSON.parse(raw);
    const def = defaultSave();
    Object.assign(save, def, d, { up: { ...def.up, ...(d.up || {}) }, tut: { ...(d.tut || {}) } });
  } catch (e) {
    console.warn('save corrupted, starting fresh', e);
  }
  return save;
}

let pending = null;
export function persist() {
  // coalesce bursts of writes
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    dataSet(KEY, JSON.stringify(save));
  }, 50);
}

export function persistNow() {
  if (pending) {
    clearTimeout(pending);
    pending = null;
  }
  dataSet(KEY, JSON.stringify(save));
}

export const discoveredCount = () => Object.keys(save.species).length;
