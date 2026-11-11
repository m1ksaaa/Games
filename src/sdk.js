// CrazyGames HTML5 SDK v3 wrapper.
// Every call is guarded, so the game also runs when the SDK is missing
// (opened as a local file, blocked by an ad blocker, or hosted elsewhere).

const SAVE_FALLBACK_PREFIX = 'flakefall:';

const state = {
  sdk: null,
  env: 'none', // 'crazygames' | 'local' | 'disabled' | 'none'
  playing: false,
  loading: false,
  settings: { muteAudio: false, disableChat: false },
  settingsListeners: [],
};

function safe(fn, fallback) {
  try {
    return fn();
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('[sdk]', e && e.message ? e.message : e);
    return fallback;
  }
}

export async function initSDK() {
  const CG = window.CrazyGames && window.CrazyGames.SDK;
  if (!CG) {
    state.env = 'none';
    return state.env;
  }
  try {
    // never let a stuck init block the game from loading
    await Promise.race([CG.init(), new Promise((_, rej) => setTimeout(() => rej(new Error('SDK init timeout')), 8000))]);
    state.env = CG.environment || 'crazygames';
    if (state.env === 'disabled') {
      state.sdk = null;
      return state.env;
    }
    state.sdk = CG;
    const s = safe(() => CG.game.settings, null);
    if (s) state.settings = { ...state.settings, ...s };
    safe(() =>
      CG.game.addSettingsChangeListener((newSettings) => {
        state.settings = { ...state.settings, ...newSettings };
        state.settingsListeners.forEach((l) => l(state.settings));
      })
    );
  } catch (e) {
    console.warn('[sdk] init failed', e);
    state.sdk = null;
    state.env = 'none';
  }
  // Local testing helper documented by CrazyGames: ?muteAudio=true
  if (/[?&]muteAudio=true/.test(location.search)) state.settings.muteAudio = true;
  return state.env;
}

export const sdkEnv = () => state.env;
export const hasSDK = () => !!state.sdk;
export const sdkSettings = () => state.settings;
export function onSettingsChange(listener) {
  state.settingsListeners.push(listener);
}

export function loadingStart() {
  if (state.loading) return;
  state.loading = true;
  if (state.sdk) safe(() => state.sdk.game.loadingStart());
}

export function loadingStop() {
  if (!state.loading) return;
  state.loading = false;
  if (state.sdk) safe(() => state.sdk.game.loadingStop());
}

export function gameplayStart() {
  if (state.playing) return;
  state.playing = true;
  if (state.sdk) safe(() => state.sdk.game.gameplayStart());
}

export function gameplayStop() {
  if (!state.playing) return;
  state.playing = false;
  if (state.sdk) safe(() => state.sdk.game.gameplayStop());
}

export const isGameplayActive = () => state.playing;

export function happytime() {
  if (state.sdk) safe(() => state.sdk.game.happytime());
}

/**
 * Request a video ad.
 * @param {'midgame'|'rewarded'} type
 * @param {{onStart?:Function, onEnd?:Function}} hooks  onStart: mute + pause, onEnd: restore
 * @returns {Promise<boolean>} true when the ad finished (reward may be granted)
 */
export function requestAd(type, hooks = {}) {
  return new Promise((resolve) => {
    if (!state.sdk) {
      // No ad provider outside CrazyGames: midgame is skipped, rewards are granted so the game stays playable.
      resolve(type === 'rewarded');
      return;
    }
    let started = false;
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      if (started && hooks.onEnd) hooks.onEnd();
      resolve(ok);
    };
    try {
      state.sdk.ad.requestAd(type, {
        adStarted: () => {
          started = true;
          if (hooks.onStart) hooks.onStart();
        },
        adFinished: () => finish(true),
        adError: (err) => {
          console.warn('[sdk] ad error', err);
          finish(false);
        },
      });
    } catch (e) {
      console.warn('[sdk] requestAd failed', e);
      finish(false);
    }
  });
}

// ---- Data (progress save). Uses the SDK data module on CrazyGames, localStorage elsewhere
// (and as a fallback if the data module is unavailable, e.g. Progress Save not enabled).
let localBackend = null;
function local() {
  if (localBackend) return localBackend;
  try {
    const ls = window.localStorage;
    const probe = SAVE_FALLBACK_PREFIX + '__probe';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    localBackend = {
      getItem: (k) => ls.getItem(SAVE_FALLBACK_PREFIX + k),
      setItem: (k, v) => ls.setItem(SAVE_FALLBACK_PREFIX + k, v),
    };
  } catch (e) {
    const mem = {};
    localBackend = {
      getItem: (k) => (k in mem ? mem[k] : null),
      setItem: (k, v) => (mem[k] = String(v)),
    };
  }
  return localBackend;
}

const sdkData = () => (state.sdk && state.sdk.data ? state.sdk.data : null);

// Returns a Promise so it works whether the backend is sync (localStorage-like) or async.
export async function dataGet(key) {
  const d = sdkData();
  if (d) {
    try {
      let v = d.getItem(key);
      if (v && typeof v.then === 'function') v = await v;
      return v === undefined ? null : v;
    } catch (e) {
      console.warn('[sdk] data module unavailable, using local save', e);
    }
  }
  try {
    return local().getItem(key);
  } catch (e) {
    return null;
  }
}

export function dataSet(key, value) {
  const d = sdkData();
  if (d) {
    try {
      const r = d.setItem(key, value);
      if (r && typeof r.catch === 'function') r.catch((e) => console.warn('[sdk] save failed', e));
      return;
    } catch (e) {
      console.warn('[sdk] data module unavailable, using local save', e);
    }
  }
  safe(() => local().setItem(key, value));
}
