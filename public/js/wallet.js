// wallet.js - handles wallet balances, deposits, withdrawals, and cashflow transactions

async function start() {
  const me = await requireLogin('INVESTOR');
  document.getElementById('who').textContent = 'Hi, ' + me.name;
  if (document.getElementById('balance')) {
    document.getElementById('balance').textContent = 'Balance: ₹' + money(me.balance);
  }

  loadWalletData();
}

async function loadWalletData() {
  try {
    const data = await api('/api/wallet');

    // summary cards
    document.getElementById('walletBalance').textContent = '₹' + money(data.balance);
    document.getElementById('totalDeposited').textContent = '₹' + money(data.totalDeposited);
    document.getElementById('totalWithdrawn').textContent = '₹' + money(data.totalWithdrawn);
    if (document.getElementById('balance')) {
      document.getElementById('balance').textContent = 'Balance: ₹' + money(data.balance);
    }

    const netStockTradesEl = document.getElementById('netStockTrades');
    if (netStockTradesEl) {
      const netTrade = data.netStockTrading || 0;
      netStockTradesEl.textContent = (netTrade >= 0 ? '+ ₹' : '- ₹') + money(Math.abs(netTrade));
      netStockTradesEl.className = 'number ' + (netTrade >= 0 ? 'good' : 'bad');
    }

    const netWorthEl = document.getElementById('totalNetWorth');
    if (netWorthEl) {
      netWorthEl.textContent = '₹' + money(data.netWorth);
    }

    // math reconciliation display
    if (document.getElementById('reconcileCash')) {
      document.getElementById('reconcileCash').textContent = '₹' + money(data.balance);
      document.getElementById('reconcileDep').textContent = '₹' + money(data.totalDeposited);
      document.getElementById('reconcileWith').textContent = '₹' + money(data.totalWithdrawn);
      const netTrade = data.netStockTrading || 0;
      document.getElementById('reconcileTrade').textContent = (netTrade >= 0 ? '+₹' : '-₹') + money(Math.abs(netTrade));
      document.getElementById('reconcileHoldings').textContent = '₹' + money(data.currentStockValue || 0);
      document.getElementById('reconcileNetWorth').textContent = '₹' + money(data.netWorth);
    }

    // cashflow transactions table
    let html = '';
    for (const cf of data.cashflows) {
      const isIncoming = cf.direction === 'IN';
      const dirBadge = isIncoming
        ? '<span class="badge" style="background:#dcfce7; color:#15803d;">+ INFLOW</span>'
        : '<span class="badge" style="background:#fee2e2; color:#b91c1c;">- OUTFLOW</span>';

      const typeLabel = formatFlowType(cf.flow_type);
      const amountClass = isIncoming ? 'cashflow-in' : 'cashflow-out';
      const amountSign = isIncoming ? '+ ₹' : '- ₹';

      const rowClass = cf.is_flagged ? 'flagged-row' : '';

      html += '<tr class="' + rowClass + '">' +
        '<td>' + esc(cf.id) + '</td>' +
        '<td><b>' + typeLabel + '</b>' + (cf.is_flagged ? ' <span class="badge badge-flagged">🚩 FLAGGED</span>' : '') + '</td>' +
        '<td>' + esc(cf.description) + '</td>' +
        '<td>' + dirBadge + '</td>' +
        '<td class="' + amountClass + '">' + amountSign + money(cf.amount) + '</td>' +
        '<td>' + new Date(cf.created_at).toLocaleString() + '</td>' +
        '</tr>';
    }

    if (data.cashflows.length === 0) {
      html = '<tr><td colspan="6">No cashflow transactions recorded yet.</td></tr>';
    }

    document.getElementById('cashflowTable').innerHTML = html;
  } catch (err) {
    showMessage('walletMessage', err.message, false);
  }
}

function formatFlowType(type) {
  switch (type) {
    case 'DEPOSIT':
      return 'Deposit';
    case 'WITHDRAW':
      return 'Withdrawal';
    case 'STOCK_BUY':
      return 'Stock Buy';
    case 'STOCK_SELL':
      return 'Stock Sell';
    default:
      return type;
  }
}

async function depositMoney() {
  const amountInput = document.getElementById('moneyAmount');
  const amount = Number(amountInput.value);

  if (!amount || amount <= 0) {
    showMessage('walletMessage', 'Please enter a valid amount greater than 0', false);
    return;
  }

  try {
    const res = await api('/api/wallet/deposit', 'POST', { amount });
    showMessage('walletMessage', res.message, true);
    amountInput.value = '';
    loadWalletData();
  } catch (err) {
    showMessage('walletMessage', err.message, false);
  }
}

async function withdrawMoney() {
  const amountInput = document.getElementById('moneyAmount');
  const amount = Number(amountInput.value);

  if (!amount || amount <= 0) {
    showMessage('walletMessage', 'Please enter a valid amount greater than 0', false);
    return;
  }

  try {
    const res = await api('/api/wallet/withdraw', 'POST', { amount });
    showMessage('walletMessage', res.message, true);
    amountInput.value = '';
    loadWalletData();
  } catch (err) {
    showMessage('walletMessage', err.message, false);
  }
}

start();
