/* Launchpad Feature — Shell (app frame and navigation)

   The frame every staff-facing tool sits in: bottom nav on mobile, sidebar
   on desktop, one section visible at a time, and the URL kept in step so
   refreshing or sharing a link lands in the right place.

   Extracted from launchpad-hub, the only app with real separation of
   concerns. Also replaces the ad-hoc showSection() in las-media-dash,
   las-media-dash-v2 and launchpad-workspace-demo.

   FIXED DURING EXTRACTION
   1. The hub's router had a hardcoded if/else chain mapping every section
      name to its render function. Adding a section meant editing the
      router, and forgetting to meant a blank screen with no error. Each
      section now carries its own render function.
   2. No URL handling. Refreshing always dropped you back on Home, and you
      couldn't send someone a link to a specific screen.
   3. Sections rendered on every visit, including re-renders of screens that
      hadn't changed. Now optionally cached.
   4. Nav items were hidden by role with direct DOM calls scattered through
      boot(). Now declared on the section.

   Usage:
     import { Shell } from './features/shell/shell.js';

     const shell = new Shell({
       mount: document.getElementById('app'),
       title: 'Launchpad',
       sections: [
         { id:'home',  label:'Home',  icon:'⌂', render: () => homeHtml() },
         { id:'leads', label:'Leads', icon:'☰', render: async () => await leadsHtml() },
         { id:'admin', label:'Admin', icon:'⚙', roles:['admin'], render: () => adminHtml() }
       ],
       role: auth.profile?.role,
       user: { name: 'Josh' },
       onSignOut: () => auth.signOut()
     });
     shell.render();
*/

