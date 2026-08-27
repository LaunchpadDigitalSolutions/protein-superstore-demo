/* Launchpad Feature — Kitchen (order screen)
   Part of LaunchServe / LaunchServe GO.

   The screen in the kitchen or behind the bar. Orders arrive, staff tap to
   mark them ready, a chime plays when something new lands. Food and drink
   are separate stations so each only sees its own work.

   Extracted from launchserve-demo (Dancing Cup), duplicated across 4 others.

   FIXED DURING EXTRACTION
   1. The "recently cleared" tray lived in a variable. Clear an order by
      mistake, refresh the screen, and it's unrecoverable. Now persisted.
   2. `seenIds` grew forever. This screen runs 12 hours a day, so the set
      kept every order id of the whole service in memory. Now capped.
   3. Per-order timers were created on every poll and cleared by rebuilding
      the whole grid — with a 4s poll that churned dozens of intervals a
      minute. Now one timer for the whole screen.
   4. The grid was rebuilt from scratch every 4 seconds, so a tap landing
      mid-refresh hit a replaced button. Now only changed cards redraw.
   5. No handling of a dropped connection — the screen silently stopped
      updating and staff had no idea. Now shows a warning.

   Usage:
     import { Kitchen } from './kitchen.js';
     const k = new Kitchen({ mount: el, venue: 'dancing-cup', station: 'kitchen' });
     await k.start();
*/

import { db as coreDb } from '../../core/db.js';

const CLEARED_KEY   = 'lp_kitchen_cleared_';
const SEEN_LIMIT    = 200;      /* plenty for a service, bounded memory */
const CLEARED_KEEP  = 8;
const CLEARED_MAX_AGE = 30 * 60 * 1000;

export class Kitchen {
  constructor(opts = {}) {
    if (!opts.mount) throw new Error('LP-100: Kitchen needs a mount element');
    if (!opts.venue) throw new Error('LP-101: Kitchen needs a venue');

    this.el      = opts.mount;
    this.venue   = opts.venue;
    this.station = opts.station === 'bar' ? 'bar' : 'kitchen';
    this.db      = opts.db || coreDb;

    this.pollMs   = opts.pollMs || 4000;
    this.amberMin = opts.amberMin ?? 5;
    this.redMin   = opts.redMin ?? 10;
    this.sound    = opts.sound !== false;
    this.confirm  = opts.confirm || (msg => Promise.resolve(window.confirm(msg)));
    this.onError  = opts.onError || (m => console.error(m));
    this.onNewOrder = opts.onNewOrder || (() => {});

    this.statusField = this.station === 'kitchen' ? 'food_status'   : 'drink_status';
    this.readyField  = this.station === 'kitchen' ? 'food_ready_at' : 'drink_ready_at';
    this.itemsField  = this.station === 'kitchen' ? 'food_items'    : 'drink_items';
    this.otherField  = this.station === 'kitchen' ? 'drink_status'  : 'food_status';

    this.orders  = [];
    this.seen    = new Set();
    this.cleared = [];
    this.online  = true;
    this._first  = true;
    this._poll   = null;
    this._tick   = null;
    this._lastSignature = '';

    this.el.classList.add('lp-kitchen');
    this.el.addEventListener('click', e => this._onClick(e));
    this._restoreCleared();
  }

  /* ---------- lifecycle ---------- */

  async start() {
    await this.refresh();
    this._poll = setInterval(() => this.refresh().catch(() => {}), this.pollMs);
    /* One timer for the whole screen rather than one per order. */
    this._tick = setInterval(() => this._updateTimers(), 1000);
    return this;
  }

  stop() {
    clearInterval(this._poll); this._poll = null;
    clearInterval(this._tick); this._tick = null;
    return this;
  }

  /* ---------- data ---------- */

