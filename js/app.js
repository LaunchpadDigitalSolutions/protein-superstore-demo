/* Protein Superstore — app boot.

   Every screen in this app is a Launchpad module with a Protein Superstore
   skin on it. This file does the wiring and nothing else:

     core/db          Supabase reads and writes
     core/toast       messages
     core/modal       product sheet, checkout, spin
     menu             products, choices and pricing
     cart             basket and the order write
     loyalty          points, rewards, redemption
     customer-capture details and marketing consent
     payment          card step (demo mode — nothing is transmitted)
     order-ready      "your order is ready" alert
     wait-times       live collection wait, measured
     shell            bottom nav on mobile, sidebar on desktop
     bug-report       floating report button
     pwa              install to home screen, offline
*/

import { configure, db } from '../core/db.js';
import { toast } from '../core/toast.js';
import { Menu } from '../features/menu/menu.js';
import { Cart } from '../features/cart/cart.js';
import { Loyalty } from '../features/loyalty/loyalty.js';
import { OrderReady } from '../features/order-ready/order-ready.js';
import { WaitTimes } from '../features/wait-times/wait-times.js';
import { Shell } from '../features/shell/shell.js';
import { BugReport } from '../features/bug-report/bug-report.js';
import { PWA } from '../features/pwa/pwa.js';

import { CONFIG } from './config.js';
import { ctx, currentUser, setStore, esc } from './state.js';
import { homeHtml, mountWait } from './home.js';
import { shopHtml, openProduct, openCheckout } from './shop.js';
import { ordersHtml, accountHtml, accountAction, reorder } from './orders.js';
import { openSpin, openOffers } from './extras.js';

const bootMsg = m => { const el = document.getElementById('bootMsg'); if (el) el.textContent = m; };

async function boot() {
  configure({ url: CONFIG.sb.url, key: CONFIG.sb.key });

  /* Health check before anything renders — a dead backend should say so,
     not show an empty shop. */
  try {
    await db('GET', '/rest/v1/ls_menu_categories?select=id&limit=1');
  } catch (e) {
    bootMsg('Cannot reach the store right now (PSP-001). Please try again shortly.');
    return;
  }

  ctx.menu = new Menu({ venue: CONFIG.venue, includeUnavailable: false });
  await ctx.menu.load();

  ctx.loyalty = new Loyalty({
    mount: document.createElement('div'),      /* re-mounted per render */
    venue: CONFIG.venue,
    brandName: CONFIG.brandName,
    rewards: CONFIG.rewards,
    earnRules: CONFIG.earnRules
  });

  ctx.cart = new Cart({
    mount: document.createElement('div'),      /* headless — this app draws its own basket */
    menu: ctx.menu,
    venue: CONFIG.venue,
    orderType: 'collection',
    paymentMethod: 'card-demo',
    pointsPerPound: CONFIG.pointsPerPound,
    loyalty: ctx.loyalty,
    onError: m => console.error(m)
  });

  ctx.notify = new OrderReady({ venue: CONFIG.venue, icon: './icon-192.png' });
  ctx.notify.resume();                         /* keep watching after a reload */

  ctx.wait = new WaitTimes({ venue: CONFIG.venue });

  ctx.pwa = new PWA({ swPath: './sw.js', scope: './' });
  ctx.pwa.register();
  ctx.pwa.onUpdateAvailable(() => toast('New version available', {
    duration: 8000, action: { label: 'Reload', onClick: () => ctx.pwa.applyUpdate() }
  }));

  new BugReport({
    clientRef: CONFIG.clientRef,
    getUser: () => ({ email: currentUser().email, role: 'customer' }),
    getView: () => ctx.shell?.active || 'boot'
  }).mount(document.body);

  buildShell();

  document.getElementById('boot').remove();
  document.getElementById('app').hidden = false;
}

function buildShell() {
  const app = document.getElementById('app');

  ctx.shell = new Shell({
    mount: app,
    title: 'PROTEIN SUPERSTORE',
    user: { name: currentUser().name },
    cache: false,
    sections: [
      { id: 'home',    label: 'Home',    icon: '⌂', render: homeHtml },
      { id: 'shop',    label: 'Shop',    icon: '▦', render: shopHtml },
      { id: 'orders',  label: 'Orders',  icon: '❐', render: ordersHtml },
      { id: 'loyalty', label: 'Loyalty', icon: '★', render: () => '<div id="psp-loyalty"></div>' },
      { id: 'account', label: 'Account', icon: '☺', render: accountHtml }
    ],
    onChange: id => afterRender(id)
  });

  ctx.shell.render();
  brandTheHeader();
  afterRender(ctx.shell.active);
  app.addEventListener('click', onClick);
}

/* Swap the shell's text title for the client's logo lockup. */
function brandTheHeader() {
  const logo = '<img class="psp-logo" src="./assets/logo.jpg" alt="Protein Superstore">';
  const side = document.querySelector('.lp-shell-brand');
  const top = document.querySelector('.lp-shell-top');
  if (side) side.innerHTML = logo;
  if (top && !top.querySelector('.psp-logo')) {
    const el = document.createElement('div');
    el.className = 'psp-topbrand';
    el.innerHTML = logo;
    top.appendChild(el);
  }
}

/* Things that have to happen once a section's HTML is in the DOM. */
function afterRender(id) {
  if (id === 'home') mountWait();
  if (id === 'loyalty') {
    const el = document.getElementById('psp-loyalty');
    if (!el) return;
    ctx.loyalty.el = el;
    el.classList.add('lp-loyalty');
    ctx.loyalty.render();
    /* Signed in already — look the card up rather than asking for the email. */
    const input = el.querySelector('[data-lp="email"]');
    if (input) { input.value = currentUser().email; ctx.loyalty.lookup(); }
  }
}

function onClick(e) {
  const t = e.target.closest('[data-psp]');
  if (!t) return;
  const kind = t.dataset.psp;

  if (kind === 'item')     return openProduct(t.dataset.id);
  if (kind === 'go')       return ctx.shell.go(t.dataset.to);
  if (kind === 'checkout') return openCheckout();
  if (kind === 'reorder')  return reorder(t.dataset.id);

  if (kind === 'cat') {
    document.querySelectorAll('.psp-chip').forEach(c => c.classList.remove('on'));
    t.classList.add('on');
    document.querySelector(`[data-cat="${CSS.escape(t.dataset.id)}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  if (kind === 'tile') {
    const a = t.dataset.action;
    if (a === 'preorder') return ctx.shell.go('shop');
    if (a === 'loyalty')  return ctx.shell.go('loyalty');
    if (a === 'spin')     return openSpin();
    if (a === 'offers')   return openOffers();
  }

  if (kind === 'store') {
    setStore(t.dataset.id);
    ctx.shell.invalidate();
    ctx.shell.refresh();
    return toast('Collecting from ' + esc(t.textContent.trim().split('\n')[0]));
  }

  if (kind === 'locked') {
    return toast('This store is not on the app yet — ask in store', { duration: 4000 });
  }

  if (['install', 'notify', 'reset'].includes(kind)) return accountAction(kind);
}

boot().catch(e => {
  console.error('PSP-000: boot failed —', e);
  bootMsg('Something went wrong starting the app (PSP-000).');
});
