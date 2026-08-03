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

// ---------- Swipe-down-to-close for .modal-sheet bottom sheets ----------
// Generic, works on every .modal-overlay.modal-sheet in the app (import
// sheets, category pickers, field-edit sheets, the Create-flow sheets,
// etc.) rather than each one wiring up its own gesture. Only arms once the
// gesture is confirmed vertical-downward and the touch didn't start inside
// content that's mid-scroll, so it doesn't fight normal scrolling.
(function () {
  let startX = 0, startY = 0, currentY = 0, startTime = 0;
  let dragging = false, tracking = false;
  let sheetEl = null, contentEl = null, startTarget = null;
  const CLOSE_PX = 100;
  const FLICK_VELOCITY = 0.5; // px/ms

  function getContent(overlay) {
    return overlay.querySelector('.modal-content, .modal-content-custom');
  }
  function scrollableAncestor(el, stopAt) {
    while (el && el !== stopAt && el !== document.body) {
      if (el.scrollHeight > el.clientHeight + 1) return el;
      el = el.parentElement;
    }
    return null;
  }
  function reset() {
    if (contentEl) {
      contentEl.style.removeProperty('transition');
      contentEl.style.removeProperty('transform');
    }
    tracking = false; dragging = false; sheetEl = null; contentEl = null; startTarget = null;
  }

  document.addEventListener('touchstart', function (e) {
    const overlay = e.target.closest('.modal-overlay.modal-sheet.active');
    if (!overlay || e.touches.length !== 1) { reset(); return; }
    const content = getContent(overlay);
    if (!content) { reset(); return; }
    sheetEl = overlay; contentEl = content; startTarget = e.target;
    startX = e.touches[0].clientX; startY = e.touches[0].clientY;
    currentY = startY; startTime = Date.now();
    tracking = true; dragging = false;
  }, { passive: true });

  document.addEventListener('touchmove', function (e) {
    if (!tracking || !contentEl) return;
    const x = e.touches[0].clientX, y = e.touches[0].clientY;
    const dx = x - startX, dy = y - startY;
    if (!dragging) {
      if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return; // not enough movement to decide yet
      if (Math.abs(dx) > Math.abs(dy) || dy < 0) { reset(); return; } // horizontal or upward — not this gesture
      const scrollEl = scrollableAncestor(startTarget, contentEl);
      if (scrollEl && scrollEl.scrollTop > 0) { reset(); return; } // let the content scroll instead
      dragging = true;
      contentEl.style.setProperty('transition', 'none', 'important');
    }
    currentY = y;
    const delta = Math.max(0, currentY - startY);
    contentEl.style.setProperty('transform', 'translateY(' + delta + 'px)', 'important');
    e.preventDefault();
  }, { passive: false });

  document.addEventListener('touchend', function () {
    if (dragging && contentEl && sheetEl) {
      const delta = Math.max(0, currentY - startY);
      const elapsed = Math.max(1, Date.now() - startTime);
      const velocity = delta / elapsed;
      const sheet = sheetEl;
      reset();
      if (delta > CLOSE_PX || velocity > FLICK_VELOCITY) sheet.classList.remove('active');
    } else {
      reset();
    }
  }, { passive: true });

  document.addEventListener('touchcancel', reset, { passive: true });
})();
