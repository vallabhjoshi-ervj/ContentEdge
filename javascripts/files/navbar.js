/* ═══════════════════════════════════════════════════
   navbar.js  —  Scroll progress bar, nav shadow,
                 hamburger menu, reveal-on-scroll

   ES MODULE  ·  import { initNavbar } from './navbar.js'

   State shape:
     { scrolled: bool, menuOpen: bool, progress: number }

   All DOM updates happen inside state.subscribe() so
   there is one authoritative source of truth — no
   manual class-toggling scattered across handlers.
════════════════════════════════════════════════════ */

import { createState } from './core.js';

export function initNavbar() {

  const nav       = document.getElementById('mainNav');
  const scrollBar = document.getElementById('scrollBar');
  const hamburger = document.getElementById('hamburger');
  const navLinks  = document.getElementById('navLinks');

  /* ── State ─────────────────────────────────────── */

  const state = createState({
    scrolled:  false,
    menuOpen:  false,
    progress:  0,
  });

  /* ── Reactive DOM renderer ──────────────────────
     All visual changes live here. Event handlers
     only call state.set() — they never touch the DOM
     directly. This makes the rendering logic trivially
     testable and prevents split-brain bugs where two
     handlers manipulate the same class independently.
  ─────────────────────────────────────────────────── */

  const unsubRender = state.subscribe(({ scrolled, menuOpen, progress }) => {
    // Nav shadow
    nav?.classList.toggle('scrolled', scrolled);

    // Scroll progress bar — skip the style write when value hasn't changed
    // to avoid triggering layout work on every scroll event.
    if (scrollBar) {
      const next = `${progress.toFixed(2)}%`;
      if (scrollBar.style.width !== next) scrollBar.style.width = next;
    }

    // Hamburger + menu
    hamburger?.setAttribute('aria-expanded', String(menuOpen));
    navLinks?.classList.toggle('open', menuOpen);
  });

  /* ── Scroll handler ─────────────────────────────── */

  let scrollRAF = null;
  function onScroll() {
    if (scrollRAF) return;
    scrollRAF = requestAnimationFrame(() => {
      scrollRAF = null;
      const totalHeight = document.body.scrollHeight - window.innerHeight;
      state.set({
        scrolled: window.scrollY > 30,
        progress: totalHeight > 0 ? (window.scrollY / totalHeight) * 100 : 0,
      });
    });
  }

  if (nav || scrollBar) window.addEventListener('scroll', onScroll, { passive: true });

  /* ── Hamburger handlers ─────────────────────────── */

  function onHamburgerClick() {
    state.set({ menuOpen: !state.get().menuOpen });
  }

  function onHamburgerKeydown(e) {
    if (e.key === 'Escape' && state.get().menuOpen) {
      state.set({ menuOpen: false });
      hamburger.focus();
    }
  }

  function onLinkClick() {
    state.set({ menuOpen: false });
  }

  function onDocClick(e) {
    if (!state.get().menuOpen) return;
    if (nav && !nav.contains(e.target)) state.set({ menuOpen: false });
  }

  const linkEls = [];
  if (hamburger && navLinks) {
    hamburger.addEventListener('click',   onHamburgerClick);
    hamburger.addEventListener('keydown', onHamburgerKeydown);
    navLinks.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', onLinkClick);
      linkEls.push(a);
    });
    document.addEventListener('click', onDocClick);
  }

  /* ── Reveal on scroll ───────────────────────────── */

  const reveals       = document.querySelectorAll('.reveal');
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('visible');
        revealObserver.unobserve(e.target);
      }
    });
  }, { threshold: 0.08 });
  reveals.forEach(el => revealObserver.observe(el));

  /* ── Destroy ────────────────────────────────────── */

  function destroy() {
    unsubRender();        // stop reactive render
    state.destroy();      // wipe all subscribers

    window.removeEventListener('scroll', onScroll);
    if (scrollRAF) { cancelAnimationFrame(scrollRAF); scrollRAF = null; }

    if (hamburger && navLinks) {
      hamburger.removeEventListener('click',   onHamburgerClick);
      hamburger.removeEventListener('keydown', onHamburgerKeydown);
      linkEls.forEach(a => a.removeEventListener('click', onLinkClick));
      document.removeEventListener('click', onDocClick);
    }

    revealObserver.disconnect();
  }

  window.addEventListener('beforeunload', destroy, { once: true });
  return destroy;
}

/* ── Auto-init ── */
if (document.readyState !== 'loading') {
  initNavbar();
} else {
  document.addEventListener('DOMContentLoaded', initNavbar, { once: true });
}
