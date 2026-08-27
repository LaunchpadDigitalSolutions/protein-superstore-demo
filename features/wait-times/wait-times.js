/* Launchpad Feature — Wait times (live, measured)
   Part of LaunchServe / LaunchServe GO.

   Shows the customer a real wait time for food and drinks, measured from
   how long the last couple of hours of orders actually took. Not a guess,
   not a static "about 20 minutes".

   Extracted from launchserve-demo (Dancing Cup).

   FIXED DURING EXTRACTION
   1. It used the MEAN. One order where staff forgot to tap "ready" until
      they cleared the table adds 45 minutes to the sample and every
      customer sees an inflated wait for the next two hours. Now the MEDIAN,
      which ignores that outlier entirely.
   2. No sanity bounds. A negative gap (clock skew between devices) or a
      four-hour gap (an order marked ready the next morning) was averaged in
      as if real. Now discarded.
   3. Errors were swallowed with an empty catch, so a broken query looked
      identical to a quiet morning.

   Usage:
     const wait = new WaitTimes({ venue: 'dancing-cup' });
     const t = await wait.load();     // { food: 12, drink: 3, sample: 18 }
     wait.mount(document.getElementById('wait'));  // renders and auto-refreshes
*/

import { db as coreDb } from '../../core/db.js';

export class WaitTimes {
  constructor(opts = {}) {
    if (!opts.venue) throw new Error('LP-160: WaitTimes needs a venue');

    this.venue     = opts.venue;
    this.db        = opts.db || coreDb;
    this.windowMs  = (opts.windowMinutes ?? 120) * 60 * 1000;
    this.minSample = opts.minSample ?? 3;     /* below this, don't claim a number */
    this.maxSaneMin = opts.maxSaneMinutes ?? 90;
    this.refreshMs = (opts.refreshMinutes ?? 3) * 60 * 1000;
    this.onError   = opts.onError || (m => console.error(m));

    this.food = null;
    this.drink = null;
    this.sample = 0;
    this.el = null;
    this._timer = null;
  }

  async load() {
    const since = new Date(Date.now() - this.windowMs).toISOString();

    let rows;
    try {
      rows = await this.db('GET',
        `/rest/v1/ls_orders?venue=eq.${enc(this.venue)}` +
        `&created_at=gte.${enc(since)}` +
        `&select=food_items,drink_items,created_at,food_ready_at,drink_ready_at`) || [];
    } catch (e) {
      /* The original swallowed this, so a broken query looked exactly like
         a quiet morning and nobody investigated. */
      this.onError('LP-161: ' + e.message);
      throw e;
    }

    const foodMins = [], drinkMins = [];

    for (const o of rows) {
      const created = new Date(o.created_at).getTime();
      const food  = asArray(o.food_items);
      const drink = asArray(o.drink_items);

      if (food.length && o.food_ready_at) {
        const m = (new Date(o.food_ready_at).getTime() - created) / 60000;
        if (this._sane(m)) foodMins.push(m);
      }
      if (drink.length && o.drink_ready_at) {
        const m = (new Date(o.drink_ready_at).getTime() - created) / 60000;
        if (this._sane(m)) drinkMins.push(m);
      }
    }

    this.food   = foodMins.length  >= this.minSample ? Math.round(median(foodMins))  : null;
    this.drink  = drinkMins.length >= this.minSample ? Math.round(median(drinkMins)) : null;
    this.sample = foodMins.length + drinkMins.length;

    return { food: this.food, drink: this.drink, sample: this.sample };
  }

  /* Discard nonsense: negative gaps come from clock skew between the
     kitchen tablet and the customer's phone; huge gaps come from an order
     marked ready the next morning. */
  _sane(mins) {
    return Number.isFinite(mins) && mins >= 0 && mins <= this.maxSaneMin;
  }

  format(mins) {
    if (mins === null || mins === undefined) return null;
    if (mins < 1) return 'under a minute';
    if (mins === 1) return '1 min';
    return mins + ' mins';
  }

  /* ---------- rendering ---------- */

  async mount(el) {
    this.el = el;
    el.classList.add('lp-wait');
    await this.refresh();
    this._timer = setInterval(() => this.refresh().catch(() => {}), this.refreshMs);
    return this;
  }

  unmount() {
    clearInterval(this._timer);
    this._timer = null;
    this.el = null;
    return this;
  }

  async refresh() {
    try {
      await this.load();
    } catch (e) {
      this.render(true);
      return;
    }
    this.render(false);
  }

  render(failed = false) {
    if (!this.el) return;

    /* Say nothing rather than something wrong. A made-up wait time is
       worse than no wait time. */
    if (failed || (this.food === null && this.drink === null)) {
      this.el.innerHTML = '';
      return;
    }

    const cells = [];
    if (this.food !== null)  cells.push({ label: 'Food',   value: this.format(this.food) });
    if (this.drink !== null) cells.push({ label: 'Drinks', value: this.format(this.drink) });

    this.el.innerHTML = `
      <div class="lp-wait-inner">
        <div class="lp-wait-head">Right now</div>
        <div class="lp-wait-cells">
          ${cells.map(c => `
            <div class="lp-wait-cell">
              <div class="lp-wait-value">${esc(c.value)}</div>
              <div class="lp-wait-label">${esc(c.label)}</div>
            </div>`).join('')}
        </div>
      </div>`;
  }
}

/* Middle value. Immune to the one order that sat for 45 minutes because
   nobody tapped the button. */
export function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function asArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch (e) { return []; } }
  return [];
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function enc(s) { return encodeURIComponent(s); }
