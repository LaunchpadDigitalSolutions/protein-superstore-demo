/* Launchpad Feature — Cart (menu, basket, checkout)
   Part of LaunchServe / LaunchServe GO.

   Extracted from launchserve-demo (Dancing Cup), where the same 15
   functions were duplicated across 5 other demos.

   FIXED DURING EXTRACTION
   1. Order references were 'A' + random(100–999) — 900 possible values, used
      as the PRIMARY KEY. On a busy service two orders collide and one fails
      to save. Now a time-ordered ref with a random tail.
   2. Option surcharges were parsed out of the display label with a regex
      (`opt.includes('+£')`). Rename the label and the price silently
      changed. Now read from structured data via the menu feature.
   3. Basket lived in a variable, so a refresh or a dropped signal lost the
      order mid-checkout. Now survives a reload.
   4. Line ids used Date.now(), which collides on rapid taps.

   NOT FIXED — needs a server
   The client calculates the total and sends it. Anyone can edit that in the
   console and pay £0.01. Fine while payment is 'pay at counter' where staff
   see the real total, NOT fine once card payment is live. See README.

   Usage:
     import { configure } from '../../core/db.js';
     import { Menu } from '../menu/menu.js';
     import { Cart } from './cart.js';

     const menu = new Menu({ venue: 'dancing-cup' });
     const cart = new Cart({ mount: el, menu, venue: 'dancing-cup', tableNumber: '12' });
     await cart.render();
*/

import { db as coreDb } from '../../core/db.js';

const STORAGE_PREFIX = 'lp_cart_';

export class Cart {
  constructor(opts = {}) {
    if (!opts.mount) throw new Error('LP-080: Cart needs a mount element');
    if (!opts.menu)  throw new Error('LP-081: Cart needs a Menu instance');
    if (!opts.venue) throw new Error('LP-082: Cart needs a venue');

    this.el     = opts.mount;
    this.menu   = opts.menu;
    this.venue  = opts.venue;
    this.db     = opts.db || opts.menu.db || coreDb;

    this.tableNumber   = opts.tableNumber || null;
    this.orderType     = opts.orderType || 'table';   /* table | collection | delivery */
    this.paymentMethod = opts.paymentMethod || 'counter';
    this.minimumOrder  = Number(opts.minimumOrder) || 0;
    this.pointsPerPound = opts.pointsPerPound ?? 10;
    this.persist       = opts.persist !== false;

    this.onOrderPlaced = opts.onOrderPlaced || (() => {});
    this.onError       = opts.onError || (m => console.error(m));
    this.onChange      = opts.onChange || (() => {});
    this.loyalty       = opts.loyalty || null;   /* optional Loyalty instance */

    this.lines = [];
    this.el.classList.add('lp-cart');
    if (this.persist) this._restore();
  }

  /* ---------- basket ---------- */

  get subtotal() {
    return round(this.lines.reduce((s, l) => s + l.price * l.qty, 0));
  }

  get count() {
    return this.lines.reduce((s, l) => s + l.qty, 0);
  }

  get isEmpty() { return this.lines.length === 0; }

  get meetsMinimum() { return this.subtotal >= this.minimumOrder; }

  /* selections: { "Choose your filling": "Full House" } */
  add(itemId, { qty = 1, selections = {}, note = '' } = {}) {
    const found = this.menu.findItem(itemId);
    if (!found) throw new Error('LP-083: no menu item with id ' + itemId);

    const { item, category } = found;
    if (item.is_available === false) throw new Error('LP-084: "' + item.name + '" is sold out');

    const missing = this.menu.missingChoices(item, selections);
    if (missing.length) throw new Error('LP-085: please choose: ' + missing.join(', '));

    qty = Math.max(1, Math.floor(Number(qty) || 1));

    /* Price from structured data, not scraped off a label. */
    const price = this.menu.priceOf(item, selections);
    const route = this.menu.routeOf(item, category);

    const choiceNote = Object.entries(selections)
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => k + ': ' + (Array.isArray(v) ? v.join(', ') : v))
      .join(' · ');
    const fullNote = [choiceNote, String(note || '').trim()].filter(Boolean).join(' · ');

