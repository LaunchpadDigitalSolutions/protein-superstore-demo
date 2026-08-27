/* Launchpad Feature — Bug report
   Mandatory on every app and client site per the Launchpad build standard.
   Currently present in 5 of 26 apps.

   A floating button, bottom right. Staff get their role and email captured
   automatically; a client's visitor gets a name and email field.

   Extracted from launchpad-workspace-demo, rewritten because that version:
   - hardcoded the Supabase URL and anon key in the file
   - hardcoded every colour instead of using brand tokens
   - injected global functions (openReport, toggleFeedback) onto window
   - captured "severity" and "type" that the bug_reports table has no
     columns for, so both were silently thrown away

   FIXED / ADDED
   1. Reports are queued when submitting fails. A bug report is most likely
      to be written exactly when the app is misbehaving — the old one showed
      an error and lost what the person typed. Now it's kept and retried.
   2. Captures the browser and viewport. "It's broken on my phone" is the
      most common report and the least actionable without them.
   3. Nothing on window; no global CSS names outside .lp-bug-*.

   Usage:
     import { configure } from './core/db.js';
     import { BugReport } from './features/bug-report/bug-report.js';
     configure({ url, key });

     new BugReport({
       clientRef: 'las',                  // omit for internal tools
       getUser: () => ({ email: auth.user?.email, role: auth.profile?.role }),
       getView: () => location.hash || 'home'
     }).mount();
*/

import { db as coreDb } from '../../core/db.js';

const QUEUE_KEY = 'lp_bug_queue';

export class BugReport {
  constructor(opts = {}) {
    this.db        = opts.db || coreDb;
    this.clientRef = opts.clientRef || 'internal';
    this.getUser   = opts.getUser || (() => ({}));
    this.getView   = opts.getView || (() => location.hash || location.pathname);
    this.label     = opts.label || 'Report a problem';
    this.onSent    = opts.onSent || (() => {});
    this.onError   = opts.onError || (m => console.error(m));

    this.el = null;
    this.open = false;
  }

  /* ---------- mounting ---------- */

  mount(root = document.body) {
    if (this.el) return this;

    this.el = document.createElement('div');
    this.el.className = 'lp-bug';
    this.el.innerHTML = `
      <button class="lp-bug-fab" data-lp="open" aria-label="${escAttr(this.label)}">
        <span aria-hidden="true">!</span>
        <span class="lp-bug-fab-text">${esc(this.label)}</span>
      </button>`;
    root.appendChild(this.el);

    this.el.addEventListener('click', e => this._onClick(e));
    /* Retry anything stuck from a previous session. */
    this.flush();
    window.addEventListener('online', () => this.flush());
    return this;
  }

  unmount() {
    this.el?.remove();
    this.el = null;
    return this;
  }

  /* ---------- form ---------- */

  openForm() {
    if (this.open) return;
    this.open = true;
    const user = this.getUser() || {};
    const knownEmail = user.email || '';

    const panel = document.createElement('div');
    panel.className = 'lp-bug-panel';
    panel.innerHTML = `
      <div class="lp-bug-sheet" role="dialog" aria-modal="true" aria-label="Report a problem">
        <div class="lp-bug-head">
          <div class="lp-bug-title">Report a problem</div>
          <button class="lp-bug-x" data-lp="close" aria-label="Close">✕</button>
        </div>
        <div class="lp-bug-body">
          <label class="lp-bug-label" for="lp-bug-msg">What went wrong?</label>
          <textarea id="lp-bug-msg" class="lp-bug-input" rows="4"
            placeholder="What were you doing, and what happened?"></textarea>

          ${knownEmail ? '' : `
            <label class="lp-bug-label" for="lp-bug-email">Your email (so we can reply)</label>
            <input id="lp-bug-email" class="lp-bug-input" type="email"
                   inputmode="email" placeholder="you@example.com">`}

          <div class="lp-bug-err" data-lp="err" role="alert"></div>
        </div>
        <div class="lp-bug-foot">
          <button class="lp-bug-btn" data-lp="close">Cancel</button>
          <button class="lp-bug-btn primary" data-lp="send">Send report</button>
        </div>
      </div>`;

    panel.addEventListener('click', e => {
      if (e.target === panel) this.closeForm();
    });
    this.el.appendChild(panel);
    requestAnimationFrame(() => panel.classList.add('on'));
    panel.querySelector('#lp-bug-msg')?.focus();

    this._onKey = e => { if (e.key === 'Escape') this.closeForm(); };
    document.addEventListener('keydown', this._onKey);
  }

