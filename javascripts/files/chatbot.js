/* ═══════════════════════════════════════════════════
   chatbot.js  —  Floating Chat Widget v2

   ES MODULE  ·  import { initChatbot } from './chatbot.js'

   State shape:
     { isOpen: bool, view: 'home'|'chat', isTyping: bool }

   All structural DOM updates (open/close, view switch,
   typing indicator visibility) are driven by state
   subscriptions. Message + chip rendering stays
   imperative — it's a list of distinct DOM nodes, not
   a function of a simple value, so reactive diffing
   would add complexity without benefit here.

   Component isolation:
     scopeStyles() injects scoped CSS so the widget's
     styles don't leak into the host page and host
     styles don't bleed in unintentionally.
════════════════════════════════════════════════════ */

import { refreshIcons, createState, scopeStyles } from './core.js';

/* ── Module-level instance tracker (double-init guard) ── */
let _destroy = null;

export function initChatbot() {
  'use strict';

  if (_destroy) { _destroy(); _destroy = null; }

  /* ── DOM refs ── */
  const launcher     = document.getElementById('ceLauncher');
  if (!launcher) return;

  const launcherBtn  = document.getElementById('ceLauncherBtn');
  const launcherPill = document.getElementById('ceLauncherPill');
  const widget       = document.getElementById('ceWidget');
  const homeView     = document.getElementById('ceHomeView');
  const chatView     = document.getElementById('ceChatView');
  const homeCard     = document.getElementById('ceHomeCard');
  const homeTab      = document.getElementById('ceHomeTab');
  const chatTab      = document.getElementById('ceChatTab');
  const backBtn      = document.getElementById('ceBackBtn');
  const ceInput      = document.getElementById('ceInput');
  const ceSendBtn    = document.getElementById('ceSendBtn');
  const ceMessages   = document.getElementById('ceMessages');
  const ceInlineMenu = document.getElementById('ceInlineMenu');
  const ceTypingSlot = document.getElementById('ceTypingSlot'); // optional dedicated slot

  if (!widget) {
    console.warn('chatbot.js: #ceWidget not found — aborting init.');
    return;
  }

  if (!ceMessages || !ceInput || !ceSendBtn) {
    console.warn('chatbot.js: required elements missing — aborting init.');
    return;
  }

  /* ── rAF-debounced icon refresh ──────────────────
     refreshIcons() traverses the whole subtree looking
     for [data-lucide] nodes — expensive if called
     multiple times per frame. This wrapper coalesces
     all calls within a single rAF tick into one pass.
  ─────────────────────────────────────────────────── */
  let _iconRAF = null;
  function safeRefresh(root = widget) {
    if (_iconRAF) return;
    _iconRAF = requestAnimationFrame(() => {
      _iconRAF = null;
      refreshIcons(root);
    });
  }

  /* ════════════════════════════════════════════════
     SCOPED STYLES
     Inject component-specific overrides scoped to
     this widget instance. Host-page styles cannot
     bleed in (specificity wins via [data-scope]).
     This is intentionally minimal — the bulk of
     chatbot styles live in the project's CSS file.
     Add any layout or animation overrides here that
     should be truly isolated.
  ════════════════════════════════════════════════ */

  const unscope = scopeStyles(widget, `
    .ce-widget {
      contain: layout style;
    }
    .ce-msg-bubble {
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    .ce-chip:focus-visible {
      outline: 2px solid var(--accent, #6c63ff);
      outline-offset: 2px;
    }
    .ce-input:focus-visible {
      outline: 2px solid var(--accent, #6c63ff);
      outline-offset: -2px;
    }
  `);

  /* ════════════════════════════════════════════════
     REACTIVE STATE
     isOpen   → widget visibility
     view     → 'home' | 'chat'
     isTyping → typing indicator
  ════════════════════════════════════════════════ */

  const state = createState({
    isOpen:   false,
    view:     'home',
    isTyping: false,
  });

  let messageQueue = Promise.resolve();

  function enqueueBotAction(action) {
    messageQueue = messageQueue
      .catch(() => {}) // prevent break chain
      .then(() => new Promise(resolve => action(resolve)));
  }

  /* ── Reactive DOM renderer ──
     Structural changes driven by state — no manual
     classList calls scattered across open/close/switch
     functions.
  ─────────────────────────────────────────────────── */

  const unsubRender = state.subscribe(({ isOpen, view, isTyping }) => {

    // ── Widget open / close ──
    widget.classList.toggle('open', isOpen);
    widget.setAttribute('aria-hidden', String(!isOpen));
    launcher.classList.toggle('open', isOpen);
    if (isOpen) safeRefresh();

    // ── View switching ──
    homeView?.classList.toggle('active', view === 'home');
    homeTab?.classList.toggle('active',  view === 'home');
    chatView?.classList.toggle('active', view === 'chat');
    chatTab?.classList.toggle('active',  view === 'chat');

    if (view === 'chat') {
      scrollToBottom();
      setTimeout(() => ceInput?.focus(), 80);
    }

    // ── Typing indicator ──
    // If a dedicated slot exists use it; otherwise manage
    // the indicator node directly in ceMessages.
    if (ceTypingSlot) {
      ceTypingSlot.hidden = !isTyping;
    } else {
      // Handled imperatively in showTyping/hideTyping below
      // for backwards compatibility with existing HTML.
    }
  });

  /* ── Picker & misc non-state refs ── */
  let typingEl = null;
  let picker   = null;
  let pickerCreated = false;

  /* ── Compiled regex — once per init ── */
  const REGEX = {
    pricing:   /pric|cost|quot|rate|charg|fee|discount|bulk/i,
    languages: /lang|service|translat|local|technical|speciali/i,
    contact:   /contact|email|hour|respond|support|urgent|reach/i,
  };

  /* ══════════════════════════════════════════════
     Q & A  B A N K
  ══════════════════════════════════════════════ */
  const QA = {
    pricing: {
      intro: '💰 Great! Here\'s a quick overview of our pricing. We offer competitive, transparent rates based on language pair, word count, and complexity. What would you like to know?',
      chips: [
        { label: 'How much does translation cost?', key: 'cost'     },
        { label: 'How do I get a quote?',           key: 'quote'    },
        { label: 'Do you offer bulk discounts?',    key: 'discount' },
        { label: 'Are there any hidden charges?',   key: 'hidden'   },
      ],
      answers: {
        cost:     'Our rates typically start from ₹1.50–₹3 per word for standard language pairs, and vary based on complexity, subject matter, and turnaround time. Technical, legal, and medical translations are priced at a premium due to specialisation. 📄',
        quote:    'Getting a quote is simple! Just share your document (or word count), source & target languages, and your deadline via email at info@contentedge.in — we\'ll send a detailed quote within a few hours. 🚀',
        discount: 'Absolutely! We offer volume discounts for projects over 10,000 words, and special rates for long-term clients & agencies. Contact us at info@contentedge.in to discuss a custom pricing plan. 🤝',
        hidden:   'No hidden charges, ever. Our quotes are all-inclusive — covering translation, proofreading, and formatting unless otherwise specified. What you see is what you pay. ✅',
      },
    },
    languages: {
      intro: '🌍 We support 100+ language pairs and cover a wide range of content services. Let me share more details — what interests you?',
      chips: [
        { label: 'Which languages do you support?',  key: 'langs'     },
        { label: 'What services do you offer?',      key: 'services'  },
        { label: 'Do you handle technical content?', key: 'technical' },
        { label: 'Do you offer localisation?',       key: 'local'     },
      ],
      answers: {
        langs:     'We work with 100+ language pairs including major European languages (French, German, Spanish, Italian), Asian languages (Hindi, Mandarin, Japanese, Arabic, Korean), and many more. If you have a specific language in mind, feel free to ask! 🗺️',
        services:  'Our core services include: ✍️ Translation, 🔍 Proofreading & Editing, 🌐 Localisation, 📝 Technical Writing, 🎯 Content Creation, 📋 Transcription, and 🖥️ Desktop Publishing (DTP). We tailor every project to your needs.',
        technical: 'Yes! We specialise in technical, legal, medical, financial, and IT content. Our translators are domain experts — not just linguists — so the accuracy and terminology are always on point. 🔬',
        local:     'Definitely! Localisation is one of our core strengths. We adapt your content culturally and linguistically for target markets — from UI strings and marketing copy to full product localisation. 🎯',
      },
    },
    contact: {
      intro: '📞 We\'d love to hear from you! Here\'s how you can reach the ContentEdge team. What would you like to know?',
      chips: [
        { label: 'What\'s your email address?',  key: 'email'    },
        { label: 'What are your working hours?', key: 'hours'    },
        { label: 'How quickly do you respond?',  key: 'response' },
        { label: 'Can I request an urgent job?', key: 'urgent'   },
      ],
      answers: {
        email:    'You can reach us at 📧 info@contentedge.in for all project enquiries, quotes, and support. We aim to reply within a few hours during business hours.',
        hours:    'Our team is available Monday–Saturday, 9:00 AM – 7:00 PM IST. For urgent projects, we do accommodate requests outside these hours — just mention it in your email. ⏰',
        response: 'We typically respond within 2–4 hours on business days. For urgent inquiries, you\'ll often hear back even faster. We take response time seriously! ⚡',
        urgent:   'Yes! We handle urgent and rush projects. Turnaround can be as fast as 12–24 hours depending on word count and language pair. Rush rates may apply. Just email us at info@contentedge.in and mark it as urgent. 🚨',
      },
    },
  };

  const FALLBACK_REPLIES = [
    'Thanks for your message! A member of our team will follow up shortly. In the meantime, feel free to explore the topics below. 😊',
    'Great question! For the most accurate answer, please email us at info@contentedge.in and we\'ll get back to you within a few hours. ✉️',
    'I\'d love to help with that! Could you share a bit more detail? You can also reach us directly at info@contentedge.in for project-specific queries.',
    'Thanks for reaching out to ContentEdge! One of our language specialists will be in touch soon. Meanwhile, check out our quick topics for instant answers. 🌍',
  ];
  let fallbackIndex = 0;

  const TOPIC_LABELS = {
    pricing:   '💰 Pricing & Quotes',
    languages: '🌍 Languages & Services',
    contact:   '📞 Contact & Support',
  };

  /* ══════════════════════════════════════════════
     UTILITIES
  ══════════════════════════════════════════════ */

  function scrollToBottom() {
    requestAnimationFrame(() => {
      ceMessages.scrollTop = ceMessages.scrollHeight;
    });
  }

  function now() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function escapeHTML(str) {
    const d = document.createElement('div');
    d.appendChild(document.createTextNode(str));
    return d.innerHTML;
  }

  /* ══════════════════════════════════════════════
     OPEN / CLOSE  (now just state mutations)
  ══════════════════════════════════════════════ */

  function openWidget()  { state.set({ isOpen: true  }); }
  function closeWidget() {
    state.set({ isOpen: false });
    if (picker) picker.style.display = 'none';
  }

  function onLauncherClick() { state.get().isOpen ? closeWidget() : openWidget(); }
  function onDocKeydown(e)   { if (e.key === 'Escape' && state.get().isOpen) { closeWidget(); launcherBtn?.focus(); } }

  launcherBtn?.addEventListener('click',  onLauncherClick);
  launcherPill?.addEventListener('click', openWidget);
  document.addEventListener('keydown', onDocKeydown);

  /* ══════════════════════════════════════════════
     VIEW SWITCHING  (state mutation only)
  ══════════════════════════════════════════════ */

  function switchView(view) { state.set({ view }); safeRefresh(); }

  homeCard?.addEventListener('click', () => switchView('chat'));
  homeTab?.addEventListener('click',  () => switchView('home'));
  chatTab?.addEventListener('click',  () => switchView('chat'));
  backBtn?.addEventListener('click',  () => switchView('home'));

  /* ══════════════════════════════════════════════
     EMOJI PICKER
  ══════════════════════════════════════════════ */

  const emojiBtn = document.getElementById('emojiBtn');
  let pScroll = null, pResize = null, pDoc = null, pEmojiClick = null;

  if (emojiBtn && ceInput) {
    picker = document.querySelector('emoji-picker');
    if (!picker) {
      picker = document.createElement('emoji-picker');
      pickerCreated = true;

      Object.assign(picker.style, {
        position: 'fixed',
        zIndex: '99999',
        display: 'none'
      });

      document.body.appendChild(picker);
    }

    function positionPicker() {
      const rect = emojiBtn.getBoundingClientRect();
      const h    = picker.offsetHeight || 300;
      picker.style.top  = `${rect.top - h - 10}px`;
      picker.style.left = `${rect.left}px`;
    }

    emojiBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); emojiBtn.click(); }
      if (e.key === 'Escape' && picker.style.display === 'block') { picker.style.display = 'none'; emojiBtn.focus(); }
    });

    emojiBtn.addEventListener('click', () => {
      if (!state.get().isOpen) openWidget();
      if (picker.style.display === 'none') {
        picker.style.display = 'block';
        requestAnimationFrame(positionPicker);
      } else {
        picker.style.display = 'none';
      }
    });

    pScroll = () => { if (picker.style.display === 'block') positionPicker(); };
    pResize = () => { if (picker.style.display === 'block') positionPicker(); };
    pDoc    = (e) => { if (!picker.contains(e.target) && !emojiBtn.contains(e.target)) picker.style.display = 'none'; };

    function onEmojiClick(ev) {
      ceInput.value += ev.detail.unicode;
      ceInput.focus();
      ceSendBtn.classList.toggle('active', ceInput.value.trim().length > 0);
    }
    picker.addEventListener('emoji-click', onEmojiClick);

    // Store reference so destroy() can remove it without a closure leak.
    pEmojiClick = onEmojiClick;

    window.addEventListener('scroll',  pScroll, { passive: true });
    window.addEventListener('resize',  pResize, { passive: true });
    document.addEventListener('click', pDoc);
  }

  /* ══════════════════════════════════════════════
     MESSAGING
  ══════════════════════════════════════════════ */

  function addMessage(html, sender) {
    const msg = document.createElement('div');
    msg.className = `ce-msg ce-msg-${sender}`;
    msg.innerHTML = sender === 'bot'
      ? `<div class="ce-msg-avatar"><img src="/assets/logo.png" alt="Logo"></div><div class="ce-msg-content"><div class="ce-msg-bubble">${html}</div><span class="ce-msg-time">${now()}</span></div>`
      : `<div class="ce-msg-content"><div class="ce-msg-bubble">${html}</div><span class="ce-msg-time">${now()}</span></div>`;
    ceMessages.appendChild(msg);
    safeRefresh();
    scrollToBottom();
    return msg;
  }

  // Typing indicator — kept imperative because it's a transient DOM node
  // (not worth routing through state; state.isTyping is still tracked so
  // future consumers e.g. a hypothetical <ce-typing-slot> can react to it).
  function showTyping() {
    state.set({ isTyping: true });
    if (typingEl) return;
    typingEl = document.createElement('div');
    typingEl.className = 'ce-msg ce-msg-bot ce-typing';
    typingEl.innerHTML = `
      <div class="ce-msg-avatar"><img src="/assets/logo.png" alt="Logo"></div>
      <div class="ce-msg-content"><div class="ce-msg-bubble">
        <span class="ce-typing-dot"></span>
        <span class="ce-typing-dot"></span>
        <span class="ce-typing-dot"></span>
      </div></div>`;
    ceMessages.appendChild(typingEl);
    scrollToBottom();
  }

  function hideTyping() {
    state.set({ isTyping: false });
    typingEl?.remove();
    typingEl = null;
  }

  /* ══════════════════════════════════════════════
     CHIP RENDERERS (data-attributes; no inline listeners)
  ══════════════════════════════════════════════ */

  function renderChips(chips, topic) {
    const tray = document.createElement('div');
    tray.className = 'ce-chips-tray';
    chips.forEach(c => {
      const btn = document.createElement('button');
      btn.className = 'ce-chip';
      Object.assign(btn.dataset, { action: 'qa', topic, key: c.key, label: c.label });
      btn.innerHTML = `<i data-lucide="corner-down-right"></i>${escapeHTML(c.label)}`;
      tray.appendChild(btn);
    });
    ceMessages.appendChild(tray);
    safeRefresh();
    scrollToBottom();
  }

  function renderBackToTopicsChip() {
    const tray = document.createElement('div');
    tray.className = 'ce-chips-tray';
    const btn = document.createElement('button');
    btn.className = 'ce-chip';
    btn.dataset.action = 'back-to-topics';
    btn.innerHTML = `<i data-lucide="list"></i>See all topics`;
    tray.appendChild(btn);
    ceMessages.appendChild(tray);
    safeRefresh();
    scrollToBottom();
  }

  function renderInlineTopicMenu() {
    const menu = document.createElement('div');
    menu.className = 'ce-inline-menu';
    menu.innerHTML = `
      <p class="ce-inline-menu-label">What can I help you with?</p>
      <button class="ce-inline-btn" data-topic="pricing"><i data-lucide="tag"></i> Pricing &amp; Quotes</button>
      <button class="ce-inline-btn" data-topic="languages"><i data-lucide="globe"></i> Languages &amp; Services</button>
      <button class="ce-inline-btn" data-topic="contact"><i data-lucide="headphones"></i> Contact &amp; Support</button>`;
    ceMessages.appendChild(menu);
    safeRefresh();
    scrollToBottom();
  }

  /* ══════════════════════════════════════════════
     TOPIC HANDLING
  ══════════════════════════════════════════════ */

  function handleTopicSelected(topic, menuEl) {
    const qa = QA[topic]; 
    if (!qa) return;


    if (menuEl) menuEl.classList.add('hidden');


    switchView('chat');
    addMessage(escapeHTML(TOPIC_LABELS[topic] || topic), 'user');


    enqueueBotAction((done) => {
      showTyping();

      
      setTimeout(() => {
        hideTyping();
        addMessage(escapeHTML(qa.intro), 'bot');
        renderChips(qa.chips, topic);
        done();
      }, 600 + Math.random() * 400);
    });
  }

  function triggerTopicIntro(topic) {
    const qa = QA[topic];
    if (!qa) return;

    enqueueBotAction((done) => {
      showTyping();

      setTimeout(() => {
        hideTyping();
        addMessage(escapeHTML(qa.intro), 'bot');
        renderChips(qa.chips, topic);
        done();
      }, 700 + Math.random() * 500);
    });
  }

  /* ══════════════════════════════════════════════
     WIDGET-LEVEL EVENT DELEGATION
  ══════════════════════════════════════════════ */

  function onWidgetClick(e) {
    const topicBtn = e.target.closest('.ce-topic-btn');
    if (topicBtn) { handleTopicSelected(topicBtn.dataset.topic, null); return; }

    const inlineBtn = e.target.closest('.ce-inline-btn');
    if (inlineBtn) { handleTopicSelected(inlineBtn.dataset.topic, inlineBtn.closest('.ce-inline-menu')); return; }

    const chip = e.target.closest('.ce-chip');
    if (!chip || chip.classList.contains('used')) return;
    chip.closest('.ce-chips-tray')?.querySelectorAll('.ce-chip').forEach(c => c.classList.add('used'));

    const { action, topic, key, label } = chip.dataset;
    if (action === 'qa') {
      addMessage(escapeHTML(label), 'user');
      const ans = QA[topic]?.answers?.[key];
      if (ans) {
        enqueueBotAction((done) => {
          showTyping();

          setTimeout(() => {
            hideTyping();
            addMessage(escapeHTML(ans), 'bot');
            renderBackToTopicsChip();
            done();
          }, 700 + Math.random() * 500);
        });
      }
    } else if (action === 'back-to-topics') {
      renderInlineTopicMenu();
    }
  }
  widget.addEventListener('click', onWidgetClick);

  function onInlineMenuClick(e) {
    const btn = e.target.closest('.ce-inline-btn');
    if (btn) handleTopicSelected(btn.dataset.topic, ceInlineMenu);
  }
  ceInlineMenu?.addEventListener('click', onInlineMenuClick);

  /* ══════════════════════════════════════════════
     INPUT + SEND
  ══════════════════════════════════════════════ */

  function onInputChange() {
    ceSendBtn.classList.toggle('active', ceInput.value.trim().length > 0);
  }

  function sendMessage() {
    const text = ceInput.value.trim(); 
    if (!text) return;
    
    
    addMessage(escapeHTML(text), 'user');
    ceInput.value = '';
    ceSendBtn.classList.remove('active');

    let matched = false;

    if      (REGEX.pricing.test(text))   { triggerTopicIntro('pricing');   matched = true; }
    else if (REGEX.languages.test(text)) { triggerTopicIntro('languages'); matched = true; }
    else if (REGEX.contact.test(text))   { triggerTopicIntro('contact');   matched = true; }

    if (!matched) {
      const reply = FALLBACK_REPLIES[fallbackIndex++ % FALLBACK_REPLIES.length];

      enqueueBotAction((done) => {
        showTyping();

        setTimeout(() => {
          hideTyping();
          addMessage(escapeHTML(reply), 'bot');
          renderBackToTopicsChip();
          done();
        }, 800 + Math.random() * 600);
      });
    }
  }

  function onSendKeydown(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }

  ceInput.addEventListener('input',   onInputChange);
  ceInput.addEventListener('keydown', onSendKeydown);
  ceSendBtn.addEventListener('click', sendMessage);

  // Single deferred call — DOM and any async icon fonts have time to settle.
  setTimeout(() => refreshIcons(widget), 0);

  /* ══════════════════════════════════════════════
     DESTROY
  ══════════════════════════════════════════════ */

  const onUnload = () => destroy();
  window.addEventListener('beforeunload', onUnload);

  function destroy() {
    window.removeEventListener('beforeunload', onUnload);

    // Reset queue to prevent pending actions
    messageQueue = Promise.resolve();

    // State + scoped styles
    unsubRender();
    state.destroy();
    unscope();

    // Cancel any pending icon refresh
    if (_iconRAF) { cancelAnimationFrame(_iconRAF); _iconRAF = null; }

    // Launcher
    launcherBtn?.removeEventListener('click',  onLauncherClick);
    launcherPill?.removeEventListener('click', openWidget);
    document.removeEventListener('keydown', onDocKeydown);

    // Widget
    widget.removeEventListener('click', onWidgetClick);
    ceInlineMenu?.removeEventListener('click', onInlineMenuClick);

    // Input
    ceInput.removeEventListener('input',   onInputChange);
    ceInput.removeEventListener('keydown', onSendKeydown);
    ceSendBtn.removeEventListener('click', sendMessage);

    // Emoji picker
    if (pScroll)      window.removeEventListener('scroll',      pScroll);
    if (pResize)      window.removeEventListener('resize',      pResize);
    if (pDoc)         document.removeEventListener('click',     pDoc);
    if (pEmojiClick)  picker?.removeEventListener('emoji-click', pEmojiClick);
    if (pickerCreated) {
      picker?.remove();
    }
    picker = null;

    _destroy = null;
  }

  _destroy = destroy;

  return destroy;
}
