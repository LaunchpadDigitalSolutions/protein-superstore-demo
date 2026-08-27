/* Launchpad — Stripe Checkout session Worker
   Deploy to Cloudflare Workers. This is the server half of
   features/payment/payment.js in stripe mode.

   WHY A WORKER AT ALL
   Two things must happen server-side or the whole thing is theatre:

     1. The Stripe secret key must never reach the browser.
     2. The amount must be recalculated from the order. If the browser tells
        you what to charge, anyone can open the console and pay 1p — the
        same bug the cart trigger fixes for pay-at-counter.

   Set these as Worker secrets (never in the code):
     STRIPE_SECRET_KEY      sk_live_… or sk_test_…
     SUPABASE_URL
     SUPABASE_SERVICE_KEY   service role — this Worker is trusted, the
                            browser is not
     ALLOWED_ORIGINS        comma-separated list of your client domains

   Route: POST /create-session   { orderRef, venue, successUrl, cancelUrl }
   Returns: { url }
*/

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const originOk = allowed.includes(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(originOk ? origin : '') });
    }
    if (request.method !== 'POST') {
      return json({ error: 'method not allowed' }, 405, origin, originOk);
    }
    if (!originOk) {
      /* Without this, anyone can point their own site at your Worker and
         create sessions against your Stripe account. */
      return json({ error: 'origin not allowed' }, 403, origin, false);
    }

    let body;
    try { body = await request.json(); }
    catch (e) { return json({ error: 'bad request' }, 400, origin, true); }

    const { orderRef, venue, successUrl, cancelUrl } = body || {};
    if (!orderRef || !venue) {
      return json({ error: 'orderRef and venue are required' }, 400, origin, true);
    }

    /* Recalculate from the order. Never from anything the browser sent. */
    const order = await getOrder(env, venue, orderRef);
    if (!order) return json({ error: 'order not found' }, 404, origin, true);
    if (order.payment_status === 'paid') {
      return json({ error: 'this order is already paid' }, 409, origin, true);
    }

    const pence = Math.round(Number(order.total) * 100);
    if (!Number.isFinite(pence) || pence < 30) {
      /* Stripe's own floor is 30p; below that the fee exceeds the payment. */
      return json({ error: 'amount too small to charge' }, 400, origin, true);
    }

    const params = new URLSearchParams();
    params.set('mode', 'payment');
    params.set('success_url', safeUrl(successUrl, allowed) + '?paid=' + encodeURIComponent(orderRef));
    params.set('cancel_url', safeUrl(cancelUrl, allowed));
    params.set('client_reference_id', orderRef);
    params.set('metadata[venue]', venue);
    params.set('metadata[order_ref]', orderRef);
    params.set('line_items[0][quantity]', '1');
    params.set('line_items[0][price_data][currency]', 'gbp');
    params.set('line_items[0][price_data][unit_amount]', String(pence));
    params.set('line_items[0][price_data][product_data][name]',
               'Order ' + orderRef);

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY,
        'Content-Type': 'application/x-www-form-urlencoded',
        /* Retrying must not create a second session for the same order. */
        'Idempotency-Key': 'order-' + venue + '-' + orderRef
      },
      body: params
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error('LP-201: stripe rejected the session', detail.slice(0, 300));
      return json({ error: 'could not start payment' }, 502, origin, true);
    }

    const session = await res.json();
    return json({ url: session.url }, 200, origin, true);
  }
};

async function getOrder(env, venue, orderRef) {
  const url = `${env.SUPABASE_URL}/rest/v1/ls_orders` +
    `?venue=eq.${encodeURIComponent(venue)}&id=eq.${encodeURIComponent(orderRef)}` +
    `&select=id,total,payment,status`;
  const res = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY
    }
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows?.[0] || null;
}

/* Only ever redirect back to a domain we control. */
function safeUrl(candidate, allowed) {
  try {
    const u = new URL(candidate);
    if (allowed.some(a => u.origin === a)) return u.origin + u.pathname;
  } catch (e) {}
  return allowed[0] || 'https://launchpadme.co.uk';
}

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin || 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400'
  };
}
function json(obj, status, origin, ok) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors(ok ? origin : '') }
  });
}
