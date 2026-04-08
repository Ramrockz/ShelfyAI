(function () {
  const CONSENT_COOKIE = 'shelfy_cookie_consent';
  const CONSENT_TTL_DAYS = 180;

  function buildCookieValue(value) {
    return encodeURIComponent(value);
  }

  function parseCookieValue(value) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  function setCookie(name, value, days, options) {
    const settings = options || {};
    const maxAgeSeconds = Math.floor(days * 24 * 60 * 60);
    let cookie = `${name}=${buildCookieValue(value)}; path=/; max-age=${maxAgeSeconds}; SameSite=${settings.sameSite || 'Lax'}`;

    if (settings.secure === true || window.location.protocol === 'https:') {
      cookie += '; Secure';
    }

    document.cookie = cookie;
  }

  function getCookie(name) {
    const cookies = document.cookie ? document.cookie.split('; ') : [];

    for (const entry of cookies) {
      const separatorIndex = entry.indexOf('=');
      const key = separatorIndex >= 0 ? entry.slice(0, separatorIndex) : entry;

      if (key === name) {
        const rawValue = separatorIndex >= 0 ? entry.slice(separatorIndex + 1) : '';
        return parseCookieValue(rawValue);
      }
    }

    return null;
  }

  function deleteCookie(name) {
    document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
  }

  function readConsent() {
    const raw = getCookie(CONSENT_COOKIE);

    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function writeConsent(analyticsEnabled, marketingEnabled) {
    const payload = {
      necessary: true,
      analytics: analyticsEnabled === true,
      marketing: marketingEnabled === true,
      updatedAt: new Date().toISOString()
    };

    setCookie(CONSENT_COOKIE, JSON.stringify(payload), CONSENT_TTL_DAYS, { sameSite: 'Lax' });
    document.dispatchEvent(new CustomEvent('shelfy:cookie-consent-updated', { detail: payload }));
    return payload;
  }

  function hasConsentFor(category) {
    const consent = readConsent();

    if (!consent) {
      return false;
    }

    if (category === 'necessary') {
      return true;
    }

    return consent[category] === true;
  }

  function ensureBannerStyles() {
    if (document.getElementById('shelfy-cookie-style-fallback')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'shelfy-cookie-style-fallback';
    style.textContent = `
      .cookie-banner { position: fixed; left: 20px; right: 20px; bottom: 20px; z-index: 11000; background: var(--bg-panel, #fff); border: 1px solid var(--border, rgba(0,0,0,0.1)); border-radius: 14px; padding: 14px 16px; box-shadow: 0 12px 30px rgba(0,0,0,0.2); }
      .cookie-banner-content { display: flex; justify-content: space-between; gap: 14px; align-items: center; flex-wrap: wrap; }
      .cookie-banner-text { margin: 0; font-size: 13px; line-height: 1.5; color: var(--text-muted, #475569); }
      .cookie-banner-actions { display: flex; gap: 10px; flex-wrap: wrap; }
      .cookie-btn { border: 1px solid var(--border, rgba(0,0,0,0.1)); background: transparent; color: var(--text-main, #0f172a); border-radius: 8px; padding: 8px 14px; font-size: 12px; font-weight: 600; cursor: pointer; }
      .cookie-btn.primary { background: var(--accent, #06b6d4); border-color: var(--accent, #06b6d4); color: #fff; }
    `;

    document.head.appendChild(style);
  }

  function removeBanner() {
    const element = document.getElementById('shelfy-cookie-banner');

    if (element) {
      element.remove();
    }
  }

  function showBanner() {
    if (document.getElementById('shelfy-cookie-banner') || readConsent()) {
      return;
    }

    ensureBannerStyles();

    const wrapper = document.createElement('div');
    wrapper.id = 'shelfy-cookie-banner';
    wrapper.className = 'cookie-banner';
    wrapper.setAttribute('role', 'dialog');
    wrapper.setAttribute('aria-live', 'polite');
    wrapper.innerHTML = `
      <div class="cookie-banner-content">
        <p class="cookie-banner-text">
          We use essential cookies to keep ShelfyAI secure and functional. With your permission, we also use analytics cookies to improve performance.
          <a href="privacy.html" class="cookie-policy-link">Learn more</a>.
        </p>
        <div class="cookie-banner-actions">
          <button type="button" class="cookie-btn" id="cookie-reject">Only essential</button>
          <button type="button" class="cookie-btn primary" id="cookie-accept">Accept all</button>
        </div>
      </div>
    `;

    document.body.appendChild(wrapper);

    const acceptButton = wrapper.querySelector('#cookie-accept');
    const rejectButton = wrapper.querySelector('#cookie-reject');

    acceptButton?.addEventListener('click', function () {
      writeConsent(true, false);
      removeBanner();
    });

    rejectButton?.addEventListener('click', function () {
      writeConsent(false, false);
      removeBanner();
    });
  }

  window.ShelfyCookies = {
    set: setCookie,
    get: getCookie,
    remove: deleteCookie,
    getConsent: readConsent,
    setConsent: writeConsent,
    hasConsentFor
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showBanner, { once: true });
  } else {
    showBanner();
  }
})();
