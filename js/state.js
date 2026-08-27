/* Shared app state and small helpers.
   The modules hold the real data — this just holds the instances so every
   screen can reach them without globals. */

import { CONFIG, STORE_KEY, USER_KEY } from './config.js';

export const ctx = {
  menu: null,      /* Menu module      */
  cart: null,      /* Cart module      */
  loyalty: null,   /* Loyalty module   */
  notify: null,    /* OrderReady       */
  shell: null,     /* Shell            */
  pwa: null        /* PWA              */
};

/* ---------- chosen store ---------- */

export function currentStore() {
  const id = localStorage.getItem(STORE_KEY) || CONFIG.liveStores[0];
  const live = CONFIG.stores.filter(s => CONFIG.liveStores.includes(s.id));
  return live.find(s => s.id === id) || live[0];
}

export function setStore(id) {
  localStorage.setItem(STORE_KEY, id);
}

/* ---------- the signed-in customer ----------
   A demo signs in as Lewis so the pitch opens on a populated account.
   A real build swaps this for core/auth.js — same shape, same call sites. */

export function currentUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* corrupt value — fall through to the default */ }
  return { name: 'Lewis', email: 'lewis@lasmedia.co.uk', phone: '07700 900123' };
}

export function setUser(u) {
  localStorage.setItem(USER_KEY, JSON.stringify(u));
}

/* ---------- formatting ---------- */

export const money = n => '£' + Number(n || 0).toFixed(2);

export const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function points(n) {
  return Number(n || 0).toLocaleString('en-GB');
}

/* When an order was placed, in words. */
export function ago(iso) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + ' min ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + (hrs === 1 ? ' hour ago' : ' hours ago');
  const days = Math.floor(hrs / 24);
  return days === 1 ? 'yesterday' : days + ' days ago';
}

/* ---------- artwork ----------
   The slush is the photograph from the mockup, tinted per flavour. Products
   use the client's own Shopify photography where we have it, and a
   typographic tile where we don't — a real photo or honest type, never a
   drawing pretending to be a product shot. */

export function slushPhoto(flavour, cls = '') {
  const filter = CONFIG.slushFilters[flavour] || 'none';
  return `<img class="psp-slush ${cls}" src="./assets/slush-hero.jpg?v=1.2.1" alt="${esc(flavour || 'Protein slush')}"
               style="filter:${filter}" loading="lazy">`;
}

export function slushPair() {
  return `<img class="psp-slushpair" src="./assets/slush-pair.jpg?v=1.2.1"
               alt="Protein slush, blue raspberry and cherry" loading="lazy">`;
}

/* A product tile. Real photo if the client's CDN has one, otherwise type. */
export function productImage(item) {
  const url = CONFIG.productImages[item.name];
  if (url) {
    return `<img class="psp-photo" src="${esc(url)}" alt="${esc(item.name)}" loading="lazy">`;
  }
  return typeTile(item.name);
}

/* Brand and product name set on black with the house slash. Deliberately
   typographic — it reads as a design choice, not a bad illustration. */
function typeTile(name) {
  const parts = String(name).split(' ');
  const brand = /^5%/.test(name) ? '5% NUTRITION'
              : /sneak/i.test(name) ? 'SNEAK'
              : /snickers|mars|m&m/i.test(name) ? 'MARS'
              : (parts[0] || '').toUpperCase();
  const rest = String(name).replace(/^5% Nutrition |^Sneak /i, '');
  return `
    <div class="psp-typetile" aria-label="${esc(name)}">
      <span class="psp-typetile-brand">${esc(brand)}</span>
      <span class="psp-typetile-name">${esc(rest)}</span>
    </div>`;
}
