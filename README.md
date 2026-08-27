# Protein Superstore — order & rewards app (demo)

A pitch demo for Protein Superstore (5 stores: Hartlepool, Sunderland, Newcastle,
Middlesbrough, Stockton). Built by Launchpad Digital Solutions.

**Live:** psp.launchpadclient.app
**Spec:** internal vault (`Projects/specs/2026-08-27-protein-superstore.md`)
**Staff view:** psp.launchpadclient.app/staff.html (demo PIN 1234)

---

## What it does

**Customer** — browse the range, pre-order a slush or supplements for collection,
pay, watch the order status, collect. Points accrue on every order and can be
redeemed against rewards. Installs to the home screen and keeps working offline.

**Staff** — on their own phone, not a mounted tablet. Sign in, see what's
waiting oldest first, what to make and what to pick, tap Ready. That flips the
customer's screen and fires their alert.

---

## It is assembled, not written

Every screen is a module from `LaunchpadDigitalSolutions/launchpad-features`.
This repo holds the Protein Superstore skin and about 700 lines of wiring.

| Module | Does |
|---|---|
| `core/db` | Every Supabase read and write |
| `core/toast`, `core/modal` | Messages, product sheet, checkout |
| `menu` | Products, choice groups, **all pricing** |
| `cart` | Basket, and the write to `ls_orders` |
| `loyalty` | Points, rewards, redemption |
| `customer-capture` | Details and marketing consent (GDPR) |
| `payment` | Card step — demo mode, nothing transmitted |
| `order-ready` | "Your order is ready" alert, survives a reload |
| `shell` | Bottom nav on mobile, sidebar on desktop |
| `bug-report` | Floating report button |
| `pwa` | Install to home screen, offline, update prompt |

Update a module upstream, copy it back in — no rewrite.

---

## Data

Supabase `coiwwbroycaznkmhevde`, venue key `psp-hartlepool`.

**One venue key per store.** Each store has its own menu, its own order board and
its own numbers, so adding a store is a config change rather than a build.
Hartlepool is the only live store; the other four render as "Coming soon".
Tables: `ls_menu_categories`, `ls_menu_items`, `ls_orders`, `ls_customers`,
`ls_loyalty`, `ls_loyalty_log`, `bug_reports`.

Products, prices, flavours and store addresses are the client's real ones,
taken from proteinsuperstore.co.uk.

---

## The staff view is not a library module yet

`js/staff.js` plus `staff.html` are client-specific for now. The `kitchen`
module was tried here first and removed: it assumes a mounted tablet on mains
power, polling every 4 seconds with sound and colour-coded timers. On a phone
that drains the battery and stops the moment the screen locks.

If this shape works for Protein Superstore it belongs in `launchpad-features`,
because every collection client will need it.

---

## Before this becomes a real build

1. **Payment is demo mode.** Only 4242 4242 4242 4242 is accepted and nothing is
   transmitted. Real money means `mode: 'stripe'` and the checkout Worker.
2. **The client sends the total.** Fine while it's a demo; a server must price the
   basket before card payment goes live. See the cart module's README.
3. **`ls_orders` is open to anon on this project.** Acceptable for a demo, not for
   a live client — the order-insert / read-own-order policies in `cart.sql` should
   replace it.
4. **Stock is not real.** Sold-out flags are manual until it talks to their Shopify
   catalogue.
5. **Sign-in is stubbed** — Lewis on the customer side, a shared PIN on the staff
   side. A real build swaps in `core/auth.js` with an account per staff member,
   because own-phone access has to be revocable when somebody leaves.
6. **Alerts only fire while the staff view is open.** Real push to a closed app
   needs VAPID keys, a subscription per phone and a Worker to send. Roughly a
   day. Do not claim it in a pitch until it exists.
7. **Collection only.** Delivery is an open question for the client, not a
   toggle — it needs address capture, a fee, a radius and a dispatch state.

---

## Tests

```bash
npm i -D jsdom && node test.mjs
```

26 passing: menu routing, every pricing path (size surcharges, stacked boosts,
missing required choices), basket line merging, and the order write — including
that slushes land on the bar board and bars on the counter board.
