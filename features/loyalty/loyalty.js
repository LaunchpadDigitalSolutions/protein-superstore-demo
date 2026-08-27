/* Launchpad Feature — Loyalty (digital stamp card)
   Product: LaunchLoyalty
   Source: extracted from launchserve-demo (Dancing Cup), Aug 2026

   Changes from the original:
   - venue, brand name, rewards and earn-rules are passed in, not hardcoded
   - no global variables; everything lives in one instance
   - no dependency on setScreen() or the host app's navigation
   - redeem() and lookup() are methods, not globals wired to onclick strings

   Usage:
     import { configure } from '../../core/db.js';
     import { Loyalty } from './loyalty.js';
     configure({ url: SB_URL, key: SB_KEY });

     const loyalty = new Loyalty({
       mount: document.getElementById('loyalty'),
       venue: 'dancing-cup',
       brandName: 'Dancing Cup',
       rewards: [ { name:'Free coffee', cost:100 }, ... ],
       earnRules: [ { icon:'☕', label:'Every £1 spent', points:'10 pts' }, ... ]
     });
     loyalty.render();

   Award points from elsewhere in your app (e.g. after an order):
     await loyalty.addPoints('someone@email.com', 50, 'Order #123', orderId);

   Tables required: ls_loyalty, ls_loyalty_log  (see loyalty.sql)
*/

import { db as coreDb } from '../../core/db.js';

const DEFAULT_REWARDS = [
  { name: 'Free coffee',   cost: 100 },
  { name: 'Free cake',     cost: 200 },
  { name: '£5 off',        cost: 350 }
];

const DEFAULT_EARN = [
  { icon: '☕', label: 'Every £1 spent', points: '10 pts' },
  { icon: '📅', label: 'Book a table',   points: '25 pts' },
  { icon: '🎂', label: 'Birthday treat', points: '100 pts' }
];

