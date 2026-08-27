/* Spin to Win and Offers — the two home tiles that aren't a screen of their own.

   Spin awards real points through the Loyalty module, so a win shows up on
   the rewards card and in ls_loyalty_log like any other accrual. One spin
   per day per device. */

import { Modal } from '../core/modal.js';
import { toast } from '../core/toast.js';
import { ctx, currentUser, esc, money } from './state.js';

const SPIN_KEY = 'psp_last_spin';

const PRIZES = [
  { label: '50 points',      pts: 50 },
  { label: '10% off today',  pts: 0, note: 'Show this at the counter' },
  { label: '100 points',     pts: 100 },
  { label: 'Free slush upgrade', pts: 0, note: 'Regular to Large, free' },
  { label: '250 points',     pts: 250 },
  { label: '25 points',      pts: 25 }
];

function spunToday() {
  return localStorage.getItem(SPIN_KEY) === new Date().toDateString();
}

export function openSpin() {
  const wrap = document.createElement('div');
  wrap.className = 'psp-spin';

  if (spunToday()) {
    wrap.innerHTML = `
      <div class="psp-spin-wheel done">✓</div>
      <p class="psp-spin-msg">You've had your spin today. Come back tomorrow.</p>`;
    new Modal({ title: 'Spin to Win', content: wrap, actions: [{ label: 'Close', role: 'cancel' }] }).open();
    return;
  }

  wrap.innerHTML = `
    <div class="psp-spin-wheel" id="wheel">◎</div>
    <p class="psp-spin-msg">One spin a day. Points land straight on your rewards card.</p>`;

  const modal = new Modal({
    title: 'Spin to Win',
    content: wrap,
    actions: [{
      label: 'SPIN', role: 'primary',
      onClick: async () => { await spin(wrap); return false; }
    }]
  });
  modal.open();
}

async function spin(wrap) {
  if (spunToday()) return;
  const wheel = wrap.querySelector('#wheel');
  wheel.classList.add('spinning');
  await new Promise(r => setTimeout(r, 1600));

  const prize = PRIZES[Math.floor(Math.random() * PRIZES.length)];
  localStorage.setItem(SPIN_KEY, new Date().toDateString());
  wheel.classList.remove('spinning');
  wheel.classList.add('done');
  wheel.textContent = '★';

  wrap.querySelector('.psp-spin-msg').innerHTML =
    `<strong>${esc(prize.label)}</strong>${prize.note ? '<br>' + esc(prize.note) : ''}`;

  if (prize.pts) {
    try {
      await ctx.loyalty.addPoints(currentUser().email, prize.pts, 'Spin to Win');
      ctx.shell.invalidate('home');
      ctx.shell.invalidate('loyalty');
      toast(prize.pts + ' points added', { type: 'success' });
    } catch (e) {
      /* The prize is still won — say so, and let staff honour it. */
      toast('Won, but the points did not save (PSP-301). Show this to staff.', { type: 'error' });
    }
  }
}

/* ---------- offers ---------- */

export function openOffers() {
  const items = ctx.menu.categories.flatMap(c => c.items);
  const bar = items.find(i => /protein bar/i.test(i.name));
  const slush = items.find(i => /slush/i.test(i.name));

  const wrap = document.createElement('div');
  wrap.className = 'psp-offers';
  wrap.innerHTML = `
    ${offer('BUY 1 GET 1 FREE', 'On selected protein bars, in store and in the app.',
            bar ? `From ${money(bar.price)}` : '')}
    ${offer('SLUSH OF THE WEEK', 'Blue Raspberry Mega for the price of a Large. Plus 50 bonus points.',
            slush ? `From ${money(slush.price)}` : '')}
    ${offer('STUDENT DISCOUNT', '10% off every order, every day. Show your student ID in store once to activate.', '')}
    ${offer('DOUBLE POINTS TUESDAY', 'Every Tuesday, 20 points per £1 instead of 10.', '')}`;

  new Modal({ title: 'Offers', content: wrap, actions: [{ label: 'Close', role: 'cancel' }] }).open();
}

function offer(title, body, tag) {
  return `
    <div class="psp-offer">
      <h3>${esc(title)}</h3>
      <p>${esc(body)}</p>
      ${tag ? `<span class="psp-offer-tag">${esc(tag)}</span>` : ''}
    </div>`;
}
