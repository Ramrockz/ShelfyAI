// Theme Toggle System

// IMMEDIATE: Apply theme from localStorage before page renders to prevent flash
(function() {
  const savedTheme = localStorage.getItem('shelfy-theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
})();

(function() {
  // Try to load user-specific theme preference from database
  async function loadTheme() {
    try {
      if (typeof supabaseClient !== 'undefined') {
        const { data: { user } } = await supabaseClient.auth.getUser();
        if (user) {
          // Try to load from database
          const { data: settings } = await supabaseClient
            .from('user_settings')
            .select('theme')
            .eq('user_id', user.id)
            .single();
          
          if (settings?.theme) {
            const dbTheme = settings.theme;
            // Update if database theme is different from localStorage
            const localTheme = localStorage.getItem('shelfy-theme');
            if (dbTheme !== localTheme) {
              localStorage.setItem('shelfy-theme', dbTheme);
              document.documentElement.setAttribute('data-theme', dbTheme);
              updateThemeToggle();
            }
          }
          return;
        }
      }
    } catch (error) {
      console.log('User not loaded yet, using cached theme');
    }
    
    // Fallback already handled by immediate script above
  }
  
  loadTheme();
  
  // Update checkbox on load
  window.addEventListener('DOMContentLoaded', () => {
    updateThemeToggle();
  });
})();

async function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme');
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  
  // Add transition class for smooth animation
  document.documentElement.style.transition = 'background 0.4s ease, color 0.4s ease';
  
  document.documentElement.setAttribute('data-theme', newTheme);
  
  // Save to localStorage immediately
  localStorage.setItem('shelfy-theme', newTheme);
  
  // Save to database if logged in
  try {
    if (typeof supabaseClient !== 'undefined') {
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (user) {
        await supabaseClient
          .from('user_settings')
          .update({ theme: newTheme })
          .eq('user_id', user.id);
      }
    }
  } catch (error) {
    console.log('Error saving theme preference:', error);
  }
  
  updateThemeToggle();
  
  // Remove transition after animation completes
  setTimeout(() => {
    document.documentElement.style.transition = '';
  }, 400);
}

function updateThemeToggle() {
  const checkbox = document.getElementById('theme-checkbox');
  if (checkbox) {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    checkbox.checked = currentTheme === 'dark';
  }
}

