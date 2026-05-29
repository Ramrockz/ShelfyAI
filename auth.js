// ShelfyAI Supabase Authentication
// Eagerly hydrate store from localStorage so it's available synchronously
// before any async auth/store setup has a chance to run.
window.currentStoreId   = localStorage.getItem('shelfy_store_id')   || null;
window.currentStoreName = localStorage.getItem('shelfy_store_name') || null;

// Replace these with your actual Supabase credentials
const SUPABASE_URL = 'https://qakldmfmdlwvehseaksy.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFha2xkbWZtZGx3dmVoc2Vha3N5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg0MzUyNjksImV4cCI6MjA4NDAxMTI2OX0.9lJCzZMUzAUeKEtRTvSpubK6Zp2Pem757IStLd-ZV8E';

// Initialize Supabase client (only if not already initialized)
if (typeof window.supabaseClient === 'undefined') {
  try {
    window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: window.localStorage
      }
    });
  } catch (error) {
    console.error('Failed to initialize Supabase:', error);
    // If Supabase fails to initialize, redirect to login
    if (!window.location.pathname.includes('/login') && window.location.pathname !== '/') {
      window.location.href = '/login';
    }
  }
}

const supabaseClient = window.supabaseClient;

// List of protected pages (without .html extension to match clean URLs)
const protectedPages = [
  'ingredients',
  'ingredient-detail',
  'recipes',
  'recipe-detail',
  'sales',
  'expenses',
  'expense-detail',
  'operations',
  'shopping-list',
  'orders',
  'order-detail',
  'analytics',
  'settings'
];

// Get current page (handle both clean URLs and .html URLs)
let currentPage = window.location.pathname.split('/').pop() || window.location.href.split('/').pop().split('?')[0];
// Remove .html extension if present
currentPage = currentPage.replace('.html', '');

console.log('Current page:', currentPage, 'Is protected:', protectedPages.includes(currentPage));

// Logout function
async function logout() {
  try {
    // Clear all cached user data
    sessionStorage.clear();
    localStorage.removeItem('shelfy_user_email');
    localStorage.removeItem('shelfy_user_avatar');
    localStorage.removeItem('shelfy_store_id');
    localStorage.removeItem('shelfy_store_name');
    window.currentStoreId   = null;
    window.currentStoreName = null;
    
    // Sign out from Supabase (this clears the session from localStorage)
    await supabaseClient.auth.signOut();
    
    // Broadcast logout event to other tabs/windows
    const channel = new BroadcastChannel('shelfy_auth');
    channel.postMessage({ type: 'logout' });
    channel.close();
    
    // Clear service worker cache to prevent serving cached protected pages
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map(name => caches.delete(name)));
    }
    
    // Force reload to clear any in-memory state
    window.location.replace('/');
  } catch (error) {
    console.error('Logout error:', error);
    // Even if there's an error, still redirect
    window.location.replace('/');
  }
}

// Get current user
async function getCurrentUser() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  return user;
}

// Ensure a row exists in the public.profiles table for this user.
// The ingredients (and other) tables have a FK on profile_id → profiles.id,
// so this must exist before any insert.
async function ensureProfileExists(user) {
  if (!user) return;
  try {
    const { error } = await supabaseClient
      .from('profiles')
      .upsert(
        { id: user.id, name: user.email.split('@')[0], role: 'user' },
        { onConflict: 'id', ignoreDuplicates: true }
      );
    if (error) console.error('ensureProfileExists error:', error);
  } catch (err) {
    console.error('ensureProfileExists exception:', err);
  }
}

// Track which user we last validated stores for so we don't re-fetch on every call
let _storeValidatedForUser = null;

