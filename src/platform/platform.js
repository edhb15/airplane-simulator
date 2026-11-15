// Web portal integration. The CrazyGames build (npm run build:crazygames) loads
// the CrazyGames HTML5 SDK v3; every other build uses the no-op "web" platform,
// so the game behaves exactly the same on GitHub Pages or a self-hosted server.
//
// Everything here is safe to call at any time: before init, without the SDK,
// with an ad blocker, or when the SDK throws.

const SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';
const BUILD_PLATFORM = import.meta.env.VITE_PLATFORM || 'web';

// Minimum time between our own midgame ad requests (the portal caps them too)
const AD_INTERVAL_MS = 3 * 60 * 1000;

function loadScript(src, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (window.CrazyGames && window.CrazyGames.SDK) return resolve();
    // The CrazyGames build already has the tag in index.html (async): wait for it
    if (document.querySelector(`script[src="${src}"]`)) {
      const t0 = performance.now();
      const poll = () => {
        if (window.CrazyGames && window.CrazyGames.SDK) return resolve();
        if (window.__cgSdkFailed) return reject(new Error('SDK failed to load'));
        if (performance.now() - t0 > timeoutMs) return reject(new Error('SDK load timed out'));
        setTimeout(poll, 50);
      };
      return poll();
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    const timer = setTimeout(() => reject(new Error('SDK load timed out')), timeoutMs);
    s.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    s.onerror = () => {
      clearTimeout(timer);
      reject(new Error('SDK failed to load'));
    };
    document.head.appendChild(s);
  });
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), ms))]);
}

class Platform {
  constructor() {
    this.name = BUILD_PLATFORM;
    this.sdk = null;
    this.ready = false;
    this.inGameplay = false;
    this.adPlaying = false;
    this.lastAdAt = performance.now(); // no ad straight after the game opens
    this.settings = { muteAudio: false, disableChat: false };
    this.listeners = new Set();
  }

  // True when running the CrazyGames build (even if the SDK failed to load)
  get isCrazyGames() {
    return this.name === 'crazygames';
  }

  // Portals forbid "Exit" buttons and links that leave the game
  get allowExit() {
    return !this.isCrazyGames;
  }
  get allowExternalLinks() {
    return !this.isCrazyGames;
  }
  // The portal page owns the tab: no "leave site?" prompts
  get allowUnloadPrompt() {
    return !this.isCrazyGames;
  }
  get chatDisabled() {
    return !!this.settings.disableChat;
  }
  get muted() {
    return !!this.settings.muteAudio || this.adPlaying;
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(ev) {
    for (const fn of this.listeners) {
      try {
        fn(ev);
      } catch (e) {
        console.error(e);
      }
    }
  }

  // Must finish before the profile and settings are read, so that saves come
  // from the portal's cloud storage when it is available.
  async init() {
    if (!this.isCrazyGames) return;
    try {
      await loadScript(SDK_URL, 6000);
      const sdk = window.CrazyGames && window.CrazyGames.SDK;
      if (!sdk) throw new Error('SDK missing');
      await withTimeout(sdk.init(), 6000);
      this.sdk = sdk;
      this.ready = sdk.environment !== 'disabled';
      if (!this.ready) return;
      this.readSettings();
      if (sdk.game && sdk.game.addSettingsChangeListener)
        sdk.game.addSettingsChangeListener((s) => {
          this.readSettings(s);
          this.emit({ type: 'settings', settings: this.settings });
          this.emit({ type: 'mute', muted: this.muted });
        });
    } catch (e) {
      // The game must still work if the SDK is blocked or unavailable
      console.warn('[platform] CrazyGames SDK unavailable:', e && e.message ? e.message : e);
      this.sdk = null;
      this.ready = false;
    }
  }

  readSettings(s) {
    const src = s || (this.sdk && this.sdk.game && this.sdk.game.settings) || {};
    this.settings = { muteAudio: !!src.muteAudio, disableChat: !!src.disableChat };
  }

  call(fn) {
    if (!this.ready) return undefined;
    try {
      return fn(this.sdk);
    } catch (e) {
      console.warn('[platform]', e);
      return undefined;
    }
  }

  // ---------------------------------------------------------------- game events
  loadingStart() {
    this.call((s) => s.game.loadingStart());
  }
  loadingStop() {
    this.call((s) => s.game.loadingStop());
  }
  // The player is actively flying (not in menus, pause, debriefs or ads)
  gameplayStart() {
    if (this.inGameplay) return;
    this.inGameplay = true;
    this.call((s) => s.game.gameplayStart());
  }
  gameplayStop() {
    if (!this.inGameplay) return;
    this.inGameplay = false;
    this.call((s) => s.game.gameplayStop());
  }
  // A moment of achievement: mission or lesson passed, promotion
  happytime() {
    this.call((s) => s.game.happytime());
  }

  // ---------------------------------------------------------------- ads
  // Show a midgame ad at a natural break (between flights). Resolves when the
  // game can continue, whether or not an ad was shown. Never rejects.
  midgameAd() {
    if (!this.ready || !this.sdk.ad || this.adPlaying) return Promise.resolve(false);
    if (performance.now() - this.lastAdAt < AD_INTERVAL_MS) return Promise.resolve(false);
    this.lastAdAt = performance.now();
    const wasPlaying = this.inGameplay;
    return new Promise((resolve) => {
      let done = false;
      const finish = (shown) => {
        if (done) return;
        done = true;
        clearTimeout(guard);
        if (this.adPlaying) {
          this.adPlaying = false;
          this.emit({ type: 'ad', playing: false });
          this.emit({ type: 'mute', muted: this.muted });
        }
        if (wasPlaying) this.gameplayStart();
        resolve(shown);
      };
      // Never leave the player stuck behind an ad that never reports back
      const guard = setTimeout(() => finish(false), 90000);
      try {
        this.sdk.ad.requestAd('midgame', {
          adStarted: () => {
            this.gameplayStop();
            this.adPlaying = true;
            this.emit({ type: 'ad', playing: true });
            this.emit({ type: 'mute', muted: true });
          },
          adFinished: () => finish(true),
          adError: () => finish(false),
        });
      } catch {
        finish(false);
      }
    });
  }

  // ---------------------------------------------------------------- multiplayer invites
  get supportsInvites() {
    return this.ready && !!(this.sdk.game && this.sdk.game.inviteLink);
  }
  inviteLink(params) {
    return this.call((s) => s.game.inviteLink(params)) || null;
  }
  inviteParam(name) {
    return this.call((s) => s.game.getInviteParam(name)) || null;
  }

  // ---------------------------------------------------------------- storage
  // The portal's data module mirrors localStorage and syncs saves to the
  // player's account; fall back to localStorage when it is not available.
  get storage() {
    if (this.ready && this.sdk.data) return this.sdk.data;
    return null;
  }
}

export const platform = new Platform();
