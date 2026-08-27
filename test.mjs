/* Integration test: does the Protein Superstore skin drive the modules
   correctly? Runs against a stubbed database — no live writes. */
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>',
  { url: 'https://psp.launchpadclient.app/' });
global.window = dom.window; global.document = dom.window.document;
global.localStorage = dom.window.localStorage;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

let pass = 0, fail = 0;
const check = (n, c, x = '') => c ? (pass++, console.log('  PASS  ' + n))
  : (fail++, console.log('  FAIL  ' + n + (x ? '  → ' + x : '')));

/* --- stub db: the real menu rows, in memory --- */
const CATS = [
  { id: 'c1', name: 'Slush Bar', type: 'drink', sort_order: 1 },
  { id: 'c2', name: 'Protein Bars & Foods', type: 'food', sort_order: 2 }
];
const ITEMS = [
  { id: 'i1', category_id: 'c1', name: 'Protein Slush', description: 'Icy', price: 3.99,
    is_available: true, sort_order: 1, choices: [
      { name: 'Choose flavour', req: true, opts: ['Blue Raspberry', 'Cherry Burst'] },
      { name: 'Select size', req: true, opts: [
        { label: 'Regular', price: 0 }, { label: 'Large', price: 1 }, { label: 'Mega', price: 2 }] },
      { name: 'Add a boost', req: false, opts: [
        { label: 'No boost', price: 0 }, { label: 'Extra scoop protein', price: 1 }] }
    ] },
  { id: 'i2', category_id: 'c2', name: "M&M's Protein Bar", description: '', price: 2.99,
    is_available: true, sort_order: 1, choices: [
      { name: 'Flavour', req: true, opts: ["Chocolate M&M's", "Peanut M&M's"] }] }
];
const written = [];
const db = async (method, path, body) => {
  if (method === 'GET' && path.includes('ls_menu_categories')) return CATS;
  if (method === 'GET' && path.includes('ls_menu_items')) return ITEMS;
  if (method === 'GET' && path.includes('ls_loyalty')) return [{ id: 9, email: 'lewis@lasmedia.co.uk', points: 1250, lifetime_pts: 1250, visits: 4 }];
  if (method === 'GET' && path.includes('ls_customers')) return [];
  if (method === 'GET' && path.includes('ls_orders')) return [];
  written.push({ method, path, body });
  return body ? [body] : null;
};

const { Menu } = await import('./features/menu/menu.js');
const { Cart } = await import('./features/cart/cart.js');
const { Loyalty } = await import('./features/loyalty/loyalty.js');

const menu = new Menu({ venue: 'psp-hartlepool', db, includeUnavailable: false });
await menu.load();

console.log('\nMenu\n');
check('loads both categories', menu.categories.length === 2);
check('slush is in the slush bar', menu.categories[0].items[0].name === 'Protein Slush');
check('slush routes to the bar station', menu.routeOf(menu.categories[0].items[0], menu.categories[0]) === 'drink');
check('a bar routes to the counter station', menu.routeOf(menu.categories[1].items[0], menu.categories[1]) === 'food');

console.log('\nPricing — the thing that must never be wrong\n');
const slush = menu.findItem('i1').item;
check('regular slush is £3.99', menu.priceOf(slush, { 'Choose flavour': 'Blue Raspberry', 'Select size': 'Regular' }) === 3.99);
check('large adds £1.00', menu.priceOf(slush, { 'Choose flavour': 'Blue Raspberry', 'Select size': 'Large' }) === 4.99);
check('mega adds £2.00', menu.priceOf(slush, { 'Choose flavour': 'Blue Raspberry', 'Select size': 'Mega' }) === 5.99);
check('a boost stacks on the size', menu.priceOf(slush, { 'Choose flavour': 'Cherry Burst', 'Select size': 'Mega', 'Add a boost': 'Extra scoop protein' }) === 6.99);
check('a missing required choice is caught', menu.missingChoices(slush, { 'Choose flavour': 'Cherry Burst' }).length === 1);
check('an optional choice is not required', menu.missingChoices(slush, { 'Choose flavour': 'Cherry Burst', 'Select size': 'Large' }).length === 0);

console.log('\nBasket\n');
const loyalty = new Loyalty({ mount: document.createElement('div'), venue: 'psp-hartlepool', db, brandName: 'Protein Superstore' });
const cart = new Cart({ mount: document.createElement('div'), menu, venue: 'psp-hartlepool', db,
  orderType: 'collection', pointsPerPound: 10, loyalty, persist: false });

cart.add('i1', { selections: { 'Choose flavour': 'Cherry Burst', 'Select size': 'Large' } });
check('adds a line', cart.count === 1);
check('at the sized price', cart.subtotal === 4.99);
cart.add('i1', { selections: { 'Choose flavour': 'Cherry Burst', 'Select size': 'Large' } });
check('the same slush bumps quantity, not a second line', cart.lines.length === 1 && cart.count === 2);
cart.add('i1', { selections: { 'Choose flavour': 'Blue Raspberry', 'Select size': 'Large' } });
check('a different flavour is its own line', cart.lines.length === 2);
cart.add('i2', { selections: { Flavour: "Peanut M&M's" } });
check('subtotal across mixed items', cart.subtotal === 4.99 * 3 + 2.99);

let threw = null;
try { cart.add('i1', { selections: { 'Choose flavour': 'Cherry Burst' } }); } catch (e) { threw = e.message; }
check('refuses a slush with no size chosen', /LP-085/.test(threw || ''));

console.log('\nOrder\n');
const order = await cart.placeOrder({ email: 'lewis@lasmedia.co.uk', name: 'Lewis',
  phone: '07700 900123', marketingOptIn: true, tableNumber: 'Hartlepool' });
const posted = written.find(w => w.path.includes('ls_orders'))?.body;
check('an order reaches ls_orders', !!posted);
check('under the right venue', posted.venue === 'psp-hartlepool');
check('collection store is recorded', posted.table_num === 'Hartlepool');
check('slushes are routed to the bar screen', posted.drink_items.length === 2);
check('the bar has something to make', posted.drink_status === 'active');
check('the counter has something to pick', posted.food_status === 'active');
check('total matches the basket', posted.total === order.total);
check('the basket is emptied after ordering', cart.isEmpty);
const pts = written.find(w => w.path.includes('ls_loyalty') && w.method === 'PATCH');
check('points accrue at 10 per £1', pts && pts.body.points === 1250 + Math.floor(order.total * 10));

console.log('\nStatus wording customers see\n');
const { } = {};
const statusModule = await import('./js/orders.js').catch(() => null);
check('orders module loads', !!statusModule);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
