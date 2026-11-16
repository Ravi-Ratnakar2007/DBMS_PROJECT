// dashboard.js - stock list, search, graph, buy/sell, and summary cards

let stocks = [];        // the stocks shown in the table
let selected = null;    // the stock the user clicked
let chart = null;       // the Chart.js graph

// runs when the page opens
async function start() {
  const me = await requireLogin('INVESTOR');
  document.getElementById('who').textContent = 'Hi, ' + me.name;
  showBalance(me.balance);
  loadStocks();
  loadSummary();
}

function showBalance(balance) {
  document.getElementById('balance').textContent = 'Balance: ₹' + money(balance);
}

async function refreshBalance() {
  const me = await api('/api/me');
  showBalance(me.balance);
}

// load the summary cards (cash, invested, current, net worth)
async function loadSummary() {
  try {
    const data = await api('/api/portfolio');
    if (document.getElementById('cashBalance')) {
      document.getElementById('cashBalance').textContent = '₹' + money(data.balance);
    }
    if (document.getElementById('investedAmount')) {
      document.getElementById('investedAmount').textContent = '₹' + money(data.investedAmount);
    }
    if (document.getElementById('currentAmount')) {
      document.getElementById('currentAmount').textContent = '₹' + money(data.currentAmount);
    }

    const netEl = document.getElementById('netWorth') || document.getElementById('netAmount');
    if (netEl) {
      netEl.textContent = '₹' + money(data.netWorth !== undefined ? data.netWorth : data.netAmount);
      netEl.className = 'number ' + (data.netWorth >= 0 ? 'good' : 'bad');
    }
  } catch (err) {
    // silently ignore if portfolio fails
  }
}

// get stocks from the server (using whatever is typed in the search box)
async function loadStocks() {
  const text = document.getElementById('search').value;
  stocks = await api('/api/stocks?search=' + encodeURIComponent(text));
  drawTable();
}

// fill the table with price and trend arrow (green up ▲ / red down ▼)
function drawTable() {
  let html = '';
  for (const s of stocks) {
    const isSelected = selected && selected.stock_id === s.stock_id;
    const cur = Number(s.current_price);
    const prev = s.prev_price !== null && s.prev_price !== undefined ? Number(s.prev_price) : null;

    let priceDisplay = '₹' + money(cur);
    if (prev !== null) {
      if (cur > prev) {
        priceDisplay = '<span class="trend-up">▲ ₹' + money(cur) + '</span>';
      } else if (cur < prev) {
        priceDisplay = '<span class="trend-down">▼ ₹' + money(cur) + '</span>';
      }
    }

    html += '<tr class="clickable ' + (isSelected ? 'selected' : '') + '" onclick="pickStock(' + s.stock_id + ')">' +
      '<td>' + esc(s.symbol) + '</td>' +
      '<td>' + esc(s.company_name) + '</td>' +
      '<td>' + esc(s.sector) + '</td>' +
      '<td>' + priceDisplay + '</td>' +
      '</tr>';
  }
  if (stocks.length === 0) {
    html = '<tr><td colspan="4">No stocks found</td></tr>';
  }
  document.getElementById('stockTable').innerHTML = html;
}

// user clicked a stock: remember it and draw its graph
async function pickStock(id) {
  selected = stocks.find(s => s.stock_id === id);
  drawTable();

  document.getElementById('chartTitle').textContent = selected.company_name + ' (' + selected.symbol + ')';
  document.getElementById('selectedInfo').textContent =
    selected.symbol + ' - current price ₹' + money(selected.current_price);

  const history = await api('/api/stocks/' + id + '/history');

  // remove the old graph before drawing a new one
  if (chart) chart.destroy();

  chart = new Chart(document.getElementById('priceChart'), {
    type: 'line',
    data: {
      labels: history.labels,
      datasets: [{
        label: selected.symbol + ' price (₹)',
        data: history.prices,
        borderColor: '#2563eb',
        backgroundColor: 'rgba(37, 99, 235, 0.1)',
        fill: true,
        tension: 0.2
      }]
    }
  });
}

// Buy or Sell button
async function trade(type) {
  if (!selected) {
    showMessage('tradeMessage', 'Click a stock first', false);
    return;
  }
  const quantity = document.getElementById('quantity').value;

  try {
    const result = await api('/api/trade', 'POST', {
      stock_id: selected.stock_id,
      type: type,
      quantity: quantity
    });
    showMessage('tradeMessage', result.message, true);
    refreshBalance();
    loadSummary();
  } catch (err) {
    showMessage('tradeMessage', err.message, false);
  }
}

// search as the user types
document.getElementById('search').addEventListener('input', loadStocks);

start();
