// Inject Switch Account modal HTML + define its functions for pages that
// don't have it inline (analytics, expense-detail, order-detail).
(function injectSwitchAccountModal() {
  if (document.getElementById('switchAccountModal')) return; // already present inline

  const html = `
<style>
.switch-account-tab.active { color:var(--accent)!important; border-bottom-color:var(--accent)!important; }
.switch-account-tab:hover { color:var(--text-main); }
</style>

<div class="modal-overlay modal-sheet" id="switchAccountModal" onclick="if(event.target===this)closeSwitchAccountModal()">
  <div class="modal-content-custom" style="max-width:450px;">
    <h3 style="margin:0 0 8px;color:var(--text-main);font-size:24px;">Switch Account</h3>
    <p style="color:var(--text-muted);margin-bottom:24px;font-size:14px;">Sign in to a different account</p>
    <div style="display:flex;gap:8px;margin-bottom:24px;border-bottom:2px solid var(--border);">
      <button class="switch-account-tab active" onclick="switchAccountTab('login')" style="flex:1;padding:12px;background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;font-size:14px;font-weight:600;color:var(--text-muted);transition:all 0.2s;margin-bottom:-2px;">Login</button>
      <button class="switch-account-tab" onclick="switchAccountTab('signup')" style="flex:1;padding:12px;background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;font-size:14px;font-weight:600;color:var(--text-muted);transition:all 0.2s;margin-bottom:-2px;">Sign Up</button>
    </div>
    <div id="switch-login-content" class="switch-account-content" style="display:block;">
      <button onclick="handleSwitchGoogleLogin()" style="width:100%;padding:14px;background:var(--bg-inner);border:1px solid var(--border);border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:12px;color:var(--text-main);margin-bottom:16px;">
        <svg width="18" height="18" viewBox="0 0 18 18"><path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/><path d="M9.003 18c2.43 0 4.467-.806 5.956-2.18L12.05 13.56c-.806.54-1.836.86-3.047.86-2.344 0-4.328-1.584-5.036-3.711H.96v2.332C2.44 15.983 5.485 18 9.003 18z" fill="#34A853"/><path d="M3.964 10.712c-.18-.54-.282-1.117-.282-1.71 0-.593.102-1.17.282-1.71V4.96H.957C.347 6.175 0 7.55 0 9.002c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/><path d="M9.003 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.464.891 11.426 0 9.002 0 5.485 0 2.44 2.017.96 4.958L3.967 7.29c.708-2.127 2.692-3.71 5.036-3.71z" fill="#EA4335"/></svg>
        Continue with Google
      </button>
      <div style="display:flex;align-items:center;gap:16px;margin:20px 0;color:var(--text-muted);font-size:13px;"><div style="flex:1;height:1px;background:var(--border);"></div><span>or</span><div style="flex:1;height:1px;background:var(--border);"></div></div>
      <form onsubmit="handleSwitchLogin(event)">
        <div style="margin-bottom:16px;text-align:left;"><label style="display:block;font-size:13px;font-weight:600;margin-bottom:8px;color:var(--text-muted);">Email</label><input type="email" id="switch-login-email" placeholder="you@example.com" required style="width:100%;padding:12px;background:var(--bg-panel);border:1px solid var(--border);border-radius:8px;color:var(--text-main);font-size:14px;box-sizing:border-box;"/></div>
        <div style="margin-bottom:16px;text-align:left;"><label style="display:block;font-size:13px;font-weight:600;margin-bottom:8px;color:var(--text-muted);">Password</label><input type="password" id="switch-login-password" placeholder="••••••••" required style="width:100%;padding:12px;background:var(--bg-panel);border:1px solid var(--border);border-radius:8px;color:var(--text-main);font-size:14px;box-sizing:border-box;"/></div>
        <button type="submit" style="width:100%;padding:12px;background:#06b6d4;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;margin-top:8px;">Sign In</button>
      </form>
      <div style="margin-top:16px;text-align:center;"><button onclick="closeSwitchAccountModal()" style="background:none;border:none;color:var(--text-muted);font-size:13px;cursor:pointer;text-decoration:underline;">Cancel</button></div>
    </div>
    <div id="switch-signup-content" class="switch-account-content" style="display:none;">
      <button onclick="handleSwitchGoogleLogin()" style="width:100%;padding:14px;background:var(--bg-inner);border:1px solid var(--border);border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:12px;color:var(--text-main);margin-bottom:16px;">
        <svg width="18" height="18" viewBox="0 0 18 18"><path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/><path d="M9.003 18c2.43 0 4.467-.806 5.956-2.18L12.05 13.56c-.806.54-1.836.86-3.047.86-2.344 0-4.328-1.584-5.036-3.711H.96v2.332C2.44 15.983 5.485 18 9.003 18z" fill="#34A853"/><path d="M3.964 10.712c-.18-.54-.282-1.117-.282-1.71 0-.593.102-1.17.282-1.71V4.96H.957C.347 6.175 0 7.55 0 9.002c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/><path d="M9.003 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.464.891 11.426 0 9.002 0 5.485 0 2.44 2.017.96 4.958L3.967 7.29c.708-2.127 2.692-3.71 5.036-3.71z" fill="#EA4335"/></svg>
        Continue with Google
      </button>
      <div style="display:flex;align-items:center;gap:16px;margin:20px 0;color:var(--text-muted);font-size:13px;"><div style="flex:1;height:1px;background:var(--border);"></div><span>or</span><div style="flex:1;height:1px;background:var(--border);"></div></div>
      <form onsubmit="handleSwitchSignUp(event)">
        <div style="margin-bottom:16px;text-align:left;"><label style="display:block;font-size:13px;font-weight:600;margin-bottom:8px;color:var(--text-muted);">Email</label><input type="email" id="switch-signup-email" placeholder="you@example.com" required style="width:100%;padding:12px;background:var(--bg-panel);border:1px solid var(--border);border-radius:8px;color:var(--text-main);font-size:14px;box-sizing:border-box;"/></div>
        <div style="margin-bottom:16px;text-align:left;"><label style="display:block;font-size:13px;font-weight:600;margin-bottom:8px;color:var(--text-muted);">Password</label><input type="password" id="switch-signup-password" placeholder="••••••••" minlength="6" required style="width:100%;padding:12px;background:var(--bg-panel);border:1px solid var(--border);border-radius:8px;color:var(--text-main);font-size:14px;box-sizing:border-box;"/></div>
        <div style="margin-bottom:16px;text-align:left;"><label style="display:block;font-size:13px;font-weight:600;margin-bottom:8px;color:var(--text-muted);">Confirm Password</label><input type="password" id="switch-signup-confirm-password" placeholder="••••••••" minlength="6" required style="width:100%;padding:12px;background:var(--bg-panel);border:1px solid var(--border);border-radius:8px;color:var(--text-main);font-size:14px;box-sizing:border-box;"/></div>
        <button type="submit" style="width:100%;padding:12px;background:#06b6d4;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;margin-top:8px;">Create Account</button>
      </form>
      <div style="margin-top:16px;text-align:center;"><button onclick="closeSwitchAccountModal()" style="background:none;border:none;color:var(--text-muted);font-size:13px;cursor:pointer;text-decoration:underline;">Cancel</button></div>
    </div>
  </div>
</div>`;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => document.body.insertAdjacentHTML('beforeend', html));
  } else {
    document.body.insertAdjacentHTML('beforeend', html);
  }

  // ── functions ─────────────────────────────────────────────
  window.switchAccountTab = function(tab) {
    document.querySelectorAll('.switch-account-tab').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    document.querySelectorAll('.switch-account-content').forEach(c => c.style.display = 'none');
    document.getElementById('switch-' + tab + '-content').style.display = 'block';
  };

  window.closeSwitchAccountModal = function() {
    const m = document.getElementById('switchAccountModal');
    if (m) m.classList.remove('active');
    ['switch-login-email','switch-login-password','switch-signup-email','switch-signup-password','switch-signup-confirm-password']
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  };

  window.handleSwitchGoogleLogin = async function() {
    try {
      await window.supabaseClient.auth.signOut();
      const { error } = await window.supabaseClient.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.href } });
      if (error) throw error;
    } catch (e) { alert('Google sign-in failed: ' + e.message); }
  };

  window.handleSwitchLogin = async function(e) {
    e.preventDefault();
    const email = document.getElementById('switch-login-email').value;
    const password = document.getElementById('switch-login-password').value;
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Switching...';
    try {
      await window.supabaseClient.auth.signOut();
      sessionStorage.removeItem('shelfy_user_email'); sessionStorage.removeItem('shelfy_user_avatar');
      localStorage.removeItem('shelfy_store_id'); localStorage.removeItem('shelfy_store_name');
      window.currentStoreId = null; window.currentStoreName = null;
      const { error } = await window.supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      window.location.reload();
    } catch (e) { alert('Login failed: ' + e.message); btn.disabled = false; btn.textContent = 'Sign In'; }
  };

  window.handleSwitchSignUp = async function(e) {
    e.preventDefault();
    const email = document.getElementById('switch-signup-email').value;
    const password = document.getElementById('switch-signup-password').value;
    if (password !== document.getElementById('switch-signup-confirm-password').value) { alert('Passwords do not match!'); return; }
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Creating account...';
    try {
      await window.supabaseClient.auth.signOut();
      sessionStorage.removeItem('shelfy_user_email'); sessionStorage.removeItem('shelfy_user_avatar');
      localStorage.removeItem('shelfy_store_id'); localStorage.removeItem('shelfy_store_name');
      window.currentStoreId = null; window.currentStoreName = null;
      const { error } = await window.supabaseClient.auth.signUp({ email, password });
      if (error) throw error;
      alert('Account created! Check your email to confirm.');
      window.switchAccountTab('login');
      document.getElementById('switch-login-email').value = email;
    } catch (e) { alert('Sign up failed: ' + e.message); btn.disabled = false; btn.textContent = 'Create Account'; }
  };
})();
