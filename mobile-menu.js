// Haptic feedback utility (Web Vibration API — works on Android, silent on iOS)
function haptic(type) {
  if (!navigator.vibrate) return;
  const patterns = {
    light:   [30],
    medium:  [50],
    heavy:   [80],
    success: [10, 60, 10],
    error:   [60, 50, 60],
  };
  navigator.vibrate(patterns[type] || patterns.light);
}

// Auto-haptic on all interactive elements (light tap)
// document.addEventListener('click', function(e) {
//   if (e.target.closest('button, .btn, .fab, [role="button"], .bottom-nav-item, .view-btn, .tab-btn, .filter-trigger')) {
//     haptic('light');
//   }
// }, { passive: true });

// Mobile menu toggle functionality
function toggleMobileMenu() {
  const navLinks = document.getElementById('navLinks');
  const hamburger = document.querySelector('.hamburger');
  if (navLinks && hamburger) {
    navLinks.classList.toggle('active');
    hamburger.classList.toggle('active');
    // haptic('medium');
  }
}

// Close mobile menu when clicking on a link
document.addEventListener('DOMContentLoaded', function() {
  const navLinks = document.querySelectorAll('.nav-links a');
  navLinks.forEach(link => {
    link.addEventListener('click', function() {
      const navLinksEl = document.getElementById('navLinks');
      const hamburger = document.querySelector('.hamburger');
      if (navLinksEl && hamburger && navLinksEl.classList.contains('active')) {
        navLinksEl.classList.remove('active');
        hamburger.classList.remove('active');
      }
    });
  });
  
  // Close mobile menu when clicking outside
  document.addEventListener('click', function(event) {
    const navbar = document.querySelector('.navbar');
    const navLinksEl = document.getElementById('navLinks');
    const hamburger = document.querySelector('.hamburger');

    if (navLinksEl && hamburger &&
        navLinksEl.classList.contains('active') &&
        navbar &&
        !navbar.contains(event.target)) {
      navLinksEl.classList.remove('active');
      hamburger.classList.remove('active');
    }
  });
});
