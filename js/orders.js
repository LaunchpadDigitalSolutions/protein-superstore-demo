/* Orders and Account.

   Orders reads ls_orders — the same table the store's slush bar screen
   writes to when staff tap Ready, so the status here is the real one. */

import { toast } from '../core/toast.js';
import { confirmDialog } from '../core/modal.js';
import { CONFIG, STORE_KEY } from './config.js';
import { ctx, currentStore, currentUser, setStore, money, esc, ago } from './state.js';

const STATUS = {
  active:   { label: 'Being prepared', cls: 'amber' },
  ready:    { label: 'Ready to collect', cls: 'green' },
  complete: { label: 'Collected', cls: 'grey' },
  refunded: { label: 'Refunded', cls: 'grey' },
  cancelled:{ label: 'Cancelled', cls: 'grey' }
};

/* An order is "ready" when every part of it is. */
function statusOf(o) {
  if (o.status !== 'active') return STATUS[o.status] || STATUS.complete;
  const parts = [o.food_status, o.drink_status].filter(s => s !== 'none');
  const allReady = parts.length > 0 && parts.every(s => s === 'ready');
  return allReady ? STATUS.ready : STATUS.active;
}

export async function ordersHtml() {
  const user = currentUser();
  let rows = [];
  try {
    rows = await ctx.cart.db('GET',
      `/rest/v1/ls_orders?venue=eq.${encodeURIComponent(CONFIG.venue)}` +
      `&customer_email=eq.${encodeURIComponent(user.email)}` +
      `&select=id,items,total,status,food_status,drink_status,table_num,created_at` +
      `&order=created_at.desc&limit=20`) || [];
  } catch (e) {
    return `<div class="psp-empty">Could not load your orders (PSP-201). Pull down to try again.</div>`;
  }

  if (!rows.length) {
    return `
      <div class="psp-empty">
        <div class="psp-empty-icon">🧾</div>
        <h2 class="psp-h2">NO ORDERS YET</h2>
        <p>Pre-order a slush or your supplements and skip the queue.</p>
        <button class="psp-btn" data-psp="go" data-to="shop">START AN ORDER</button>
      </div>`;
  }

  const live = rows.filter(o => o.status === 'active');
  const past = rows.filter(o => o.status !== 'active');

  return `
    ${live.map(orderCard).join('')}
    ${past.length ? `<h2 class="psp-h2 psp-mt">PREVIOUS ORDERS</h2>` : ''}
    ${past.map(orderCard).join('')}
    <div class="psp-spacer"></div>`;
}

function orderCard(o) {
  const s = statusOf(o);
  const items = (o.items || []).map(i => `${i.q}× ${esc(i.n)}`).join('<br>');
  return `
    <article class="psp-order ${s.cls}">
      <header class="psp-order-top">
        <div>
          <div class="psp-order-ref">#${esc(o.id)}</div>
          <div class="psp-order-when">${esc(o.table_num || '')} · ${ago(o.created_at)}</div>
        </div>
        <span class="psp-badge ${s.cls}">${s.label}</span>
      </header>
      <div class="psp-order-items">${items}</div>
      <footer class="psp-order-foot">
        <span>${money(o.total)}</span>
        ${s.cls === 'green'
          ? '<strong class="psp-collect-now">Show this screen at the counter</strong>'
          : `<button class="psp-link" data-psp="reorder" data-id="${esc(o.id)}">Order again</button>`}
      </footer>
    </article>`;
}

/* Re-add every line of a past order to the basket. */
export function reorder(orderId) {
  ctx.cart.db('GET',
    `/rest/v1/ls_orders?id=eq.${encodeURIComponent(orderId)}&select=items`)
    .then(rows => {
      const items = rows?.[0]?.items || [];
      let added = 0;
      items.forEach(i => {
        const match = ctx.menu.categories.flatMap(c => c.items)
          .find(m => i.n.startsWith(m.name));
        if (!match) return;
        try { ctx.cart.add(match.id, { qty: i.q, selections: rebuildSelections(match, i.n) }); added++; }
        catch (e) { /* a choice that no longer exists — skip that line */ }
      });
      if (!added) return toast('Those products have changed — please pick them again');
      toast(added + ' item' + (added === 1 ? '' : 's') + ' added', { type: 'success' });
      ctx.shell.go('shop');
    })
    .catch(() => toast('Could not load that order (PSP-202)', { type: 'error' }));
}

