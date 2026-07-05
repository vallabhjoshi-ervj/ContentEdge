/* ═══════════════════════════════════════════════════
   core.js  —  Utilities, reactive state, scoped styles,
               component lifecycle, Lucide helpers

   ES MODULE  ·  <script type="module" src="core.js">
════════════════════════════════════════════════════ */

'use strict';

/* ══════════════════════════════════════════════════
   BASIC EXPORTS
══════════════════════════════════════════════════ */

export const prefersReducedMotion =
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function refreshIcons(root = document) {
  if (typeof lucide !== 'undefined') lucide.createIcons({ root });
}

/* ══════════════════════════════════════════════════
   REACTIVE STATE  createState(initial)
   ─────────────────────────────────────────────────
   Minimal reactive store — no dependencies.

   API:
     state.get()              → current snapshot (frozen)
     state.set(partial)       → merge patch + notify
     state.subscribe(fn)      → fn(state) called on change
                                returns unsubscribe fn
     state.destroy()          → wipes all subscribers

   Batching:
     Multiple set() calls within the same microtask are
     coalesced into one notification pass, preventing
     O(n × subscribers) renders on rapid state changes.

   Usage:
     const ui = createState({ open: false, view: 'home' });
     const unsub = ui.subscribe(({ open }) => {
       el.classList.toggle('open', open);
     });
     ui.set({ open: true });   // notifies once per tick
     unsub();                  // stop listening
══════════════════════════════════════════════════ */

export function createState(initial) {
  let _state      = Object.freeze({ ...initial });
  let _listeners  = [];
  let _pending    = false;   // microtask batch gate

  function _flush() {
    _pending = false;
    const snap = _state;
    // Iterate over a copy so mid-notification unsubscribes are safe
    [..._listeners].forEach(fn => fn(snap));
  }

  return {
    /** Read-only snapshot */
    get() { return _state; },

    /**
     * Merge `patch` into state. Listeners are notified once
     * per microtask, no matter how many set() calls are made
     * synchronously.
     */
    set(patch) {
      if (
        !patch ||
        typeof patch !== 'object' ||
        Array.isArray(patch)       ||
        patch instanceof Date      ||
        patch instanceof Map       ||
        patch instanceof Set
      ) return;
      _state = Object.freeze({ ..._state, ...patch });
      if (!_pending) {
        _pending = true;
        queueMicrotask(_flush);
      }
    },

    /**
     * Register a listener. The fn receives the current state
     * snapshot immediately (useful for initial render), then
     * again on every subsequent change.
     * Returns an unsubscribe function.
     */
    subscribe(fn) {
      _listeners.push(fn);
      fn(_state); // synchronous initial call
      return function unsubscribe() {
        _listeners = _listeners.filter(l => l !== fn);
      };
    },

    /** Tear down — remove all subscribers (called by destroy hooks). */
    destroy() { _listeners = []; },
  };
}

/* ══════════════════════════════════════════════════
   COMPUTED VALUES  computed(fn)
   ─────────────────────────────────────────────────
   Memoises a derived value so repeated calls within
   the same synchronous turn return a cached result.
   Cache is invalidated by calling computed.invalidate().

   Designed to pair with createState subscribers:
     const progress = computed(
       () => window.scrollY / (document.body.scrollHeight - window.innerHeight)
     );
     state.subscribe(() => bar.style.width = `${progress() * 100}%`);

   For values that depend on state, derive them inside
   the subscriber directly — computed() is for
   expensive pure calculations you want to share
   across multiple subscribers without re-running.
══════════════════════════════════════════════════ */

export function computed(fn) {
  let _cache   = undefined;
  let _valid   = false;

  function get() {
    if (!_valid) {
      _cache = fn();
      _valid = true;
      // Auto-invalidate at end of current microtask so the cache is
      // fresh on the next subscriber notification cycle.
      queueMicrotask(() => { _valid = false; });
    }
    return _cache;
  }

  get.invalidate = () => { _valid = false; };
  return get;
}


