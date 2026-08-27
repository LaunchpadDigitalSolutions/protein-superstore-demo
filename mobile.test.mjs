/* Mobile-first checks on the CSS itself. These would have caught the header
   and card-stretch problems before they reached a phone. */
import { readFileSync } from 'fs';
const css = ['css/psp.css','css/psp-screens.css'].map(f => readFileSync(f,'utf8')).join('\n');
const html = readFileSync('index.html','utf8');

let pass=0, fail=0;
const check=(n,c,x='')=>c?(pass++,console.log('  PASS  '+n)):(fail++,console.log('  FAIL  '+n+(x?'  → '+x:'')));

console.log('\nMobile-first CSS\n');

/* Base styles must be unconditional; only min-width queries scale up. */
const maxWidthQueries = (css.match(/@media\s*\(max-width/g)||[]).length;
check('no max-width queries as the responsive strategy', maxWidthQueries === 0, maxWidthQueries+' found');

const minWidthQueries = (css.match(/@media\s*\(min-width/g)||[]).length;
check('scales up with min-width queries', minWidthQueries >= 3);

/* Nothing wider than a 375px screen may be hard-coded outside a query. */
const base = css.split('@media')[0];
const wide = (base.match(/width:\s*(\d{3,})px/g)||[])
  .filter(m => Number(m.match(/\d+/)[0]) > 320);
check('no container wider than 320px in the base styles', wide.length === 0, wide.join(' '));

/* Inputs below 16px make iOS Safari zoom the page. */
const smallInputs = /(?:input|select|textarea)[^{]*\{[^}]*font-size:\s*(?:1[0-5]|[0-9])px/.test(css);
check('no input below 16px', !smallInputs);

/* Every card element is height-bounded, so a flex row cannot stretch them. */
check('card art has a fixed height', /\.psp-card-art\{[^}]*height:96px/.test(css.replace(/\s+/g,'')));
check('product photo is bounded', /\.psp-photo\{[^}]*height:96px/.test(css.replace(/\s+/g,'')));
check('type tile is bounded', /\.psp-typetile\{[^}]*height:96px/.test(css.replace(/\s+/g,'')));
check('slush photo is bounded', /\.psp-slush\{[^}]*height:96px/.test(css.replace(/\s+/g,'')));

/* The logo is sized by height so it cannot blow out on a narrow screen. */
check('logo sized by height, not natural width', /\.psp-logo\{[^}]*height:26px/.test(css.replace(/\s+/g,'')));
check('logo has a max-width guard', /\.psp-logo\{[^}]*max-width:150px/.test(css.replace(/\s+/g,'')));

/* Tap targets. */
const taps = (css.match(/min-height:\s*var\(--tap\)|min-height:\s*(4[4-9]|[5-9]\d)px/g)||[]).length;
check('44px+ tap targets used throughout', taps >= 8, taps+' found');

console.log('\nCache busting\n');
const linked = html.match(/\.(?:css|js)\?v=[\d.]+/g)||[];
check('every stylesheet and script is version-stamped', linked.length >= 12, linked.length+' found');
const unversioned = html.match(/(?:href|src)="\.\/(?:css|js|core|features)\/[^"]*\.(?:css|js)"/g)||[];
check('nothing links to an unversioned asset', unversioned.length === 0, unversioned.join(' '));

const sw = readFileSync('sw.js','utf8');
check('code is network-first in the service worker', /isCode \? networkFirst/.test(sw));
check('offline fallback never serves JSON as a stylesheet', /isData/.test(sw));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail?1:0);
