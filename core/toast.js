/* Launchpad Core — Toast (pop-up messages)

   The short bar that appears to say "Saved" or "Something went wrong".

   Existing versions across 13 apps all required a <div id="toast"> to
   already be in the page, hardcoded their colours, and had no queue —
   a second message overwrote the first and reset the timer, so rapid
   messages showed only the last one.

   This one creates its own element, queues messages, uses brand tokens,
   and announces to screen readers.

   Usage:
     import { toast } from './core/toast.js';
     toast('Saved');
     toast('Could not save', { type: 'error' });
     toast('Deleted', { action: { label: 'Undo', onClick: () => restore() } });
*/

const DEFAULT_DURATION = 2800;
const ERROR_DURATION   = 4200;   /* errors need longer to read */

let container = null;
let queue = [];
let showing = false;

function ensureContainer() {
  if (container && document.body.contains(container)) return container;
  container = document.createElement('div');
  container.className = 'lp-toast-host';
  container.setAttribute('role', 'status');
  container.setAttribute('aria-live', 'polite');
  document.body.appendChild(container);
  return container;
}

/* Show a message.
   opts.type      'info' | 'success' | 'error'   (default 'info')
   opts.duration  ms; errors default longer
   opts.action    { label, onClick } — renders a button, pauses dismissal */
export function toast(message, opts = {}) {
  queue.push({ message: String(message ?? ''), ...opts });
  if (!showing) next();
}

export function clearToasts() {
  queue = [];
  if (container) container.innerHTML = '';
  showing = false;
}

function next() {
  const item = queue.shift();
  if (!item) { showing = false; return; }
  showing = true;

  const host = ensureContainer();
  const el = document.createElement('div');
  el.className = 'lp-toast' + (item.type ? ' lp-toast-' + item.type : '');

  const text = document.createElement('span');
  text.className = 'lp-toast-msg';
  text.textContent = item.message;
  el.appendChild(text);

  let timer;
  const dismiss = () => {
    clearTimeout(timer);
    el.classList.remove('on');
    setTimeout(() => { el.remove(); next(); }, 300);
  };

  if (item.action?.label) {
    const btn = document.createElement('button');
    btn.className = 'lp-toast-action';
    btn.textContent = item.action.label;
    btn.addEventListener('click', () => {
      try { item.action.onClick?.(); } catch (e) { console.error('LP-020: ' + e.message); }
      dismiss();
    });
    el.appendChild(btn);
  }

  host.appendChild(el);
  /* next frame so the transition runs */
  requestAnimationFrame(() => el.classList.add('on'));

  const duration = item.duration
    || (item.type === 'error' ? ERROR_DURATION : DEFAULT_DURATION);
  timer = setTimeout(dismiss, duration);

  /* Tapping the toast dismisses it early. */
  el.addEventListener('click', e => {
    if (!e.target.closest('.lp-toast-action')) dismiss();
  });
}