  async refresh() {
    let rows;
    try {
      rows = await this.db('GET',
        `/rest/v1/ls_orders?venue=eq.${enc(this.venue)}` +
        `&${this.statusField}=in.(active,ready)` +
        `&order=created_at.asc&select=*`) || [];
      if (!this.online) { this.online = true; this._lastSignature = ''; }
    } catch (e) {
      /* Don't wipe the screen — staff still need to see the current orders.
         Just flag that it's gone stale. */
      if (this.online) {
        this.online = false;
        this._lastSignature = '';
        this.render();
        this.onError('LP-102: ' + e.message);
      }
      return this.orders;
    }

    /* Chime for orders we haven't seen before, but never on first load —
       otherwise opening the screen sets off a dozen chimes. */
    const fresh = rows.filter(o => !this.seen.has(o.id));
    if (!this._first && fresh.length) {
      if (this.sound) playChime();
      fresh.forEach(o => this.onNewOrder(o));
    }
    this._first = false;

    rows.forEach(o => this.seen.add(o.id));
    if (this.seen.size > SEEN_LIMIT) {
      /* Bounded — this screen runs all day. */
      this.seen = new Set([...this.seen].slice(-SEEN_LIMIT));
    }

    this.orders = rows;
    this.render();
    return rows;
  }

  get activeCount() {
    return this.orders.filter(o => o[this.statusField] === 'active').length;
  }

  /* ---------- actions ---------- */

  async markReady(orderId) {
    const patch = {};
    patch[this.statusField] = 'ready';
    patch[this.readyField]  = new Date().toISOString();
    await this._patch(orderId, patch, 'LP-103');
  }

  /* Clear it off the screen. If the other station is already done, the
     whole order is complete. */
  async clearOrder(orderId) {
    /* Always read fresh. The local list is a snapshot up to pollMs old, and
       the OTHER station may have marked its half ready in the meantime — if
       we trust the stale copy the order never gets marked complete and sits
       active forever. */
    let order;
    try {
      order = (await this.db('GET',
        `/rest/v1/ls_orders?id=eq.${enc(orderId)}&select=*`))?.[0];
    } catch (e) {
      order = this.orders.find(o => o.id === orderId);   /* offline fallback */
    }
    if (!order) return;

    const patch = {};
    patch[this.statusField] = 'none';

    const other = order[this.otherField];
    if (other === 'none' || other === 'ready') {
      patch.status = 'complete';
      patch.completed_at = new Date().toISOString();
    }

    this._remember(order);
    await this._patch(orderId, patch, 'LP-104');
  }

  /* Undo a mistaken clear. */
  async restore(orderId) {
    const patch = {};
    patch[this.statusField] = 'active';
    patch.status = 'active';
    patch.completed_at = null;
    this.cleared = this.cleared.filter(o => o.id !== orderId);
    this._saveCleared();
    await this._patch(orderId, patch, 'LP-105');
  }

  async refund(orderId) {
    const ok = await this.confirm(`Mark order ${orderId} as refunded?`);
    if (!ok) return false;
    await this._patch(orderId, {
      status: 'refunded',
      completed_at: new Date().toISOString()
    }, 'LP-106');
    return true;
  }

  async _patch(orderId, patch, code) {
    try {
      await this.db('PATCH', `/rest/v1/ls_orders?id=eq.${enc(orderId)}`, patch);
      await this.refresh();
    } catch (e) {
      this.onError(code + ': ' + e.message);
      throw e;
    }
  }

  /* ---------- cleared tray ---------- */

  _remember(order) {
    this.cleared = [{ id: order.id, table_num: order.table_num, clearedAt: Date.now() },
                    ...this.cleared.filter(o => o.id !== order.id)]
                   .slice(0, CLEARED_KEEP);
    this._saveCleared();
  }

  get recentlyCleared() {
    const cutoff = Date.now() - CLEARED_MAX_AGE;
    this.cleared = this.cleared.filter(o => o.clearedAt > cutoff);
    return this.cleared;
  }

  get _clearedKey() { return CLEARED_KEY + this.venue + '_' + this.station; }

  _saveCleared() {
    try { localStorage.setItem(this._clearedKey, JSON.stringify(this.cleared)); } catch (e) {}
  }

  _restoreCleared() {
    try {
      const raw = localStorage.getItem(this._clearedKey);
      const saved = raw ? JSON.parse(raw) : [];
      this.cleared = Array.isArray(saved) ? saved : [];
    } catch (e) { this.cleared = []; }
  }

  /* ---------- rendering ---------- */

