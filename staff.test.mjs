/* Staff view logic. The café assumptions this replaces are called out in each
   group heading — these tests exist so they cannot creep back. */
import { isOutstanding, work, minutesWaiting, sortForStaff, newSince,
         summarise, readyPatch, collectedPatch, stage, isUnpaid, amountDue,
         forStaff, pointsOnCollection } from './js/staff.js';

let pass=0, fail=0;
const check=(n,c,x='')=>c?(pass++,console.log('  PASS  '+n)):(fail++,console.log('  FAIL  '+n+(x?'  → '+x:'')));

const order = (o={}) => ({
  id:'A1', status:'active', food_status:'active', drink_status:'active',
  food_items:[{n:'Snickers Bar',q:2,price:2.99}],
  drink_items:[{n:'Protein Slush (Mega)',q:1,price:5.99}],
  items:[{n:'Snickers Bar',q:2},{n:'Protein Slush (Mega)',q:1}],
  total:11.97, created_at:new Date(Date.now()-6*60000).toISOString(), ...o });

console.log('\nWhat still needs doing\n');
check('an untouched order is outstanding', isOutstanding(order()));
check('half done is still outstanding', isOutstanding(order({ food_status:'ready' })));
check('both done is not', !isOutstanding(order({ food_status:'ready', drink_status:'ready' })));
check('a collected order is not', !isOutstanding(order({ status:'complete' })));
check('an order with no drinks is handled', isOutstanding(order({ drink_status:'none' })));

console.log('\nMake versus pick\n');
let w = work(order());
check('slush goes in make', w.make.length === 1 && /Slush/.test(w.make[0].n));
check('shelf stock goes in pick', w.pick.length === 1 && /Snickers/.test(w.pick[0].n));
w = work(order({ drink_status:'ready' }));
check('a finished half disappears from the list', w.make.length === 0 && w.pick.length === 1);

console.log('\nOrdering — oldest first, not newest\n');
const rows = [
  order({ id:'NEW', created_at:new Date(Date.now()-1*60000).toISOString() }),
  order({ id:'OLD', created_at:new Date(Date.now()-30*60000).toISOString() })
];
check('the longest wait is served first', sortForStaff(rows)[0].id === 'OLD');
check('minutes waiting is honest', minutesWaiting(rows[1]) === 30);
check('a clock skew cannot go negative',
  minutesWaiting(order({ created_at:new Date(Date.now()+60000).toISOString() })) === 0);

console.log('\nAlerting once, never on first load\n');
const seen = new Set(['A1']);
check('an order already seen does not buzz again', newSince([order()], seen).length === 0);
check('a genuinely new order buzzes', newSince([order({ id:'B2' })], seen).length === 1);

console.log('\nMarking ready\n');
let p = readyPatch(order());
check('both halves are marked', p.food_status === 'ready' && p.drink_status === 'ready');
check('times are stamped', !!p.food_ready_at && !!p.drink_ready_at);
p = readyPatch(order({ drink_status:'ready' }));
check('an already-finished half is left alone', !('drink_status' in p) && p.food_status === 'ready');
p = readyPatch(order({ food_status:'none' }));
check('a part that does not exist is not invented', !('food_status' in p));
check('collecting closes the order', collectedPatch().status === 'complete');

console.log('\nSummary line\n');
check('counts every unit, not every line', summarise(order()) === '3 items · £11.97');
check('one item reads singular', summarise(order({ items:[{n:'x',q:1}], total:2.99 })) === '1 item · £2.99');

console.log('\nReserve and pay at the counter\n');
const paid = order({ payment:'card-demo' });
const owed = order({ payment:'counter' });
check('a prepaid order shows nothing owed', amountDue(paid) === 0);
check('a reserved order shows the full amount owed', amountDue(owed) === 11.97);
check('paid is not flagged unpaid', !isUnpaid(paid));
check('reserved is flagged unpaid', isUnpaid(owed));

console.log('\nA ready order stays on the list until it is collected\n');
const madeUp = order({ id:'R1', payment:'counter', food_status:'ready', drink_status:'ready' });
check('made and waiting is not "todo"', stage(madeUp) === 'waiting');
check('still to make is "todo"', stage(order()) === 'todo');
check('a collected order drops off', stage(order({ status:'complete' })) === 'done');
const g = forStaff([madeUp, order({ id:'T1' })]);
check('work comes first', g.todo.length === 1 && g.todo[0].id === 'T1');
check('the waiting shelf is separate', g.waiting.length === 1 && g.waiting[0].id === 'R1');
check('completed orders are excluded', forStaff([order({ status:'complete' })]).todo.length === 0);

console.log('\nPoints are earned on payment, not on ordering\n');
check('a reserved order earns its points at collection',
  pointsOnCollection(order({ payment:'counter', customer_email:'a@b.com', total:11.97 }), 10) === 119);
check('a prepaid order does not earn twice',
  pointsOnCollection(order({ payment:'card-demo', customer_email:'a@b.com' }), 10) === 0);
check('a guest with no email earns nothing',
  pointsOnCollection(order({ payment:'counter', customer_email:null }), 10) === 0);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail?1:0);
