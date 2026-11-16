// common.js - small helper functions used by every page

// Talk to the server. Example: api('/api/stocks')  or  api('/api/trade', 'POST', { ... })
async function api(url, method, body) {
  const options = { method: method || 'GET', headers: { 'Content-Type': 'application/json' } };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));

  // not logged in -> go to the login page
  if (res.status === 401) {
    window.location = 'login.html';
    throw new Error('Please login first');
  }
  // any other error -> throw it so the page can show the message
  if (!res.ok) {
    throw new Error(data.error || 'Something went wrong');
  }
  return data;
}

// Call this at the top of a page. role = 'INVESTOR' or 'ADMIN'.
// If the wrong kind of user opens the page, send them to their own page.
async function requireLogin(role) {
  const me = await api('/api/me');
  if (role && me.role !== role) {
    window.location = me.role === 'ADMIN' ? 'admin.html' : 'dashboard.html';
  }
  return me;
}

async function logout() {
  await api('/api/logout', 'POST');
  window.location = 'login.html';
}

// Makes text safe before putting it inside HTML
function esc(text) {
  return String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 1234.5 -> "1,234.50"
function money(n) {
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// show a green or red message inside an element
function showMessage(id, text, isGood) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = 'msg ' + (isGood ? 'good' : 'bad');
}