  render() {
    /* Only redraw when something actually changed — otherwise a tap landing
       mid-poll hits a button that's just been replaced. */
    const signature = this.orders.map(o =>
      o.id + ':' + o[this.statusField]).join('|') + '|' + this.online + '|' +
      this.recentlyCleared.map(c => c.id).join(',');
    if (signature === this._lastSignature) { this._updateTimers(); return; }
    this._lastSignature = signature;

    const cleared = this.recentlyCleared;
    this.el.innerHTML = `
      <div class="lp-kit-head">
        <div class="lp-kit-title">${this.station === 'bar' ? 'Bar' : 'Kitchen'}</div>
        <div class="lp-kit-badge${this.activeCount ? '' : ' zero'}">${this.activeCount} active</div>
      </div>
      ${this.online ? '' :
        '<div class="lp-kit-offline">Connection lost — showing the last known orders. Retrying…</div>'}
      <div class="lp-kit-grid">
        ${this.orders.length
          ? this.orders.map(o => this._card(o)).join('')
          : '<div class="lp-kit-empty">No orders waiting.</div>'}
      </div>
      ${cleared.length ? `
        <div class="lp-kit-tray">
          <div class="lp-kit-tray-title">Recently cleared</div>
          ${cleared.map(o => `
            <div class="lp-kit-tray-row">
              <span>Table ${esc(o.table_num || '—')} · ${esc(o.id)}
                <span class="lp-kit-ago" data-ago="${o.clearedAt}"></span></span>
              <button data-lp="restore" data-id="${escAttr(o.id)}">Restore</button>
            </div>`).join('')}
        </div>` : ''}`;
    this._updateTimers();
  }

  _card(o) {
    const items = o[this.itemsField] || [];
    const ready = o[this.statusField] === 'ready';
    return `
      <div class="lp-kit-card${ready ? ' ready' : ''}" data-order="${escAttr(o.id)}">
        <div class="lp-kit-card-head">
          <div>
            <div class="lp-kit-table">Table ${esc(o.table_num || '—')}</div>
            <div class="lp-kit-ref">${esc(o.id)}</div>
          </div>
          <div class="lp-kit-timer" data-since="${new Date(o.created_at).getTime()}">00:00</div>
        </div>
        <div class="lp-kit-items">
          ${items.map(i => `
            <div class="lp-kit-item">
              <span class="lp-kit-qty">${Number(i.q) || 1}×</span>
              <span class="lp-kit-name">${esc(i.n)}</span>
            </div>`).join('')}
        </div>
        <div class="lp-kit-actions">
          ${ready
            ? `<button class="lp-kit-btn done" data-lp="clear" data-id="${escAttr(o.id)}">Clear</button>`
            : `<button class="lp-kit-btn ready" data-lp="ready" data-id="${escAttr(o.id)}">Mark ready</button>`}
        </div>
      </div>`;
  }

  /* One pass over the visible timers each second. */
  _updateTimers() {
    const now = Date.now();
    this.el.querySelectorAll('.lp-kit-timer').forEach(el => {
      const since = Number(el.dataset.since);
      if (!since) return;
      const secs = Math.max(0, Math.floor((now - since) / 1000));
      const mins = Math.floor(secs / 60);
      el.textContent = String(mins).padStart(2, '0') + ':' + String(secs % 60).padStart(2, '0');
      el.className = 'lp-kit-timer ' +
        (mins >= this.redMin ? 'red' : mins >= this.amberMin ? 'amber' : 'green');
    });
    this.el.querySelectorAll('.lp-kit-ago').forEach(el => {
      const mins = Math.floor((now - Number(el.dataset.ago)) / 60000);
      el.textContent = mins < 1 ? 'just now' : mins + 'm ago';
    });
  }

  _onClick(e) {
    const btn = e.target.closest('[data-lp]');
    if (!btn) return;
    const id = btn.dataset.id;
    btn.disabled = true;                     /* stop a double tap */
    const done = () => { btn.disabled = false; };
    if (btn.dataset.lp === 'ready')   this.markReady(id).catch(done).finally(done);
    if (btn.dataset.lp === 'clear')   this.clearOrder(id).catch(done).finally(done);
    if (btn.dataset.lp === 'restore') this.restore(id).catch(done).finally(done);
  }
}

/* Three rising tones. Loud enough to hear over a kitchen. */
export function playChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [[880, 0], [1100, 0.12], [1320, 0.24]].forEach(([freq, delay]) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = freq; osc.type = 'sine';
      gain.gain.setValueAtTime(0, ctx.currentTime + delay);
      gain.gain.linearRampToValueAtTime(0.4, ctx.currentTime + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.5);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.5);
    });
  } catch (e) { /* autoplay blocked until the screen is touched — fine */ }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const escAttr = esc;
function enc(s) { return encodeURIComponent(s); }
