// portfolio.js - shows what the user owns, their orders, and direct sell option

// green text for profit, red for loss
function plClass(n) {
  return n >= 0 ? 'good' : 'bad';
}

async function start() {
  const me = await requireLogin('INVESTOR');
  document.getElementById('who').textContent = 'Hi, ' + me.name;
  if (document.getElementById('balance')) {
    document.getElementById('balance').textContent = 'Balance: ₹' + money(me.balance);
  }

  const data = await api('/api/portfolio');

  // ----- holdings table -----
  let html = '';
  let totalValue = 0;
  let totalPL = 0;

  for (const h of data.holdings) {
    const value = h.quantity * Number(h.current_price);
    const pl = (Number(h.current_price) - Number(h.avg_buy_price)) * h.quantity;
    totalValue += value;
    totalPL += pl;

    html += '<tr>' +
      '<td>' + esc(h.symbol) + '</td>' +
      '<td>' + esc(h.company_name) + '</td>' +
      '<td>' + h.quantity + '</td>' +
      '<td>₹' + money(h.avg_buy_price) + '</td>' +
      '<td>₹' + money(h.current_price) + '</td>' +
      '<td>₹' + money(value) + '</td>' +
      '<td class="' + plClass(pl) + '">₹' + money(pl) + '</td>' +
      '<td><button class="small red" onclick="directSell(' + h.stock_id + ', \'' + esc(h.symbol) + '\', ' + h.quantity + ')">Sell</button></td>' +
      '</tr>';
  }
  if (data.holdings.length === 0) {
    html = '<tr><td colspan="8">You do not own any stocks yet</td></tr>';
  }
  document.getElementById('holdingsTable').innerHTML = html;

  // ----- summary cards -----
  document.getElementById('cashBalance').textContent = '₹' + money(data.balance);
  document.getElementById('investedAmount').textContent = '₹' + money(data.investedAmount);
  document.getElementById('currentAmount').textContent = '₹' + money(data.currentAmount);

  const plBox = document.getElementById('totalPL');
  plBox.textContent = (totalPL >= 0 ? '+ ₹' : '- ₹') + money(Math.abs(totalPL));
  plBox.className = 'number ' + plClass(totalPL);

  const netWorthEl = document.getElementById('netWorth');
  if (netWorthEl) {
    const netWorth = data.netWorth !== undefined ? data.netWorth : (Number(data.balance) + totalValue);
    netWorthEl.textContent = '₹' + money(netWorth);
  }

  // ----- orders table -----
  html = '';
  for (const o of data.orders) {
    const statusClass = o.status === 'FLAGGED' ? 'flagged-row' : '';
    html += '<tr class="' + statusClass + '">' +
      '<td>' + o.order_id + '</td>' +
      '<td>' + esc(o.symbol) + '</td>' +
      '<td>' + o.order_type + '</td>' +
      '<td>' + o.quantity + '</td>' +
      '<td>₹' + money(o.price) + '</td>' +
      '<td>' + o.status + '</td>' +
      '<td>' + new Date(o.order_time).toLocaleString() + '</td>' +
      '</tr>';
  }
  if (data.orders.length === 0) {
    html = '<tr><td colspan="7">No orders yet</td></tr>';
  }
  document.getElementById('ordersTable').innerHTML = html;
}

// Direct sell function for holdings
async function directSell(stockId, symbol, maxQty) {
  const input = prompt('How many shares of ' + symbol + ' would you like to sell? (1 - ' + maxQty + '):', maxQty);
  if (input === null || input.trim() === '') return;

  const qty = parseInt(input, 10);
  if (isNaN(qty) || qty <= 0) {
    showMessage('portfolioMessage', 'Please enter a valid positive quantity', false);
    return;
  }
  if (qty > maxQty) {
    showMessage('portfolioMessage', 'You only own ' + maxQty + ' shares of ' + symbol, false);
    return;
  }

  try {
    const result = await api('/api/trade', 'POST', {
      stock_id: stockId,
      type: 'SELL',
      quantity: qty
    });
    showMessage('portfolioMessage', result.message, true);
    start();
  } catch (err) {
    showMessage('portfolioMessage', err.message, false);
  }
}

start();
