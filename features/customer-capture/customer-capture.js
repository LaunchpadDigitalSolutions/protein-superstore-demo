/* Launchpad Feature — Customer capture
   The "own your customers" product. Name, mobile, email and a marketing
   opt-in captured at checkout, so the venue builds its own list instead of
   renting one from Just Eat or Fresha.

   Extracted from launchserve-go-demo.

   FIXED DURING EXTRACTION
   1. Consent was a bare boolean. UK GDPR requires the venue to be able to
      DEMONSTRATE consent — who, when, and to what wording. A true/false
      with no timestamp and no record of what was shown is not defensible,
      and a marketing list you cannot defend is a liability, not the asset
      we sell it as. Now every grant records the exact wording, the moment,
      and where it happened, and every change is kept in a log.
   2. There was no unsubscribe. Sending marketing with no way out is
      unlawful under PECR. Every customer now has a token for a one-click
      link that needs no login.
   3. There was no way to action a deletion request. `forget()` scrubs the
      person but keeps the orders, so the venue's takings survive.
   4. Customer details lived on the order row, so the marketing list was
      derived from orders — delete an order and you deleted the consent
      record with it.

   Usage:
     import { CustomerCapture } from './features/customer-capture/customer-capture.js';

     const capture = new CustomerCapture({
       mount: el, venue: 'spice-hut',
       consentText: 'Email me occasional offers from Spice Hut'
     });
     capture.render();
     const details = capture.value();       // validates
     await capture.save(details);
*/

import { db as coreDb } from '../../core/db.js';

const DEFAULT_CONSENT =
  'Email me occasional offers and news. You can unsubscribe at any time.';

export class CustomerCapture {
  constructor(opts = {}) {
    if (!opts.venue) throw new Error('LP-182: CustomerCapture needs a venue');

    this.venue        = opts.venue;
    this.db           = opts.db || coreDb;
    this.el           = opts.mount || null;
    this.consentText  = opts.consentText || DEFAULT_CONSENT;
    this.source       = opts.source || 'checkout';
    this.requirePhone = opts.requirePhone !== false;
    this.requireEmail = opts.requireEmail !== false;
    this.onError      = opts.onError || (m => console.error(m));

    if (this.el) this.el.classList.add('lp-cc');
  }

  /* ---------- form ---------- */

  render() {
    if (!this.el) throw new Error('LP-183: no mount element to render into');
    this.el.innerHTML = `
      <div class="lp-cc-field">
        <label class="lp-cc-label" for="lp-cc-name">Your name</label>
        <input id="lp-cc-name" class="lp-cc-input" autocomplete="name" placeholder="Dave Smith">
      </div>
      <div class="lp-cc-field">
        <label class="lp-cc-label" for="lp-cc-phone">Mobile${this.requirePhone ? '' : ' (optional)'}</label>
        <input id="lp-cc-phone" class="lp-cc-input" type="tel" inputmode="tel"
               autocomplete="tel" placeholder="07700 900000">
      </div>
      <div class="lp-cc-field">
        <label class="lp-cc-label" for="lp-cc-email">Email${this.requireEmail ? '' : ' (optional)'}</label>
        <input id="lp-cc-email" class="lp-cc-input" type="email" inputmode="email"
               autocomplete="email" placeholder="dave@example.com">
      </div>

      <label class="lp-cc-consent">
        <input type="checkbox" id="lp-cc-optin" class="lp-cc-check">
        <span class="lp-cc-consent-text">${esc(this.consentText)}</span>
      </label>

      <div class="lp-cc-err" data-lp="err" role="alert"></div>`;
    return this;
  }

  /* Read and validate. Throws with something a customer can act on. */
  value() {
    const get = id => this.el?.querySelector('#' + id)?.value ?? '';
    const details = {
      name: get('lp-cc-name').trim(),
      phone: get('lp-cc-phone').trim(),
      email: get('lp-cc-email').trim().toLowerCase(),
      marketingOptIn: !!this.el?.querySelector('#lp-cc-optin')?.checked
    };
    this.validate(details);
    return details;
  }

  validate(d) {
    if (!d.name) throw new Error('LP-184: please enter your name');
    if (this.requirePhone && !isPhone(d.phone)) {
      throw new Error('LP-185: please enter a mobile number we can reach you on');
    }
    if (d.phone && !isPhone(d.phone)) throw new Error('LP-185: that mobile number does not look right');
    if (this.requireEmail && !isEmail(d.email)) {
      throw new Error('LP-186: please enter a valid email address');
    }
    if (d.email && !isEmail(d.email)) throw new Error('LP-186: that email does not look right');
    if (d.marketingOptIn && !d.email) {
      throw new Error('LP-187: we need an email address to send you offers');
    }
    return true;
  }

  showError(message) {
    const err = this.el?.querySelector('[data-lp="err"]');
    if (!err) return;
    err.textContent = String(message).replace(/^LP-\d+: /, '');
    err.style.display = 'block';
  }

  clearError() {
    const err = this.el?.querySelector('[data-lp="err"]');
    if (err) err.style.display = 'none';
  }

  /* ---------- storing ---------- */

