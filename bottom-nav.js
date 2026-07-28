(function () {
  const pages = [
    {
      href: '/operations', page: 'operations', label: 'Dashboard',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>`
    },
    {
      href: '/ingredients', page: 'ingredients', label: 'Inventory',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73L13 2.27a2 2 0 0 0-2 0L4 6.27A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`
    },
    {
      href: '/recipes', page: 'recipes', label: 'Products',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`
    },
    {
      href: '/orders', page: 'orders', label: 'Orders',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>`
    },
    {
      href: '/settings', page: 'more', label: 'More',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>`
    }
  ];

  const rawPage = window.location.pathname.split('/').pop().replace('.html', '') || 'index';

  // "pricing" and "docs" are shown to both logged-out and logged-in users —
  // give them the app-style bottom nav only when a login is already cached,
  // using the same fast synchronous flag auth.js sets/clears on sign-in/out.
  const alwaysPublicPages = ['index', 'login', 'sandbox', 'blog'];
  const dualAudiencePages = ['pricing', 'docs'];
  const isLikelyLoggedIn = !!localStorage.getItem('shelfy_user_email');
  const isPublicDualAudience = dualAudiencePages.includes(rawPage) && !isLikelyLoggedIn;
  if (alwaysPublicPages.includes(rawPage) || isPublicDualAudience || window.location.pathname === '/') return;
  const parentMap = {
    'ingredient-detail': 'ingredients',
    'recipe-detail': 'recipes',
    'order-detail': 'orders',
    'expense-detail': 'more',
    'expenses': 'more',
    'analytics': 'more',
    'settings': 'more',
    'change-log': 'more'
  };
  const activePage = parentMap[rawPage] || rawPage;

  const pageTitleMap = {
    'operations': 'Dashboard',
    'ingredients': 'Inventory',
    'ingredient-detail': 'Inventory',
    'recipes': 'Products',
    'recipe-detail': 'Product',
    'orders': 'Orders',
    'order-detail': 'Order',
    'expenses': 'Expenses',
    'expense-detail': 'Expense',
    'analytics': 'Analytics',
    'settings': 'Settings',
    'change-log': 'Change Logs',
    'docs': 'Quick Start',
    'pricing': 'Pricing'
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
    /* Hidden by default — only meant for the mobile header (below); without
       this it renders as a stray flex child of .navbar on desktop too,
       colliding with the logo and nav-links. */
    .mobile-page-title { display: none; }
    /* Hidden by default — its real (circular, transparent) styling only
       exists inside the mobile media query below; without this base rule
       it falls back to a bare unstyled browser <button> on desktop. */
    .nav-search-toggle { display: none; }
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

      /* ---------- Mobile header: title left, compact action cluster right ---------- */
      .navbar {
        position: relative;
        padding: env(safe-area-inset-top, 0px) 16px 0 !important;
        min-height: calc(52px + env(safe-area-inset-top, 0px)) !important;
      }
      .navbar .nav-links,
      .navbar .hamburger,
      .navbar .theme-toggle-wrapper,
      .navbar .logo {
        display: none !important;
      }
      .mobile-page-title {
        display: block;
        font-size: 17px;
        font-weight: 700;
        color: var(--text-main, #f1f5f9);
        letter-spacing: -0.01em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0;
        flex-shrink: 1;
      }
      .navbar .nav-actions {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
      }
      .nav-search-toggle {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: transparent;
        border: none;
        color: var(--text-main, #f1f5f9);
        cursor: pointer;
        flex-shrink: 0;
        -webkit-tap-highlight-color: transparent;
      }
      .nav-search-toggle svg {
        width: 20px;
        height: 20px;
      }
      .navbar .nav-actions .search-wrapper {
        display: none;
      }
      /* Search active: title and other actions hide, input takes over the row */
      .navbar.mobile-search-active .mobile-page-title,
      .navbar.mobile-search-active .notification-bell,
      .navbar.mobile-search-active .user-menu {
        display: none !important;
      }
      .navbar.mobile-search-active .nav-actions {
        flex: 1;
        margin-left: 0;
      }
      .navbar.mobile-search-active .nav-actions .search-wrapper {
        display: block;
        flex: 1;
        min-width: 0;
        position: relative;
      }
      .navbar.mobile-search-active .nav-search-input {
        display: block;
        width: 100%;
        margin: 0;
        background: var(--bg-inner);
        border: none;
        border-radius: 8px;
        padding: 7px 32px 7px 32px !important;
        font-size: 14px;
        color: var(--text-main);
        font-family: inherit;
        outline: none;
        box-sizing: border-box;
      }
      .navbar.mobile-search-active .nav-actions .search-icon {
        position: absolute;
        left: 10px;
        top: 50%;
        transform: translateY(-50%);
        width: 16px;
        height: 16px;
        color: var(--text-muted);
        pointer-events: none;
        z-index: 10;
      }
      .navbar.mobile-search-active .nav-actions .search-clear {
        position: absolute;
        right: 6px;
        top: 50%;
        transform: translateY(-50%);
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: transparent;
        border: none;
        color: var(--text-muted);
        cursor: pointer;
        display: none;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        line-height: 1;
        padding: 0;
        z-index: 10;
      }
      .navbar.mobile-search-active .nav-actions .search-clear.visible {
        display: flex;
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

    // Mobile page title — replaces the logo, which is hidden on mobile
    const navbar = document.querySelector('.navbar');
    if (navbar && pageTitle) {
      const titleEl = document.createElement('div');
      titleEl.className = 'mobile-page-title';
      titleEl.textContent = pageTitle;
      navbar.insertBefore(titleEl, navbar.firstChild);
    }

    // Collapsible mobile search — only on pages that already have a
    // nav-actions search box (ingredients/orders/recipes/expenses).
    // Collapsed by default so it doesn't compete with the title and the
    // notification/avatar icons for space; expands to fill the header on tap.
    const searchWrapper = navbar?.querySelector('.nav-actions .search-wrapper');
    if (navbar && searchWrapper) {
      const SEARCH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
      const CLOSE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'nav-search-toggle';
      toggleBtn.setAttribute('aria-label', 'Search');
      toggleBtn.innerHTML = SEARCH_ICON;
      searchWrapper.parentNode.insertBefore(toggleBtn, searchWrapper);

      toggleBtn.addEventListener('click', () => {
        const active = navbar.classList.toggle('mobile-search-active');
        toggleBtn.innerHTML = active ? CLOSE_ICON : SEARCH_ICON;
        const input = searchWrapper.querySelector('.nav-search-input');
        if (active) {
          setTimeout(() => input?.focus(), 50);
        } else if (input && input.value) {
          input.value = '';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
    }

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
