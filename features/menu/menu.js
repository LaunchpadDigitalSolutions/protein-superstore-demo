/* Launchpad Feature — Menu
   Product: LaunchMenu (£29/mo). Also the data source for cart and kitchen.

   Two parts:
     Menu       — loads and caches the menu (what customers browse)
     MenuAdmin  — the owner's editor (add, edit, reorder, mark sold out)

   THIS IS NEW CODE, NOT AN EXTRACTION. The demos held their menu in a
   hardcoded JS object and their admin panel edited it in memory, so
   nothing survived a refresh. That means LaunchMenu was never actually
   built despite being priced and pitched.

   Usage — customer side:
     import { configure } from '../../core/db.js';
     import { Menu } from './menu.js';
     configure({ url, key });

     const menu = new Menu({ venue: 'dancing-cup' });
     const cats = await menu.load();
     // [{ id, name, type, items: [{ id, name, price, choices, ... }] }]

   Usage — owner side:
     import { MenuAdmin } from './menu.js';
     new MenuAdmin({ mount: el, menu }).render();
*/

import { db as coreDb } from '../../core/db.js';

/* ---------- customer side ---------- */

export class Menu {
  constructor(opts = {}) {
    if (!opts.venue) throw new Error('LP-070: Menu needs a venue');
    this.venue = opts.venue;
    this.db = opts.db || coreDb;
    this.includeUnavailable = opts.includeUnavailable ?? true;
    this.categories = [];
    this._loaded = false;
  }

  async load({ force = false } = {}) {
    if (this._loaded && !force) return this.categories;

    const v = enc(this.venue);
    const [cats, items] = await Promise.all([
      this.db('GET', `/rest/v1/ls_menu_categories?venue=eq.${v}&is_active=eq.true` +
                     `&select=id,name,type,sort_order&order=sort_order.asc,name.asc`),
      this.db('GET', `/rest/v1/ls_menu_items?venue=eq.${v}&is_active=eq.true` +
                     `&select=id,category_id,name,description,price,type,choices,allergens,is_available,sort_order` +
                     `&order=sort_order.asc,name.asc`)
    ]);

    const byCat = new Map();
    (items || []).forEach(i => {
      if (!this.includeUnavailable && !i.is_available) return;
      if (!byCat.has(i.category_id)) byCat.set(i.category_id, []);
      byCat.get(i.category_id).push({ ...i, price: Number(i.price) });
    });

    this.categories = (cats || []).map(c => ({
      ...c,
      items: byCat.get(c.id) || []
    }));
    this._loaded = true;
    return this.categories;
  }

  /* Does this item go to the kitchen or the bar?
     Item type wins; otherwise inherit the category. */
  routeOf(item, category) {
    return item.type || category?.type || 'food';
  }

  findItem(id) {
    for (const c of this.categories) {
      const hit = c.items.find(i => String(i.id) === String(id));
      if (hit) return { item: hit, category: c };
    }
    return null;
  }

  /* Price including any option surcharges the customer picked.
     selections: { "Choose your filling": "Full House" } */
  priceOf(item, selections = {}) {
    let total = Number(item.price) || 0;
    (item.choices || []).forEach(group => {
      const picked = selections[group.name];
      if (picked == null) return;
      const list = Array.isArray(picked) ? picked : [picked];
      list.forEach(label => {
        const opt = (group.opts || []).find(o =>
          typeof o === 'object' ? o.label === label : o === label);
        if (opt && typeof opt === 'object' && opt.price) total += Number(opt.price);
      });
    });
    return Math.round(total * 100) / 100;
  }

  /* Which required choices haven't been answered? */
  missingChoices(item, selections = {}) {
    return (item.choices || [])
      .filter(g => g.req && (selections[g.name] == null || selections[g.name] === ''))
      .map(g => g.name);
  }
}

/* ---------- owner side ---------- */

export class MenuAdmin {
  constructor(opts = {}) {
    if (!opts.mount) throw new Error('LP-071: MenuAdmin needs a mount element');
    if (!opts.menu)  throw new Error('LP-072: MenuAdmin needs a Menu instance');

    this.el   = opts.mount;
    this.menu = opts.menu;
    this.db   = opts.db || opts.menu.db || coreDb;
    this.onChange = opts.onChange || (() => {});
    this.onError  = opts.onError  || (m => console.error(m));
    this.confirm  = opts.confirm  || (msg => Promise.resolve(window.confirm(msg)));

    this.el.classList.add('lp-menu-admin');
    this.el.addEventListener('click', e => this._onClick(e));
  }

  async render() {
    this.el.innerHTML = '<div class="lp-menu-loading">Loading menu…</div>';
    try {
      await this.menu.load({ force: true });
    } catch (e) {
      this.el.innerHTML = '<div class="lp-menu-error">Could not load the menu.</div>';
      this.onError('LP-073: ' + e.message);
      return;
    }

    const cats = this.menu.categories;
    this.el.innerHTML = `
      <div class="lp-menu-bar">
        <button class="lp-menu-add" data-lp="add-cat">+ Add category</button>
      </div>
      ${cats.length ? cats.map(c => this._categoryHtml(c)).join('') :
        '<div class="lp-menu-empty">No categories yet. Add one to get started.</div>'}`;
  }