/* Order lines store their options as "Choose flavour: Cherry Burst · Size: Large".
   Turn that back into the selections object the Cart module expects. */
function rebuildSelections(item, line) {
  const note = line.slice(item.name.length).replace(/^\s*\(|\)\s*$/g, '').trim();
  const out = {};
  note.split(' · ').forEach(pair => {
    const at = pair.indexOf(': ');
    if (at > 0) out[pair.slice(0, at)] = pair.slice(at + 2);
  });
  return out;
}

/* ---------- account ---------- */

export function accountHtml() {
  const user = currentUser();
  const store = currentStore();
  return `
    <div class="psp-acct-head">
      <div class="psp-avatar lg">${esc(user.name.charAt(0))}</div>
      <div>
        <div class="psp-acct-name">${esc(user.name)}</div>
        <div class="psp-acct-mail">${esc(user.email)}</div>
      </div>
    </div>

    <h2 class="psp-h2">YOUR STORE</h2>
    <div class="psp-stores">
      ${CONFIG.stores.map(s => {
        const live = CONFIG.liveStores.includes(s.id);
        return `
        <button class="psp-store${s.id === store.id ? ' on' : ''}${live ? '' : ' locked'}"
                data-psp="${live ? 'store' : 'locked'}" data-id="${esc(s.id)}">
          <div>
            <div class="psp-store-name">${esc(s.name)}${live ? '' : ' <span class="psp-soon">Coming soon</span>'}</div>
            <div class="psp-store-addr">${esc(s.address)}</div>
            <div class="psp-store-hours">${live ? esc(s.hours) : 'Not taking app orders yet'}</div>
          </div>
          <span class="psp-tick" aria-hidden="true">✓</span>
        </button>`;
      }).join('')}
    </div>

    <h2 class="psp-h2 psp-mt">APP</h2>
    <div class="psp-rows">
      <button class="psp-row" data-psp="install">Add to home screen<span class="psp-chev">›</span></button>
      <button class="psp-row" data-psp="notify">Turn on order notifications<span class="psp-chev">›</span></button>
      <a class="psp-row" href="/staff.html">Staff: slush bar screen<span class="psp-chev">›</span></a>
      <button class="psp-row" data-psp="reset">Reset demo data<span class="psp-chev">›</span></button>
    </div>

    <div class="psp-version">Protein Superstore app ${CONFIG.version} · built by Launchpad Digital Solutions
      <br>Demo build — payments are simulated, no card is ever charged.</div>
    <div class="psp-spacer"></div>`;
}

export async function accountAction(action) {
  if (action === 'install') {
    if (ctx.pwa.canInstall) {
      const r = await ctx.pwa.promptInstall();
      if (r.outcome === 'accepted') toast('Installed', { type: 'success' });
    } else if (ctx.pwa.needsManualInstall) {
      toast('On iPhone: tap Share, then Add to Home Screen', { duration: 6000 });
    } else {
      toast('Already installed, or not supported on this browser');
    }
  }
  if (action === 'notify') {
    const ok = await ctx.notify.askPermission();
    toast(ok ? 'We will buzz you when your order is ready'
             : 'Notifications are blocked in your browser settings');
  }
  if (action === 'reset') {
    if (!(await confirmDialog('Clear the basket and the chosen store on this device?'))) return;
    ctx.cart.clear();
    localStorage.removeItem(STORE_KEY);
    setStore('hartlepool');
    ctx.shell.invalidate();
    ctx.shell.refresh();
    toast('Demo reset');
  }
}