    /* Same item, same options, same note → bump the quantity rather than
       adding a second line. */
    const existing = this.lines.find(l =>
      String(l.itemId) === String(itemId) && l.note === fullNote && l.price === price);
    if (existing) {
      existing.qty += qty;
    } else {
      this.lines.push({
        lineId: newLineId(),
        itemId: item.id,
        name: item.name,
        price,
        qty,
        note: fullNote,
        route: route === 'drink' ? 'drink' : 'food',
        selections
      });
    }
    this._save();
    this.onChange(this);
    return this;
  }

  setQty(lineId, qty) {
    const line = this.lines.find(l => l.lineId === lineId);
    if (!line) return this;
    qty = Math.floor(Number(qty) || 0);
    if (qty <= 0) return this.remove(lineId);
    line.qty = qty;
    this._save();
    this.onChange(this);
    return this;
  }

  remove(lineId) {
    this.lines = this.lines.filter(l => l.lineId !== lineId);
    this._save();
    this.onChange(this);
    return this;
  }

  clear() {
    this.lines = [];
    this._save();
    this.onChange(this);
    return this;
  }

  /* ---------- checkout ---------- */

  async placeOrder({ email = null, name = null, phone = null,
                     marketingOptIn = false, tableNumber = null,
                     paymentMethod = null, notes = '' } = {}) {
    if (this.isEmpty) throw new Error('LP-086: the basket is empty');
    if (!this.meetsMinimum) {
      throw new Error('LP-087: minimum order is £' + this.minimumOrder.toFixed(2));
    }

    const table = tableNumber || this.tableNumber;
    if (this.orderType === 'table' && !table) {
      throw new Error('LP-088: table number is required');
    }

    const ref = newOrderRef();
    const items = this.lines.map(l => ({
      n: l.name + (l.note ? ' (' + l.note + ')' : ''),
      q: l.qty,
      price: l.price,
      type: l.route
    }));
    const foodItems  = items.filter(i => i.type === 'food');
    const drinkItems = items.filter(i => i.type === 'drink');
    const total = this.subtotal;

    const order = {
      id: ref,
      venue: this.venue,
      table_num: String(table || ''),
      items,
      food_items: foodItems,
      drink_items: drinkItems,
      total,
      payment: paymentMethod || this.paymentMethod,
      customer_email: email ? String(email).trim().toLowerCase() : null,
      status: 'active',
      food_status:  foodItems.length  ? 'active' : 'none',
      drink_status: drinkItems.length ? 'active' : 'none'
    };

    try {
      await this.db('POST', '/rest/v1/ls_orders', order);
    } catch (e) {
      this.onError('LP-089: ' + e.message);
      throw new Error('Could not send your order. Please try again or order at the counter.');
    }

    /* Everything past this point is a bonus — the order is already in.
       A failure here must never look like a failed order. */
    if (email) {
      try {
        await this._saveCustomer({ email, name, phone, marketingOptIn });
      } catch (e) { this.onError('LP-090: customer save failed — ' + e.message); }

      if (this.loyalty && this.pointsPerPound) {
        try {
          await this.loyalty.addPoints(email, Math.floor(total * this.pointsPerPound),
            'Order ' + ref, ref);
        } catch (e) { this.onError('LP-091: loyalty accrual failed — ' + e.message); }
      }
    }

    this.lastOrder = { ref, total, items, order };
    this.clear();
    this.onOrderPlaced(this.lastOrder);
    return this.lastOrder;
  }

  async _saveCustomer({ email, name, phone, marketingOptIn }) {
    email = String(email).trim().toLowerCase();
    const existing = await this.db('GET',
      `/rest/v1/ls_customers?venue=eq.${enc(this.venue)}&email=eq.${enc(email)}&select=id`);

    if (existing?.length) {
      const body = { last_seen_at: new Date().toISOString() };
      if (name)  body.name = name;
      if (phone) body.phone = phone;
      /* Only ever turn opt-in ON here. Withdrawing consent happens through
         unsubscribe, and must not be silently reversed by a later order. */
      if (marketingOptIn) body.marketing_opt_in = true;
      await this.db('PATCH', `/rest/v1/ls_customers?id=eq.${enc(existing[0].id)}`, body);
    } else {
      await this.db('POST', '/rest/v1/ls_customers', {
        venue: this.venue, email, name: name || null, phone: phone || null,
        marketing_opt_in: !!marketingOptIn
      });
    }
  }

  /* ---------- rendering ---------- */

  async render() {
    this.el.innerHTML = '<div class="lp-cart-loading">Loading menu…</div>';
    try {
      await this.menu.load();
    } catch (e) {
      this.el.innerHTML = '<div class="lp-cart-error">Could not load the menu.</div>';
      this.onError('LP-092: ' + e.message);
      return;
    }
    this.renderMenu();
  }

  renderMenu() {
    const cats = this.menu.categories.filter(c => c.items.length);
    this.el.innerHTML = `
      <div class="lp-cart-menu">
        ${cats.map(c => `
          <div class="lp-cart-cat">
            <div class="lp-cart-cat-name">${esc(c.name)}</div>
            ${c.items.map(i => `
              <button class="lp-cart-item${i.is_available === false ? ' sold-out' : ''}"
                      data-lp="item" data-id="${escAttr(i.id)}"
                      ${i.is_available === false ? 'disabled' : ''}>
                <span class="lp-cart-item-main">
                  <span class="lp-cart-item-name">${esc(i.name)}${
                    i.is_available === false ? ' <span class="lp-cart-tag">Sold out</span>' : ''}</span>
                  ${i.description ? `<span class="lp-cart-item-desc">${esc(i.description)}</span>` : ''}
                </span>
                <span class="lp-cart-item-price">£${Number(i.price).toFixed(2)}</span>
              </button>`).join('')}
          </div>`).join('')}
      </div>
      ${this.renderBar()}`;
  }

  renderBar() {
    if (this.isEmpty) return '';
    return `
      <div class="lp-cart-bar" data-lp="basket">
        <span class="lp-cart-bar-count">${this.count}</span>
        <span class="lp-cart-bar-label">View basket</span>
        <span class="lp-cart-bar-total">£${this.subtotal.toFixed(2)}</span>
      </div>`;
  }

  basketHtml() {
    if (this.isEmpty) return '<div class="lp-cart-empty">Your basket is empty.</div>';
    return `
      <div class="lp-cart-basket">
        ${this.lines.map(l => `
          <div class="lp-cart-line">
            <div class="lp-cart-line-main">
              <div class="lp-cart-line-name">${esc(l.name)}</div>
              ${l.note ? `<div class="lp-cart-line-note">${esc(l.note)}</div>` : ''}
            </div>
            <div class="lp-cart-qty">
              <button data-lp="dec" data-line="${escAttr(l.lineId)}" aria-label="Fewer">−</button>
              <span>${l.qty}</span>
              <button data-lp="inc" data-line="${escAttr(l.lineId)}" aria-label="More">+</button>
            </div>
            <div class="lp-cart-line-price">£${(l.price * l.qty).toFixed(2)}</div>
          </div>`).join('')}
        <div class="lp-cart-total">
          <span>Total</span><span>£${this.subtotal.toFixed(2)}</span>
        </div>
        ${!this.meetsMinimum ? `<div class="lp-cart-min">
          Minimum order £${this.minimumOrder.toFixed(2)} — add £${(this.minimumOrder - this.subtotal).toFixed(2)} more.
        </div>` : ''}
      </div>`;
  }

  /* ---------- persistence ---------- */

  get _key() { return STORAGE_PREFIX + this.venue; }

  _save() {
    if (!this.persist) return;
    try {
      localStorage.setItem(this._key, JSON.stringify({ lines: this.lines, at: Date.now() }));
    } catch (e) { /* private browsing, quota — not worth failing the order over */ }
  }

  _restore() {
    try {
      const raw = localStorage.getItem(this._key);
      if (!raw) return;
      const saved = JSON.parse(raw);
      /* A basket older than 4 hours is yesterday's, not an interrupted order. */
      if (Date.now() - (saved.at || 0) > 4 * 60 * 60 * 1000) {
        localStorage.removeItem(this._key);
        return;
      }
      this.lines = Array.isArray(saved.lines) ? saved.lines : [];
    } catch (e) {
      localStorage.removeItem(this._key);
    }
  }
}

/* Time-ordered so refs sort chronologically, with a random tail so two
   orders in the same minute can't collide.

   Replaces 'A' + random(100–999), which had 900 possible values and was the
   PRIMARY KEY — on a busy service two orders collide and one fails to save.

   The alphabet excludes 0/O and 1/I so a ref read down the phone isn't
   ambiguous. 32^6 ≈ 1.07 billion tails per minute. */
const REF_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function newOrderRef() {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const mins = String(now.getHours() * 60 + now.getMinutes()).padStart(4, '0');
  let tail = '';
  for (let i = 0; i < 6; i++) {
    tail += REF_ALPHABET[Math.floor(Math.random() * REF_ALPHABET.length)];
  }
  return `${day}${mins}-${tail}`;
}

let lineCounter = 0;
function newLineId() {
  return Date.now().toString(36) + '-' + (++lineCounter).toString(36);
}

function round(n) { return Math.round(n * 100) / 100; }
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const escAttr = esc;
function enc(s) { return encodeURIComponent(s); }