  _categoryHtml(c) {
    return `
      <div class="lp-menu-cat" data-cat="${escAttr(c.id)}">
        <div class="lp-menu-cat-head">
          <div>
            <div class="lp-menu-cat-name">${esc(c.name)}</div>
            <div class="lp-menu-cat-meta">${esc(c.type)} · ${c.items.length} item${c.items.length === 1 ? '' : 's'}</div>
          </div>
          <div class="lp-menu-cat-actions">
            <button data-lp="edit-cat" data-id="${escAttr(c.id)}" aria-label="Edit ${esc(c.name)}">Edit</button>
            <button data-lp="add-item" data-id="${escAttr(c.id)}">+ Item</button>
          </div>
        </div>
        ${c.items.map(i => `
          <div class="lp-menu-item${i.is_available ? '' : ' sold-out'}" data-item="${escAttr(i.id)}">
            <div class="lp-menu-item-main">
              <div class="lp-menu-item-name">${esc(i.name)}${i.is_available ? '' : ' <span class="lp-menu-tag">Sold out</span>'}</div>
              ${i.description ? `<div class="lp-menu-item-desc">${esc(i.description)}</div>` : ''}
              ${i.choices?.length ? `<div class="lp-menu-item-choices">${i.choices.length} choice group${i.choices.length === 1 ? '' : 's'}</div>` : ''}
            </div>
            <div class="lp-menu-item-right">
              <div class="lp-menu-item-price">£${Number(i.price).toFixed(2)}</div>
              <button data-lp="toggle-avail" data-id="${escAttr(i.id)}" data-avail="${i.is_available}">
                ${i.is_available ? 'Mark sold out' : 'Back on'}
              </button>
              <button data-lp="edit-item" data-id="${escAttr(i.id)}">Edit</button>
            </div>
          </div>`).join('')}
      </div>`;
  }

  /* ---------- writes ---------- */

  async saveCategory({ id, name, type, sort_order }) {
    name = String(name || '').trim();
    if (!name) throw new Error('LP-074: category needs a name');

    if (id) {
      await this.db('PATCH', `/rest/v1/ls_menu_categories?id=eq.${enc(id)}`,
        { name, type, sort_order });
    } else {
      await this.db('POST', '/rest/v1/ls_menu_categories',
        { venue: this.menu.venue, name, type: type || 'food',
          sort_order: sort_order ?? 0, is_active: true });
    }
    await this.render();
    this.onChange();
  }

  async saveItem({ id, category_id, name, description, price, type, choices, sort_order }) {
    name = String(name || '').trim();
    price = Number(price);
    if (!name) throw new Error('LP-075: item needs a name');
    if (!Number.isFinite(price) || price < 0) throw new Error('LP-076: item needs a valid price');
    if (!id && !category_id) throw new Error('LP-077: new item needs a category');

    const body = {
      name,
      description: String(description || '').trim(),
      price: Math.round(price * 100) / 100,
      type: type || null,
      choices: choices || [],
      sort_order: sort_order ?? 0
    };

    if (id) {
      if (category_id) body.category_id = category_id;   /* allow moving category */
      await this.db('PATCH', `/rest/v1/ls_menu_items?id=eq.${enc(id)}`, body);
    } else {
      /* Set the flags explicitly rather than relying on column defaults —
         keeps the feature working against any backend. */
      await this.db('POST', '/rest/v1/ls_menu_items',
        { ...body, venue: this.menu.venue, category_id,
          is_active: true, is_available: true });
    }
    await this.render();
    this.onChange();
  }

  /* Soft delete — is_active false. Keeps the row so historic orders
     referencing it still make sense. */
  async deleteItem(id) {
    const found = this.menu.findItem(id);
    const ok = await this.confirm(`Remove "${found?.item?.name || 'this item'}" from the menu?`);
    if (!ok) return false;
    await this.db('PATCH', `/rest/v1/ls_menu_items?id=eq.${enc(id)}`, { is_active: false });
    await this.render();
    this.onChange();
    return true;
  }

  async deleteCategory(id) {
    const cat = this.menu.categories.find(c => String(c.id) === String(id));
    const n = cat?.items.length || 0;
    const ok = await this.confirm(
      n ? `Remove "${cat.name}" and its ${n} item${n === 1 ? '' : 's'}?`
        : `Remove "${cat?.name || 'this category'}"?`);
    if (!ok) return false;
    await this.db('PATCH', `/rest/v1/ls_menu_categories?id=eq.${enc(id)}`, { is_active: false });
    await this.render();
    this.onChange();
    return true;
  }

  /* Sold out — the one the owner presses most, mid-service. */
  async setAvailable(id, available) {
    await this.db('PATCH', `/rest/v1/ls_menu_items?id=eq.${enc(id)}`, { is_available: !!available });
    await this.render();
    this.onChange();
  }

  async reorder(type, ids) {
    const table = type === 'category' ? 'ls_menu_categories' : 'ls_menu_items';
    for (let i = 0; i < ids.length; i++) {
      await this.db('PATCH', `/rest/v1/${table}?id=eq.${enc(ids[i])}`, { sort_order: i });
    }
    await this.render();
    this.onChange();
  }

  _onClick(e) {
    const btn = e.target.closest('[data-lp]');
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.lp;
    if (action === 'toggle-avail') {
      this.setAvailable(id, btn.dataset.avail !== 'true')
        .catch(err => this.onError('LP-078: ' + err.message));
    }
    /* edit-cat / add-item / edit-item / add-cat are surfaced to the host
       app via onAction so it can open its own modal. */
    this.onAction?.(action, id);
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const escAttr = esc;
function enc(s) { return encodeURIComponent(s); }
