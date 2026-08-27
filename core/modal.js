/* Launchpad Core — Modal (pop-up windows)

   Full screen on mobile, centred box on desktop — per the Launchpad
   mobile-first build standard.

   Existing versions across 12 apps were one-liners that toggled a class on
   HTML that had to already exist in the page. No focus management, no
   escape key, no scroll lock, and nothing stopping the page behind from
   scrolling under the modal on iOS.

   Usage:
     import { Modal, confirmDialog } from './core/modal.js';

     const m = new Modal({
       title: 'Edit item',
       content: '<p>Anything — a string or an element</p>',
       actions: [
         { label: 'Cancel', role: 'cancel' },
         { label: 'Save', role: 'primary', onClick: () => save() }
       ]
     });
     m.open();

     if (await confirmDialog('Delete this lead?')) { ... }
*/

let openCount = 0;
let scrollY = 0;

export class Modal {
  constructor(opts = {}) {
    this.title     = opts.title || '';
    this.content   = opts.content ?? '';
    this.actions   = opts.actions || [];
    this.dismissable = opts.dismissable !== false;   /* backdrop + escape close it */
    this.onClose   = opts.onClose || (() => {});
    this.el = null;
    this._lastFocus = null;
  }

  open() {
    if (this.el) return this;
    this._lastFocus = document.activeElement;

    this.el = document.createElement('div');
    this.el.className = 'lp-modal-backdrop';
    this.el.innerHTML = `
      <div class="lp-modal" role="dialog" aria-modal="true"
           ${this.title ? 'aria-label="' + esc(this.title) + '"' : ''}>
        ${this.title ? `<div class="lp-modal-head">
          <div class="lp-modal-title">${esc(this.title)}</div>
          ${this.dismissable ? '<button class="lp-modal-x" data-lp="close" aria-label="Close">✕</button>' : ''}
        </div>` : ''}
        <div class="lp-modal-body"></div>
        ${this.actions.length ? '<div class="lp-modal-foot"></div>' : ''}
      </div>`;

    const body = this.el.querySelector('.lp-modal-body');
    if (this.content instanceof Node) body.appendChild(this.content);
    else body.innerHTML = this.content;

    const foot = this.el.querySelector('.lp-modal-foot');
    this.actions.forEach(a => {
      const b = document.createElement('button');
      b.className = 'lp-modal-btn' + (a.role ? ' lp-modal-btn-' + a.role : '');
      b.textContent = a.label;
      b.addEventListener('click', async () => {
        let keepOpen = false;
        try { keepOpen = await a.onClick?.(this) === false; }
        catch (e) { console.error('LP-030: ' + e.message); }
        if (!keepOpen) this.close();
      });
      foot.appendChild(b);
    });

    this.el.addEventListener('click', e => {
      if (e.target.closest('[data-lp="close"]')) return this.close();
      if (this.dismissable && e.target === this.el) this.close();
    });

    this._onKey = e => {
      if (e.key === 'Escape' && this.dismissable) this.close();
      if (e.key === 'Tab') this._trapFocus(e);
    };
    document.addEventListener('keydown', this._onKey);

    document.body.appendChild(this.el);
    lockScroll();
    requestAnimationFrame(() => this.el?.classList.add('on'));

    /* Focus the first control, or the dialog, so keyboard and screen
       reader users land inside rather than behind it. */
    const first = this.el.querySelector('input, select, textarea, button');
    (first || this.el.querySelector('.lp-modal'))?.focus?.();

    return this;
  }

  close() {
    if (!this.el) return;
    const el = this.el;
    this.el = null;
    document.removeEventListener('keydown', this._onKey);
    el.classList.remove('on');
    setTimeout(() => el.remove(), 220);
    unlockScroll();
    this._lastFocus?.focus?.();
    this.onClose();
  }

  setContent(html) {
    const body = this.el?.querySelector('.lp-modal-body');
    if (!body) return;
    if (html instanceof Node) { body.innerHTML = ''; body.appendChild(html); }
    else body.innerHTML = html;
  }

  _trapFocus(e) {
    const items = [...this.el.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
    )];
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
}

/* Yes/no dialog. Resolves true or false. */
export function confirmDialog(message, opts = {}) {
  return new Promise(resolve => {
    let answered = false;
    const m = new Modal({
      title: opts.title || 'Are you sure?',
      content: `<p class="lp-modal-text">${esc(message)}</p>`,
      actions: [
        { label: opts.cancelLabel || 'Cancel', role: 'cancel',
          onClick: () => { answered = true; resolve(false); } },
        { label: opts.confirmLabel || 'Confirm',
          role: opts.danger ? 'danger' : 'primary',
          onClick: () => { answered = true; resolve(true); } }
      ],
      onClose: () => { if (!answered) resolve(false); }
    });
    m.open();
  });
}

/* iOS scrolls the page behind a fixed overlay unless the body is pinned. */
function lockScroll() {
  if (openCount++ > 0) return;
  scrollY = window.scrollY || 0;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${scrollY}px`;
  document.body.style.width = '100%';
}
function unlockScroll() {
  if (--openCount > 0) return;
  openCount = 0;
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.width = '';
  window.scrollTo(0, scrollY);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
