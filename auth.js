// ShelfyAI Supabase Authentication
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

// Check if user is authenticated
async function isAuthenticated() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  return !!session;
}

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
    
    console.log('initUserMenu: Starting...');
    console.log('initUserMenu: userEmailElement exists:', !!userEmailElement);
    console.log('initUserMenu: userAvatar exists:', !!userAvatar);
    
    // Fetch user data
    const user = await getCurrentUser();
    
    console.log('initUserMenu: User data:', user);
    
    if (!user ||!user.email) {
      console.error('No user or user email found in initUserMenu');
      if (userEmailElement) {
        userEmailElement.textContent = 'Not logged in';
      }
      return;
    }

    console.log('initUserMenu: User email:', user.email);

    // Guarantee a profiles row exists so FK constraints on other tables don't fail
    await ensureProfileExists(user);
    
    if (userEmailElement) {
      // Force update with user data - clear first then set
      userEmailElement.textContent = '';
      setTimeout(() => {
        userEmailElement.textContent = user.email;
        console.log('initUserMenu: Email set to:', user.email);
      }, 0);
      sessionStorage.setItem('shelfy_user_email', user.email);
    } else {
      console.error('initUserMenu: userMenuEmail element not found in DOM');
    }
      
    // Load avatar from database
    const { data: settings } = await supabaseClient
      .from('user_settings')
      .select('avatar_url')
      .eq('user_id', user.id)
      .single();
    
    if (userAvatar) {
      if (settings?.avatar_url) {
        // Show avatar image
        userAvatar.style.backgroundImage = `url(${settings.avatar_url})`;
        userAvatar.style.backgroundSize = 'cover';
        userAvatar.style.backgroundPosition = 'center';
        userAvatar.textContent = '';
        sessionStorage.setItem('shelfy_user_avatar', settings.avatar_url);
      } else {
        // Show initial
        userAvatar.style.backgroundImage = '';
        userAvatar.textContent = user.email.charAt(0).toUpperCase();
        sessionStorage.setItem('shelfy_user_avatar', 'null');
      }
    }
    
    console.log('initUserMenu: Completed successfully');
  } catch (error) {
    console.error('Error initializing user menu:', error);
  }
}

// Settings function (placeholder)
function openSettings() {
  window.location.href = '/settings';
}

// Switch account function (placeholder)
async function switchAccount() {
  const modal = document.getElementById('switchAccountModal');
  if (modal) {
    modal.classList.add('active');
  }
  toggleUserMenu();
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
