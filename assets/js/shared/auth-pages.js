/**
 * Auth form pages (sign in, register, forgot/reset password) for auth.html.
 */
(function (global) {
  function loadHubQuiz() {
    try {
      const data = (global.FWUser && typeof FWUser.getBlob === 'function') ? FWUser.getBlob() : null;
      if (data && data.scores && typeof data.scores === 'object') return data;
    } catch (_) { /* ignore */ }
    return null;
  }

  // Display gate: only errors FWErr marked user-facing print verbatim.
  function fwErr(err, fallback) {
    return global.FWErr ? FWErr.forUser(err, fallback) : fallback;
  }

  function busy(btn, label) {
    return global.FWButtonBusy ? FWButtonBusy.start(btn, { label: label }) : function () {};
  }

  // Inline card alerts: same element renders the error (default) or the green
  // counterpart, so the "password updated" hand-off doesn't read as a failure.
  function setAlert(el, msg, kind) {
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('auth-alert--ok', kind === 'ok');
  }

  function bindPasswordToggles() {
    document.querySelectorAll('[data-pw-toggle]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const input = document.getElementById(btn.getAttribute('data-pw-toggle'));
        if (!input) return;
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.setAttribute('aria-pressed', show ? 'true' : 'false');
        btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      });
    });
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
    setAlert(errEl, '');
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
    const restore = busy(btn, 'Signing in…');
    try {
      await FWAuth.authLogin(email, password);
      if (global.dispatchEvent) {
        global.dispatchEvent(new CustomEvent('fw-auth-change', { detail: { email: FWAuth.authEmail() } }));
      }
      if (global.FWPageBoot) FWPageBoot.redirectAfterAuth();
      else location.replace('portal.html');
    } catch (err) {
      errEl.textContent = fwErr(err, 'Sign in failed.');
    } finally {
      emailEl.disabled = false;
      if (pwEl) pwEl.disabled = false;
      restore();
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
    const restore = busy(btn, 'Creating…');
    try {
      await FWAuth.authRegister(email, password, loadHubQuiz());
      if (global.dispatchEvent) {
        global.dispatchEvent(new CustomEvent('fw-auth-change', { detail: { email: FWAuth.authEmail() } }));
      }
      if (global.FWPageBoot) FWPageBoot.redirectAfterAuth();
      else location.replace('portal.html');
    } catch (err) {
      errEl.textContent = fwErr(err, 'Registration failed.');
    } finally {
      emailEl.disabled = false;
      if (pwEl) pwEl.disabled = false;
      if (pw2El) pw2El.disabled = false;
      restore();
    }
  }

  function openForgotPassword() {
    showAuthPage('forgot-password');
    try { history.replaceState(null, '', '#forgot-password'); } catch (_) { /* ignore */ }
    const err = document.getElementById('forgot-error');
    const ok = document.getElementById('forgot-success');
    if (err) err.textContent = '';
    if (ok) ok.hidden = true;
  }

  async function forgotPasswordSubmit() {
    const emailEl = document.getElementById('forgot-email');
    const errEl = document.getElementById('forgot-error');
    const okEl = document.getElementById('forgot-success');
    const btn = document.getElementById('forgot-btn');
    const email = (emailEl.value || '').trim();
    errEl.textContent = '';
    okEl.hidden = true;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      errEl.textContent = 'Please enter a valid email address.';
      return;
    }
    const restore = busy(btn, 'Sending…');
    try {
      await FWAuth.authForgotPassword(email);
      okEl.textContent = 'If an account exists for that email, we sent a reset link.';
      okEl.hidden = false;
    } catch (err) {
      errEl.textContent = fwErr(err, 'Could not send reset email.');
    } finally {
      restore();
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
    const restore = busy(btn, 'Updating…');
    try {
      await FWAuth.authResetPassword(token, password);
      showAuthPage('signin');
      try { history.replaceState(null, '', '#signin'); } catch (_) { /* ignore */ }
      const signinErr = document.getElementById('signin-error');
      setAlert(signinErr, 'Password updated. Sign in with your new password.', 'ok');
    } catch (err) {
      errEl.textContent = fwErr(err, 'Could not reset password.');
    } finally {
      restore();
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
    bindPasswordToggles();
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
    setAlert: setAlert,
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
