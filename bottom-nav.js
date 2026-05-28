(function () {
  const pages = [
    {
      href: '/operations', page: 'operations', label: 'Dashboard',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>`
    },
    {
      href: '/ingredients', page: 'ingredients', label: 'Ingredients',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73L13 2.27a2 2 0 0 0-2 0L4 6.27A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`
    },
    {
      href: '/recipes', page: 'recipes', label: 'Recipes',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`
    },
    {
      href: '/orders', page: 'orders', label: 'Orders',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>`
    },
    {
      href: '/expenses', page: 'expenses', label: 'Expenses',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>`
    },
    {
      href: '/analytics', page: 'analytics', label: 'Analytics',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`
    }
  ];

  const rawPage = window.location.pathname.split('/').pop().replace('.html', '') || 'index';

  const publicPages = ['index', 'login', 'pricing', 'docs', 'faq', 'sandbox', 'blog'];
  if (publicPages.includes(rawPage) || window.location.pathname === '/') return;
  const parentMap = {
    'ingredient-detail': 'ingredients',
    'recipe-detail': 'recipes',
    'order-detail': 'orders',
    'expense-detail': 'expenses'
  };
  const activePage = parentMap[rawPage] || rawPage;

  const pageTitleMap = {
    'operations': 'Dashboard',
    'ingredients': 'Ingredients',
    'ingredient-detail': 'Ingredient',
    'recipes': 'Recipes',
    'recipe-detail': 'Recipe',
    'orders': 'Orders',
    'order-detail': 'Order',
    'expenses': 'Expenses',
    'expense-detail': 'Expense',
    'analytics': 'Analytics',
    'settings': 'Settings'
  };
  const pageTitle = pageTitleMap[rawPage] || '';

  const nav = document.createElement('nav');
  nav.id = 'bottom-nav';
  nav.innerHTML = pages.map(p => `
    <a href="${p.href}" class="bn-item${activePage === p.page ? ' active' : ''}">
      ${p.icon}
      <span>${p.label}</span>
    </a>
  `).join('');

  const style = document.createElement('style');
  style.textContent = `
    /* App-feel globals */
    * {
      -webkit-tap-highlight-color: transparent;
    }
    input, textarea, select, [contenteditable] {
      -webkit-user-select: text !important;
      user-select: text !important;
    }

    #bottom-nav { display: none; }
    @media (max-width: 768px) {
      body {
        -webkit-user-select: none;
        user-select: none;
        -webkit-overflow-scrolling: touch;
      }
      input, textarea, select, [contenteditable] {
        -webkit-user-select: text !important;
        user-select: text !important;
      }
      button:active, .btn:active, .view-btn:active, .card-small:active {
        opacity: 0.6;
        transition: opacity 0.05s;
      }
      #bottom-nav {
        display: flex;
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        height: 60px;
        background: var(--bg-panel, #1e1e2e);
        border-top: 1px solid var(--border, rgba(255,255,255,0.08));
        z-index: 9000;
        padding-bottom: env(safe-area-inset-bottom, 0px);
      }
      .bn-item {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 3px;
        color: var(--text-muted, #6b7280);
        text-decoration: none;
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.02em;
        transition: color 0.15s;
        -webkit-tap-highlight-color: transparent;
      }
      .bn-item svg {
        width: 22px;
        height: 22px;
        flex-shrink: 0;
      }
      .bn-item.active {
        color: var(--accent, #06b6d4);
      }
      body {
        padding-bottom: calc(60px + env(safe-area-inset-bottom, 0px)) !important;
      }
      footer {
        display: none !important;
      }
      .navbar {
        padding: env(safe-area-inset-top, 0px) 16px 0 !important;
        min-height: calc(52px + env(safe-area-inset-top, 0px)) !important;
      }
      .navbar .nav-links,
      .navbar .hamburger,
      .navbar .theme-toggle-wrapper {
        display: none !important;
      }
      .navbar .nav-actions {
        margin-left: auto;
      }
      .navbar {
        position: relative;
      }
      .mobile-page-title {
        position: absolute;
        left: 50%;
        transform: translateX(-50%);
        font-size: 16px;
        font-weight: 700;
        color: var(--text-main, #f1f5f9);
        white-space: nowrap;
        pointer-events: none;
        letter-spacing: -0.01em;
      }
      .breadcrumb {
        display: none !important;
      }
      .fab {
        bottom: calc(60px + env(safe-area-inset-bottom, 0px) + 16px) !important;
      }
    }
  `;

  document.head.appendChild(style);
  const overlay = document.createElement('div');
  overlay.id = 'rotate-overlay';
  overlay.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:48px;height:48px;margin-bottom:16px;opacity:0.6;">
      <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3"/>
    </svg>
    <p style="margin:0;font-size:16px;font-weight:600;">Please rotate your device</p>
    <p style="margin:8px 0 0;font-size:13px;opacity:0.6;">This app works in portrait mode only</p>
  `;
  Object.assign(overlay.style, {
    display: 'none', position: 'fixed', inset: '0', zIndex: '99999',
    background: 'var(--bg-main, #0f172a)', color: 'var(--text-main, #f1f5f9)',
    flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    textAlign: 'center', padding: '40px'
  });

  document.addEventListener('DOMContentLoaded', () => {
    document.body.appendChild(nav);
    document.body.appendChild(overlay);

    // Lock to portrait when supported (works in PWA/fullscreen mode)
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('portrait').catch(() => {});
    }

    // JS-based portrait enforcement using orientation APIs (not viewport pixels)
    const isMobileDevice = navigator.maxTouchPoints > 0 && window.screen.width <= 1024;

    function isLandscapeOrientation() {
      if (screen.orientation && screen.orientation.type) {
        return screen.orientation.type.startsWith('landscape');
      }
      if (typeof window.orientation !== 'undefined') {
        return Math.abs(window.orientation) === 90;
      }
      return false;
    }

    function enforcePortrait() {
      if (!isMobileDevice) return;
      if (isLandscapeOrientation()) {
        overlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';
      } else {
        overlay.style.display = 'none';
        document.body.style.overflow = '';
      }
    }

    window.addEventListener('orientationchange', () => setTimeout(enforcePortrait, 100));
    if (screen.orientation) {
      screen.orientation.addEventListener('change', () => setTimeout(enforcePortrait, 100));
    }
    enforcePortrait();
  });
})();
