/* Render the home and shop markup headlessly and check the real assets are
   referenced, not drawings. */
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', { url: 'https://x.github.io/protein-superstore-demo/' });
global.window = dom.window; global.document = dom.window.document; global.localStorage = dom.window.localStorage;

const CATS = [{ id:'c1', name:'Slush Bar', type:'drink', sort_order:1 },
              { id:'c2', name:'Protein Bars & Foods', type:'food', sort_order:2 }];
const ITEMS = [
 { id:'i1', category_id:'c1', name:'Protein Slush', description:'Icy', price:3.99, is_available:true, sort_order:1,
   choices:[{name:'Choose flavour',req:true,opts:['Blue Raspberry','Cherry Burst']},
            {name:'Select size',req:true,opts:[{label:'Regular',price:0},{label:'Large',price:1}]}] },
 { id:'i2', category_id:'c2', name:"M&M's Protein Bar", description:'', price:2.99, is_available:true, sort_order:1, choices:[] },
 { id:'i3', category_id:'c2', name:'5% Nutrition Crea-TEN 225g', description:'', price:29.99, is_available:true, sort_order:2, choices:[] }
];
const db = async (m,p) => p.includes('categories') ? CATS : p.includes('items') ? ITEMS
  : p.includes('loyalty') ? [{ id:1, points:1250, lifetime_pts:3140, visits:17 }] : [];

const { Menu } = await import('./features/menu/menu.js');
const { Cart } = await import('./features/cart/cart.js');
const { Loyalty } = await import('./features/loyalty/loyalty.js');
const { ctx } = await import('./js/state.js');
ctx.menu = new Menu({ venue:'psp-hartlepool', db, includeUnavailable:false });
await ctx.menu.load();
ctx.loyalty = new Loyalty({ mount: document.createElement('div'), venue:'psp-hartlepool', db });
ctx.cart = new Cart({ mount: document.createElement('div'), menu: ctx.menu, venue:'psp-hartlepool', db, persist:false });

const { homeHtml } = await import('./js/home.js');
const { shopHtml } = await import('./js/shop.js');
const home = await homeHtml();
const shop = shopHtml();

let pass=0, fail=0;
const check=(n,c)=>c?(pass++,console.log('  PASS  '+n)):(fail++,console.log('  FAIL  '+n));
console.log('\nArtwork\n');
check('hero uses the mockup artwork', home.includes('./assets/hero.jpg'));
check('promo uses the photographed slush pair', home.includes('./assets/slush-pair.jpg'));
check('points balance is live, not hardcoded', home.includes('1,250'));
check('slush card uses the photograph', shop.includes('./assets/slush-hero.jpg'));
check("M&M's uses the client's own CDN photo", shop.includes('cdn/shop/products/m_m-protein-bar'));
check('a product with no photo gets a type tile, not a fake tub', shop.includes('psp-typetile'));
check('no drawn cup left anywhere', !home.includes('<svg class="psp-cup"') && !shop.includes('psp-tub'));
check('every image lazy-loads below the fold', (shop.match(/loading="lazy"/g)||[]).length >= 2);
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail?1:0);
