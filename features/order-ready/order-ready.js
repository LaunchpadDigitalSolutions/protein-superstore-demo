/* Launchpad Feature — Order ready (tell the customer)
   Part of LaunchServe / LaunchServe GO.

   After ordering, the customer gets a banner, a chime and a phone
   notification when their food or drinks are up — even with the app closed.

   Extracted from launchserve-demo (Dancing Cup).

   FIXED DURING EXTRACTION
   1. Wrong message when drinks were ready first. The original required food
      to have been announced before it would announce drinks, so a customer
      whose drinks arrived first heard nothing, then later got "Your food is
      ready — drinks are on their way" when the drinks had been sat there
      for ten minutes.
   2. The poll never stopped. If an order was never marked ready — staff
      forgot, or it was refunded — it polled every 5 seconds forever,
      flattening the customer's battery. Now gives up after a set time.
   3. Watching was lost on reload. Close the tab or drop signal and the
      customer was never told. Now resumes automatically.
   4. Only one order at a time — a module-level timer variable meant a
      second order silently stopped the first from being watched.
   5. The icon URL was hardcoded to launchserve-demo.pages.dev, so every
      client's notification showed the demo's icon.

   Usage:
     const notify = new OrderReady({ venue: 'dancing-cup', icon: '/icon-192.png' });
     await notify.askPermission();        // after a tap, not on load
     notify.watch(orderRef);
*/

import { db as coreDb } from '../../core/db.js';

const WATCH_KEY = 'lp_watching_order_';

export class OrderReady {
  constructor(opts = {}) {
    if (!opts.venue) throw new Error('LP-170: OrderReady needs a venue');

    this.venue    = opts.venue;
    this.db       = opts.db || coreDb;
    this.icon     = opts.icon || null;
    this.pollMs   = opts.pollMs ?? 5000;
    this.giveUpMs = (opts.giveUpMinutes ?? 90) * 60 * 1000;
    this.sound    = opts.sound !== false;
    this.onReady  = opts.onReady || (() => {});
    this.onError  = opts.onError || (m => console.error(m));

    this.orderId = null;
    this.announced = { food: false, drink: false, all: false };
    this._timer = null;
    this._startedAt = 0;
  }

  /* Ask AFTER a tap. Asking on page load gets denied and can never be
     asked again. */
  async askPermission() {
    if (typeof Notification === 'undefined') return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    try {
      return (await Notification.requestPermission()) === 'granted';
    } catch (e) { return false; }
  }

  get canNotify() {
    return typeof Notification !== 'undefined' && Notification.permission === 'granted';
  }

  /* ---------- watching ---------- */

  watch(orderId, { startedAt = Date.now() } = {}) {
    if (!orderId) return this;
    this.stop();
    this.orderId = orderId;
    this.announced = { food: false, drink: false, all: false };
    this._startedAt = startedAt;
    this._save();
    this._timer = setInterval(() => this.check().catch(() => {}), this.pollMs);
    this.check().catch(() => {});
    return this;
  }

  /* Pick back up after a reload — the customer closed the tab and would
     otherwise never be told. */
  resume() {
    const saved = this._read();
    if (!saved) return null;
    if (Date.now() - saved.startedAt > this.giveUpMs) { this._clear(); return null; }
    this.watch(saved.orderId, { startedAt: saved.startedAt });
    this.announced = saved.announced || this.announced;
    return saved.orderId;
  }

  stop() {
    clearInterval(this._timer);
    this._timer = null;
    return this;
  }

  finish() {
    this.stop();
    this._clear();
    this.orderId = null;
    return this;
  }