export class Shell {
  constructor(opts = {}) {
    if (!opts.mount) throw new Error('LP-160: Shell needs a mount element');
    if (!opts.sections?.length) throw new Error('LP-161: Shell needs at least one section');

    this.el       = opts.mount;
    this.title    = opts.title || 'Launchpad';
    this.role     = opts.role || null;
    this.user     = opts.user || null;
    this.useHash  = opts.useHash !== false;
    this.cache    = opts.cache === true;
    this.onChange = opts.onChange || (() => {});
    this.onSignOut = opts.onSignOut || null;
    this.onError  = opts.onError || (m => console.error(m));

    this.sections = opts.sections.filter(s => this._allowed(s));
    if (!this.sections.length) throw new Error('LP-162: no sections visible to role "' + this.role + '"');

    this.active = this._initialSection(opts.active);
    this._rendered = new Map();
    this.sidebarOpen = false;

    this.el.classList.add('lp-shell');
    this.el.addEventListener('click', e => this._onClick(e));

    if (this.useHash) {
      this._onHash = () => {
        const id = location.hash.replace(/^#/, '');
        if (id && id !== this.active && this.sections.some(s => s.id === id)) this.go(id, false);
      };
      window.addEventListener('hashchange', this._onHash);
    }
  }

  destroy() {
    if (this._onHash) window.removeEventListener('hashchange', this._onHash);
    this.el.innerHTML = '';
  }

  _allowed(section) {
    if (!section.roles?.length) return true;
    return section.roles.includes(this.role);
  }

  /* A shared link wins over the default, but only if that section exists
     and this person is allowed to see it. */
  _initialSection(preferred) {
    if (this.useHash) {
      const fromUrl = location.hash.replace(/^#/, '');
      if (fromUrl && this.sections.some(s => s.id === fromUrl)) return fromUrl;
    }
    if (preferred && this.sections.some(s => s.id === preferred)) return preferred;
    return this.sections[0].id;
  }

  /* ---------- rendering ---------- */

  render() {
    this.el.innerHTML = `
      <div class="lp-shell-overlay" data-lp="close-sidebar"></div>

      <aside class="lp-shell-side">
        <div class="lp-shell-brand">${esc(this.title)}</div>
        <nav class="lp-shell-nav">
          ${this.sections.map(s => this._navItem(s, 'side')).join('')}
        </nav>
        ${this.user || this.onSignOut ? `
          <div class="lp-shell-foot">
            ${this.user?.name ? `<div class="lp-shell-user">${esc(this.user.name)}</div>` : ''}
            ${this.onSignOut ? '<button class="lp-shell-out" data-lp="signout">Sign out</button>' : ''}
          </div>` : ''}
      </aside>

      <div class="lp-shell-main">
        <header class="lp-shell-top">
          <button class="lp-shell-burger" data-lp="toggle-sidebar" aria-label="Menu">☰</button>
          <div class="lp-shell-heading" data-lp-heading></div>
        </header>
        <main class="lp-shell-body" data-lp-body></main>
      </div>

      <nav class="lp-shell-bottom">
        ${this.sections.slice(0, 5).map(s => this._navItem(s, 'bottom')).join('')}
      </nav>`;

    this._paintNav();
    this._renderSection();
    return this;
  }

  _navItem(s, where) {
    const on = s.id === this.active ? ' on' : '';
    if (where === 'bottom') {
      return `<button class="lp-shell-bi${on}" data-lp="go" data-id="${escAttr(s.id)}"
                      aria-current="${s.id === this.active ? 'page' : 'false'}">
        <span class="lp-shell-bi-icon" aria-hidden="true">${esc(s.icon || '•')}</span>
        <span class="lp-shell-bi-label">${esc(s.label)}</span>
      </button>`;
    }
    return `<button class="lp-shell-ni${on}" data-lp="go" data-id="${escAttr(s.id)}"
                    aria-current="${s.id === this.active ? 'page' : 'false'}">
      <span aria-hidden="true">${esc(s.icon || '•')}</span> ${esc(s.label)}
      ${s.badge != null ? `<span class="lp-shell-badge">${esc(s.badge)}</span>` : ''}
    </button>`;
  }

  async go(id, updateUrl = true) {
    const section = this.sections.find(s => s.id === id);
    if (!section || id === this.active) { this.closeSidebar(); return; }

    this.active = id;
    if (updateUrl && this.useHash) history.replaceState(null, '', '#' + id);
    this._paintNav();
    this.closeSidebar();
    await this._renderSection();
    this.onChange(id);
  }

  async _renderSection() {
    const body = this.el.querySelector('[data-lp-body]');
    const heading = this.el.querySelector('[data-lp-heading]');
    const section = this.sections.find(s => s.id === this.active);
    if (!body || !section) return;

    if (heading) heading.textContent = section.label;

    if (this.cache && this._rendered.has(section.id)) {
      body.innerHTML = '';
      body.appendChild(this._rendered.get(section.id));
      return;
    }

    if (!section.render) { body.innerHTML = ''; return; }

    body.innerHTML = '<div class="lp-shell-loading">Loading…</div>';
    try {
      const out = await section.render();
      if (this.active !== section.id) return;      /* moved on mid-load */

      const wrap = document.createElement('div');
      if (out instanceof Node) wrap.appendChild(out);
      else wrap.innerHTML = out ?? '';

      body.innerHTML = '';
      body.appendChild(wrap);
      if (this.cache) this._rendered.set(section.id, wrap);
    } catch (e) {
      body.innerHTML = '<div class="lp-shell-error">Could not load this page.</div>';
      this.onError('LP-163: ' + e.message);
    }
  }

  /* Force a section to rebuild next time it's shown. */
  invalidate(id = null) {
    if (id) this._rendered.delete(id);
    else this._rendered.clear();
    return this;
  }

  refresh() { this._rendered.delete(this.active); return this._renderSection(); }

  setBadge(id, value) {
    const s = this.sections.find(x => x.id === id);
    if (s) s.badge = value;
    this._paintNav();
    return this;
  }

  _paintNav() {
    this.el.querySelectorAll('[data-lp="go"]').forEach(b => {
      const on = b.dataset.id === this.active;
      b.classList.toggle('on', on);
      b.setAttribute('aria-current', on ? 'page' : 'false');
    });
    const side = this.el.querySelector('.lp-shell-nav');
    if (side) side.innerHTML = this.sections.map(s => this._navItem(s, 'side')).join('');
  }

  /* ---------- sidebar ---------- */

  openSidebar()  { this.sidebarOpen = true;  this.el.classList.add('sidebar-open'); }
  closeSidebar() { this.sidebarOpen = false; this.el.classList.remove('sidebar-open'); }
  toggleSidebar(){ this.sidebarOpen ? this.closeSidebar() : this.openSidebar(); }

  _onClick(e) {
    const btn = e.target.closest('[data-lp]');
    if (!btn) return;
    const action = btn.dataset.lp;
    if (action === 'go') this.go(btn.dataset.id);
    if (action === 'toggle-sidebar') this.toggleSidebar();
    if (action === 'close-sidebar') this.closeSidebar();
    if (action === 'signout') this.onSignOut?.();
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const escAttr = esc;
