// Test double for https://sdk.crazygames.com/crazygames-sdk-v3.js (used by tools/smoke-test.mjs only).
// Mirrors the v3 API surface the game uses and records every call in window.__sdkLog.
(function () {
  const log = (window.__sdkLog = []);
  const store = {};
  let listeners = [];
  const settings = { muteAudio: false, disableChat: false };
  window.CrazyGames = {
    SDK: {
      environment: 'local',
      init: () => { log.push('init'); return Promise.resolve(); },
      game: {
        get settings() { return settings; },
        addSettingsChangeListener: (l) => listeners.push(l),
        removeSettingsChangeListener: (l) => (listeners = listeners.filter((x) => x !== l)),
        loadingStart: () => log.push('loadingStart'),
        loadingStop: () => log.push('loadingStop'),
        gameplayStart: () => log.push('gameplayStart'),
        gameplayStop: () => log.push('gameplayStop'),
        happytime: () => log.push('happytime'),
      },
      ad: {
        requestAd: (type, cb) => {
          log.push('requestAd:' + type);
          setTimeout(() => {
            cb.adStarted && cb.adStarted();
            setTimeout(() => cb.adFinished && cb.adFinished(), 300);
          }, 50);
        },
        hasAdblock: () => Promise.resolve(false),
      },
      data: {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); log.push('data.setItem'); },
        removeItem: (k) => delete store[k],
        clear: () => Object.keys(store).forEach((k) => delete store[k]),
      },
      __setMute(v) { settings.muteAudio = v; listeners.forEach((l) => l({ ...settings })); },
    },
  };
})();
