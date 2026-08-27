/* Real-browser layout check at 375px. Supabase and Google Fonts are not
   reachable from the build sandbox, so both are stubbed — the point is the
   layout, not the data. */
import puppeteer from 'puppeteer-core';

const CATS=[{id:'c1',name:'Slush Bar',type:'drink',sort_order:1},
            {id:'c2',name:'Protein Bars & Foods',type:'food',sort_order:2}];
const ITEMS=[
 {id:'i1',category_id:'c1',name:'Protein Slush',description:'Refreshing. Icy.',price:3.99,is_available:true,sort_order:1,
  choices:[{name:'Choose flavour',req:true,opts:['Blue Raspberry','Cherry Burst','Strawberry Watermelon','Tropical Punch']},
           {name:'Select size',req:true,opts:[{label:'Regular',price:0},{label:'Large',price:1},{label:'Mega',price:2}]}]},
 {id:'i2',category_id:'c2',name:"M&M's Protein Bar",description:'',price:2.99,is_available:true,sort_order:1,choices:[]},
 {id:'i3',category_id:'c2',name:'Snickers Low Sugar Hi-Protein Bar',description:'',price:2.99,is_available:true,sort_order:2,choices:[]},
 {id:'i4',category_id:'c2',name:'5% Nutrition 5150 384g',description:'',price:36.99,is_available:true,sort_order:3,choices:[]}];

const b = await puppeteer.launch({
  executablePath:'/home/claude/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome',
  args:['--no-sandbox','--disable-dev-shm-usage']});
const p = await b.newPage();
await p.evaluateOnNewDocument(() => {
  /* Measuring layout, not caching. */
  Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true });
});
await p.setCacheEnabled(false);   /* each viewport pass must re-read the CSS */
await p.setRequestInterception(true);
const CORS = {
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'*',
  'Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE,OPTIONS'
};
p.on('request', req => {
  const u = req.url();
  /* The browser preflights a cross-origin fetch; without a proper OPTIONS
     answer the real request never happens. */
  if (req.method() === 'OPTIONS') return req.respond({ status:204, headers:CORS, body:'' });
  const json = d => req.respond({ status:200, contentType:'application/json',
    headers:CORS, body: JSON.stringify(d) });
  if (u.includes('ls_menu_categories')) return json(CATS);
  if (u.includes('ls_menu_items')) return json(ITEMS);
  if (u.includes('ls_loyalty')) return json([{id:1,email:'lewis@lasmedia.co.uk',points:1250,lifetime_pts:3140,visits:17}]);
  if (u.includes('ls_orders')) return json([]);
  if (u.includes('supabase.co')) return json([]);
  if (u.includes('fonts.googleapis') || u.includes('fonts.gstatic')) return req.respond({ status:200, contentType:'text/css', body:'' });
  return req.continue();
});

let pass=0, fail=0;
const check=(n,c,x='')=>c?(pass++,console.log('  PASS  '+n)):(fail++,console.log('  FAIL  '+n+(x?'  → '+x:'')));

for (const [label, w] of [['375px', 375], ['360px', 360], ['768px', 768]]) {
  await p.setViewport({ width:w, height:812, deviceScaleFactor:2, isMobile:w<768 });
  await p.goto('http://127.0.0.1:8899/index.html', { waitUntil:'networkidle2' });
  await new Promise(r=>setTimeout(r,1200));

  const m = await p.evaluate(() => {
    const over = [];
    document.querySelectorAll('body *').forEach(el => {
      const r = el.getBoundingClientRect();
      const offCanvas = r.right <= 0;            /* deliberately parked off-screen */
      /* Content inside a horizontal scroller is meant to run past the edge. */
      const inScroller = el.closest('.psp-rail, .psp-chiprow');
      if (!offCanvas && !inScroller && r.width > 0 && r.right > window.innerWidth + 1) {
        const scroller = el.closest('[style*="overflow"],.psp-rail,.psp-chiprow');
        if (!scroller || scroller === el) {
          over.push(el.tagName.toLowerCase() + '.' + (el.className||'').toString().split(' ')[0]
            + ' w' + Math.round(r.width) + ' right' + Math.round(r.right));
        }
      }
    });
    const tiles = [...document.querySelectorAll('.psp-tile')].map(t => Math.round(t.getBoundingClientRect().width));
    const small = [...document.querySelectorAll('button,a,input')]
      .filter(e => { const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.height < 44 && !e.closest('.lp-bug'); })
      .map(e => (e.className||'').toString().split(' ')[0] + ' h' + Math.round(e.getBoundingClientRect().height));
    /* The container itself must never be wider than the screen, even when a
       scroller inside it is. */
    const bodyEl = document.querySelector('.lp-shell-body');
    const bodyWidth = bodyEl ? Math.round(bodyEl.getBoundingClientRect().width) : 0;
    const railCards = document.querySelectorAll('.psp-railcard').length;
    const promo = !!document.querySelector('.psp-promo');
    /* A missing element used to make this pass silently — the selector was
       wrong and the check reported green while the button sat on the nav. */
    const bugEl = document.querySelector('.lp-bug-fab');
    const navEl = document.querySelector('.lp-shell-bottom');
    const bugFound = !!bugEl && !!navEl;
    const bug = bugEl?.getBoundingClientRect();
    const nav = navEl?.getBoundingClientRect();
    const navVisible = nav && getComputedStyle(navEl).display !== 'none';
    const bugClearsNav = bugFound && (!navVisible || bug.bottom <= nav.top + 1);
    return { railCards, promo, bugClearsNav, bugFound, bodyWidth,
             doc: document.documentElement.scrollWidth, view: window.innerWidth,
             over: over.slice(0,6), tiles, tilesVisible: tiles.filter((_,i)=>i<4).length, small: [...new Set(small)].slice(0,6) };
  });

  console.log('\n' + label + '  (document ' + m.doc + ' / viewport ' + m.view + ')\n');
  check('no horizontal overflow', m.doc <= m.view + 1, 'document is ' + m.doc + 'px');
  check('nothing sticks out past the edge', m.over.length === 0, m.over.join(' | '));
  check('all four tiles fit on one row',
    m.tiles.length === 4 && m.tiles.reduce((a,c)=>a+c,0) <= m.view, 'tile widths ' + m.tiles.join(','));
  check('every control is at least 44px tall', m.small.length === 0, m.small.join(' | '));
  check('the page container fits the screen', m.bodyWidth <= m.view, m.bodyWidth + 'px in a ' + m.view + 'px screen');
  check('the slush promo renders', m.promo);
  check('the popular products rail has cards', m.railCards >= 3, m.railCards + ' cards');
  check('the bug button was actually found', m.bugFound);
  check('the bug button does not cover the bottom nav', m.bugClearsNav);
}

await p.setViewport({ width:375, height:812, deviceScaleFactor:2, isMobile:true });
await p.goto('http://127.0.0.1:8899/index.html', { waitUntil:'networkidle2' });
await new Promise(r=>setTimeout(r,1200));
await p.screenshot({ path:'shot-home.png' });
console.log(`\n${pass} passed, ${fail} failed\n`);
await b.close();
process.exit(fail?1:0);
