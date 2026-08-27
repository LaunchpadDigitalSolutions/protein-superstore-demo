/* Launchpad Feature — Payment
   Part of LaunchServe / LaunchServe GO / LaunchServe Book.

   READ THIS BEFORE USING IT
   The demos had a card form that formatted digits into a plain <input> and
   sent nothing anywhere. Fine as a pitch prop. Two ways that becomes a
   problem:

     1. You hand a client something that looks like it takes payment and
        doesn't, and nobody notices until a customer thinks they've paid.
     2. A real customer types a real card number into an ordinary input on
        a page with no PCI compliance. The moment card data touches your
        page you are on the hook for it.

   So this feature has two modes and they cannot be confused:

     mode: 'demo'    A payment step for pitching. Visibly marked as a demo,
                     accepts only a test number, never transmits anything,
                     and refuses to run on a non-demo domain.

     mode: 'stripe'  Real money. Redirects to Stripe Checkout — the card
                     number never touches your page, which is what keeps
                     the client inside PCI SAQ-A instead of SAQ-D.

   There is deliberately no third mode that collects real card details
   directly. If you find yourself wanting one, the answer is Stripe.

   Usage — pitching:
     const pay = new Payment({ mount: el, mode: 'demo', amount: 12.50 });
     pay.render();
     const result = await pay.submit();          // { paid: true, demo: true }

   Usage — real:
     const pay = new Payment({
       mount: el, mode: 'stripe', amount: 12.50,
       checkoutEndpoint: 'https://pay.launchpadme.co.uk/create-session',
       orderRef: 'PRE-42', venue: 'spice-hut'
     });
     await pay.checkout();                        // leaves the page
*/

const TEST_CARD = '4242424242424242';

/* Domains where demo mode is allowed to run. Anything else and it refuses,
   so a demo can't be quietly deployed as a client's real checkout. */
const DEMO_HOSTS = [
  'localhost', '127.0.0.1',
  'launchpadclient.app', 'pages.dev', 'launchpadme.co.uk'
];

export class Payment {
  constructor(opts = {}) {
    this.mode = opts.mode;
    if (!['demo', 'stripe'].includes(this.mode)) {
      throw new Error("LP-190: Payment needs mode 'demo' or 'stripe'");
    }

    this.el       = opts.mount || null;
    this.amount   = Number(opts.amount) || 0;
    this.currency = opts.currency || 'GBP';
    this.onError  = opts.onError || (m => console.error(m));

    if (this.mode === 'stripe') {
      if (!opts.checkoutEndpoint) {
        throw new Error('LP-191: stripe mode needs a checkoutEndpoint — the ' +
                        'Worker that creates the Checkout session');
      }
      this.checkoutEndpoint = opts.checkoutEndpoint;
      this.orderRef  = opts.orderRef || null;
      this.venue     = opts.venue || null;
      const here = typeof location !== 'undefined' ? location.href : '';
      this.successUrl = opts.successUrl || here;
      this.cancelUrl  = opts.cancelUrl || here;
      this.fetch = opts.fetch || ((...a) => fetch(...a));
      /* Injectable so the redirect can be observed in tests rather than
         actually leaving the page. */
      this.navigate = opts.navigate || (url => { location.href = url; });
    }

    if (this.mode === 'demo') {
      this.allowedHosts = opts.allowedHosts || DEMO_HOSTS;
      this.hostname = opts.hostname || (typeof location !== 'undefined' ? location.hostname : '');
    }

    if (this.el) this.el.classList.add('lp-pay');
  }

  /* A demo build must never end up live on a client's own domain. */
  get demoAllowedHere() {
    if (this.mode !== 'demo') return true;
    const h = String(this.hostname || '').toLowerCase();
    return this.allowedHosts.some(allowed => h === allowed || h.endsWith('.' + allowed));
  }

  /* ---------- rendering ---------- */

  render() {
    if (!this.el) throw new Error('LP-192: no mount element to render into');

    if (this.mode === 'stripe') {
      this.el.innerHTML = `
        <div class="lp-pay-total">
          <span>Total to pay</span><span>${money(this.amount, this.currency)}</span>
        </div>
        <button class="lp-pay-go" data-lp="checkout">Pay securely</button>
        <div class="lp-pay-note">You'll be taken to our payment provider. Your card
          details are never handled by this site.</div>
        <div class="lp-pay-err" data-lp="err" role="alert"></div>`;
      this.el.addEventListener('click', e => {
        if (e.target.closest('[data-lp="checkout"]')) this.checkout();
      });
      return this;
    }

    if (!this.demoAllowedHere) {
      this.el.innerHTML = `
        <div class="lp-pay-blocked">
          <strong>Demo payment is disabled here.</strong>
          This build is running on <code>${esc(this.hostname)}</code>, which isn't a
          demo domain. Switch to <code>mode: 'stripe'</code> before taking real money.
        </div>`;
      this.onError('LP-193: demo payment blocked on ' + this.hostname);
      return this;
    }

    this.el.innerHTML = `
      <div class="lp-pay-demo-flag">Demo — no real payment is taken</div>
      <div class="lp-pay-total">
        <span>Total</span><span>${money(this.amount, this.currency)}</span>
      </div>
      <div class="lp-pay-field">
        <label class="lp-pay-label" for="lp-pay-num">Card number</label>
        <input id="lp-pay-num" class="lp-pay-input" inputmode="numeric"
               autocomplete="off" placeholder="4242 4242 4242 4242">
      </div>
      <div class="lp-pay-row">
        <div class="lp-pay-field">
          <label class="lp-pay-label" for="lp-pay-exp">Expiry</label>
          <input id="lp-pay-exp" class="lp-pay-input" inputmode="numeric"
                 autocomplete="off" placeholder="MM / YY">
        </div>
        <div class="lp-pay-field">
          <label class="lp-pay-label" for="lp-pay-cvc">CVC</label>
          <input id="lp-pay-cvc" class="lp-pay-input" inputmode="numeric"
                 autocomplete="off" placeholder="123" maxlength="4">
        </div>
      </div>
      <div class="lp-pay-note">Use <code>4242 4242 4242 4242</code>, any future
        expiry, any CVC. Nothing is sent anywhere.</div>
      <div class="lp-pay-err" data-lp="err" role="alert"></div>`;

    const num = this.el.querySelector('#lp-pay-num');
    const exp = this.el.querySelector('#lp-pay-exp');
    const cvc = this.el.querySelector('#lp-pay-cvc');
    num.addEventListener('input', () => { num.value = formatCard(num.value); });
    exp.addEventListener('input', () => { exp.value = formatExpiry(exp.value); });
    cvc.addEventListener('input', () => { cvc.value = cvc.value.replace(/\D/g, '').slice(0, 4); });
    return this;
  }

