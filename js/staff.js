/* Staff order view — the logic.

   Built for a phone in a hand, not a screen on a wall. That constraint drives
   every decision here:

   - No 4-second poll. A phone screen locks and the tab suspends, so a fast
     poll drains the battery and stops working anyway. Polls every 20s while
     the app is open, and refreshes immediately when the phone comes back to
     it, which is the moment staff actually look.
   - No colour timers. Amber at 3 minutes and red at 6 means nothing to
     somebody who isn't looking at the screen. Orders are listed oldest first
     with a plain minutes-waiting figure.
   - The list is the source of truth, never the notification. A notification
     can arrive late or not at all; opening the app must always show the
     truth.

   The DOM lives in staff.html. Everything here is pure so it can be tested. */

/* An order still needs work if any part of it is unfinished. */
export function isOutstanding(o) {
  if (o.status !== 'active') return false;
  return ['food_status', 'drink_status']
    .some(f => o[f] === 'active');
}

/* What the person actually has to do, split by where it comes from.
   `make` is the slush bar. `pick` is off the shelf. */
export function work(o) {
  return {
    make: o.drink_status === 'active' ? (o.drink_items || []) : [],
    pick: o.food_status === 'active' ? (o.food_items || []) : []
  };
}

export function minutesWaiting(o, now = Date.now()) {
  return Math.max(0, Math.floor((now - new Date(o.created_at).getTime()) / 60000));
}

/* Oldest first — the person who has waited longest gets served first.
   A café screen sorts newest first because it is a live queue; a collection
   list is the opposite. */
export function sortForStaff(rows) {
  return rows.slice().sort((a, b) =>
    new Date(a.created_at) - new Date(b.created_at));
}

/* Which orders are new since we last looked, so we only notify once each. */
export function newSince(rows, seen) {
  return rows.filter(o => !seen.has(o.id));
}

export function summarise(o) {
  const n = (o.items || []).reduce((s, i) => s + (i.q || 1), 0);
  return n + (n === 1 ? ' item' : ' items') + ' · £' + Number(o.total).toFixed(2);
}

/* One tap marks the whole order ready. Staff should not have to think about
   which half is which — the app knows, and only patches the parts that are
   still outstanding so it cannot undo something already done. */
export function readyPatch(o) {
  const now = new Date().toISOString();
  const patch = {};
  if (o.food_status === 'active') { patch.food_status = 'ready'; patch.food_ready_at = now; }
  if (o.drink_status === 'active') { patch.drink_status = 'ready'; patch.drink_ready_at = now; }
  return patch;
}

/* Collected closes it off. */
export function collectedPatch() {
  return { status: 'complete', completed_at: new Date().toISOString() };
}
