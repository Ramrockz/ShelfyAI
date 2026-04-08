// ShelfyAI Supabase Authentication
// Replace these with your actual Supabase credentials
const SUPABASE_URL = 'https://qakldmfmdlwvehseaksy.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFha2xkbWZtZGx3dmVoc2Vha3N5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg0MzUyNjksImV4cCI6MjA4NDAxMTI2OX0.9lJCzZMUzAUeKEtRTvSpubK6Zp2Pem757IStLd-ZV8E';

// Initialize Supabase client (only if not already initialized)
if (typeof window.supabaseClient === 'undefined') {
  try {
    window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (error) {
    console.error('Failed to initialize Supabase:', error);
    // If Supabase fails to initialize, redirect to login
    if (window.location.pathname.includes('.html') && !window.location.pathname.includes('login.html')) {
      window.location.href = 'login.html';
    }
  }
}

const supabaseClient = window.supabaseClient;

// List of protected pages
const protectedPages = [
  'ingredients.html',
  'ingredient-detail.html',
  'recipes.html',
  'recipe-detail.html',
  'sales.html',
  'expenses.html',
  'expense-detail.html',
  'operations.html',
  'shopping-list.html',
  'orders.html',
  'order-detail.html',
  'settings.html'
];

// Get current page
const currentPage = window.location.pathname.split('/').pop() || window.location.href.split('/').pop().split('?')[0];

console.log('Current page:', currentPage, 'Is protected:', protectedPages.includes(currentPage));

// Logout function
async function logout() {
  // Clear cached user data
  sessionStorage.removeItem('shelfy_user_email');
  sessionStorage.removeItem('shelfy_user_avatar');
  await supabaseClient.auth.signOut();
  window.location.href = 'index.html';
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
    
    // Immediately show cached data for instant load
    const cachedEmail = sessionStorage.getItem('shelfy_user_email');
    const cachedAvatar = sessionStorage.getItem('shelfy_user_avatar');
    
    if (cachedEmail && userEmailElement) {
      userEmailElement.textContent = cachedEmail;
      
      if (userAvatar) {
        if (cachedAvatar && cachedAvatar !== 'null') {
          userAvatar.style.backgroundImage = `url(${cachedAvatar})`;
          userAvatar.style.backgroundSize = 'cover';
          userAvatar.style.backgroundPosition = 'center';
          userAvatar.textContent = '';
        } else {
          userAvatar.style.backgroundImage = '';
          userAvatar.textContent = cachedEmail.charAt(0).toUpperCase();
        }
      }
    }
    
    // Fetch fresh data in background
    const user = await getCurrentUser();

    // Guarantee a profiles row exists so FK constraints on other tables don't fail
    await ensureProfileExists(user);
    
    if (user && userEmailElement) {
      // Update with fresh data
      userEmailElement.textContent = user.email;
      sessionStorage.setItem('shelfy_user_email', user.email);
      
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
    }
  } catch (error) {
    console.error('Error initializing user menu:', error);
  }
}

// Settings function (placeholder)
function openSettings() {
  window.location.href = 'settings.html';
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
      const returnUrl = new URLSearchParams(window.location.search).get('return') || 'operations.html';
      window.location.replace(returnUrl);
    }
  });
})();

// If on a protected page, hide content until auth is verified
if (protectedPages.includes(currentPage)) {
  // Check authentication
  supabaseClient.auth.getSession().then(async ({ data: { session } }) => {
    console.log('Session check result:', session ? 'Authenticated' : 'Not authenticated');
    if (!session) {
      // Not authenticated, redirect to login
      window.location.href = `login.html?return=${currentPage}`;
    } else {
      // Authenticated, initialize user menu first
      await initUserMenu();
      // Then show content
      document.documentElement.style.visibility = 'visible';
    }
  }).catch((error) => {
    console.error('Auth check failed:', error);
    // Error checking auth, redirect to login
    window.location.href = `login.html?return=${currentPage}`;
  });
} else {
  // Not a protected page, show it
  console.log('Not a protected page, showing content');
  document.documentElement.style.visibility = 'visible';
}
