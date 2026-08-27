/* Shop, product sheet, basket and checkout.

   Nothing here calculates a price or writes an order. The Menu module owns
   pricing (priceOf / missingChoices), the Cart module owns the basket and
   the write to ls_orders, CustomerCapture owns details and consent, and
   Payment owns the card step. This file is the Protein Superstore skin on
   top of them. */

import { Modal } from '../core/modal.js';
import { toast } from '../core/toast.js';
import { CustomerCapture } from '../features/customer-capture/customer-capture.js';
import { Payment } from '../features/payment/payment.js';
import { CONFIG } from './config.js';
import { ctx, currentStore, currentUser, money, esc, slushPhoto, productImage } from './state.js';

const isSlush = item => /slush|shake|float/i.test(item.name);

export function productArt(item, flavour) {
  return isSlush(item)
    ? slushPhoto(flavour || firstFlavour(item), 'sm')
    : productImage(item);
}

function firstFlavour(item) {
  const g = (item.choices || []).find(c => /flavour/i.test(c.name));
  if (!g) return null;
  const o = g.opts?.[0];
  return typeof o === 'string' ? o : o?.label || null;
}

/* ---------- shop screen ---------- */

export function shopHtml() {
  const cats = ctx.menu.categories;
  return `
    <div class="psp-chiprow">
      ${cats.map((c, i) => `<button class="psp-chip${i === 0 ? ' on' : ''}"
        data-psp="cat" data-id="${esc(c.id)}">${esc(c.name)}</button>`).join('')}
    </div>
    ${cats.map(c => `
      <section class="psp-cat" data-cat="${esc(c.id)}">
        <h2 class="psp-h2">${esc(c.name)}</h2>
        <div class="psp-grid">${c.items.map(cardHtml).join('')}</div>
      </section>`).join('')}
    <div class="psp-spacer"></div>`;
}

function cardHtml(item) {
  return `
    <button class="psp-card" data-psp="item" data-id="${esc(item.id)}">
      <div class="psp-card-art">${productArt(item)}</div>
      <div class="psp-card-name">${esc(item.name)}</div>
      <div class="psp-card-price">${money(item.price)}${(item.choices || []).some(c => /size/i.test(c.name)) ? '<span>from</span>' : ''}</div>
      <span class="psp-card-add" aria-hidden="true">+</span>
    </button>`;
}

/* ---------- product sheet ---------- */

export function openProduct(itemId) {
  const found = ctx.menu.findItem(itemId);
  if (!found) return toast('That product is no longer listed', { type: 'error' });
  const item = found.item;
  const selections = {};
  (item.choices || []).forEach(g => {
    const first = g.opts?.[0];
    if (g.req) selections[g.name] = typeof first === 'string' ? first : first?.label;
  });

  const wrap = document.createElement('div');
  wrap.className = 'psp-sheet';
  const draw = () => {
    const flavour = selections[Object.keys(selections).find(k => /flavour/i.test(k)) || ''] || null;
    wrap.innerHTML = `
      <div class="psp-sheet-art">${isSlush(item)
        ? slushPhoto(flavour, 'lg')
        : productImage(item)}</div>
      <div class="psp-sheet-desc">${esc(item.description)}</div>
      ${(item.choices || []).map(groupHtml).join('')}
      <div class="psp-sheet-total">
        <span>Total</span><strong>${money(ctx.menu.priceOf(item, selections))}</strong>
      </div>`;
    wrap.querySelectorAll('[data-opt]').forEach(b => {
      b.onclick = () => { selections[b.dataset.group] = b.dataset.opt; draw(); };
    });
  };

  function groupHtml(g) {
    return `
      <div class="psp-group">
        <div class="psp-group-label">${esc(g.name)}${g.req ? '' : ' <span>optional</span>'}</div>
        <div class="psp-opts">
          ${(g.opts || []).map(o => {
            const label = typeof o === 'string' ? o : o.label;
            const extra = typeof o === 'string' ? 0 : Number(o.price || 0);
            const on = selections[g.name] === label ? ' on' : '';
            return `<button class="psp-opt${on}" data-opt="${esc(label)}" data-group="${esc(g.name)}">
              ${esc(label)}${extra ? `<em>+${money(extra)}</em>` : ''}</button>`;
          }).join('')}
        </div>
      </div>`;
  }

  draw();

  const modal = new Modal({
    title: item.name,
    content: wrap,
    actions: [
      { label: 'Cancel', role: 'cancel' },
      { label: isSlush(item) ? 'Pre-order now' : 'Add to basket', role: 'primary',
        onClick: () => {
          try {
            ctx.cart.add(item.id, { selections });
            toast(item.name + ' added', { type: 'success' });
            ctx.shell.refresh();
          } catch (e) {
            toast(e.message.replace(/^LP-\d+:\s*/, ''), { type: 'error' });
            return false;   /* keep the sheet open so they can fix the choice */
          }
        } }
    ]
  });
  modal.open();
}

/* ---------- basket bar ---------- */

export function basketBarHtml() {
  if (ctx.cart.isEmpty) return '';
  return `
    <button class="psp-basketbar" data-psp="checkout">
      <span class="psp-basketbar-count">${ctx.cart.count}</span>
      <span>View basket</span>
      <strong>${money(ctx.cart.subtotal)}</strong>
    </button>`;
}

/* ---------- checkout ---------- */

