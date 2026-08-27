/* Home screen — Lewis's mockup, screen one.

   The points figure comes from the Loyalty module (ls_loyalty), the slush
   promo and popular products come from the Menu module, and the wait time
   is measured by the WaitTimes module from real order timings. Nothing on
   this screen is a hardcoded number. */

import { CONFIG } from './config.js';
import { ctx, currentStore, currentUser, money, esc, points, slushPair } from './state.js';
import { productArt, basketBarHtml } from './shop.js';

export async function homeHtml() {
  const user = currentUser();
  const store = currentStore();

  let balance = 0;
  try {
    const rows = await ctx.loyalty.db('GET',
      `/rest/v1/ls_loyalty?venue=eq.${encodeURIComponent(CONFIG.venue)}` +
      `&email=eq.${encodeURIComponent(user.email)}&select=points`);
    balance = rows?.[0]?.points || 0;
  } catch (e) {
    /* A rewards lookup failing must never blank the home screen. */
    console.error('PSP-101: points lookup failed — ' + e.message);
  }

  const slush = findItem('Protein Slush');
  const popular = ctx.menu.categories
    .flatMap(c => c.items)
    .filter(i => !/slush|shake|float/i.test(i.name))
    .slice(0, 6);

  return `
    <div class="psp-welcome">
      <div class="psp-avatar">${esc(user.name.charAt(0))}</div>
      <div class="psp-welcome-txt">Welcome back, <strong>${esc(user.name.split(' ')[0])}</strong></div>
      <div class="psp-points-pill">${points(balance)}<span>POINTS</span></div>
    </div>

    <section class="psp-hero" data-psp="go" data-to="shop">
      <img class="psp-hero-img" src="./assets/hero.jpg?v=1.1.1" alt="Fuel your results">
      <button class="psp-btn psp-hero-btn" data-psp="go" data-to="shop">SHOP NOW</button>
    </section>

    <div class="psp-tiles">
      ${tile('preorder', '⏱', 'PRE-ORDER', 'Skip the wait')}
      ${tile('loyalty', '★', 'LOYALTY', 'Earn rewards')}
      ${tile('spin', '◎', 'SPIN TO WIN', 'Win prizes')}
      ${tile('offers', '🏷', 'OFFERS', 'Latest deals')}
    </div>

    <div id="psp-wait" class="psp-wait"></div>

    ${slush ? `
    <section class="psp-promo" data-psp="item" data-id="${esc(slush.id)}">
      <span class="psp-promo-flag">NEW</span>
      <div class="psp-promo-copy">
        <h2 class="psp-promo-h">PROTEIN<br><em>SLUSH</em></h2>
        <p>Refreshing. Icy. Packed with protein.</p>
        <span class="psp-btn psp-btn-sm">ORDER NOW</span>
      </div>
      <div class="psp-promo-art">${slushPair()}</div>
    </section>` : ''}

    <div class="psp-rowhead">
      <h2 class="psp-h2">POPULAR PRODUCTS</h2>
      <button class="psp-link" data-psp="go" data-to="shop">View all</button>
    </div>
    <div class="psp-rail">
      ${popular.map(i => `
        <button class="psp-railcard" data-psp="item" data-id="${esc(i.id)}">
          <div class="psp-card-art">${productArt(i)}</div>
          <div class="psp-card-name">${esc(i.name)}</div>
          <div class="psp-card-price">${money(i.price)}</div>
          <span class="psp-card-add" aria-hidden="true">+</span>
        </button>`).join('')}
    </div>

    <div class="psp-storecard" data-psp="go" data-to="account">
      <div>
        <div class="psp-storecard-label">Your store</div>
        <div class="psp-storecard-name">${esc(store.name)}</div>
        <div class="psp-storecard-hours">${esc(store.hours)}</div>
      </div>
      <span class="psp-chev">›</span>
    </div>

    <div class="psp-spacer"></div>
    ${basketBarHtml()}`;
}

function tile(action, icon, label, sub) {
  return `
    <button class="psp-tile" data-psp="tile" data-action="${esc(action)}">
      <span class="psp-tile-icon" aria-hidden="true">${icon}</span>
      <span class="psp-tile-label">${esc(label)}</span>
      <span class="psp-tile-sub">${esc(sub)}</span>
    </button>`;
}

function findItem(name) {
  return ctx.menu.categories.flatMap(c => c.items).find(i => i.name === name) || null;
}

/* Called after the home screen is in the DOM — the wait time renders itself
   and refreshes on its own timer. */
export function mountWait() {
  const el = document.getElementById('psp-wait');
  if (el && ctx.wait) ctx.wait.mount(el);
}
