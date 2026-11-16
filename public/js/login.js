// login.js - login and registration

// ----- Login -----
document.getElementById('loginForm').addEventListener('submit', async function (event) {
  event.preventDefault();   // stop the page from reloading

  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  try {
    const result = await api('/api/login', 'POST', { email: email, password: password });
    // admin goes to the admin page, everyone else to the dashboard
    window.location = result.role === 'ADMIN' ? 'admin.html' : 'dashboard.html';
  } catch (err) {
    showMessage('message', err.message, false);
  }
});

// ----- Toggle register form -----
document.getElementById('toggleRegister').addEventListener('click', function (e) {
  e.preventDefault();
  const form = document.getElementById('registerForm');
  const visible = form.style.display !== 'none';
  form.style.display = visible ? 'none' : 'block';
  this.textContent = visible ? "Don't have an account? Register" : 'Already have an account? Login';
});

// ----- Register -----
document.getElementById('registerForm').addEventListener('submit', async function (event) {
  event.preventDefault();

  const full_name = document.getElementById('regName').value;
  const email = document.getElementById('regEmail').value;
  const password = document.getElementById('regPassword').value;
  const phone = document.getElementById('regPhone').value;

  try {
    const result = await api('/api/register', 'POST', { full_name, email, password, phone });
    showMessage('regMessage', result.message, true);
    // clear the form
    document.getElementById('registerForm').reset();
  } catch (err) {
    showMessage('regMessage', err.message, false);
  }
});