export function openCheckout() {
  if (ctx.cart.isEmpty) return toast('Your basket is empty');
  const store = currentStore();
  const user = currentUser();

  const wrap = document.createElement('div');
  wrap.className = 'psp-checkout';
  wrap.innerHTML = `
    <div class="psp-lines">
      ${ctx.cart.lines.map(l => `
        <div class="psp-line">
          <div>
            <div class="psp-line-name">${esc(l.name)}</div>
            ${l.note ? `<div class="psp-line-note">${esc(l.note)}</div>` : ''}
          </div>
          <div class="psp-qty">
            <button data-qty="-1" data-line="${esc(l.lineId)}" aria-label="One fewer">−</button>
            <span>${l.qty}</span>
            <button data-qty="1" data-line="${esc(l.lineId)}" aria-label="One more">+</button>
          </div>
          <div class="psp-line-price">${money(l.price * l.qty)}</div>
        </div>`).join('')}
    </div>
    <div class="psp-collect">
      <div class="psp-collect-label">Collect from</div>
      <div class="psp-collect-store">${esc(store.name)}</div>
      <div class="psp-collect-addr">${esc(store.address)}</div>
    </div>
    <h3 class="psp-h3">How would you like to pay?</h3>
    <div class="psp-paychoice">
      <button class="psp-payopt on" data-pay="card">
        <span class="psp-payopt-t">Pay now</span>
        <span class="psp-payopt-s">Card. Walk in, collect, walk out.</span>
      </button>
      <button class="psp-payopt" data-pay="counter">
        <span class="psp-payopt-t">Reserve &amp; pay in store</span>
        <span class="psp-payopt-s">We hold it. Pay at the counter.</span>
      </button>
    </div>
    <h3 class="psp-h3">Your details</h3>
    <div id="cc"></div>
    <div id="payWrap">
      <h3 class="psp-h3">Payment</h3>
      <div id="pay"></div>
    </div>`;

  const modal = new Modal({ title: 'Checkout', content: wrap, actions: [] });
  modal.open();

  wrap.querySelectorAll('[data-qty]').forEach(b => {
    b.onclick = () => {
      const line = ctx.cart.lines.find(l => l.lineId === b.dataset.line);
      ctx.cart.setQty(b.dataset.line, line.qty + Number(b.dataset.qty));
      modal.close();
      ctx.shell.refresh();
      if (!ctx.cart.isEmpty) openCheckout();
    };
  });

  const capture = new CustomerCapture({
    mount: wrap.querySelector('#cc'),
    venue: CONFIG.venue,
    source: 'app-preorder',
    consentText: 'Email me Protein Superstore offers, new stock and slush of the week. ' +
                 'Unsubscribe any time.'
  });
  capture.render();
  prefill(wrap, user);

  const pay = new Payment({ mount: wrap.querySelector('#pay'), mode: 'demo', amount: ctx.cart.subtotal });
  pay.render();

  const go = document.createElement('button');
  go.className = 'psp-btn psp-btn-lg';
  wrap.appendChild(go);

  let method = 'card';
  const setMethod = m => {
    method = m;
    wrap.querySelectorAll('[data-pay]').forEach(b => b.classList.toggle('on', b.dataset.pay === m));
    wrap.querySelector('#payWrap').hidden = (m === 'counter');
    go.textContent = m === 'counter'
      ? 'Reserve — pay ' + money(ctx.cart.subtotal) + ' in store'
      : 'Pay ' + money(ctx.cart.subtotal) + ' and pre-order';
  };
  wrap.querySelectorAll('[data-pay]').forEach(b => { b.onclick = () => setMethod(b.dataset.pay); });
  setMethod('card');

  go.onclick = () => submit({ capture, pay, modal, go, method: () => method });
}

function prefill(wrap, user) {
  const set = (id, v) => { const el = wrap.querySelector(id); if (el && v) el.value = v; };
  set('#lp-cc-name', user.name);
  set('#lp-cc-phone', user.phone);
  set('#lp-cc-email', user.email);
}

async function submit({ capture, pay, modal, go, method }) {
  /* value() validates and throws — it does not return a list of problems. */
  let details;
  try {
    details = capture.value();
  } catch (e) {
    return toast(e.message.replace(/^LP-\d+:\s*/, ''), { type: 'error' });
  }

  const counter = method() === 'counter';
  go.disabled = true;
  go.textContent = counter ? 'Reserving…' : 'Taking payment…';
  try {
    if (!counter) {
      const paid = await pay.submit();
      if (!paid?.paid) throw new Error('Payment was not completed');
    }

    /* Points are earned when the money is taken. A reservation has not been
       paid for and may never be collected, so the staff app awards those at
       the counter instead. */
    ctx.cart.loyalty = counter ? null : ctx.loyalty;

    const order = await ctx.cart.placeOrder({
      email: details.email, name: details.name, phone: details.phone,
      marketingOptIn: details.marketingOptIn,
      tableNumber: currentStore().name,
      paymentMethod: counter ? 'counter' : 'card-demo'
    });
    ctx.cart.loyalty = ctx.loyalty;

    await capture.save(details, { orderTotal: order.total });
    await ctx.notify.askPermission();
    ctx.notify.watch(order.ref);

    modal.close();
    ctx.shell.invalidate();
    ctx.shell.go('orders');
    toast(counter
      ? 'Reserved — pay ' + money(order.total) + ' at the counter'
      : 'Order ' + order.ref + ' sent to ' + currentStore().name, { type: 'success' });
  } catch (e) {
    go.disabled = false;
    go.textContent = 'Try again';
    toast(e.message.replace(/^LP-\d+:\s*/, ''), { type: 'error' });
  }
}
