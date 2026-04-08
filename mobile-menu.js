// Mobile menu toggle functionality
function toggleMobileMenu() {
  const navLinks = document.getElementById('navLinks');
  const hamburger = document.querySelector('.hamburger');
  if (navLinks && hamburger) {
    navLinks.classList.toggle('active');
    hamburger.classList.toggle('active');
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
