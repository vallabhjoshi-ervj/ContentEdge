/* ═══════════════════════════════════════════════════
   ContentEdge – Main Script (monolithic / no-bundler)
   All features in one IIFE — zero global pollution.
════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ════════════════════════════════════════════════
     1. UTILITIES
  ════════════════════════════════════════════════ */

  const prefersReducedMotion =
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function refreshIcons(root = document) {
    if (typeof lucide !== 'undefined') lucide.createIcons({ root });
  }

  /* ── createState ────────────────────────────────
     Batched reactive store.  API:
       state.get()         → frozen snapshot
       state.set(patch)    → merge + notify (batched)
       state.subscribe(fn) → returns unsubscribe fn
       state.destroy()     → wipe all subscribers
  ─────────────────────────────────────────────── */
  function createState(initial) {
    let _state     = Object.freeze({ ...initial });
    let _listeners = [];
    let _pending   = false;

    function _flush() {
      _pending = false;
      const snap = _state;
      [..._listeners].forEach(fn => fn(snap));
    }

    return {
      get() { return _state; },
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
        if (!_pending) { _pending = true; queueMicrotask(_flush); }
      },
      subscribe(fn) {
        _listeners.push(fn);
        fn(_state);
        return () => { _listeners = _listeners.filter(l => l !== fn); };
      },
      destroy() { _listeners = []; },
    };
  }

  /* ── scopeStyles ────────────────────────────────
     CSS scoping via data-scope attribute.
     Returns unscope() cleanup fn.
  ─────────────────────────────────────────────── */
  function scopeStyles(el, css) {
    const uid = `cs-${(crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)).slice(0, 8)}`;
    el.dataset.scope = uid;
    const scoped = css.replace(/([^@\n][^{]*?)\s*\{/g, (_m, sel) => {
      const prefixed = sel.split(',').map(s => `[data-scope="${uid}"] ${s.trim()}`).join(',\n');
      return `${prefixed} {`;
    });
    const style = document.createElement('style');
    style.dataset.scopeFor = uid;
    style.textContent = scoped;
    document.head.appendChild(style);
    return function unscope() { delete el.dataset.scope; style.remove(); };
  }

  /* ── sanitizeHTML ──────────────────────────────── */
  function sanitizeHTML(html) {
    const doc  = new DOMParser().parseFromString(html, 'text/html');
    const frag = document.createDocumentFragment();
    doc.body.querySelectorAll('script').forEach(s => s.remove());
    doc.body.childNodes.forEach(n => frag.appendChild(document.importNode(n, true)));
    return frag;
  }

  /* ── mountComponent ──────────────────────────── */
  const _mounted = new Map();

  async function mountComponent(id, file, onMount = () => {}) {
    const el = document.getElementById(id);
    if (!el) return;
    if (_mounted.has(id)) { _mounted.get(id).destroy?.(); _mounted.delete(id); }
    try {
      const res = await fetch(file);
      if (!res.ok) throw new Error(`mountComponent: ${file} → HTTP ${res.status}`);
      el.replaceChildren(sanitizeHTML(await res.text()));
      const destroy = onMount(el) ?? (() => {});
      _mounted.set(id, { el, destroy });
      refreshIcons(el);
    } catch (err) { console.error(err); }
  }

  /* ═══════════════════════════════════════════════
     2. COMPONENT BOOTSTRAP + CHATBOT BRIDGE

     MIGRATION PATH when adding a bundler:
       1. Remove window.initChatbot from initChatbot().
       2. Replace tryInitChatbot() with a direct call
          to initChatbot(el) inside the onMount below.
       3. Delete resolveChatbot() and the bridge entirely.
  ════════════════════════════════════════════════ */

  let _chatbotResolver = null;

  function resolveChatbot(module) {
    if (typeof module?.initChatbot === 'function') {
      _chatbotResolver = module.initChatbot;
      tryInitChatbot(0);
    }
  }

  function tryInitChatbot(retries = 10) {
    // BUG FIX: in the monolithic IIFE, initChatbot is a local function
    // (hoisted), never assigned to window. Always reference it by its
    // local name — window.initChatbot will always be undefined here.
    // _chatbotResolver is the escape hatch for the bundler migration path.
    const fn = _chatbotResolver ?? (typeof initChatbot === 'function' ? initChatbot : undefined);
    if (typeof fn === 'function') {
      if (!window._chatbotInitialized) {
        try {
          const destroy = fn();
          if (typeof destroy === 'function') {
            window._chatbotInitialized = true;
          }
        } catch (e) {
          console.error('script.js: initChatbot failed:', e);
        }
      }
    } else if (retries > 0) {
      setTimeout(() => tryInitChatbot(retries - 1), 100);
    } else {
      console.warn('script.js: initChatbot not found after retries.');
    }
  }

  function initDropdowns() {
    document.querySelectorAll('.has-dropdown').forEach(item => {
      let t;
      item.addEventListener('mouseenter', () => { clearTimeout(t); item.classList.add('open'); });
      item.addEventListener('mouseleave', () => { t = setTimeout(() => item.classList.remove('open'), 120); });
    });
  }

  mountComponent('header',  'components/header.html', () => initDropdowns());
  mountComponent('footer',  'components/footer.html');
  mountComponent('chatbot', 'components/chatbot.html', () => {
    tryInitChatbot();
    return () => { window._chatbotInitialized = false; };
  });

  /* ═══════════════════════════════════════════════
     3. ANIMATIONS
     Physics loop — createState not applicable here.
  ════════════════════════════════════════════════ */

  function initAnimations() {
    const stack = document.querySelector('.hero-card-stack');
    const cards = document.querySelectorAll('.hcard');
    if (!stack || prefersReducedMotion) return () => {};

    let stackRect = stack.getBoundingClientRect();
    let resizeRAF = null;
    function onResize() {
      if (resizeRAF) return;
      resizeRAF = requestAnimationFrame(() => { resizeRAF = null; stackRect = stack.getBoundingClientRect(); });
    }
    window.addEventListener('resize', onResize, { passive: true });

    let tiltRAF = null;
    function onStackMove(e) {
      if (tiltRAF) return;
      tiltRAF = requestAnimationFrame(() => {
        tiltRAF = null;
        const x = e.clientX - stackRect.left, y = e.clientY - stackRect.top;
        const oX = (x - stackRect.width  / 2) / (stackRect.width  / 2);
        const oY = (y - stackRect.height / 2) / (stackRect.height / 2);
        cards.forEach((card, i) => {
          const d = (i + 1) * 4;
          card.style.setProperty('--sx', `${-oX*d*2}px`);
          card.style.setProperty('--sy', `${-oY*d*2}px`);
          const t = card.classList.contains('hcard-main') ? 'translate(-50%,-50%) ' : '';
          card.style.transform = `${t}translateX(${oX*d}px) translateY(${oY*d}px) rotateX(${oY*6}deg) rotateY(${oX*6}deg)`;
        });
      });
    }
    stack.addEventListener('mousemove', onStackMove, { passive: true });

    const cardCleanups = [];
    cards.forEach(card => {
      let cr = card.getBoundingClientRect();
      function onEnter() { cr = card.getBoundingClientRect(); }
      let gRAF = null;
      function onMove(e) {
        if (gRAF) return;
        gRAF = requestAnimationFrame(() => {
          gRAF = null;
          const x = e.clientX - cr.left, y = e.clientY - cr.top;
          const cx = cr.width / 2, cy = cr.height / 2;
          const n  = Math.hypot(x - cx, y - cy) / Math.hypot(cx, cy);
          card.style.setProperty('--x',         `${x}px`);
          card.style.setProperty('--y',         `${y}px`);
          card.style.setProperty('--intensity', Math.max(0.1, 0.35 - n * 0.25));
          card.style.setProperty('--size',      `${160 + n * 60}px`);
        });
      }
      card.addEventListener('mouseenter', onEnter, { passive: true });
      card.addEventListener('mousemove',  onMove,  { passive: true });
      cardCleanups.push(() => { card.removeEventListener('mouseenter', onEnter); card.removeEventListener('mousemove', onMove); });
    });

    function onLeave() {
      cards.forEach(c => { c.style.transform = c.classList.contains('hcard-main') ? 'translate(-50%,-50%)' : ''; });
    }
    stack.addEventListener('mouseleave', onLeave, { passive: true });

    return function destroy() {
      window.removeEventListener('resize', onResize);
      stack.removeEventListener('mousemove', onStackMove);
      stack.removeEventListener('mouseleave', onLeave);
      cardCleanups.forEach(fn => fn());
      if (resizeRAF) cancelAnimationFrame(resizeRAF);
      if (tiltRAF)   cancelAnimationFrame(tiltRAF);
    };
  }

  /* ═══════════════════════════════════════════════
     4. NAVBAR — reactive state
  ════════════════════════════════════════════════ */

  function initNavbar() {
    const nav       = document.getElementById('mainNav');
    const scrollBar = document.getElementById('scrollBar');
    const hamburger = document.getElementById('hamburger');
    const navLinks  = document.getElementById('navLinks');

    // ── State ──
    const state = createState({ scrolled: false, menuOpen: false, progress: 0 });

    // ── Reactive render — single source of truth for DOM state ──
    const unsubRender = state.subscribe(({ scrolled, menuOpen, progress }) => {
      nav?.classList.toggle('scrolled', scrolled);
      if (scrollBar) scrollBar.style.width = `${progress}%`;
      hamburger?.setAttribute('aria-expanded', String(menuOpen));
      navLinks?.classList.toggle('open', menuOpen);
    });

    // ── Scroll ──
    let scrollRAF = null;
    function onScroll() {
      if (scrollRAF) return;
      scrollRAF = requestAnimationFrame(() => {
        scrollRAF = null;
        const total = document.body.scrollHeight - window.innerHeight;
        state.set({ scrolled: window.scrollY > 30, progress: total > 0 ? (window.scrollY / total) * 100 : 0 });
      });
    }
    if (nav || scrollBar) window.addEventListener('scroll', onScroll, { passive: true });

    // ── Hamburger ──
    function onHClick()  { state.set({ menuOpen: !state.get().menuOpen }); }
    function onHKey(e)   { if (e.key === 'Escape' && state.get().menuOpen) { state.set({ menuOpen: false }); hamburger.focus(); } }
    function onDocClick(e) { if (!state.get().menuOpen) return; if (nav && !nav.contains(e.target)) state.set({ menuOpen: false }); }

    const linkEls = [];
    if (hamburger && navLinks) {
      hamburger.addEventListener('click',   onHClick);
      hamburger.addEventListener('keydown', onHKey);
      navLinks.querySelectorAll('a').forEach(a => { a.addEventListener('click', () => state.set({ menuOpen: false })); linkEls.push(a); });
      document.addEventListener('click', onDocClick);
    }

    // ── Reveal ──
    const reveals = document.querySelectorAll('.reveal');
    const revealObs = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); revealObs.unobserve(e.target); } });
    }, { threshold: 0.08 });
    reveals.forEach(el => revealObs.observe(el));

    function destroy() {
      unsubRender(); state.destroy();
      window.removeEventListener('scroll', onScroll);
      if (scrollRAF) cancelAnimationFrame(scrollRAF);
      if (hamburger && navLinks) {
        hamburger.removeEventListener('click',   onHClick);
        hamburger.removeEventListener('keydown', onHKey);
        linkEls.forEach(a => a.removeEventListener('click', () => state.set({ menuOpen: false })));
        document.removeEventListener('click', onDocClick);
      }
      revealObs.disconnect();
    }
    window.addEventListener('beforeunload', destroy, { once: true });
    return destroy;
  }

  /* ═══════════════════════════════════════════════
     5. CAROUSEL — physics loop, no createState needed
  ════════════════════════════════════════════════ */

  function initCarousel() {
    const track    = document.getElementById('logoTrack');
    const carousel = document.querySelector('.carousel');
    if (!track || !carousel) return () => {};

    let isPaused = false, isVisible = true, position = 0;
    const speed  = prefersReducedMotion ? 0 : 0.5;

    function fillTrack() {
      const items = Array.from(track.children);
      const need  = window.innerWidth * 2;
      let safety  = 0;
      while (track.scrollWidth < need && safety < 20) { items.forEach(i => track.appendChild(i.cloneNode(true))); safety++; }
      if (safety >= 20) console.warn('script.js: carousel fillTrack hit safety limit.');
    }
    fillTrack();

    let resizeRAF = null;
    function onResize() {
      if (resizeRAF) return;
      resizeRAF = requestAnimationFrame(() => { resizeRAF = null; fillTrack(); });
    }
    window.addEventListener('resize', onResize, { passive: true });

    function onEnter() { isPaused = true; } function onLeave() { isPaused = false; }
    carousel.addEventListener('mouseenter', onEnter);
    carousel.addEventListener('mouseleave', onLeave);

    function onVis() { isPaused = document.hidden; }
    document.addEventListener('visibilitychange', onVis);

    const visObs = new IntersectionObserver(([e]) => { isVisible = e.isIntersecting; });
    visObs.observe(carousel);

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

    function destroy() {
      if (rafId)     cancelAnimationFrame(rafId);
      if (resizeRAF) cancelAnimationFrame(resizeRAF);
      visObs.disconnect();
      carousel.removeEventListener('mouseenter', onEnter);
      carousel.removeEventListener('mouseleave', onLeave);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('resize', onResize);
    }
    window.addEventListener('beforeunload', destroy, { once: true });
    return destroy;
  }

  /* ═══════════════════════════════════════════════
     6. PAGE INIT (form, select, year)
  ════════════════════════════════════════════════ */

  function initPage() {
    const yearEl = document.getElementById('currentYear');
    if (yearEl) yearEl.textContent = new Date().getFullYear();
    refreshIcons();

    const quoteBtn = document.getElementById('quoteBtn');
    if (quoteBtn) {
      const fields = { fname: document.getElementById('fname'), lname: document.getElementById('lname'), email: document.getElementById('email'), company: document.getElementById('company'), service: document.getElementById('service'), message: document.getElementById('message') };
      quoteBtn.addEventListener('click', () => {
        const fname = fields.fname?.value.trim() ?? '', lname = fields.lname?.value.trim() ?? '',
              email = fields.email?.value.trim() ?? '', company = fields.company?.value.trim() ?? '',
              service = fields.service?.value ?? '', message = fields.message?.value.trim() ?? '';
        if (!fname || !email) { alert('Please fill in your name and email.'); return; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { alert('Please enter a valid email address.'); return; }
        const subject = `New Inquiry from ${fname} ${lname}`;
        const body    = `Name:    ${fname} ${lname}\nEmail:   ${email}\nCompany: ${company}\nService: ${service}\n\nMessage: ${message}`;
        alert('Opening your email client… If nothing opens, email us at info@contentedge.in');
        window.location.href = `mailto:info@contentedge.in?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      });
    }

    const customSelect = document.getElementById('serviceSelect');
    if (customSelect) {
      const selected = customSelect.querySelector('.select-selected'), hiddenInput = document.getElementById('service');
      selected?.setAttribute('tabindex', '0');
      const open = () => customSelect.classList.add('active'), close = () => customSelect.classList.remove('active'), toggle = () => customSelect.classList.toggle('active');
      selected?.addEventListener('click', toggle);
      selected?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
        if (e.key === 'Escape') close();
        if (e.key === 'ArrowDown') { e.preventDefault(); open(); customSelect.querySelector('.select-options div')?.focus(); }
      });
      customSelect.addEventListener('click', (e) => { const opt = e.target.closest('.select-options div'); if (!opt) return; if (selected) selected.textContent = opt.textContent; if (hiddenInput) hiddenInput.value = opt.dataset.value; close(); });
      customSelect.addEventListener('keydown', (e) => {
        if (!customSelect.classList.contains('active')) return;
        const opts = Array.from(customSelect.querySelectorAll('.select-options div'));
        const idx  = opts.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') { e.preventDefault(); opts[Math.min(idx+1, opts.length-1)]?.focus(); }
        if (e.key === 'ArrowUp')   { e.preventDefault(); if (idx <= 0) { close(); selected?.focus(); } else opts[idx-1]?.focus(); }
        if (e.key === 'Escape')    { close(); selected?.focus(); }
      });
      document.addEventListener('click', (e) => { if (!customSelect.contains(e.target)) close(); });
    }

    initAnimations();
    initNavbar();
    initCarousel();
  }

  if (document.readyState !== 'loading') { initPage(); }
  else { document.addEventListener('DOMContentLoaded', initPage, { once: true }); }

  /* ═══════════════════════════════════════════════
     7. CHATBOT — reactive state + scoped styles
  ════════════════════════════════════════════════ */

  let _chatbotDestroy = null;

  function initChatbot() {
    if (_chatbotDestroy) { _chatbotDestroy(); _chatbotDestroy = null; }

    const launcher = document.getElementById('ceLauncher'); if (!launcher) return;
    const launcherBtn = document.getElementById('ceLauncherBtn'), launcherPill = document.getElementById('ceLauncherPill');
    const widget = document.getElementById('ceWidget');
    const homeView = document.getElementById('ceHomeView'), chatView = document.getElementById('ceChatView');
    const homeCard = document.getElementById('ceHomeCard'), homeTab = document.getElementById('ceHomeTab'), chatTab = document.getElementById('ceChatTab'), backBtn = document.getElementById('ceBackBtn');
    const ceInput = document.getElementById('ceInput'), ceSendBtn = document.getElementById('ceSendBtn'), ceMessages = document.getElementById('ceMessages'), ceInlineMenu = document.getElementById('ceInlineMenu');

    if (!ceMessages || !ceInput || !ceSendBtn) { console.warn('initChatbot: elements missing.'); return; }

    // ── Scoped styles ──
    const unscope = scopeStyles(widget, `
      .ce-widget { contain: layout style; }
      .ce-msg-bubble { word-break: break-word; overflow-wrap: anywhere; }
      .ce-chip:focus-visible { outline: 2px solid var(--accent, #6c63ff); outline-offset: 2px; }
      .ce-input:focus-visible { outline: 2px solid var(--accent, #6c63ff); outline-offset: -2px; }
    `);

    // ── State ──
    const state = createState({ isOpen: false, view: 'home', isTyping: false });

    // ── rAF-debounced icon refresh ──
    let _iconRAF = null;
    function safeRefresh(root = widget) {
      if (_iconRAF) return;
      _iconRAF = requestAnimationFrame(() => { _iconRAF = null; refreshIcons(root); });
    }

    // ── Reactive render ──
    const unsubRender = state.subscribe(({ isOpen, view }) => {
      widget.classList.toggle('open', isOpen);
      widget.setAttribute('aria-hidden', String(!isOpen));
      launcher.classList.toggle('open', isOpen);
      if (isOpen) safeRefresh();
      homeView?.classList.toggle('active', view === 'home');
      homeTab?.classList.toggle('active',  view === 'home');
      chatView?.classList.toggle('active', view === 'chat');
      chatTab?.classList.toggle('active',  view === 'chat');
      if (view === 'chat') { scrollToBottom(); setTimeout(() => ceInput?.focus(), 80); }
    });

    let typingEl = null, picker = null;
    const REGEX = { pricing: /pric|cost|quot|rate|charg|fee|discount|bulk/i, languages: /lang|service|translat|local|technical|speciali/i, contact: /contact|email|hour|respond|support|urgent|reach/i };

    const QA = {
      pricing: {
        intro: '💰 Great! Here\'s a quick overview of our pricing. We offer competitive, transparent rates based on language pair, word count, and complexity. What would you like to know?',
        chips: [{ label: 'How much does translation cost?', key: 'cost' }, { label: 'How do I get a quote?', key: 'quote' }, { label: 'Do you offer bulk discounts?', key: 'discount' }, { label: 'Are there any hidden charges?', key: 'hidden' }],
        answers: { cost: 'Our rates typically start from ₹1.50–₹3 per word for standard language pairs, varying by complexity and turnaround time. 📄', quote: 'Share your document, language pair, and deadline at info@contentedge.in — we\'ll send a quote within a few hours. 🚀', discount: 'We offer volume discounts for 10,000+ words and special rates for long-term clients. 🤝', hidden: 'No hidden charges. Quotes are all-inclusive — translation, proofreading, and formatting. ✅' },
      },
      languages: {
        intro: '🌍 We support 100+ language pairs and a wide range of content services. What interests you?',
        chips: [{ label: 'Which languages do you support?', key: 'langs' }, { label: 'What services do you offer?', key: 'services' }, { label: 'Do you handle technical content?', key: 'technical' }, { label: 'Do you offer localisation?', key: 'local' }],
        answers: { langs: 'We work with 100+ pairs — European (French, German, Spanish), Asian (Hindi, Mandarin, Japanese, Arabic, Korean), and more. 🗺️', services: '✍️ Translation, 🔍 Proofreading, 🌐 Localisation, 📝 Technical Writing, 🎯 Content Creation, 📋 Transcription, 🖥️ DTP.', technical: 'Yes! Domain experts in technical, legal, medical, financial, and IT content. 🔬', local: 'Full product localisation — UI strings, marketing copy, cultural adaptation. 🎯' },
      },
      contact: {
        intro: '📞 We\'d love to hear from you! Here\'s how to reach the ContentEdge team.',
        chips: [{ label: 'What\'s your email address?', key: 'email' }, { label: 'What are your working hours?', key: 'hours' }, { label: 'How quickly do you respond?', key: 'response' }, { label: 'Can I request an urgent job?', key: 'urgent' }],
        answers: { email: '📧 info@contentedge.in — all enquiries and quotes. We aim to reply within a few hours.', hours: 'Monday–Saturday, 9:00 AM–7:00 PM IST. Urgent requests outside hours are accommodated. ⏰', response: 'We typically respond within 2–4 hours on business days. ⚡', urgent: 'Yes! Rush turnaround from 12–24 hours. Email info@contentedge.in and mark it urgent. 🚨' },
      },
    };

    const FALLBACK_REPLIES = ['Thanks for your message! Explore the topics below or email info@contentedge.in. 😊', 'Great question! Email us at info@contentedge.in for the most accurate answer. ✉️', 'Could you share more detail? Or reach us at info@contentedge.in directly.', 'One of our language specialists will be in touch. Check the quick topics for instant answers! 🌍'];
    let fallbackIndex = 0;
    const TOPIC_LABELS = { pricing: '💰 Pricing & Quotes', languages: '🌍 Languages & Services', contact: '📞 Contact & Support' };

    function scrollToBottom() { ceMessages.scrollTo({ top: ceMessages.scrollHeight, behavior: 'smooth' }); }
    function now() { return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
    function escapeHTML(str) { const d = document.createElement('div'); d.appendChild(document.createTextNode(str)); return d.innerHTML; }

    function openWidget()  { state.set({ isOpen: true  }); }
    function closeWidget() { state.set({ isOpen: false }); if (picker) picker.style.display = 'none'; }
    function onLaunch()    { state.get().isOpen ? closeWidget() : openWidget(); }
    function onDocKey(e)   { if (e.key === 'Escape' && state.get().isOpen) { closeWidget(); launcherBtn?.focus(); } }
    launcherBtn?.addEventListener('click', onLaunch);
    launcherPill?.addEventListener('click', openWidget);
    document.addEventListener('keydown', onDocKey);

    function switchView(view) { state.set({ view }); safeRefresh(); }
    homeCard?.addEventListener('click', () => switchView('chat'));
    homeTab?.addEventListener('click',  () => switchView('home'));
    chatTab?.addEventListener('click',  () => switchView('chat'));
    backBtn?.addEventListener('click',  () => switchView('home'));

    // ── Emoji Picker ──
    const emojiBtn = document.getElementById('emojiBtn');
    let pS = null, pR = null, pD = null, pEC = null;
    if (emojiBtn && ceInput) {
      picker = document.querySelector('emoji-picker') || (() => { const p = document.createElement('emoji-picker'); Object.assign(p.style, { position: 'fixed', zIndex: '99999', display: 'none' }); document.body.appendChild(p); return p; })();
      function pos() { const r = emojiBtn.getBoundingClientRect(), h = picker.offsetHeight || 300; picker.style.top = `${r.top-h-10}px`; picker.style.left = `${r.left}px`; }
      emojiBtn.addEventListener('keydown', (e) => { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); emojiBtn.click(); } if (e.key==='Escape'&&picker.style.display==='block') { picker.style.display='none'; emojiBtn.focus(); } });
      emojiBtn.addEventListener('click', () => { if (!state.get().isOpen) openWidget(); picker.style.display==='none' ? (picker.style.display='block', requestAnimationFrame(pos)) : (picker.style.display='none'); });
      pEC = (ev) => { ceInput.value += ev.detail.unicode; ceInput.focus(); ceSendBtn.classList.toggle('active', ceInput.value.trim().length > 0); };
      picker.addEventListener('emoji-click', pEC);
      pS = () => { if (picker.style.display==='block') pos(); }; pR = pS;
      pD = (e) => { if (!picker.contains(e.target) && !emojiBtn.contains(e.target)) picker.style.display='none'; };
      window.addEventListener('scroll', pS, { passive: true }); window.addEventListener('resize', pR, { passive: true }); document.addEventListener('click', pD);
    }

    function addMessage(html, sender) {
      const msg = document.createElement('div');
      msg.className = `ce-msg ce-msg-${sender}`;
      msg.innerHTML = sender === 'bot'
        ? `<div class="ce-msg-avatar"><img src="/assets/logo.png" alt="Logo"></div><div class="ce-msg-content"><div class="ce-msg-bubble">${html}</div><span class="ce-msg-time">${now()}</span></div>`
        : `<div class="ce-msg-content"><div class="ce-msg-bubble">${html}</div><span class="ce-msg-time">${now()}</span></div>`;
      ceMessages.appendChild(msg); safeRefresh(); scrollToBottom(); return msg;
    }
    function showTyping() {
      state.set({ isTyping: true });
      if (typingEl) return;
      typingEl = document.createElement('div');
      typingEl.className = 'ce-msg ce-msg-bot ce-typing';
      typingEl.innerHTML = `<div class="ce-msg-avatar"><img src="/assets/logo.png" alt="Logo"></div><div class="ce-msg-content"><div class="ce-msg-bubble"><span class="ce-typing-dot"></span><span class="ce-typing-dot"></span><span class="ce-typing-dot"></span></div></div>`;
      ceMessages.appendChild(typingEl); scrollToBottom();
    }
    function hideTyping() { state.set({ isTyping: false }); typingEl?.remove(); typingEl = null; }

    function renderChips(chips, topic) {
      const tray = document.createElement('div'); tray.className = 'ce-chips-tray';
      chips.forEach(c => { const btn = document.createElement('button'); btn.className = 'ce-chip'; Object.assign(btn.dataset, { action: 'qa', topic, key: c.key, label: c.label }); btn.innerHTML = `<i data-lucide="corner-down-right"></i>${escapeHTML(c.label)}`; tray.appendChild(btn); });
      ceMessages.appendChild(tray); safeRefresh(); scrollToBottom();
    }
    function renderBackToTopicsChip() {
      const tray = document.createElement('div'); tray.className = 'ce-chips-tray';
      const btn = document.createElement('button'); btn.className = 'ce-chip'; btn.dataset.action = 'back-to-topics';
      btn.innerHTML = `<i data-lucide="list"></i>See all topics`; tray.appendChild(btn); ceMessages.appendChild(tray); safeRefresh(); scrollToBottom();
    }
    function renderInlineTopicMenu() {
      const menu = document.createElement('div'); menu.className = 'ce-inline-menu';
      menu.innerHTML = `<p class="ce-inline-menu-label">What can I help you with?</p><button class="ce-inline-btn" data-topic="pricing"><i data-lucide="tag"></i> Pricing &amp; Quotes</button><button class="ce-inline-btn" data-topic="languages"><i data-lucide="globe"></i> Languages &amp; Services</button><button class="ce-inline-btn" data-topic="contact"><i data-lucide="headphones"></i> Contact &amp; Support</button>`;
      ceMessages.appendChild(menu); safeRefresh(); scrollToBottom();
    }

    function handleTopic(topic, menuEl) {
      const qa = QA[topic]; if (!qa) return;
      if (menuEl) menuEl.classList.add('hidden');
      switchView('chat'); addMessage(escapeHTML(TOPIC_LABELS[topic] || topic), 'user'); showTyping();
      setTimeout(() => { hideTyping(); addMessage(escapeHTML(qa.intro), 'bot'); renderChips(qa.chips, topic); }, 600 + Math.random() * 400);
    }
    function triggerIntro(topic) {
      showTyping();
      setTimeout(() => { hideTyping(); addMessage(escapeHTML(QA[topic].intro), 'bot'); renderChips(QA[topic].chips, topic); }, 700 + Math.random() * 500);
    }

    function onWidgetClick(e) {
      const tBtn = e.target.closest('.ce-topic-btn'); if (tBtn) { handleTopic(tBtn.dataset.topic, null); return; }
      const iBtn = e.target.closest('.ce-inline-btn'); if (iBtn) { handleTopic(iBtn.dataset.topic, iBtn.closest('.ce-inline-menu')); return; }
      const chip = e.target.closest('.ce-chip'); if (!chip || chip.classList.contains('used')) return;
      chip.closest('.ce-chips-tray')?.querySelectorAll('.ce-chip').forEach(c => c.classList.add('used'));
      const { action, topic, key, label } = chip.dataset;
      if (action === 'qa') {
        addMessage(escapeHTML(label), 'user');
        const ans = QA[topic]?.answers?.[key];
        if (ans) { showTyping(); setTimeout(() => { hideTyping(); addMessage(escapeHTML(ans), 'bot'); renderBackToTopicsChip(); }, 700 + Math.random() * 500); }
      } else if (action === 'back-to-topics') { renderInlineTopicMenu(); }
    }
    widget.addEventListener('click', onWidgetClick);

    function onMenuClick(e) { const btn = e.target.closest('.ce-inline-btn'); if (btn) handleTopic(btn.dataset.topic, ceInlineMenu); }
    ceInlineMenu?.addEventListener('click', onMenuClick);

    function onInput()  { ceSendBtn.classList.toggle('active', ceInput.value.trim().length > 0); }
    function onKey(e)   { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }
    function send() {
      const text = ceInput.value.trim(); if (!text) return;
      addMessage(escapeHTML(text), 'user'); ceInput.value = ''; ceSendBtn.classList.remove('active');
      let hit = false;
      if      (REGEX.pricing.test(text))   { triggerIntro('pricing');   hit = true; }
      else if (REGEX.languages.test(text)) { triggerIntro('languages'); hit = true; }
      else if (REGEX.contact.test(text))   { triggerIntro('contact');   hit = true; }
      if (!hit) {
        const reply = FALLBACK_REPLIES[fallbackIndex++ % FALLBACK_REPLIES.length];
        showTyping();
        setTimeout(() => { hideTyping(); addMessage(escapeHTML(reply), 'bot'); renderBackToTopicsChip(); }, 800 + Math.random() * 600);
      }
    }
    ceInput.addEventListener('input', onInput); ceInput.addEventListener('keydown', onKey); ceSendBtn.addEventListener('click', send);

    // Single deferred call — avoids redundant DOM work.
    setTimeout(() => refreshIcons(widget), 0);

    function destroy() {
      unsubRender(); state.destroy(); unscope();
      if (_iconRAF) { cancelAnimationFrame(_iconRAF); _iconRAF = null; }
      launcherBtn?.removeEventListener('click', onLaunch);
      launcherPill?.removeEventListener('click', openWidget);
      document.removeEventListener('keydown', onDocKey);
      widget.removeEventListener('click', onWidgetClick);
      ceInlineMenu?.removeEventListener('click', onMenuClick);
      ceInput.removeEventListener('input', onInput); ceInput.removeEventListener('keydown', onKey); ceSendBtn.removeEventListener('click', send);
      if (pS)  window.removeEventListener('scroll', pS);
      if (pR)  window.removeEventListener('resize', pR);
      if (pD)  document.removeEventListener('click', pD);
      if (pEC) picker?.removeEventListener('emoji-click', pEC);
      picker?.parentNode?.removeChild(picker); picker = null;
      _chatbotDestroy = null;
    }
    _chatbotDestroy = destroy;
    window.addEventListener('beforeunload', destroy, { once: true });
    return destroy;
  }

})(); // end IIFE