  /* ---------- demo ---------- */

  /* Only the Stripe test number is accepted. Someone tapping in their real
     card gets told to stop, rather than being led to believe they've paid. */
  async submit() {
    if (this.mode !== 'demo') {
      throw new Error('LP-194: submit() is demo only — use checkout() for real payments');
    }
    if (!this.demoAllowedHere) {
      throw new Error('LP-193: demo payment is disabled on this domain');
    }

    const num = digits(this.el?.querySelector('#lp-pay-num')?.value);
    const exp = this.el?.querySelector('#lp-pay-exp')?.value || '';
    const cvc = digits(this.el?.querySelector('#lp-pay-cvc')?.value);

    if (!num) throw new Error('LP-195: enter the demo card number');
    if (num !== TEST_CARD) {
      throw new Error('LP-196: this is a demo — do not enter a real card. ' +
                      'Use 4242 4242 4242 4242');
    }
    if (!isFutureExpiry(exp)) throw new Error('LP-197: enter a future expiry date');
    if (cvc.length < 3) throw new Error('LP-198: enter a 3 or 4 digit CVC');

    /* Deliberately nothing is transmitted, stored, or logged. */
    await pause(600);
    return { paid: true, demo: true, amount: this.amount, method: 'demo' };
  }

  /* ---------- stripe ---------- */

  /* Creates a Checkout session server-side and leaves the page. The card
     number never touches this site. */
  async checkout() {
    if (this.mode !== 'stripe') {
      throw new Error('LP-199: checkout() needs stripe mode');
    }
    const err = this.el?.querySelector('[data-lp="err"]');
    const btn = this.el?.querySelector('[data-lp="checkout"]');
    if (err) err.style.display = 'none';
    if (btn) { btn.disabled = true; btn.textContent = 'Taking you to payment…'; }

    try {
      /* Amount is sent for display only. The Worker recalculates it from
         the order — never trust a total that came from the browser. */
      const res = await this.fetch(this.checkoutEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderRef: this.orderRef,
          venue: this.venue,
          successUrl: this.successUrl,
          cancelUrl: this.cancelUrl
        })
      });
      if (!res.ok) throw new Error('checkout session ' + res.status);
      const data = await res.json();
      if (!data.url) throw new Error('no checkout url returned');

      this.navigate(data.url);
      return { redirecting: true, url: data.url };
    } catch (e) {
      this.onError('LP-200: ' + e.message);
      if (err) {
        err.textContent = "We couldn't start the payment. Please try again, or pay at the counter.";
        err.style.display = 'block';
      }
      if (btn) { btn.disabled = false; btn.textContent = 'Pay securely'; }
      throw new Error('Could not start the payment.');
    }
  }

  showError(message) {
    const err = this.el?.querySelector('[data-lp="err"]');
    if (!err) return;
    err.textContent = String(message).replace(/^LP-\d+: /, '');
    err.style.display = 'block';
  }
}

/* ---------- formatting ---------- */

export function formatCard(v) {
  return digits(v).slice(0, 19).replace(/(.{4})/g, '$1 ').trim();
}

export function formatExpiry(v) {
  const d = digits(v).slice(0, 4);
  return d.length >= 3 ? d.slice(0, 2) + ' / ' + d.slice(2) : d;
}

/* Is MM / YY in the future, and is MM a real month? The demos checked
   neither, so 13/99 and last year both sailed through. */
export function isFutureExpiry(v, now = new Date()) {
  const d = digits(v);
  if (d.length !== 4) return false;
  const mm = Number(d.slice(0, 2));
  const yy = Number(d.slice(2));
  if (mm < 1 || mm > 12) return false;
  const year = 2000 + yy;
  const endOfMonth = new Date(year, mm, 1) - 1;
  return endOfMonth >= now.getTime();
}

/* Luhn — catches a mistyped digit before the customer is told it failed.
   Exported for the Worker to use; demo mode only accepts the test number. */
export function luhnValid(v) {
  const d = digits(v);
  if (d.length < 12) return false;
  let sum = 0, alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = Number(d[i]);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}

function digits(v) { return String(v ?? '').replace(/\D/g, ''); }
function money(n, cur) {
  try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur }).format(n); }
  catch (e) { return '£' + Number(n).toFixed(2); }
}
function pause(ms) { return new Promise(r => setTimeout(r, ms)); }
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
