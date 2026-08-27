/* Launchpad Feature — PWA (install to home screen, and work offline)

   Turns any Launchpad app into something that installs on a phone, opens
   without a browser bar, and keeps working when the signal drops.

   Extracted from launchserve-demo / cafe / restaurant.

   WHAT WAS WRONG
   1. launchserve-demo/sw.js is a KILL SWITCH. It intercepts every
      navigation and returns a hardcoded "Coming Soon" page instead of the
      app. A service worker persists on the device after install, so anyone
      who added that demo to their home screen sees "Coming Soon" and keeps
      seeing it. If a prospect installed it during a pitch, that's what
      they still have.
   2. None of the three service workers cached anything — every one was
      network-only. A PWA that shows nothing without signal is just a
      bookmark, and "works when the wifi drops" is most of why a café
      wants one.
   3. There was no update path. A user with the app installed could sit on
      a stale version indefinitely with no way to know.
   4. Only 3 of 7 demos are installable at all. launchserve-go-demo,
      go-butcher, book-demo and launchtrade-demo have no manifest and no
      icons — "add to home screen" is a selling point that four of the
      demos cannot actually do.

   Usage — in the page:
     import { PWA } from './features/pwa/pwa.js';
     const pwa = new PWA({ swPath: '/sw.js' });
     await pwa.register();
     pwa.onUpdateAvailable(() => showToast('New version — tap to reload',
       { action: { label: 'Reload', onClick: () => pwa.applyUpdate() } }));
     if (pwa.canInstall) showInstallButton();

   Usage — generating the two static files:
     node -e "…" or copy sw-template.js and edit the CONFIG block.
*/

export class PWA {
  constructor(opts = {}) {
    this.swPath   = opts.swPath || '/sw.js';
    this.scope    = opts.scope || '/';
    this.onError  = opts.onError || (m => console.error(m));
    this._updateHandlers = [];
    this._installHandlers = [];
    this.registration = null;
    this.deferredPrompt = null;
    this.updateReady = false;

    /* Chrome fires this instead of showing its own prompt, so we can put
       the install button where it makes sense rather than where Chrome
       decides. */
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeinstallprompt', e => {
        e.preventDefault();
        this.deferredPrompt = e;
        this._installHandlers.forEach(fn => fn(this));
      });
      window.addEventListener('appinstalled', () => {
        this.deferredPrompt = null;
      });
    }
  }

  get isStandalone() {
    if (typeof window === 'undefined') return false;
    return window.matchMedia?.('(display-mode: standalone)')?.matches
      || window.navigator?.standalone === true;
  }

  get canInstall() { return !!this.deferredPrompt; }

  get isSupported() {
    return typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  }

  async register() {
    if (!this.isSupported) return null;
    try {
      const reg = await navigator.serviceWorker.register(this.swPath, { scope: this.scope });
      this.registration = reg;

      /* A worker sitting in `waiting` means a new version is downloaded
         and blocked behind the open tabs. */
      if (reg.waiting) this._flagUpdate();

      reg.addEventListener('updatefound', () => {
        const incoming = reg.installing;
        if (!incoming) return;
        incoming.addEventListener('statechange', () => {
          if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
            this._flagUpdate();
          }
        });
      });

      /* Check on return to the app — a kitchen screen may be open for days. */
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden) reg.update().catch(() => {});
        });
      }
      return reg;
    } catch (e) {
      this.onError('LP-230: service worker registration failed — ' + e.message);
      return null;
    }
  }

  _flagUpdate() {
    this.updateReady = true;
    this._updateHandlers.forEach(fn => fn(this));
  }

  onUpdateAvailable(fn) { this._updateHandlers.push(fn); return this; }
  onInstallAvailable(fn) { this._installHandlers.push(fn); return this; }

  /* Swap to the new version. Reloads once the new worker takes over. */
  async applyUpdate() {
    const waiting = this.registration?.waiting;
    if (!waiting) { location.reload(); return; }
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      reloaded = true;
      location.reload();
    });
    waiting.postMessage({ type: 'SKIP_WAITING' });
  }

  async promptInstall() {
    if (!this.deferredPrompt) return { outcome: 'unavailable' };
    const prompt = this.deferredPrompt;
    this.deferredPrompt = null;
    prompt.prompt();
    try {
      const choice = await prompt.userChoice;
      return { outcome: choice?.outcome || 'unknown' };
    } catch (e) {
      return { outcome: 'error' };
    }
  }

  /* iOS has no install prompt — Safari requires Share → Add to Home Screen,
     so the app has to say so rather than showing a button that does nothing. */
  get needsManualInstall() {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    const isIOS = /iphone|ipad|ipod/i.test(ua);
    return isIOS && !this.isStandalone;
  }

  async unregister() {
    if (!this.isSupported) return false;
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map(r => r.unregister()));
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    return true;
  }
}

/* ---------- manifest ---------- */

/* Build a manifest for a client. Icons are REQUIRED and checked — the GO
   demo shipped a manifest pointing at icons that were never in the repo,
   so it installed with a blank square. */
export function buildManifest({
  name, shortName, description = '',
  themeColour = '#2563eb', backgroundColour = '#09090b',
  startUrl = '/', scope = '/', display = 'standalone',
  orientation = 'portrait', icons = null
} = {}) {
  if (!name) throw new Error('LP-231: manifest needs a name');
  const short = shortName || name.slice(0, 12);

  const iconList = icons || [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
  ];
  if (!iconList.length) throw new Error('LP-232: manifest needs at least one icon');

  return {
    name, short_name: short, description,
    start_url: startUrl, scope, display, orientation,
    theme_color: themeColour, background_color: backgroundColour,
    icons: iconList
  };
}

/* Check the manifest's icons actually exist before shipping. */
export async function verifyIcons(manifest, { fetchFn = fetch, base = '' } = {}) {
  const results = [];
  for (const icon of manifest.icons || []) {
    const url = base + icon.src;
    try {
      const res = await fetchFn(url, { method: 'HEAD' });
      results.push({ src: icon.src, ok: res.ok, status: res.status });
    } catch (e) {
      results.push({ src: icon.src, ok: false, status: 0, error: e.message });
    }
  }
  return { ok: results.every(r => r.ok), icons: results };
}