// Ensures the user has at least one store; sets window.currentStoreId / window.currentStoreName
async function ensureStoreExists(user) {
  if (!user) return;
  // Skip only if we already validated for THIS specific user
  if (_storeValidatedForUser === user.id && window.currentStoreId) return;
  try {
    const { data: stores } = await supabaseClient
      .from('stores')
      .select('id, name')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: true });

    let list = stores || [];

    // Auto-create default store on first login
    if (list.length === 0) {
      const defaultName = (user.email.split('@')[0] || 'My') + "'s Store";
      const { data: created } = await supabaseClient
        .from('stores')
        .insert({ owner_id: user.id, name: defaultName })
        .select('id, name')
        .single();
      if (created) list = [created];
    }

    // Validate saved store — if it belongs to a different account, clear it
    const savedId = localStorage.getItem('shelfy_store_id');
    const valid = savedId ? list.find(s => s.id === savedId) : null;
    if (savedId && !valid) {
      // Stale store from a different account — discard it
      localStorage.removeItem('shelfy_store_id');
      localStorage.removeItem('shelfy_store_name');
      window.currentStoreId   = null;
      window.currentStoreName = null;
    }
    const active = valid || list[0];

    if (active) {
      localStorage.setItem('shelfy_store_id', active.id);
      localStorage.setItem('shelfy_store_name', active.name);
      window.currentStoreId   = active.id;
      window.currentStoreName = active.name;
    }
    _storeValidatedForUser = user.id;
  } catch (err) {
    console.error('ensureStoreExists error:', err);
    // Fallback: use whatever is in localStorage
    window.currentStoreId   = localStorage.getItem('shelfy_store_id') || null;
    window.currentStoreName = localStorage.getItem('shelfy_store_name') || null;
  }
}

// Convenience getter — safe to call before ensureStoreExists resolves
function getStoreId() {
  return window.currentStoreId || localStorage.getItem('shelfy_store_id');
}

// Check if user is authenticated
async function isAuthenticated() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  return !!session;
}

// Safely apply an avatar URL: shows the initial letter immediately, then replaces
// it with the image only after the image confirms it loaded. Falls back to the
// letter (and busts the cache) if the URL is broken.
function applyAvatarUrl(avatarEl, url, fallbackLetter) {
  if (!avatarEl) return;
  // Always show the letter first so there's never an empty circle
  avatarEl.style.backgroundImage = '';
  avatarEl.style.backgroundSize = '';
  avatarEl.style.backgroundPosition = '';
  avatarEl.textContent = fallbackLetter;
  if (!url || url === 'null') return;
  const img = new Image();
  img.onload = () => {
    avatarEl.style.backgroundImage = `url(${url})`;
    avatarEl.style.backgroundSize = 'cover';
    avatarEl.style.backgroundPosition = 'center';
    avatarEl.textContent = '';
  };
  img.onerror = () => {
    try { sessionStorage.setItem('shelfy_user_avatar', 'null'); } catch (e) {}
  };
  img.src = url;
}

// On every page load, re-validate the inline-cache avatar so a stale/broken URL
// never leaves an empty circle (inline scripts run before this DOMContentLoaded).
document.addEventListener('DOMContentLoaded', () => {
  const avatarEl = document.getElementById('userAvatar');
  const emailEl  = document.getElementById('userMenuEmail');
  const roleEl   = document.querySelector('.user-menu-role');
  const cachedEmail  = sessionStorage.getItem('shelfy_user_email');
  const cachedAvatar = sessionStorage.getItem('shelfy_user_avatar');
  const cachedTier   = sessionStorage.getItem('shelfy_user_tier');
  if (cachedEmail && emailEl) emailEl.textContent = cachedEmail;
  if (cachedTier && roleEl) roleEl.textContent = cachedTier;
  if (avatarEl && cachedAvatar && cachedAvatar !== 'null' && cachedEmail) {
    applyAvatarUrl(avatarEl, cachedAvatar, cachedEmail.charAt(0).toUpperCase());
  }
});

// User menu functions
function toggleUserMenu() {
  const button = document.getElementById('userMenuButton');
  const dropdown = document.getElementById('userMenuDropdown');
  
  if (button && dropdown) {
    button.classList.toggle('active');
    dropdown.classList.toggle('active');
  }
}

// Close user menu when clicking outside
document.addEventListener('click', (e) => {
  const userMenu = document.querySelector('.user-menu');
  const dropdown = document.getElementById('userMenuDropdown');
  
  if (userMenu && dropdown && !userMenu.contains(e.target)) {
    document.getElementById('userMenuButton')?.classList.remove('active');
    dropdown.classList.remove('active');
  }
});

