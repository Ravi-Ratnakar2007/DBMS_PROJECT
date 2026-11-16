// admin.js - the admin page
// Admin can view transactions, search by Transaction ID, change prices, add stocks, and FLAG/UNFLAG suspicious transactions.

async function start() {
  const me = await requireLogin('ADMIN');
  document.getElementById('who').textContent = 'Hi, ' + me.name;
  loadAll();
}

// reload everything on the page
function loadAll() {
  loadStats();
  loadTransactions();
  loadStocks();
  loadInvestors();
}

// run an admin action, show the message, then reload the page data
async function doAction(url, body) {
  try {
    const result = await api(url, 'POST', body);
    showMessage('adminMessage', result.message, true);
    loadAll();
    return true;
  } catch (err) {
    showMessage('adminMessage', err.message, false);
    return false;
  }
}

// ---------- numbers at the top ----------
async function loadStats() {
  const s = await api('/api/admin/stats');
  document.getElementById('statInvestors').textContent = s.investors + ' / 30';
  document.getElementById('statTransactions').textContent = s.transactions;
  document.getElementById('statMoney').textContent = '₹' + money(s.moneyTraded);
  document.getElementById('statFlagged').textContent = s.flaggedTransactions;
  document.getElementById('statTop').textContent = s.mostTraded;
}

// ---------- transactions (with search by Transaction ID / Symbol / Investor) ----------
async function loadTransactions() {
  const search = document.getElementById('txnSearch').value.trim();
  const status = document.getElementById('txnStatusFilter').value;

  const queryParams = new URLSearchParams();
  if (search) queryParams.set('search', search);
  if (status) queryParams.set('status', status);

  const txns = await api('/api/admin/transactions?' + queryParams.toString());

  let html = '';
  for (const t of txns) {
    const isFlagged = Boolean(t.is_flagged);
    const statusBadge = isFlagged
      ? '<span class="badge badge-flagged">🚩 FLAGGED</span>'
      : '<span class="badge badge-normal">EXECUTED</span>';

    const actionButton = isFlagged
      ? '<button class="small" onclick="unflagTxn(' + t.transaction_id + ')">Unflag</button>'
      : '<button class="small orange" onclick="flagTxn(' + t.transaction_id + ')">🚩 Flag</button>';

    html += '<tr class="' + (isFlagged ? 'flagged-row' : '') + '">' +
      '<td><b>#' + t.transaction_id + '</b></td>' +
      '<td>#' + t.order_id + '</td>' +
      '<td>' + esc(t.full_name) + '</td>' +
      '<td><b>' + esc(t.symbol) + '</b></td>' +
      '<td>' + esc(t.order_type) + '</td>' +
      '<td>' + t.quantity + '</td>' +
      '<td>₹' + money(t.price) + '</td>' +
      '<td>₹' + money(t.total_amount) + '</td>' +
      '<td>' + statusBadge + '</td>' +
      '<td>' + new Date(t.txn_time).toLocaleString() + '</td>' +
      '<td>' + actionButton + '</td>' +
      '</tr>';
  }

  if (txns.length === 0) {
    html = '<tr><td colspan="11">No transactions found matching your criteria.</td></tr>';
  }

  document.getElementById('transactionsTable').innerHTML = html;
}

function flagTxn(id) {
  doAction('/api/admin/transactions/' + id + '/flag');
}

function unflagTxn(id) {
  doAction('/api/admin/transactions/' + id + '/unflag');
}

// Search as user types or changes filter
document.getElementById('txnSearch').addEventListener('input', () => {
  loadTransactions();
});
document.getElementById('txnSearch').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadTransactions();
});
document.getElementById('txnStatusFilter').addEventListener('change', loadTransactions);

// ---------- stock prices ----------
async function loadStocks() {
  const stocks = await api('/api/stocks');
  let html = '';
  for (const s of stocks) {
    html += '<tr>' +
      '<td>' + esc(s.symbol) + '</td>' +
      '<td>' + esc(s.company_name) + '</td>' +
      '<td>₹' + money(s.current_price) + '</td>' +
      '<td><button class="small" onclick="changePrice(' + s.stock_id + ', \'' + esc(s.symbol) + '\')">Change</button></td>' +
      '</tr>';
  }
  document.getElementById('stocksTable').innerHTML = html;
}

function changePrice(stockId, symbol) {
  const price = prompt('New price for ' + symbol + ':');
  if (price === null || price === '') return; // user pressed cancel
  doAction('/api/admin/price', { stock_id: stockId, new_price: price });
}

// ---------- add new stock ----------
async function addStock() {
  const ok = await doAction('/api/admin/stocks', {
    company_name: document.getElementById('newName').value,
    sector: document.getElementById('newSector').value,
    headquarters: document.getElementById('newHq').value,
    symbol: document.getElementById('newSymbol').value,
    price: document.getElementById('newPrice').value,
    total_shares: document.getElementById('newShares').value
  });
  if (ok) {
    // clear the form
    for (const id of ['newName', 'newSector', 'newHq', 'newSymbol', 'newPrice', 'newShares']) {
      document.getElementById(id).value = '';
    }
  }
}

// ---------- investors ----------
async function loadInvestors() {
  const investors = await api('/api/admin/investors');
  let html = '';
  for (const i of investors) {
    html += '<tr>' +
      '<td>' + i.investor_id + '</td>' +
      '<td>' + esc(i.full_name) + '</td>' +
      '<td>' + esc(i.email) + '</td>' +
      '<td>₹' + money(i.balance) + '</td>' +
      '<td>' +
        '<button class="small" onclick="addMoney(' + i.investor_id + ', \'' + esc(i.full_name) + '\')">Add Money</button> ' +
        '<button class="small red" onclick="removeInvestor(' + i.investor_id + ', \'' + esc(i.full_name) + '\')">Remove</button>' +
      '</td>' +
      '</tr>';
  }
  document.getElementById('investorsTable').innerHTML = html;
}

function addMoney(investorId, name) {
  const amount = prompt('How much money to add to ' + name + '?');
  if (amount === null || amount === '') return;
  doAction('/api/admin/add-money', { investor_id: investorId, amount: amount });
}

function removeInvestor(investorId, name) {
  const confirmed = confirm(
    'Are you sure you want to remove investor "' + name + '" (ID #' + investorId + ')?\n\n' +
    'This will permanently delete their account, portfolio holdings, orders, transactions, and cashflow history.'
  );
  if (!confirmed) return;
  doAction('/api/admin/investors/' + investorId + '/remove');
}

start();