  async save(details, { orderTotal = 0 } = {}) {
    this.validate(details);
    const email = details.email;
    if (!email) return null;              /* nothing to key a customer on */

    const existing = (await this.db('GET',
      `/rest/v1/ls_customers?venue=eq.${enc(this.venue)}&email=eq.${enc(email)}&select=*`))?.[0];

    /* Someone who unsubscribed must not be quietly re-added by a later
       order. Only an explicit re-opt-in through resubscribe() undoes it. */
    const alreadyUnsubscribed = !!existing?.unsubscribed_at;
    const grantingConsent = details.marketingOptIn && !alreadyUnsubscribed
                            && !existing?.marketing_opt_in;

    const body = {
      last_seen_at: new Date().toISOString(),
      order_count: (existing?.order_count || 0) + 1,
      total_spent: round((Number(existing?.total_spent) || 0) + (Number(orderTotal) || 0))
    };
    if (details.name)  body.name = details.name;
    if (details.phone) body.phone = details.phone;

    if (grantingConsent) {
      body.marketing_opt_in = true;
      body.consent_at = new Date().toISOString();
      body.consent_text = this.consentText;
      body.consent_source = this.source;
    }

    let row;
    if (existing) {
      row = (await this.db('PATCH',
        `/rest/v1/ls_customers?id=eq.${enc(existing.id)}`, body))?.[0];
    } else {
      row = (await this.db('POST', '/rest/v1/ls_customers', {
        venue: this.venue, email, ...body,
        marketing_opt_in: !!body.marketing_opt_in
      }))?.[0];
    }

    if (grantingConsent) {
      try {
        await this.db('POST', '/rest/v1/ls_consent_log', {
          venue: this.venue, email, action: 'granted',
          consent_text: this.consentText, source: this.source
        });
      } catch (e) {
        this.onError('LP-188: consent not logged — ' + e.message);
      }
    }
    return row;
  }

  /* ---------- the venue's list ---------- */

  /* Only people who may lawfully be contacted. */
  async marketingList() {
    return await this.db('GET',
      `/rest/v1/ls_marketing_list?venue=eq.${enc(this.venue)}` +
      `&select=*&order=last_seen_at.desc`) || [];
  }

  async allCustomers({ limit = 500 } = {}) {
    return await this.db('GET',
      `/rest/v1/ls_customers?venue=eq.${enc(this.venue)}` +
      `&select=*&order=last_seen_at.desc&limit=${limit}`) || [];
  }

  async stats() {
    const all = await this.allCustomers({ limit: 5000 });
    const optedIn = all.filter(c => c.marketing_opt_in && !c.unsubscribed_at).length;
    return {
      customers: all.length,
      optedIn,
      unsubscribed: all.filter(c => c.unsubscribed_at).length,
      optInRate: all.length ? Math.round((optedIn / all.length) * 100) : 0,
      repeatCustomers: all.filter(c => (c.order_count || 0) > 1).length
    };
  }

  /* ---------- consent ---------- */

  async unsubscribe(token) {
    const res = await this.db('POST', '/rest/v1/rpc/ls_unsubscribe', { p_token: token });
    const row = Array.isArray(res) ? res[0] : res;
    return { ok: !!row?.ok, email: row?.email || null };
  }

  /* Re-opting in after an unsubscribe has to be deliberate. */
  async resubscribe(email, { consentText = null } = {}) {
    email = String(email).trim().toLowerCase();
    const existing = (await this.db('GET',
      `/rest/v1/ls_customers?venue=eq.${enc(this.venue)}&email=eq.${enc(email)}&select=id`))?.[0];
    if (!existing) return false;

    const text = consentText || this.consentText;
    await this.db('PATCH', `/rest/v1/ls_customers?id=eq.${enc(existing.id)}`, {
      marketing_opt_in: true,
      unsubscribed_at: null,
      consent_at: new Date().toISOString(),
      consent_text: text,
      consent_source: 'resubscribe'
    });
    await this.db('POST', '/rest/v1/ls_consent_log', {
      venue: this.venue, email, action: 'granted',
      consent_text: text, source: 'resubscribe'
    });
    return true;
  }

  /* Right to erasure. Scrubs the person, keeps the orders — deleting the
     row outright would take the venue's takings with it. */
  async forget(email) {
    const res = await this.db('POST', '/rest/v1/rpc/ls_forget_customer', {
      p_venue: this.venue, p_email: String(email).trim().toLowerCase()
    });
    return res === true || (Array.isArray(res) ? !!res[0] : !!res);
  }

  /* Subject access request — everything held on one person. */
  async export(email) {
    email = String(email).trim().toLowerCase();
    const [customer, orders, consent] = await Promise.all([
      this.db('GET', `/rest/v1/ls_customers?venue=eq.${enc(this.venue)}&email=eq.${enc(email)}&select=*`),
      this.db('GET', `/rest/v1/ls_orders?venue=eq.${enc(this.venue)}&customer_email=eq.${enc(email)}&select=id,created_at,total,items`),
      this.db('GET', `/rest/v1/ls_consent_log?venue=eq.${enc(this.venue)}&email=eq.${enc(email)}&select=*&order=created_at.asc`)
    ]);
    return { customer: customer?.[0] || null, orders: orders || [], consentHistory: consent || [] };
  }
}

/* UK mobiles and landlines, tolerant of spaces and +44. */
function isPhone(v) {
  const digits = String(v || '').replace(/[\s()-]/g, '').replace(/^\+44/, '0');
  return /^0\d{9,10}$/.test(digits);
}
function isEmail(v) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v || ''));
}
function round(n) { return Math.round(n * 100) / 100; }
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function enc(s) { return encodeURIComponent(s); }