// Initialize user menu with user email and avatar
async function initUserMenu() {
  try {
    const userEmailElement = document.getElementById('userMenuEmail');
    const userAvatar = document.getElementById('userAvatar');

    // getSession() reads from localStorage — no network needed, works immediately
    // after OAuth redirect. getUser() requires a network round-trip and can fail
    // or time out on the first page load after sign-in.
    const { data: { session } } = await supabaseClient.auth.getSession();
    const user = session?.user;

    if (!user?.email) {
      if (userEmailElement) userEmailElement.textContent = 'Not logged in';
      return;
    }

    // Cache email unconditionally — DOM may not be ready yet if auth.js ran in <head>
    sessionStorage.setItem('shelfy_user_email', user.email);
    if (userEmailElement) {
      userEmailElement.textContent = user.email;
    }
    // Show initial letter right away as a safe fallback
    if (userAvatar) {
      userAvatar.textContent = user.email.charAt(0).toUpperCase();
      userAvatar.style.backgroundImage = '';
    }

    // Guarantee a profiles row exists so FK constraints on other tables don't fail
    await ensureProfileExists(user);

    // Ensure the user has a store and set window.currentStoreId / window.currentStoreName
    await ensureStoreExists(user);

    // Load avatar and tier from database
    const { data: settings } = await supabaseClient
      .from('user_settings')
      .select('avatar_url, tier')
      .eq('user_id', user.id)
      .single();

    const tierLabels = { free: 'Free Plan', starter: 'Starter Plan', pro: 'Pro Plan' };
    const tierLabel = tierLabels[settings?.tier] || 'Free Plan';
    const roleEl = document.querySelector('.user-menu-role');
    if (roleEl) roleEl.textContent = tierLabel;
    sessionStorage.setItem('shelfy_user_tier', tierLabel);

    const avatarUrl = settings?.avatar_url || null;
    try { sessionStorage.setItem('shelfy_user_avatar', avatarUrl || 'null'); } catch (e) {}
    applyAvatarUrl(userAvatar, avatarUrl, user.email.charAt(0).toUpperCase());

    // Show active store name in menu header and nav
    if (window.currentStoreName) {
      // User menu: insert store name below the role line
      const menuHeader = document.querySelector('.user-menu-header');
      if (menuHeader && !document.getElementById('userMenuStore')) {
        const div = document.createElement('div');
        div.id = 'userMenuStore';
        div.style.cssText = 'font-size:11px;color:var(--text-muted);margin-top:2px;';
        div.textContent = window.currentStoreName;
        menuHeader.appendChild(div);
      }
    }

    // Relabel "Switch Account" → "Switch Store" and inject "Switch Accounts" below it
    document.querySelectorAll('.user-menu-item').forEach(item => {
      if (item.getAttribute('onclick')?.includes('switchAccount')) {
        const span = item.querySelector('span');
        if (span && (span.textContent.trim() === 'Switch Account' || span.textContent.trim() === 'Switch Store')) {
          span.textContent = 'Switch Store';
          // Replace the Switch Store SVG with a building/store icon
          const existingSvg = item.querySelector('svg');
          if (existingSvg) {
            existingSvg.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline stroke-linecap="round" stroke-linejoin="round" stroke-width="2" points="9 22 9 12 15 12 15 22"/>';
            existingSvg.setAttribute('viewBox', '0 0 24 24');
          }
          // Insert "Switch Accounts" sibling with the original arrows icon
          if (!item.nextElementSibling || !item.nextElementSibling.dataset.switchAccounts) {
            const sibling = document.createElement('div');
            sibling.className = 'user-menu-item';
            sibling.dataset.switchAccounts = '1';
            sibling.setAttribute('onclick', "toggleUserMenu();const m=document.getElementById('switchAccountModal');if(m)m.classList.add('active');");
            sibling.innerHTML = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"></path></svg><span>Switch Accounts</span>`;
            item.parentNode.insertBefore(sibling, item.nextSibling);
          }
        }
      }
    });

    console.log('initUserMenu: Completed successfully');
  } catch (error) {
    console.error('Error initializing user menu:', error);
  }
}

// Settings function (placeholder)
function openSettings() {
  window.location.href = '/settings';
}

// Switch account / store — opens store switcher if available, falls back to account modal
async function switchAccount() {
  toggleUserMenu();
  if (typeof openStoreModal === 'function') {
    openStoreModal();
  } else {
    const modal = document.getElementById('switchAccountModal');
    if (modal) modal.classList.add('active');
  }
}