export class Loyalty {
  constructor(opts = {}) {
    if (!opts.mount) throw new Error('LP-210: Loyalty needs a mount element');
    if (!opts.venue) throw new Error('LP-211: Loyalty needs a venue');

    /* The database function is injected so the feature can be tested and
       demoed without a live Supabase connection. Defaults to core/db.js. */
    this.db        = opts.db || coreDb;

    this.el        = opts.mount;
    this.venue     = opts.venue;
    this.brandName = opts.brandName || 'Rewards';
    this.rewards   = (opts.rewards || DEFAULT_REWARDS).slice().sort((a, b) => a.cost - b.cost);
    this.earnRules = opts.earnRules || DEFAULT_EARN;
    this.onError   = opts.onError || (msg => console.error(msg));

    this.el.classList.add('lp-loyalty');
    this.el.addEventListener('click', e => this._onClick(e));
    this.el.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.matches('[data-lp="email"]')) this.lookup();
    });
  }

  /* ---------- screens ---------- */

  render() {
    this.el.innerHTML = `
      <div class="lp-ly-look">
        <div class="lp-ly-title">${esc(this.brandName)} Rewards</div>
        <div class="lp-ly-sub">Earn points every time you spend. Enter the email you order with to see your balance.</div>
        <input class="lp-ly-input" data-lp="email" type="email"
               placeholder="you@email.com" autocomplete="email" inputmode="email">
        <button class="lp-ly-btn" data-lp="lookup">View my points</button>
        <div class="lp-ly-err" data-lp="err" role="alert"></div>
      </div>`;
  }

  renderCard(r) {
    const next = this.rewards.find(x => x.cost > r.points);
    const pct  = next ? Math.min(100, (r.points / next.cost) * 100) : 100;

    this.el.innerHTML = `
      <div class="lp-ly-card">
        <div class="lp-ly-top">
          <div class="lp-ly-brand">${esc(this.brandName)}<span>REWARDS</span></div>
          <div style="text-align:right">
            <div class="lp-ly-pts">${r.points}</div>
            <div class="lp-ly-plabel">Points</div>
          </div>
        </div>
        <div class="lp-ly-bar"><div class="lp-ly-fill" data-lp="fill"></div></div>
        <div class="lp-ly-next">${
          next ? `${next.cost - r.points} points until ${esc(next.name)}` : 'All rewards unlocked'
        }</div>
      </div>

      <div class="lp-ly-stats">
        <div class="lp-ly-stat"><div class="lp-ly-sv">${r.visits || 0}</div><div class="lp-ly-sl">Visits</div></div>
        <div class="lp-ly-stat"><div class="lp-ly-sv">${r.lifetime_pts || 0}</div><div class="lp-ly-sl">Lifetime</div></div>
        <div class="lp-ly-stat"><div class="lp-ly-sv">£${parseFloat(r.total_spent || 0).toFixed(0)}</div><div class="lp-ly-sl">Spent</div></div>
      </div>

      <div class="lp-ly-sec">Your rewards</div>
      ${this.rewards.map(w => {
        const can = r.points >= w.cost;
        return `<div class="lp-ly-reward${can ? ' can' : ''}">
          <div>
            <div class="lp-ly-rname">${esc(w.name)}</div>
            <div class="lp-ly-rcost">${w.cost} points</div>
          </div>
          <button class="lp-ly-rbtn" ${can ? '' : 'disabled'}
                  data-lp="redeem" data-cost="${w.cost}" data-name="${esc(w.name)}">
            ${can ? 'Claim' : 'Locked'}
          </button>
        </div>`;
      }).join('')}

      <div class="lp-ly-sec">How to earn</div>
      ${this.earnRules.map(e => `
        <div class="lp-ly-earn">
          <div class="lp-ly-eicon">${esc(e.icon)}</div>
          <div class="lp-ly-elabel">${esc(e.label)}</div>
          <div class="lp-ly-epts">${esc(e.points)}</div>
        </div>`).join('')}

      <button class="lp-ly-btn lp-ly-btn-ghost" data-lp="back">Check another account</button>`;

    this.current = r;
    requestAnimationFrame(() => {
      const f = this.el.querySelector('[data-lp="fill"]');
      if (f) f.style.width = pct + '%';
    });
  }

  /* ---------- actions ---------- */

  async lookup() {
    const input = this.el.querySelector('[data-lp="email"]');
    const errEl = this.el.querySelector('[data-lp="err"]');
    const email = (input?.value || '').trim().toLowerCase();

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      errEl.textContent = 'Please enter a valid email address.';
      errEl.style.display = 'block';
      input?.focus();
      return;
    }
    errEl.style.display = 'none';

    const btn = this.el.querySelector('[data-lp="lookup"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }

    try {
      let rows = await this.db('GET',
        `/rest/v1/ls_loyalty?venue=eq.${enc(this.venue)}&email=eq.${enc(email)}&select=*`) || [];

      if (!rows.length) {
        await this.db('POST', '/rest/v1/ls_loyalty',
          { venue: this.venue, email, points: 0, lifetime_pts: 0, visits: 0 });
        rows = [{ email, points: 0, lifetime_pts: 0, visits: 0, total_spent: 0 }];
      }
      this.renderCard(rows[0]);
    } catch (err) {
      errEl.textContent = 'Could not load your points. Please try again.';
      errEl.style.display = 'block';
      this.onError('LP-212: ' + err.message);
      if (btn) { btn.disabled = false; btn.textContent = 'View my points'; }
    }
  }

  async redeem(cost, name) {
    const email = this.current?.email;
    if (!email) return;

    try {
      const rows = await this.db('GET',
        `/rest/v1/ls_loyalty?venue=eq.${enc(this.venue)}&email=eq.${enc(email)}&select=*`) || [];
      if (!rows.length) return;

      const r = rows[0];
      if (r.points < cost) { this.toast('Not enough points'); return; }

      await this.db('PATCH', `/rest/v1/ls_loyalty?id=eq.${r.id}`,
        { points: r.points - cost, updated_at: new Date().toISOString() });
      await this.db('POST', '/rest/v1/ls_loyalty_log',
        { venue: this.venue, email, points: -cost, reason: 'Redeemed: ' + name });

      this.toast(name + ' — show this to staff');
      /* Render from a fresh object rather than mutating r. The original
         Dancing Cup code mutated in place, which double-deducted whenever
         the data layer returned a live reference instead of a copy. */
      this.renderCard({ ...r, points: r.points - cost });
    } catch (err) {
      this.toast('Could not redeem — please try again');
      this.onError('LP-213: ' + err.message);
    }
  }

  /* Award points. Call from anywhere — after an order, a booking, a birthday. */
  async addPoints(email, pts, reason, orderId) {
    if (!email) return;
    email = email.trim().toLowerCase();

    const rows = await this.db('GET',
      `/rest/v1/ls_loyalty?venue=eq.${enc(this.venue)}&email=eq.${enc(email)}&select=*`) || [];

    if (rows.length) {
      const r = rows[0];
      await this.db('PATCH', `/rest/v1/ls_loyalty?id=eq.${r.id}`, {
        points: r.points + pts,
        lifetime_pts: r.lifetime_pts + pts,
        visits: r.visits + 1,
        updated_at: new Date().toISOString()
      });
    } else {
      await this.db('POST', '/rest/v1/ls_loyalty',
        { venue: this.venue, email, points: pts, lifetime_pts: pts, visits: 1 });
    }

    await this.db('POST', '/rest/v1/ls_loyalty_log',
      { venue: this.venue, email, points: pts, reason, order_id: orderId || null });
  }

  toast(msg) {
    let t = document.querySelector('.lp-ly-toast');
    if (!t) {
      t = document.createElement('div');
      t.className = 'lp-ly-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove('on'), 2600);
  }

  /* ---------- internal ---------- */

  _onClick(e) {
    const el = e.target.closest('[data-lp]');
    if (!el) return;
    const action = el.dataset.lp;
    if (action === 'lookup') this.lookup();
    else if (action === 'back') this.render();
    else if (action === 'redeem') this.redeem(Number(el.dataset.cost), el.dataset.name);
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function enc(s) { return encodeURIComponent(s); }
