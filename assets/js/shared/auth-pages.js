/**
 * Auth form pages (sign in, register, forgot/reset password) for auth.html.
 */
(function (global) {
  const HUB_KEY = 'fw_hub_quiz_v1';

  function loadHubQuiz() {
    try {
      const raw = localStorage.getItem(HUB_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (data && data.scores && typeof data.scores === 'object') return data;
    } catch (_) { /* ignore */ }
    return null;
  }

  function showAuthPage(page) {
    document.querySelectorAll('section.auth-page').forEach(function (el) {
      el.hidden = el.id !== 'auth-page-' + page;
    });
    document.documentElement.setAttribute('data-boot-page', page);
    if (global.FWAppNav) FWAppNav.sync(null);
  }

  function hashPath() {
    const h = (location.hash || '').replace(/^#/, '');
    return h.split('?')[0];
  }

  function resetTokenFromUrl() {
    const h = (location.hash || '').replace(/^#/, '');
    const q = h.indexOf('?') >= 0 ? h.slice(h.indexOf('?') + 1) : '';
  const fromHash = new URLSearchParams(q).get('token');
    if (fromHash) return fromHash;
    try {
      return new URLSearchParams(location.search).get('token') || '';
    } catch (_) {
      return '';
    }
  }

  async function signInFromPage() {
    const emailEl = document.getElementById('signin-email');
    const pwEl = document.getElementById('signin-password');
    const errEl = document.getElementById('signin-error');
    const btn = document.getElementById('signin-btn');
    const email = (emailEl.value || '').trim();
    const password = pwEl ? pwEl.value : '';
    errEl.textContent = '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      errEl.textContent = 'Please enter a valid email address.';
      return;
    }
    if (!global.FWAuth || !FWAuth.isValidPassword(password)) {
      errEl.textContent = 'Password must be at least 8 characters.';
      return;
    }
    emailEl.disabled = true;
    if (pwEl) pwEl.disabled = true;
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      await FWAuth.authLogin(email, password);
      if (global.dispatchEvent) {
        global.dispatchEvent(new CustomEvent('fw-auth-change', { detail: { email: FWAuth.authEmail() } }));
      }
      if (global.FWPageBoot) FWPageBoot.redirectAfterAuth();
      else location.replace('portal.html');
    } catch (err) {
      errEl.textContent = (err && err.message) || 'Sign in failed.';
    } finally {
      emailEl.disabled = false;
      if (pwEl) pwEl.disabled = false;
      btn.disabled = false;
      btn.textContent = 'Sign in →';
    }
  }

  async function registerFromPage() {
    const emailEl = document.getElementById('register-email');
    const pwEl = document.getElementById('register-password');
    const pw2El = document.getElementById('register-password-confirm');
    const errEl = document.getElementById('register-error');
    const btn = document.getElementById('register-btn');
    const email = (emailEl.value || '').trim();
    const password = pwEl ? pwEl.value : '';
    const confirm = pw2El ? pw2El.value : '';
    errEl.textContent = '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      errEl.textContent = 'Please enter a valid email address.';
      return;
    }
    if (!global.FWAuth || !FWAuth.isValidPassword(password)) {
      errEl.textContent = 'Password must be at least 8 characters.';
      return;
    }
    if (password !== confirm) {
      errEl.textContent = 'Passwords do not match.';
      return;
    }
    emailEl.disabled = true;
    if (pwEl) pwEl.disabled = true;
    if (pw2El) pw2El.disabled = true;
    btn.disabled = true;
    btn.textContent = 'Creating…';
    try {
      await FWAuth.authRegister(email, password, loadHubQuiz());
      if (global.dispatchEvent) {
        global.dispatchEvent(new CustomEvent('fw-auth-change', { detail: { email: FWAuth.authEmail() } }));
      }
      if (global.FWPageBoot) FWPageBoot.redirectAfterAuth();
      else location.replace('portal.html');
    } catch (err) {
      errEl.textContent = (err && err.message) || 'Registration failed.';
    } finally {
      emailEl.disabled = false;
      if (pwEl) pwEl.disabled = false;
      if (pw2El) pw2El.disabled = false;
      btn.disabled = false;
      btn.textContent = 'Create account →';
    }
  }

  function openForgotPassword() {
    showAuthPage('forgot-password');
    try { history.replaceState(null, '', '#forgot-password'); } catch (_) { /* ignore */ }
    const err = document.getElementById('forgot-error');
    const ok = document.getElementById('forgot-success');
    if (err) err.textContent = '';
    if (ok) ok.style.display = 'none';
  }

  async function forgotPasswordSubmit() {
    const emailEl = document.getElementById('forgot-email');
    const errEl = document.getElementById('forgot-error');
    const okEl = document.getElementById('forgot-success');
    const btn = document.getElementById('forgot-btn');
    const email = (emailEl.value || '').trim();
    errEl.textContent = '';
    okEl.style.display = 'none';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      errEl.textContent = 'Please enter a valid email address.';
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      await FWAuth.authForgotPassword(email);
      okEl.textContent = 'If an account exists for that email, we sent a reset link.';
      okEl.style.display = 'block';
    } catch (err) {
      errEl.textContent = (err && err.message) || 'Could not send reset email.';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Send reset link →';
    }
  }

  async function resetPasswordSubmit() {
    const token = resetTokenFromUrl();
    const pwEl = document.getElementById('reset-password-new');
    const pw2El = document.getElementById('reset-password-confirm');
    const errEl = document.getElementById('reset-password-error');
    const btn = document.getElementById('reset-password-btn');
    const password = pwEl ? pwEl.value : '';
    const confirm = pw2El ? pw2El.value : '';
    errEl.textContent = '';
    if (!token) {
      errEl.textContent = 'Reset link is invalid or expired. Request a new one from sign in.';
      return;
    }
    if (!FWAuth.isValidPassword(password)) {
      errEl.textContent = 'Password must be at least 8 characters.';
      return;
    }
    if (password !== confirm) {
      errEl.textContent = 'Passwords do not match.';
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Updating…';
    try {
      await FWAuth.authResetPassword(token, password);
      showAuthPage('signin');
      try { history.replaceState(null, '', '#signin'); } catch (_) { /* ignore */ }
      const signinErr = document.getElementById('signin-error');
      if (signinErr) signinErr.textContent = 'Password updated. Sign in with your new password.';
    } catch (err) {
      errEl.textContent = (err && err.message) || 'Could not reset password.';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Update password →';
    }
  }

  function routeBoot() {
    const path = hashPath();
    const signedIn = global.FWAuth && FWAuth.authEmail && FWAuth.authEmail();
    if (signedIn && (path === 'signin' || path === 'register' || path === '')) {
      if (global.FWPageBoot) FWPageBoot.redirectAfterAuth();
      else location.replace('portal.html');
      return true;
    }
    if (path === 'register') { showAuthPage('register'); return true; }
    if (path === 'forgot-password') { showAuthPage('forgot-password'); return true; }
    if (path === 'reset-password') { showAuthPage('reset-password'); return true; }
    if (path === 'signin' || !path) { showAuthPage('signin'); return true; }
    showAuthPage('signin');
    return true;
  }

  function init() {
    if (global.FWPageBoot) {
      FWPageBoot.authBootThen(function () {
        routeBoot();
        document.documentElement.removeAttribute('data-boot-page');
      });
    } else {
      routeBoot();
      document.documentElement.removeAttribute('data-boot-page');
    }
    global.addEventListener('hashchange', routeBoot);
  }

  global.coachSignInFromPage = signInFromPage;
  global.coachRegisterFromPage = registerFromPage;
  global.coachRegisterFromPage = registerFromPage;
  global.coachOpenForgotPassword = openForgotPassword;
  global.coachForgotPasswordSubmit = forgotPasswordSubmit;
  global.coachResetPasswordSubmit = resetPasswordSubmit;
  global.coachResetTokenFromUrl = resetTokenFromUrl;

  global.FWAuthPages = {
    init: init,
    routeBoot: routeBoot,
    showAuthPage: showAuthPage,
    signInFromPage: signInFromPage,
    registerFromPage: registerFromPage,
    openForgotPassword: openForgotPassword,
    forgotPasswordSubmit: forgotPasswordSubmit,
    resetPasswordSubmit: resetPasswordSubmit,
    loadHubQuiz: loadHubQuiz,
  };

  if (document.getElementById('auth-page-signin')) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
