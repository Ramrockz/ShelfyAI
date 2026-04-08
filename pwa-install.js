(function () {
  // Don't show if already running as installed PWA
  if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) return;

  var deferredPrompt = null;
  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  var isAndroid = /android/i.test(navigator.userAgent);

  if (!isIOS && !isAndroid) return; // desktop already handled by browser chrome

  // --- Inject banner styles ---
  var style = document.createElement('style');
  style.textContent = [
    '#pwa-banner{position:fixed;bottom:0;left:0;right:0;z-index:99999;',
    'background:var(--bg-panel,#fff);border-top:1px solid var(--border,#e2e8f0);',
    'padding:14px 16px;display:flex;align-items:center;gap:12px;',
    'box-shadow:0 -4px 20px rgba(0,0,0,0.10);animation:slideUp .3s ease;}',
    '@keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}',
    '#pwa-banner img{width:44px;height:44px;border-radius:10px;flex-shrink:0;}',
    '#pwa-banner .pwa-text{flex:1;min-width:0;}',
    '#pwa-banner .pwa-title{font-weight:700;font-size:14px;color:var(--text-main,#0f172a);line-height:1.3;}',
    '#pwa-banner .pwa-sub{font-size:12px;color:var(--text-muted,#64748b);margin-top:2px;}',
    '#pwa-banner .pwa-install-btn{background:var(--accent,#06b6d4);color:#fff;border:none;',
    'border-radius:8px;padding:9px 16px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;flex-shrink:0;}',
    '#pwa-banner .pwa-close{background:none;border:none;color:var(--text-muted,#64748b);',
    'font-size:20px;cursor:pointer;padding:4px;line-height:1;flex-shrink:0;}'
  ].join('');
  document.head.appendChild(style);

  function createBanner(subtitle, buttonText, onInstall) {
    var banner = document.createElement('div');
    banner.id = 'pwa-banner';
    banner.innerHTML =
      '<img src="/favicon.png" alt="ShelfyAI">' +
      '<div class="pwa-text">' +
        '<div class="pwa-title">Install ShelfyAI</div>' +
        '<div class="pwa-sub">' + subtitle + '</div>' +
      '</div>' +
      '<button class="pwa-install-btn">' + buttonText + '</button>' +
      '<button class="pwa-close" aria-label="Dismiss">&times;</button>';

    banner.querySelector('.pwa-install-btn').addEventListener('click', onInstall);
    banner.querySelector('.pwa-close').addEventListener('click', function () {
      banner.remove();
      sessionStorage.setItem('pwa-banner-dismissed', '1');
    });
    return banner;
  }

  if (sessionStorage.getItem('pwa-banner-dismissed')) return;

  if (isAndroid) {
    // Android: wait for the browser's beforeinstallprompt event
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredPrompt = e;

      var banner = createBanner('Add to your home screen for the best experience.', 'Install', function () {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(function () {
          deferredPrompt = null;
          document.getElementById('pwa-banner') && document.getElementById('pwa-banner').remove();
        });
      });

      document.body.appendChild(banner);
    });
  } else if (isIOS) {
    // iOS: show manual instructions (no API available)
    window.addEventListener('DOMContentLoaded', function () {
      var banner = createBanner(
        'Tap \u{1F4E4} Share → "Add to Home Screen"',
        'How?',
        function () {
          // Show the subtitle more prominently
          var sub = document.querySelector('#pwa-banner .pwa-sub');
          if (sub) { sub.style.fontWeight = '700'; sub.style.color = 'var(--accent,#06b6d4)'; }
        }
      );
      document.body.appendChild(banner);
    });
  }
})();
