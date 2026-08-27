/* Shared app state and small helpers.
   The modules hold the real data — this just holds the instances so every
   screen can reach them without globals. */

import { CONFIG, STORE_KEY, USER_KEY } from './config.js';

export const ctx = {
  menu: null,      /* Menu module      */
  cart: null,      /* Cart module      */
  loyalty: null,   /* Loyalty module   */
  notify: null,    /* OrderReady       */
  wait: null,      /* WaitTimes        */
  shell: null,     /* Shell            */
  pwa: null        /* PWA              */
};

/* ---------- chosen store ---------- */

export function currentStore() {
  const id = localStorage.getItem(STORE_KEY) || 'hartlepool';
  return CONFIG.stores.find(s => s.id === id) || CONFIG.stores[0];
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
   No product photography in a demo, so the slush cup is drawn. It takes the
   flavour colours from config so picking a flavour changes the cup. */

export function slushCup(flavour, size = 190) {
  const [light, dark] = CONFIG.slushColours[flavour] || CONFIG.slushColours['Blue Raspberry'];
  const uid = 'g' + Math.random().toString(36).slice(2, 8);
  return `
  <svg class="psp-cup" viewBox="0 0 120 170" width="${size}" height="${Math.round(size * 1.42)}"
       role="img" aria-label="${esc(flavour || 'Protein slush')}">
    <defs>
      <linearGradient id="${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${light}"/><stop offset="100%" stop-color="${dark}"/>
      </linearGradient>
    </defs>
    <rect x="55" y="4" width="7" height="52" rx="3.5" fill="#d8d8d8" transform="rotate(12 58 30)"/>
    <path d="M22 40 h76 l-7 22 H29 Z" fill="${light}" opacity=".35"/>
    <ellipse cx="60" cy="40" rx="38" ry="9" fill="#efefef"/>
    <path d="M27 58 h66 l-9 100 a10 10 0 0 1 -10 8 H46 a10 10 0 0 1 -10 -8 Z" fill="url(#${uid})"/>
    <path d="M27 58 h66 l-2 22 H29 Z" fill="#fff" opacity=".18"/>
    <rect x="30" y="92" width="60" height="26" rx="4" fill="#111"/>
    <text x="60" y="106" text-anchor="middle" font-family="Archivo, sans-serif"
          font-style="italic" font-weight="900" font-size="11" fill="#fff">PROTEIN</text>
    <text x="60" y="115" text-anchor="middle" font-family="Archivo, sans-serif"
          font-weight="700" font-size="6" fill="#E4181F" letter-spacing="1">SUPERSTORE</text>
  </svg>`;
}

/* Tub artwork for supplements — brand initial on a plinth. */
export function tubArt(name) {
  const initial = esc((name || '?').replace(/^[^A-Za-z]*/, '').charAt(0).toUpperCase());
  return `
  <svg class="psp-tub" viewBox="0 0 120 120" role="img" aria-label="${esc(name)}">
    <ellipse cx="60" cy="108" rx="34" ry="6" fill="#000" opacity=".55"/>
    <rect x="30" y="26" width="60" height="78" rx="8" fill="#1b1b1b" stroke="#2f2f2f"/>
    <rect x="30" y="26" width="60" height="14" rx="7" fill="#2a2a2a"/>
    <rect x="34" y="52" width="52" height="30" rx="4" fill="#E4181F"/>
    <text x="60" y="75" text-anchor="middle" font-family="Archivo, sans-serif"
          font-style="italic" font-weight="900" font-size="22" fill="#fff">${initial}</text>
  </svg>`;
}
