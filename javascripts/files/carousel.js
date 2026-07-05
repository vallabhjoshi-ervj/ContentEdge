/* ═══════════════════════════════════════════════════
   carousel.js  —  Infinite logo-track carousel

   ES MODULE  ·  import { initCarousel } from './carousel.js'

   Why no createState here:
   Like animations.js, this is a continuous numeric
   animation loop. `position`, `isPaused`, `isVisible`
   are transition values — not discrete UI states that
   multiple parts of the app need to observe.
════════════════════════════════════════════════════ */

import { prefersReducedMotion } from './core.js';

// ── Original-items snapshot ──────────────────────────────────────────────────
// Snapshot is per initCarousel() instance
// (safe for multiple carousels / remounts), outside initCarousel(), so re-calls (e.g.
// dynamic remount, HMR, SPA route change) never read from an already-mutated
// track and accidentally clone clones.
//
// Lazy: populated on first initCarousel() call so the DOM is guaranteed ready.
// After that it's frozen — fillTrack() always clones from this reference only.
// ─────────────────────────────────────────────────────────────────────────────


export function initCarousel() {
  let originalItems = null;
  const track    = document.getElementById('logoTrack');
  const carousel = document.querySelector('.carousel');

  if (!track || !carousel) return () => {};

  // Populate snapshot only on the very first call, before fillTrack() touches
  // the DOM. Subsequent calls skip this block — originalItems stays clean.
  if (!originalItems) {
    originalItems = Array.from(track.children).map(i => i.cloneNode(true));
  }

  let isPaused  = false;
  let isVisible = true;
  let position  = 0;
  const speed   = prefersReducedMotion ? 0 : 0.5;

  // ── Fill track ──
  function fillTrack() {
    // Full reset — wipe all children (prior clones included).
    track.innerHTML = '';

    // Always clone from originalItems, never from DOM children.
    originalItems.forEach(i => track.appendChild(i.cloneNode(true)));

    // Duplicate until the track is wide enough for seamless infinite scroll.
    const need = window.innerWidth * 2;
    let safety = 0;
    while (track.scrollWidth < need && safety < 20) {
      originalItems.forEach(i => track.appendChild(i.cloneNode(true)));
      safety++;
    }
    if (safety >= 20) console.warn('carousel.js: fillTrack hit safety limit — check CSS width.');
  }
  fillTrack();

  // rAF-throttled resize
  let resizeRAF = null;
  function onResize() {
    if (resizeRAF) return;
    resizeRAF = requestAnimationFrame(() => { resizeRAF = null; fillTrack(); });
  }
  window.addEventListener('resize', onResize, { passive: true });

  // ── Pause on hover / tab visibility ──
  function onEnter() { isPaused = true;  }
  function onLeave() { isPaused = false; }
  carousel.addEventListener('mouseenter', onEnter);
  carousel.addEventListener('mouseleave', onLeave);

  function onVisChange() { isPaused = document.hidden; }
  document.addEventListener('visibilitychange', onVisChange);

  // ── Pause when offscreen ──
  const visObs = new IntersectionObserver(([e]) => { isVisible = e.isIntersecting; });
  visObs.observe(carousel);

  // ── Animation loop ──
  let rafId = null;
  function animate() {
    if (!isPaused && isVisible) {
      position -= speed;
      if (Math.abs(position) >= track.scrollWidth / 2) position = 0;
      track.style.transform = `translateX(${position}px)`;
    }
    rafId = requestAnimationFrame(animate);
  }
  animate();

  // ── Destroy ──
  function destroy() {
    if (rafId)     cancelAnimationFrame(rafId);
    if (resizeRAF) cancelAnimationFrame(resizeRAF);
    visObs.disconnect();
    carousel.removeEventListener('mouseenter', onEnter);
    carousel.removeEventListener('mouseleave', onLeave);
    document.removeEventListener('visibilitychange', onVisChange);
    window.removeEventListener('resize', onResize);
  }

  window.addEventListener('beforeunload', destroy, { once: true });
  return destroy;
}

if (document.readyState !== 'loading') {
  initCarousel();
} else {
  document.addEventListener('DOMContentLoaded', initCarousel, { once: true });
}