// Handle OAuth / magic-link callback: Supabase puts #access_token=... in the hash.
// Detect this on any page and exchange it for a session, then redirect to the app.
(function handleAuthCallback() {
  if (!window.location.hash.includes('access_token=')) return;

  // Let Supabase JS client parse the hash and establish the session
  supabaseClient.auth.getSession().then(async ({ data: { session } }) => {
    if (session) {
      // Ensure profile row exists for the newly authenticated user
      await ensureProfileExists(session.user);
      // Redirect to the app (preserve any ?return= param if present)
      const returnUrl = new URLSearchParams(window.location.search).get('return') || '/operations';
      window.location.replace(returnUrl);
    }
  });
})();

// Listen for logout events from other tabs/windows
const authChannel = new BroadcastChannel('shelfy_auth');
authChannel.onmessage = (event) => {
  if (event.data.type === 'logout') {
    // Another tab logged out, clean up and redirect
    sessionStorage.clear();
    window.location.replace('/');
  }
};

// Listen for Supabase auth state changes (handles cross-tab logout)
supabaseClient.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT') {
    // User signed out, redirect to home if on protected page
    if (protectedPages.includes(currentPage)) {
      sessionStorage.clear();
      window.location.replace('/');
    }
  }
});

// If on a protected page, hide content until auth is verified
if (protectedPages.includes(currentPage)) {
  // Safety fallback: always show page after 3 seconds to prevent permanent blank screen
  setTimeout(() => {
    if (document.documentElement.style.visibility === 'hidden') {
      console.warn('Forcing page visibility after timeout');
      document.documentElement.style.visibility = 'visible';
    }
  }, 3000);
  // Check if this is an OAuth callback (hash contains access_token)
  const isOAuthCallback = window.location.hash.includes('access_token=');
  
  if (isOAuthCallback) {
    // OAuth callback - wait for session to be established from hash parameters
    console.log('OAuth callback detected, waiting for session establishment...');
    
    // Give Supabase time to process the hash and establish the session
    setTimeout(async () => {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (session && session.user) {
        console.log('OAuth session established for user:', session.user.email);
        await ensureProfileExists(session.user);
        await initUserMenu();
        document.documentElement.style.visibility = 'visible';
        // Clear the hash from URL for cleaner appearance
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      } else {
        // Session establishment failed
        console.error('OAuth callback failed to establish session');
        window.location.replace(`/login?return=${currentPage}`);
      }
    }, 1500); // Wait 1.5 seconds for session to be processed from hash
  } else {
    // Not an OAuth callback - do normal auth check
    // Supabase v2 stores session in localStorage with key format: sb-{project-ref}-auth-token
    const hasSessionData = localStorage.getItem('sb-qakldmfmdlwvehseaksy-auth-token');
    
    if (!hasSessionData) {
      // No session data at all, immediately redirect (prevents flash)
      window.location.replace(`/login?return=${currentPage}`);
    } else {
      // Session data exists, verify it's valid
      supabaseClient.auth.getSession().then(async ({ data: { session } }) => {
        console.log('Session check result:', session ? 'Authenticated' : 'Not authenticated');
        if (!session) {
          // Not authenticated, redirect to login (use replace to prevent back button)
          window.location.replace(`/login?return=${currentPage}`);
        } else {
          // Authenticated, initialize user menu first
          await initUserMenu();
          // Then show content
          document.documentElement.style.visibility = 'visible';
          
          // Periodically validate session (every 30 seconds)
          // This helps catch session expiry and cross-device logouts
          setInterval(async () => {
            const { data: { session: currentSession } } = await supabaseClient.auth.getSession();
            if (!currentSession) {
              // Session expired or user logged out elsewhere
              sessionStorage.clear();
              window.location.replace('/login?return=' + currentPage);
            }
          }, 30000); // Check every 30 seconds
        }
      }).catch((error) => {
        console.error('Auth check failed:', error);
        // Error checking auth, redirect to login (use replace to prevent back button)
        window.location.replace(`/login?return=${currentPage}`);
      });
    }
  }
} else {
  // Not a protected page, show it
  console.log('Not a protected page, showing content');
  document.documentElement.style.visibility = 'visible';
}

// Fix footer layout on mobile - override inline styles
function fixFooterOnMobile() {
  if (window.innerWidth <= 768) {
    const footerGrid = document.querySelector('.footer-grid');
    if (footerGrid) {
      footerGrid.style.gridTemplateColumns = 'repeat(3, 1fr)';
      footerGrid.style.gap = '10px';
    }
  }
}
// Run on load and resize
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', fixFooterOnMobile);
} else {
  fixFooterOnMobile();
}
window.addEventListener('resize', fixFooterOnMobile);
