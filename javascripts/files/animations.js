/* ═══════════════════════════════════════════════════
   animations.js  —  Hero card stack parallax / tilt
                     and per-card glow physics

   ES MODULE  ·  import { initAnimations } from './animations.js'

   Why no createState here:
   Animations are a physics loop — continuous values
   derived from pointer position and time. They have no
   discrete states worth subscribing to; the "state" is
   just intermediate floats living inside rAF closures.
   Adding a reactive store would be over-abstraction.
════════════════════════════════════════════════════ */

import { prefersReducedMotion } from './core.js';

export function initAnimations() {

  const stack = document.querySelector('.hero-card-stack');
  const cards = document.querySelectorAll('.hcard');

  if (!stack || prefersReducedMotion) return () => {};

  let stackRect = stack.getBoundingClientRect();

  // rAF-throttled resize — avoids layout thrashing on each event
  let resizeRAF = null;
  function onResize() {
    if (resizeRAF) return;
    resizeRAF = requestAnimationFrame(() => {
      resizeRAF = null;
      stackRect = stack.getBoundingClientRect();
    });
  }
  window.addEventListener('resize', onResize, { passive: true });

  // ── Tilt ──
  let tiltRAF = null;
  function onStackMove(e) {
    if (tiltRAF) return;
    tiltRAF = requestAnimationFrame(() => {
      tiltRAF = null;
      const x       = e.clientX - stackRect.left;
      const y       = e.clientY - stackRect.top;
      const offsetX = (x - stackRect.width  / 2) / (stackRect.width  / 2);
      const offsetY = (y - stackRect.height / 2) / (stackRect.height / 2);

      cards.forEach((card, i) => {
        const depth = (i + 1) * 4;
        const tx    = offsetX * depth;
        const ty    = offsetY * depth;
        const t     = card.classList.contains('hcard-main') ? 'translate(-50%,-50%) ' : '';
        // Batch all style mutations into a single cssText assignment to avoid
        // multiple style recalculations per card per frame.
        card.style.setProperty('--sx', `${-tx * 2}px`);
        card.style.setProperty('--sy', `${-ty * 2}px`);

        card.style.transform =
          `${t}translateX(${tx}px) translateY(${ty}px) ` +
          `rotateX(${offsetY * 6}deg) rotateY(${offsetX * 6}deg)`;
      });
    });
  }
  stack.addEventListener('mousemove', onStackMove, { passive: true });

  // ── Glow Physics — single shared RAF ────────────────
  // Previously each card had its own glowRAF handle, meaning N cards meant
  // N separate rAF callbacks per frame on hover. Now one shared loop
  // processes the latest pointer position for every card in one pass.
  // The pending event reference is captured on each mousemove and consumed
  // on the next frame — zero per-card overhead.

  let glowRAF    = null;
  let pendingEvt = null; // latest mousemove event; overwritten each move

  // Per-card rect cache — refreshed on mouseenter, stable during hover.
  const cardRects = new Map();

  const cardCleanups = [];
  cards.forEach((card) => {
    function onEnter() {
      cardRects.set(card, card.getBoundingClientRect());
    }
    function onMove(e) {
      pendingEvt = e;
      if (glowRAF) return;
      glowRAF = requestAnimationFrame(() => {
        glowRAF = null;
        const ev = pendingEvt;
        if (!ev) return;
        cards.forEach((c) => {
          const rect = cardRects.get(c);
          if (!rect) return;
          const x  = ev.clientX - rect.left;
          const y  = ev.clientY - rect.top;
          const cx = rect.width  / 2;
          const cy = rect.height / 2;
          const n  = Math.hypot(x - cx, y - cy) / Math.hypot(cx, cy);
          c.style.setProperty('--x',         `${x}px`);
          c.style.setProperty('--y',         `${y}px`);
          c.style.setProperty('--intensity', Math.max(0.1, 0.35 - n * 0.25));
          c.style.setProperty('--size',      `${160 + n * 60}px`);
        });
      });
    }
    card.addEventListener('mouseenter', onEnter, { passive: true });
    card.addEventListener('mousemove',  onMove,  { passive: true });
    cardCleanups.push(() => {
      card.removeEventListener('mouseenter', onEnter);
      card.removeEventListener('mousemove',  onMove);
      cardRects.delete(card);
    });
  });

  // ── Reset ──
  function onLeave() {
    cards.forEach(c => {
      c.style.transform = c.classList.contains('hcard-main') ? 'translate(-50%,-50%)' : '';
    });
  }
  stack.addEventListener('mouseleave', onLeave, { passive: true });

  // ── Destroy ──
  function destroy() {
    window.removeEventListener('resize',    onResize);
    stack.removeEventListener('mousemove',  onStackMove);
    stack.removeEventListener('mouseleave', onLeave);
    cardCleanups.forEach(fn => fn());
    if (resizeRAF) { cancelAnimationFrame(resizeRAF); resizeRAF = null; }
    if (tiltRAF)   { cancelAnimationFrame(tiltRAF);   tiltRAF   = null; }
    if (glowRAF)   { cancelAnimationFrame(glowRAF);   glowRAF   = null; }
    pendingEvt = null;
  }

  return destroy;
}

if (document.readyState !== 'loading') {
  initAnimations();
} else {
  document.addEventListener('DOMContentLoaded', initAnimations, { once: true });
}