/* ══════════════════════════════════════════════════
   SCOPED STYLES  scopeStyles(el, css)
   ─────────────────────────────────────────────────
   Lightweight CSS scoping — the same strategy Vue's
   <style scoped> compiles to, without Shadow DOM.

   How it works:
     1. A unique data-scope="uid" attribute is set on `el`.
     2. Each CSS rule selector is prefixed with
        [data-scope="uid"], so rules only match inside
        the component root.
     3. A <style> tag is injected into <head>.
     4. Returns a cleanup fn that removes both.

   Limitations:
     • @keyframes and @font-face are injected as-is
       (they're inherently global; rename them manually
       if collisions are a concern).
     • CSS nesting (level 4) is passed through untouched —
       supported in all evergreen browsers as of 2024.
     • For full isolation use Shadow DOM instead; this
       utility is intentionally lighter so Lucide icons
       (which need document-level access) keep working.

   Usage:
     const unscope = scopeStyles(widgetEl, `
       .ce-msg { padding: 8px; }
       .ce-chip { border-radius: 999px; }
     `);
     // later:
     unscope();
══════════════════════════════════════════════════ */

export function scopeStyles(el, css) {
  // Generate a short collision-resistant UID
  const uid = `cs-${(crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)).slice(0, 8)}`;
  el.dataset.scope = uid;

  // Prefix every rule selector with the scope attribute selector.
  // Strategy:
  //   - Skip @-rules (media, keyframes, etc.) — leave them intact.
  //   - For everything else, split on commas, prefix each part.
  const scoped = css.replace(
    /([^@\n][^{]*?)\s*\{/g,
    (_match, rawSelector) => {
      // Skip if the captured selector itself contains a '{' (e.g. nested @-rules
      // that slipped past the leading [^@] guard).
      if (rawSelector.includes('{')) return _match;
      const prefixed = rawSelector
        .split(',')
        .map(s => `[data-scope="${uid}"] ${s.trim()}`)
        .join(',\n');
      return `${prefixed} {`;
    }
  );

  const style = document.createElement('style');
  style.dataset.scopeFor = uid;
  style.textContent = scoped;
  document.head.appendChild(style);

  return function unscope() {
    delete el.dataset.scope;
    style.remove();
  };
}

/* ══════════════════════════════════════════════════
   SANITIZED HTML INJECTION
══════════════════════════════════════════════════ */

function sanitizeHTML(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // Remove script tags
  doc.querySelectorAll('script').forEach(el => el.remove());

  // Remove dangerous attributes like onclick, onerror, etc.
  doc.querySelectorAll('*').forEach(el => {
    [...el.attributes].forEach(attr => {
      if (attr.name.startsWith('on')) {
        el.removeAttribute(attr.name);
      }
    });
  });

  const frag = document.createDocumentFragment();
  doc.body.childNodes.forEach(n => frag.appendChild(document.importNode(n, true)));

  return frag;
}

/* ══════════════════════════════════════════════════
   COMPONENT LIFECYCLE  mountComponent / unmountComponent
══════════════════════════════════════════════════ */

const _mounted = new Map(); // id → { el, destroy }

/**
 * Mount a component into a DOM slot.
 *
 * Two call signatures — both supported:
 *
 *   Legacy (positional):
 *     mountComponent('chatbot', 'components/chatbot.html', onMount)
 *
 *   Object config (preferred):
 *     mountComponent({
 *       id:       'chatbot',
 *       template: 'components/chatbot.html',
 *       state:    createState({ … }),   // optional — passed to mount/destroy
 *       mount:    (el, state) => { … }, // may return destroy fn
 *       destroy:  (el, state) => { … }, // optional extra teardown
 *     })
 *
 * Re-mounting tears down the previous instance first.
 */
export async function mountComponent(idOrConfig, file, onMount = () => {}) {
  // Normalise both call signatures into a single options object.
  const opts = (typeof idOrConfig === 'object' && idOrConfig !== null)
    ? idOrConfig
    : { id: idOrConfig, template: file, mount: onMount };

  const { id, template, state: compState, mount, destroy: extraDestroy } = opts;
  const el = document.getElementById(id);
  if (!el) return;

  // Tear down any previous instance registered under this id.
  if (_mounted.has(id)) {
    _mounted.get(id).destroy?.();
    _mounted.delete(id);
  }

  try {
    const res = await fetch(template);
    if (!res.ok) throw new Error(`mountComponent: ${template} → HTTP ${res.status}`);
    el.replaceChildren(sanitizeHTML(await res.text()));

    const mountFn  = mount ?? (() => {});
    const innerDestroy = mountFn(el, compState) ?? (() => {});

    function destroy() {
      innerDestroy?.();
      extraDestroy?.(el, compState);
    }

    _mounted.set(id, { el, destroy });
    refreshIcons(el);
  } catch (err) {
    console.error(err);
  }
}

export function unmountComponent(id) {
  const inst = _mounted.get(id);
  if (!inst) return;
  inst.destroy?.();
  inst.el.replaceChildren();
  _mounted.delete(id);
}

/* ══════════════════════════════════════════════════
   COMPONENT BOOTSTRAP
══════════════════════════════════════════════════ */

mountComponent('header', 'components/header.html', () => {
  initDropdowns();
});

mountComponent('footer', 'components/footer.html');

mountComponent('chatbot', 'components/chatbot.html', () => {
  // Dynamic import — no globals, no polling, no init flags.
  // The HTML is in the DOM by the time onMount fires, so
  // initChatbot() finds all its DOM refs immediately.
  let _chatbotDestroy = null;
  import('./chatbot.js')
    .then(({ initChatbot }) => {
      _chatbotDestroy = initChatbot();
    })
    .catch(err => console.error('core.js: failed to load chatbot.js:', err));

  // Return a destroy fn so mountComponent can tear down on remount.
  return () => { _chatbotDestroy?.(); _chatbotDestroy = null; };
});

function initDropdowns() {
  document.querySelectorAll('.has-dropdown').forEach(item => {
    let timeout;
    item.addEventListener('mouseenter', () => { clearTimeout(timeout); item.classList.add('open'); });
    item.addEventListener('mouseleave', () => {
      timeout = setTimeout(() => item.classList.remove('open'), 120);
    });
  });
}

/* ══════════════════════════════════════════════════
   PAGE INIT
══════════════════════════════════════════════════ */

function pageInit() {
  const yearEl = document.getElementById('currentYear');
  if (yearEl) yearEl.textContent = new Date().getFullYear();
  refreshIcons();

  /* ── Contact Form ── */
  const quoteBtn = document.getElementById('quoteBtn');
  if (quoteBtn) {
    const fields = {
      fname:   document.getElementById('fname'),
      lname:   document.getElementById('lname'),
      email:   document.getElementById('email'),
      company: document.getElementById('company'),
      service: document.getElementById('service'),
      message: document.getElementById('message'),
    };
    quoteBtn.addEventListener('click', () => {
      const fname   = fields.fname?.value.trim()   ?? '';
      const lname   = fields.lname?.value.trim()   ?? '';
      const email   = fields.email?.value.trim()   ?? '';
      const company = fields.company?.value.trim() ?? '';
      const service = fields.service?.value        ?? '';
      const message = fields.message?.value.trim() ?? '';

      if (!fname || !email) { alert('Please fill in your name and email.'); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { alert('Please enter a valid email address.'); return; }

      const subject = `New Inquiry from ${fname} ${lname}`;
      const body    = `Name:    ${fname} ${lname}\nEmail:   ${email}\nCompany: ${company}\nService: ${service}\n\nMessage: ${message}`;
      alert('Opening your email client… If nothing opens, email us at info@contentedge.in');
      window.location.href = `mailto:info@contentedge.in?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    });
  }

  /* ── Custom Select ── */
  const customSelect = document.getElementById('serviceSelect');
  if (customSelect) {
    const selected    = customSelect.querySelector('.select-selected');
    const hiddenInput = document.getElementById('service');
    selected?.setAttribute('tabindex', '0');

    const open   = () => customSelect.classList.add('active');
    const close  = () => customSelect.classList.remove('active');
    const toggle = () => customSelect.classList.toggle('active');

    selected?.addEventListener('click', toggle);
    selected?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowDown') { e.preventDefault(); open(); customSelect.querySelector('.select-options div')?.focus(); }
    });
    customSelect.addEventListener('click', (e) => {
      const opt = e.target.closest('.select-options div');
      if (!opt) return;
      if (selected)    selected.textContent = opt.textContent;
      if (hiddenInput) hiddenInput.value    = opt.dataset.value;
      close();
    });
    customSelect.addEventListener('keydown', (e) => {
      if (!customSelect.classList.contains('active')) return;
      const opts = Array.from(customSelect.querySelectorAll('.select-options div'));
      const idx  = opts.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); opts[Math.min(idx + 1, opts.length - 1)]?.focus(); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); if (idx <= 0) { close(); selected?.focus(); } else opts[idx - 1]?.focus(); }
      if (e.key === 'Escape')    { close(); selected?.focus(); }
    });
    document.addEventListener('click', (e) => {
      if (!customSelect.contains(e.target)) close();
    });
  }
}

if (document.readyState !== 'loading') {
  pageInit();
} else {
  document.addEventListener('DOMContentLoaded', pageInit, { once: true });
}