  async check() {
    if (!this.orderId) return null;

    /* Don't poll forever. An order that's never marked ready would other-
       wise drain the customer's battery until they closed the tab. */
    if (Date.now() - this._startedAt > this.giveUpMs) { this.finish(); return null; }

    let order;
    try {
      const rows = await this.db('GET',
        `/rest/v1/ls_orders?id=eq.${enc(this.orderId)}` +
        `&select=food_status,drink_status,food_items,drink_items,status`);
      order = rows?.[0];
    } catch (e) {
      return null;                   /* transient — try again next tick */
    }
    if (!order) return null;

    /* Refunded or cancelled: stop, and say nothing. */
    if (['refunded', 'cancelled'].includes(order.status)) { this.finish(); return null; }

    const hasFood  = asArray(order.food_items).length > 0;
    const hasDrink = asArray(order.drink_items).length > 0;
    const foodDone  = !hasFood  || ['ready', 'none'].includes(order.food_status);
    const drinkDone = !hasDrink || ['ready', 'none'].includes(order.drink_status);

    /* Announce whichever is genuinely ready, in whatever order it happens.
       The original insisted on food first, so a customer whose drinks came
       up first heard nothing until the food was done. */
    if (hasFood && hasDrink && foodDone && drinkDone && !this.announced.all) {
      this.announced = { food: true, drink: true, all: true };
      this._fire('Everything is ready', 'Come and collect, or we\u2019ll bring it over.');
      this._save();
      this.finish();
      return 'all';
    }

    if (hasFood && foodDone && !this.announced.food) {
      this.announced.food = true;
      this._fire('Your food is ready',
        hasDrink && !drinkDone ? 'Drinks are still coming.' : 'Come and collect, or we\u2019ll bring it over.');
      this._save();
    }

    if (hasDrink && drinkDone && !this.announced.drink) {
      this.announced.drink = true;
      this._fire('Your drinks are ready',
        hasFood && !foodDone ? 'Food is still coming.' : 'Come and collect, or we\u2019ll bring it over.');
      this._save();
    }

    if (foodDone && drinkDone) { this.finish(); return 'done'; }
    return null;
  }

  /* ---------- announcing ---------- */

  _fire(title, body) {
    if (this.sound) playChime();
    this.showBanner(title, body);
    this.onReady({ title, body, orderId: this.orderId });

    if (!this.canNotify) return;
    const opts = { body, tag: 'order-ready', renotify: true, requireInteraction: true };
    if (this.icon) { opts.icon = this.icon; opts.badge = this.icon; }

    try {
      new Notification(title, opts);
    } catch (e) {
      /* iOS in a home-screen app can only notify via the service worker. */
      if (navigator.serviceWorker) {
        navigator.serviceWorker.ready
          .then(sw => sw.showNotification(title, opts))
          .catch(() => {});
      }
    }
  }

  showBanner(title, body, ms = 15000) {
    let el = document.querySelector('.lp-ready-banner');
    if (!el) {
      el = document.createElement('div');
      el.className = 'lp-ready-banner';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.innerHTML =
      `<div class="lp-ready-title">${esc(title)}</div>` +
      `<div class="lp-ready-sub">${esc(body)}</div>`;
    requestAnimationFrame(() => el.classList.add('on'));
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => el.classList.remove('on'), ms);
  }

  /* ---------- persistence ---------- */

  get _key() { return WATCH_KEY + this.venue; }

  _save() {
    try {
      localStorage.setItem(this._key, JSON.stringify({
        orderId: this.orderId, startedAt: this._startedAt, announced: this.announced
      }));
    } catch (e) {}
  }

  _read() {
    try {
      const raw = localStorage.getItem(this._key);
      const v = raw ? JSON.parse(raw) : null;
      return v?.orderId ? v : null;
    } catch (e) { return null; }
  }

  _clear() {
    try { localStorage.removeItem(this._key); } catch (e) {}
  }
}

export function playChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [[880, 0], [1100, 0.12], [1320, 0.24]].forEach(([f, d]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0, ctx.currentTime + d);
      g.gain.linearRampToValueAtTime(0.4, ctx.currentTime + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + d + 0.5);
      o.start(ctx.currentTime + d); o.stop(ctx.currentTime + d + 0.5);
    });
  } catch (e) {}
}

function asArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch (e) { return []; } }
  return [];
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function enc(s) { return encodeURIComponent(s); }
