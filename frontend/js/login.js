document.addEventListener('DOMContentLoaded', () => {
  // Already signed in - go straight to dashboard.
  if (Api.token()) {
    window.location.href = Student.isStudent() ? Student.homeUrl() : 'pages/dashboard.html';
    return;
  }

  const form = document.getElementById('loginForm');
  const errorBox = document.getElementById('loginError');
  const btn = document.getElementById('loginBtn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.style.display = 'none';
    btn.disabled = true;
    btn.textContent = 'Signing in…';

    try {
      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;
      const result = await Api.post('/auth/login', { email, password });
      Api.setToken(result.token);
      localStorage.setItem('al_user', JSON.stringify(result.user));
      window.location.href = Student.isStudent() ? Student.homeUrl() : 'pages/dashboard.html';
    } catch (err) {
      errorBox.textContent = err.message || 'Sign in failed.';
      errorBox.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  });
});