  closeForm() {
    const panel = this.el?.querySelector('.lp-bug-panel');
    if (!panel) { this.open = false; return; }
    document.removeEventListener('keydown', this._onKey);
    panel.classList.remove('on');
    setTimeout(() => panel.remove(), 200);
    this.open = false;
  }

  /* ---------- sending ---------- */

  async send({ message, email } = {}) {
    message = String(message || '').trim();
    if (message.length < 5) throw new Error('LP-150: please describe what went wrong');

    const user = this.getUser() || {};
    const report = {
      app_url: location.href.slice(0, 500),
      current_view: String(this.getView() || '').slice(0, 200),
      user_role: user.role || (user.email ? 'user' : 'visitor'),
      user_email: (user.email || email || '').trim().toLowerCase() || null,
      message: [message, '', '— ' + browserLine()].join('\n').slice(0, 4000),
      client_ref: this.clientRef
    };

    try {
      await this.db('POST', '/rest/v1/bug_reports', report);
      this.onSent(report);
      return { sent: true };
    } catch (e) {
      /* The app is probably already misbehaving — that's why they're
         reporting. Don't lose what they typed. */
      this._queue(report);
      this.onError('LP-151: ' + e.message);
      return { sent: false, queued: true };
    }
  }

  /* Retry anything held back. */
  async flush() {
    const queued = this._readQueue();
    if (!queued.length) return 0;

    const remaining = [];
    let sent = 0;
    for (const report of queued) {
      try {
        await this.db('POST', '/rest/v1/bug_reports', report);
        sent++;
      } catch (e) {
        remaining.push(report);
      }
    }
    this._writeQueue(remaining);
    return sent;
  }

  get queuedCount() { return this._readQueue().length; }

  _queue(report) {
    const q = this._readQueue();
    q.push(report);
    this._writeQueue(q.slice(-20));      /* bounded */
  }

  _readQueue() {
    try {
      const raw = localStorage.getItem(QUEUE_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  }

  _writeQueue(list) {
    try {
      if (list.length) localStorage.setItem(QUEUE_KEY, JSON.stringify(list));
      else localStorage.removeItem(QUEUE_KEY);
    } catch (e) {}
  }

  /* ---------- events ---------- */

  async _onClick(e) {
    const btn = e.target.closest('[data-lp]');
    if (!btn) return;
    const action = btn.dataset.lp;

    if (action === 'open')  return this.openForm();
    if (action === 'close') return this.closeForm();

    if (action === 'send') {
      const panel = this.el.querySelector('.lp-bug-panel');
      const msg   = panel.querySelector('#lp-bug-msg')?.value;
      const email = panel.querySelector('#lp-bug-email')?.value;
      const err   = panel.querySelector('[data-lp="err"]');

      btn.disabled = true;
      btn.textContent = 'Sending…';
      try {
        const res = await this.send({ message: msg, email });
        this._showThanks(panel, res.queued);
      } catch (ex) {
        err.textContent = ex.message.replace(/^LP-\d+: /, '');
        err.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Send report';
      }
    }
  }

  _showThanks(panel, queued) {
    panel.querySelector('.lp-bug-sheet').innerHTML = `
      <div class="lp-bug-thanks">
        <div class="lp-bug-tick" aria-hidden="true">✓</div>
        <div class="lp-bug-thanks-title">Thanks — that's been sent</div>
        <div class="lp-bug-thanks-sub">${queued
          ? "We couldn't reach the server just now, so it's saved and will send itself when you're back online."
          : "We'll take a look."}</div>
        <button class="lp-bug-btn primary" data-lp="close">Close</button>
      </div>`;
    setTimeout(() => this.closeForm(), 3200);
  }
}

/* Browser and viewport. "It's broken on my phone" is the most common
   report and the least actionable without these. */
function browserLine() {
  const w = window.innerWidth, h = window.innerHeight;
  const ua = navigator.userAgent || '';
  let browser = 'Unknown browser';
  if (/edg\//i.test(ua))          browser = 'Edge';
  else if (/chrome|crios/i.test(ua)) browser = 'Chrome';
  else if (/firefox|fxios/i.test(ua)) browser = 'Firefox';
  else if (/safari/i.test(ua))    browser = 'Safari';
  let os = 'Unknown OS';
  if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS';
  else if (/android/i.test(ua))     os = 'Android';
  else if (/mac os/i.test(ua))      os = 'macOS';
  else if (/windows/i.test(ua))     os = 'Windows';
  return `${browser} on ${os}, ${w}×${h}`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const escAttr = esc;
