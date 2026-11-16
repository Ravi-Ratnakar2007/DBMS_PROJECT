require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./db');

const app = express();
app.use(express.json());

// Trust first proxy (Render, etc.) so secure cookies and req.ip work
app.set('trust proxy', 1);

// Session secret
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET && process.env.NODE_ENV === 'production') {
  console.error('ERROR: SESSION_SECRET environment variable is required in production.');
  process.exit(1);
}
if (!SESSION_SECRET) {
  console.warn('WARNING: SESSION_SECRET is not set. Using an insecure dev fallback. Do NOT run like this in production.');
}

app.use(session({
  secret: SESSION_SECRET || 'dev-fallback-secret-do-not-use-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  }
}));

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.redirect('/login.html'));

// ======================= HELPER FUNCTIONS =======================

const MAX_INVESTORS = 30;           // cap on total investors
const MAX_ORDERS_PER_DAY = 10;      // daily trade limit per investor
const MAX_QUANTITY_PER_ORDER = 500;  // max shares in one order
const PRICE_TOLERANCE = 0.20;       // 20% tolerance on price vs current

function round2(n) {
  return Math.round(n * 100) / 100;
}

// only allow logged in users
function needLogin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Please login first' });
  }
  next();
}

// only allow admin users
function needAdmin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Please login first' });
  }
  if (req.session.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Admins only' });
  }
  next();
}

// The BUY / SELL logic. Must be called inside a MySQL transaction.
// o = { userId, stockId, type: 'BUY' or 'SELL', quantity, price, orderId (optional) }
// returns { ok: true/false, message: '...' }
async function executeTrade(conn, o) {
  let problem = null;

  // quantity cap
  if (o.quantity > MAX_QUANTITY_PER_ORDER) {
    problem = 'Maximum ' + MAX_QUANTITY_PER_ORDER + ' shares per order';
  }

  // price tolerance check
  if (!problem) {
    const [stockRow] = await conn.query(
      'select current_price from Stocks where stock_id = ?',
      [o.stockId]
    );
    if (stockRow.length > 0) {
      const currentPrice = Number(stockRow[0].current_price);
      const upperLimit = round2(currentPrice * (1 + PRICE_TOLERANCE));
      const lowerLimit = round2(currentPrice * (1 - PRICE_TOLERANCE));
      if (o.type === 'BUY' && o.price > upperLimit) {
        problem = 'Buy price ₹' + o.price.toFixed(2) + ' exceeds 120% of current price ₹' + currentPrice.toFixed(2);
      }
      if (o.type === 'SELL' && o.price < lowerLimit) {
        problem = 'Sell price ₹' + o.price.toFixed(2) + ' is below 80% of current price ₹' + currentPrice.toFixed(2);
      }
    }
  }

  const total = round2(o.price * o.quantity);

  // lock the investor row so two trades cannot happen at the same time
  const [inv] = await conn.query(
    'select balance from Investors where investor_id = ? for update',
    [o.userId]
  );
  const balance = Number(inv[0].balance);

  // get the portfolio row (if the user owns this stock already)
  const [port] = await conn.query(
    'select quantity, avg_buy_price from Portfolios where investor_id = ? and stock_id = ?',
    [o.userId, o.stockId]
  );

  // check balance & shares if no earlier problem
  if (!problem) {
    if (o.type === 'BUY' && balance < total) {
      problem = 'Not enough balance. You need ₹' + total.toFixed(2);
    }
    if (o.type === 'SELL' && (port.length === 0 || port[0].quantity < o.quantity)) {
      problem = 'You do not own enough shares to sell';
    }
  }

  // not allowed: save the order as REJECTED
  if (problem) {
    if (o.orderId) {
      await conn.query("update Orders set status = 'REJECTED' where order_id = ?", [o.orderId]);
    } else {
      await conn.query(
        "insert into Orders (investor_id, stock_id, order_type, quantity, price, status) values (?, ?, ?, ?, ?, 'REJECTED')",
        [o.userId, o.stockId, o.type, o.quantity, o.price]
      );
    }
    return { ok: false, message: problem };
  }

  // allowed: update money and shares
  if (o.type === 'BUY') {
    await conn.query('update Investors set balance = balance - ? where investor_id = ?', [total, o.userId]);

    if (port.length > 0) {
      const oldQty = port[0].quantity;
      const newQty = oldQty + o.quantity;
      const newAvg = round2((oldQty * Number(port[0].avg_buy_price) + o.quantity * o.price) / newQty);
      await conn.query(
        'update Portfolios set quantity = ?, avg_buy_price = ? where investor_id = ? and stock_id = ?',
        [newQty, newAvg, o.userId, o.stockId]
      );
    } else {
      await conn.query(
        'insert into Portfolios (investor_id, stock_id, quantity, avg_buy_price) values (?, ?, ?, ?)',
        [o.userId, o.stockId, o.quantity, o.price]
      );
    }
  } else {
    // SELL
    await conn.query('update Investors set balance = balance + ? where investor_id = ?', [total, o.userId]);
    await conn.query(
      'update Portfolios set quantity = quantity - ? where investor_id = ? and stock_id = ?',
      [o.quantity, o.userId, o.stockId]
    );
  }

  // save the order as EXECUTED and add a transaction row
  let orderId = o.orderId;
  if (orderId) {
    await conn.query("update Orders set status = 'EXECUTED' where order_id = ?", [orderId]);
  } else {
    const [result] = await conn.query(
      "insert into Orders (investor_id, stock_id, order_type, quantity, price, status) values (?, ?, ?, ?, ?, 'EXECUTED')",
      [o.userId, o.stockId, o.type, o.quantity, o.price]
    );
    orderId = result.insertId;
  }
  await conn.query(
    'insert into Transactions (order_id, quantity, price) values (?, ?, ?)',
    [orderId, o.quantity, o.price]
  );

  const word = o.type === 'BUY' ? 'Bought' : 'Sold';
  return { ok: true, message: word + ' ' + o.quantity + ' shares for ' + total.toFixed(2) };
}

// ======================= AUTH ROUTES =======================

// POST /api/login   body: { email, password }
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Enter email and password' });
  }

  const [rows] = await db.query('select * from Investors where email = ?', [email]);
  if (rows.length === 0) {
    return res.status(400).json({ error: 'Wrong email or password' });
  }

  const user = rows[0];
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    return res.status(400).json({ error: 'Wrong email or password' });
  }

  req.session.user = { id: user.investor_id, name: user.full_name, role: user.role };
  res.json({ role: user.role });
});

// POST /api/register   body: { full_name, email, password, phone }
app.post('/api/register', async (req, res) => {
  const { full_name, email, password, phone } = req.body;

  if (!full_name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const [countRow] = await db.query("select count(*) as n from Investors where role = 'INVESTOR'");
  if (countRow[0].n >= MAX_INVESTORS) {
    return res.status(400).json({ error: 'Registration is closed. Maximum ' + MAX_INVESTORS + ' investors allowed.' });
  }

  const [existing] = await db.query('select investor_id from Investors where email = ?', [email]);
  if (existing.length > 0) {
    return res.status(400).json({ error: 'An account with this email already exists' });
  }

  const hash = await bcrypt.hash(password, 10);
  await db.query(
    "insert into Investors (full_name, email, password_hash, phone, balance, role) values (?, ?, ?, ?, 0, 'INVESTOR')",
    [full_name, email, hash, phone || null]
  );

  res.json({ message: 'Account created! You can now log in.' });
});

// GET /api/me   -> info about the logged in user (with fresh balance)
app.get('/api/me', needLogin, async (req, res) => {
  const [rows] = await db.query('select balance from Investors where investor_id = ?', [req.session.user.id]);
  if (rows.length === 0) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'Account not found' });
  }
  res.json({
    id: req.session.user.id,
    name: req.session.user.name,
    role: req.session.user.role,
    balance: Number(rows[0].balance)
  });
});

// POST /api/logout
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ message: 'Logged out' }));
});

// ======================= STOCKS ROUTES =======================

// GET /api/stocks?search=nova
app.get('/api/stocks', needLogin, async (req, res) => {
  const q = '%' + (req.query.search || '') + '%';
  const [rows] = await db.query(
    `select s.stock_id, s.symbol, s.current_price, c.company_name, c.sector,
            (select old_price from Price_History ph where ph.stock_id = s.stock_id order by ph.changed_at desc, ph.history_id desc limit 1) as prev_price
     from Stocks s
     join Companies c on s.company_id = c.company_id
     where c.company_name like ? or s.symbol like ? or c.sector like ?
     order by c.company_name`,
    [q, q, q]
  );
  res.json(rows);
});

// GET /api/stocks/5/history
app.get('/api/stocks/:id/history', needLogin, async (req, res) => {
  const id = req.params.id;

  const [stock] = await db.query('select current_price from Stocks where stock_id = ?', [id]);
  if (stock.length === 0) {
    return res.status(404).json({ error: 'Stock not found' });
  }

  const [rows] = await db.query(
    'select old_price, new_price, changed_at from Price_History where stock_id = ? order by changed_at',
    [id]
  );

  if (rows.length === 0) {
    return res.json({ labels: ['Now'], prices: [Number(stock[0].current_price)] });
  }

  const labels = ['Start'];
  const prices = [Number(rows[0].old_price)];
  for (const r of rows) {
    labels.push(new Date(r.changed_at).toISOString().slice(0, 10));
    prices.push(Number(r.new_price));
  }
  res.json({ labels, prices });
});

// ======================= TRADE ROUTES =======================
// POST /api/trade   body: { stock_id, type: 'BUY' or 'SELL', quantity }
app.post('/api/trade', needLogin, async (req, res) => {
  const { stock_id, type } = req.body;
  const quantity = parseInt(req.body.quantity);

  if (type !== 'BUY' && type !== 'SELL') {
    return res.status(400).json({ error: 'Type must be BUY or SELL' });
  }
  if (!quantity || quantity <= 0) {
    return res.status(400).json({ error: 'Enter a valid quantity' });
  }
  if (req.session.user.role === 'ADMIN') {
    return res.status(403).json({ error: 'Admins cannot trade' });
  }

  // daily trade limit
  const [dayCount] = await db.query(
    `select count(*) as n from Orders
     where investor_id = ? and date(order_time) = curdate()`,
    [req.session.user.id]
  );
  if (dayCount[0].n >= MAX_ORDERS_PER_DAY) {
    return res.status(400).json({ error: 'Daily trade limit reached (' + MAX_ORDERS_PER_DAY + ' orders per day)' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [stock] = await conn.query('select current_price from Stocks where stock_id = ?', [stock_id]);
    if (stock.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Stock not found' });
    }

    const result = await executeTrade(conn, {
      userId: req.session.user.id,
      stockId: stock_id,
      type: type,
      quantity: quantity,
      price: Number(stock[0].current_price)
    });

    await conn.commit();

    if (result.ok) {
      res.json({ message: result.message });
    } else {
      res.status(400).json({ error: result.message });
    }
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

// ======================= PORTFOLIO ROUTES =======================

// GET /api/portfolio
app.get('/api/portfolio', needLogin, async (req, res) => {
  const userId = req.session.user.id;

  const [me] = await db.query('select balance from Investors where investor_id = ?', [userId]);
  if (me.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }

  const [holdings] = await db.query(
    `select s.stock_id, s.symbol, c.company_name, p.quantity, p.avg_buy_price, s.current_price
     from Portfolios p
     join Stocks s on p.stock_id = s.stock_id
     join Companies c on s.company_id = c.company_id
     where p.investor_id = ? and p.quantity > 0
     order by s.symbol`,
    [userId]
  );

  let investedAmount = 0;
  let currentAmount = 0;
  for (const h of holdings) {
    investedAmount += h.quantity * Number(h.avg_buy_price);
    currentAmount += h.quantity * Number(h.current_price);
  }

  investedAmount = round2(investedAmount);
  currentAmount = round2(currentAmount);
  const cashBalance = round2(Number(me[0].balance));
  const totalPL = round2(currentAmount - investedAmount);
  const netWorth = round2(cashBalance + currentAmount);

  const [orders] = await db.query(
    `select o.order_id, s.symbol, o.order_type, o.quantity, o.price, o.status, o.order_time
     from Orders o
     join Stocks s on o.stock_id = s.stock_id
     where o.investor_id = ?
     order by o.order_time desc
     limit 30`,
    [userId]
  );

  res.json({
    balance: cashBalance,
    investedAmount,
    currentAmount,
    totalPL,
    netWorth,
    netAmount: netWorth, // backwards compatibility
    holdings,
    orders
  });
});

// ======================= WALLET ROUTES =======================

// GET /api/wallet -> balance, deposit/withdraw totals, and unified cashflow transactions
app.get('/api/wallet', needLogin, async (req, res) => {
  const userId = req.session.user.id;

  const [inv] = await db.query('select balance, created_at from Investors where investor_id = ?', [userId]);
  if (inv.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }
  const balance = Number(inv[0].balance);

  let [walletFlows] = await db.query(
    `select cashflow_id, flow_type, amount, balance_after, note, created_at
     from Cashflows
     where investor_id = ?
     order by created_at desc`,
    [userId]
  );

  const [tradeFlows] = await db.query(
    `select t.transaction_id, o.order_type, t.quantity, t.price, t.total_amount, t.is_flagged, t.txn_time, s.symbol
     from Transactions t
     join Orders o on t.order_id = o.order_id
     join Stocks s on o.stock_id = s.stock_id
     where o.investor_id = ?
     order by t.txn_time desc`,
    [userId]
  );

  // Auto-seed initial funding cashflow if none exists for this investor
  if (walletFlows.length === 0) {
    let tBuys = 0;
    let tSells = 0;
    for (const tf of tradeFlows) {
      if (tf.order_type === 'BUY') tBuys += Number(tf.total_amount);
      if (tf.order_type === 'SELL') tSells += Number(tf.total_amount);
    }
    const impliedInitial = round2(balance + tBuys - tSells);
    if (impliedInitial > 0) {
      await db.query(
        'insert into Cashflows (investor_id, flow_type, amount, balance_after, note, created_at) values (?, "DEPOSIT", ?, ?, "Initial account funding", ?)',
        [userId, impliedInitial, impliedInitial, inv[0].created_at || new Date()]
      );
      const [reloaded] = await db.query(
        `select cashflow_id, flow_type, amount, balance_after, note, created_at
         from Cashflows
         where investor_id = ?
         order by created_at desc`,
        [userId]
      );
      walletFlows = reloaded;
    }
  }

  let totalDeposited = 0;
  let totalWithdrawn = 0;
  for (const wf of walletFlows) {
    if (wf.flow_type === 'DEPOSIT') totalDeposited += Number(wf.amount);
    if (wf.flow_type === 'WITHDRAW') totalWithdrawn += Number(wf.amount);
  }

  let totalStockBought = 0;
  let totalStockSold = 0;
  for (const tf of tradeFlows) {
    if (tf.order_type === 'BUY') totalStockBought += Number(tf.total_amount);
    if (tf.order_type === 'SELL') totalStockSold += Number(tf.total_amount);
  }

  // Get current stock holdings value to compute Net Worth
  const [holdings] = await db.query(
    `select p.quantity, s.current_price
     from Portfolios p
     join Stocks s on p.stock_id = s.stock_id
     where p.investor_id = ? and p.quantity > 0`,
    [userId]
  );
  let currentStockValue = 0;
  for (const h of holdings) {
    currentStockValue += h.quantity * Number(h.current_price);
  }

  totalDeposited = round2(totalDeposited);
  totalWithdrawn = round2(totalWithdrawn);
  totalStockBought = round2(totalStockBought);
  totalStockSold = round2(totalStockSold);
  const netStockTrading = round2(totalStockSold - totalStockBought);
  currentStockValue = round2(currentStockValue);
  const netWorth = round2(balance + currentStockValue);

  const unified = [];

  for (const wf of walletFlows) {
    unified.push({
      id: 'W-' + wf.cashflow_id,
      category: 'WALLET',
      flow_type: wf.flow_type,
      direction: wf.flow_type === 'DEPOSIT' ? 'IN' : 'OUT',
      amount: Number(wf.amount),
      description: wf.note || (wf.flow_type === 'DEPOSIT' ? 'Wallet Deposit' : 'Wallet Withdrawal'),
      is_flagged: false,
      created_at: wf.created_at
    });
  }

  for (const tf of tradeFlows) {
    unified.push({
      id: 'T-' + tf.transaction_id,
      category: 'TRADE',
      flow_type: tf.order_type === 'BUY' ? 'STOCK_BUY' : 'STOCK_SELL',
      direction: tf.order_type === 'BUY' ? 'OUT' : 'IN',
      amount: Number(tf.total_amount),
      description: (tf.order_type === 'BUY' ? 'Bought ' : 'Sold ') + tf.quantity + ' shares of ' + tf.symbol + ' @ ₹' + Number(tf.price).toFixed(2),
      is_flagged: Boolean(tf.is_flagged),
      created_at: tf.txn_time
    });
  }

  unified.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  res.json({
    balance: round2(balance),
    totalDeposited,
    totalWithdrawn,
    totalStockBought,
    totalStockSold,
    netStockTrading,
    currentStockValue,
    netWorth,
    cashflows: unified
  });
});

// POST /api/wallet/deposit
app.post('/api/wallet/deposit', needLogin, async (req, res) => {
  if (req.session.user.role === 'ADMIN') {
    return res.status(403).json({ error: 'Admins cannot deposit' });
  }
  const amount = Number(req.body.amount);
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Enter an amount greater than 0' });
  }
  if (amount > 1000000) {
    return res.status(400).json({ error: 'Maximum deposit is ₹10,00,000 per transaction' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('update Investors set balance = balance + ? where investor_id = ?',
      [amount, req.session.user.id]);
    const [inv] = await conn.query('select balance from Investors where investor_id = ?', [req.session.user.id]);
    const newBal = Number(inv[0].balance);

    await conn.query(
      'insert into Cashflows (investor_id, flow_type, amount, balance_after, note) values (?, "DEPOSIT", ?, ?, ?)',
      [req.session.user.id, amount, newBal, 'Wallet deposit']
    );
    await conn.commit();
    res.json({ message: 'Deposited ₹' + amount.toFixed(2) + ' into wallet', balance: newBal });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

// POST /api/wallet/withdraw
app.post('/api/wallet/withdraw', needLogin, async (req, res) => {
  if (req.session.user.role === 'ADMIN') {
    return res.status(403).json({ error: 'Admins cannot withdraw' });
  }
  const amount = Number(req.body.amount);
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Enter an amount greater than 0' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [inv] = await conn.query(
      'select balance from Investors where investor_id = ? for update',
      [req.session.user.id]
    );
    const balance = Number(inv[0].balance);
    if (amount > balance) {
      await conn.rollback();
      return res.status(400).json({ error: 'Insufficient balance. You have ₹' + balance.toFixed(2) });
    }

    const newBal = balance - amount;
    await conn.query('update Investors set balance = balance - ? where investor_id = ?',
      [amount, req.session.user.id]);

    await conn.query(
      'insert into Cashflows (investor_id, flow_type, amount, balance_after, note) values (?, "WITHDRAW", ?, ?, ?)',
      [req.session.user.id, amount, newBal, 'Wallet withdrawal']
    );
    await conn.commit();
    res.json({ message: 'Withdrawn ₹' + amount.toFixed(2) + ' from wallet', balance: newBal });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

// Backward-compatible deposit/withdraw endpoints
app.post('/api/deposit', needLogin, async (req, res) => {
  if (req.session.user.role === 'ADMIN') {
    return res.status(403).json({ error: 'Admins cannot deposit' });
  }
  const amount = Number(req.body.amount);
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Enter an amount greater than 0' });
  }
  if (amount > 1000000) {
    return res.status(400).json({ error: 'Maximum deposit is ₹10,00,000 per transaction' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('update Investors set balance = balance + ? where investor_id = ?',
      [amount, req.session.user.id]);
    const [row] = await conn.query('select balance from Investors where investor_id = ?', [req.session.user.id]);
    const newBal = Number(row[0].balance);
    await conn.query(
      'insert into Cashflows (investor_id, flow_type, amount, balance_after, note) values (?, "DEPOSIT", ?, ?, ?)',
      [req.session.user.id, amount, newBal, 'Wallet deposit']
    );
    await conn.commit();
    res.json({ message: 'Deposited ₹' + amount.toFixed(2), balance: newBal });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

app.post('/api/withdraw', needLogin, async (req, res) => {
  if (req.session.user.role === 'ADMIN') {
    return res.status(403).json({ error: 'Admins cannot withdraw' });
  }
  const amount = Number(req.body.amount);
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Enter an amount greater than 0' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [inv] = await conn.query(
      'select balance from Investors where investor_id = ? for update',
      [req.session.user.id]
    );
    const balance = Number(inv[0].balance);
    if (amount > balance) {
      await conn.rollback();
      return res.status(400).json({ error: 'Insufficient balance. You have ₹' + balance.toFixed(2) });
    }
    const newBal = balance - amount;
    await conn.query('update Investors set balance = balance - ? where investor_id = ?',
      [amount, req.session.user.id]);
    await conn.query(
      'insert into Cashflows (investor_id, flow_type, amount, balance_after, note) values (?, "WITHDRAW", ?, ?, ?)',
      [req.session.user.id, amount, newBal, 'Wallet withdrawal']
    );
    await conn.commit();
    res.json({ message: 'Withdrawn ₹' + amount.toFixed(2), balance: newBal });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

// ======================= ADMIN ROUTES =======================

// GET /api/admin/stats
app.get('/api/admin/stats', needAdmin, async (req, res) => {
  const [inv] = await db.query("select count(*) as n from Investors where role = 'INVESTOR'");
  const [txn] = await db.query('select count(*) as n, coalesce(sum(total_amount), 0) as money from Transactions');
  const [flagged] = await db.query('select count(*) as n from Transactions where is_flagged = true');
  const [top] = await db.query(
    `select s.symbol, sum(t.quantity) as shares
     from Transactions t
     join Orders o on t.order_id = o.order_id
     join Stocks s on o.stock_id = s.stock_id
     group by s.symbol
     order by shares desc
     limit 1`
  );

  res.json({
    investors: inv[0].n,
    transactions: txn[0].n,
    moneyTraded: txn[0].money,
    flaggedTransactions: flagged[0].n,
    mostTraded: top.length ? top[0].symbol : '-'
  });
});

// GET /api/admin/transactions?search=12&status=FLAGGED
app.get('/api/admin/transactions', needAdmin, async (req, res) => {
  let sql = `select t.transaction_id, t.order_id, t.quantity, t.price, t.total_amount, t.is_flagged, t.txn_time,
                    i.investor_id, i.full_name, i.email, s.symbol, o.order_type
             from Transactions t
             join Orders o on t.order_id = o.order_id
             join Investors i on o.investor_id = i.investor_id
             join Stocks s on o.stock_id = s.stock_id`;

  const params = [];
  const conditions = [];

  if (req.query.search) {
    const term = req.query.search.trim();
    if (!isNaN(term) && Number(term) > 0) {
      conditions.push('(t.transaction_id = ? or o.order_id = ?)');
      params.push(Number(term), Number(term));
    } else {
      const likeTerm = '%' + term + '%';
      conditions.push('(s.symbol like ? or i.full_name like ? or i.email like ?)');
      params.push(likeTerm, likeTerm, likeTerm);
    }
  }

  if (req.query.status === 'FLAGGED') {
    conditions.push('t.is_flagged = true');
  } else if (req.query.status === 'NORMAL') {
    conditions.push('t.is_flagged = false');
  }

  if (conditions.length > 0) {
    sql += ' where ' + conditions.join(' and ');
  }

  sql += ' order by t.txn_time desc limit 100';

  const [rows] = await db.query(sql, params);
  res.json(rows);
});

// POST /api/admin/transactions/:id/flag
app.post('/api/admin/transactions/:id/flag', needAdmin, async (req, res) => {
  const txnId = req.params.id;
  const [result] = await db.query(
    'update Transactions set is_flagged = true where transaction_id = ?',
    [txnId]
  );
  if (result.affectedRows === 0) {
    return res.status(404).json({ error: 'Transaction not found' });
  }

  await db.query(
    `update Orders o
     join Transactions t on o.order_id = t.order_id
     set o.status = 'FLAGGED'
     where t.transaction_id = ?`,
    [txnId]
  );

  res.json({ message: 'Transaction #' + txnId + ' flagged as suspicious' });
});

// POST /api/admin/transactions/:id/unflag
app.post('/api/admin/transactions/:id/unflag', needAdmin, async (req, res) => {
  const txnId = req.params.id;
  const [result] = await db.query(
    'update Transactions set is_flagged = false where transaction_id = ?',
    [txnId]
  );
  if (result.affectedRows === 0) {
    return res.status(404).json({ error: 'Transaction not found' });
  }

  await db.query(
    `update Orders o
     join Transactions t on o.order_id = t.order_id
     set o.status = 'EXECUTED'
     where t.transaction_id = ?`,
    [txnId]
  );

  res.json({ message: 'Transaction #' + txnId + ' unflagged' });
});

// GET /api/admin/investors
app.get('/api/admin/investors', needAdmin, async (req, res) => {
  const [rows] = await db.query(
    "select investor_id, full_name, email, balance, created_at from Investors where role = 'INVESTOR' order by investor_id"
  );
  res.json(rows);
});

// POST /api/admin/add-money body: { investor_id, amount }
app.post('/api/admin/add-money', needAdmin, async (req, res) => {
  const amount = Number(req.body.amount);
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Enter an amount greater than 0' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('update Investors set balance = balance + ? where investor_id = ?', [amount, req.body.investor_id]);
    const [inv] = await conn.query('select balance from Investors where investor_id = ?', [req.body.investor_id]);
    if (inv.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Investor not found' });
    }
    const newBal = Number(inv[0].balance);
    await conn.query(
      'insert into Cashflows (investor_id, flow_type, amount, balance_after, note) values (?, "DEPOSIT", ?, ?, ?)',
      [req.body.investor_id, amount, newBal, 'Admin credit: Funds added by administrator']
    );
    await conn.commit();
    res.json({ message: 'Added ₹' + amount.toFixed(2) + ' to the account' });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

// Remove investor handler
async function handleRemoveInvestor(req, res) {
  const investorId = parseInt(req.params.id, 10);
  if (!investorId) {
    return res.status(400).json({ error: 'Invalid investor ID' });
  }

  const [target] = await db.query('select investor_id, full_name, role from Investors where investor_id = ?', [investorId]);
  if (target.length === 0) {
    return res.status(404).json({ error: 'Investor not found' });
  }
  if (target[0].role === 'ADMIN') {
    return res.status(403).json({ error: 'Cannot remove an administrator account' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Delete transactions belonging to orders of this investor
    await conn.query(
      `delete t from Transactions t
       join Orders o on t.order_id = o.order_id
       where o.investor_id = ?`,
      [investorId]
    );

    // 2. Delete orders
    await conn.query('delete from Orders where investor_id = ?', [investorId]);

    // 3. Delete portfolio holdings
    await conn.query('delete from Portfolios where investor_id = ?', [investorId]);

    // 4. Delete cashflows
    await conn.query('delete from Cashflows where investor_id = ?', [investorId]);

    // 5. Delete investor
    await conn.query('delete from Investors where investor_id = ? and role = "INVESTOR"', [investorId]);

    await conn.commit();
    res.json({ message: 'Investor "' + target[0].full_name + '" (ID #' + investorId + ') removed successfully' });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// POST /api/admin/investors/:id/remove and DELETE /api/admin/investors/:id
app.post('/api/admin/investors/:id/remove', needAdmin, handleRemoveInvestor);
app.delete('/api/admin/investors/:id', needAdmin, handleRemoveInvestor);

// POST /api/admin/price body: { stock_id, new_price }
app.post('/api/admin/price', needAdmin, async (req, res) => {
  const newPrice = Number(req.body.new_price);
  if (!newPrice || newPrice <= 0) {
    return res.status(400).json({ error: 'Enter a price greater than 0' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [stock] = await conn.query('select current_price from Stocks where stock_id = ?', [req.body.stock_id]);
    if (stock.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Stock not found' });
    }
    await conn.query(
      'insert into Price_History (stock_id, old_price, new_price) values (?, ?, ?)',
      [req.body.stock_id, stock[0].current_price, newPrice]
    );
    await conn.query('update Stocks set current_price = ? where stock_id = ?', [newPrice, req.body.stock_id]);
    await conn.commit();
    res.json({ message: 'Price updated' });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

// POST /api/admin/stocks body: { company_name, sector, headquarters, symbol, price, total_shares }
app.post('/api/admin/stocks', needAdmin, async (req, res) => {
  const { company_name, sector, headquarters, symbol } = req.body;
  const price = Number(req.body.price);
  const totalShares = parseInt(req.body.total_shares);

  if (!company_name || !sector || !symbol || !price || !totalShares) {
    return res.status(400).json({ error: 'Fill all the fields' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [c] = await conn.query(
      'insert into Companies (company_name, sector, headquarters, listed_date) values (?, ?, ?, curdate())',
      [company_name, sector, headquarters || null]
    );
    await conn.query(
      'insert into Stocks (company_id, symbol, current_price, total_shares) values (?, ?, ?, ?)',
      [c.insertId, symbol.toUpperCase(), price, totalShares]
    );
    await conn.commit();
    res.json({ message: 'New stock added' });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'That company name or symbol already exists' });
    }
    throw err;
  } finally {
    conn.release();
  }
});

// ======================= ERROR HANDLER =======================

// if any route crashes, send a simple error instead of dying
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error, check the terminal' });
});

// ======================= START & INITIALIZATION =======================

async function initDatabase() {
  try {
    // 1. Ensure role column exists on Investors
    const [roleCols] = await db.query("show columns from Investors like 'role'");
    if (roleCols.length === 0) {
      await db.query("alter table Investors add column role enum('INVESTOR','ADMIN') not null default 'INVESTOR'");
      console.log('Added role column to Investors');
    }

    // 2. Ensure is_flagged column exists on Transactions
    const [flagCols] = await db.query("show columns from Transactions like 'is_flagged'");
    if (flagCols.length === 0) {
      await db.query("alter table Transactions add column is_flagged boolean not null default false");
      console.log('Added is_flagged column to Transactions');
    }

    // 3. Ensure Orders status enum includes FLAGGED
    try {
      await db.query(`
        alter table Orders
        modify column status enum('PENDING','EXECUTED','REJECTED','CANCELLED','FLAGGED')
        not null default 'PENDING'
      `);
    } catch (e) {
      // ignore if already modified
    }

    // 4. Ensure Cashflows table exists
    await db.query(`
      create table if not exists Cashflows (
        cashflow_id int auto_increment primary key,
        investor_id int not null,
        flow_type enum('DEPOSIT','WITHDRAW') not null,
        amount decimal(15,2) not null,
        balance_after decimal(15,2) not null,
        note varchar(255),
        created_at timestamp not null default current_timestamp,
        foreign key (investor_id) references Investors(investor_id),
        check (amount > 0)
      )
    `);

    // 5. Ensure admin account exists and has valid password
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    const adminHash = await bcrypt.hash(adminPassword, 10);
    const [admin] = await db.query("select investor_id, password_hash from Investors where email = 'admin@example.com'");
    if (admin.length === 0) {
      await db.query(
        "insert into Investors (full_name, email, password_hash, phone, balance, role) values ('Admin', 'admin@example.com', ?, '9000000000', 0, 'ADMIN')",
        [adminHash]
      );
      console.log('Created admin account (admin@example.com / admin123)');
    } else if (admin[0].password_hash === 'x') {
      await db.query("update Investors set password_hash = ? where email = 'admin@example.com'", [adminHash]);
    }

    // 6. Ensure initial funding entries exist in Cashflows so deposits and cash balance line up
    const [invs] = await db.query("select investor_id, balance, created_at from Investors where role = 'INVESTOR'");
    for (const inv of invs) {
      const [cfRows] = await db.query("select cashflow_id from Cashflows where investor_id = ? limit 1", [inv.investor_id]);
      if (cfRows.length === 0) {
        const [trades] = await db.query(
          `select o.order_type, coalesce(sum(t.total_amount), 0) as total
           from Transactions t
           join Orders o on t.order_id = o.order_id
           where o.investor_id = ?
           group by o.order_type`,
          [inv.investor_id]
        );
        let buys = 0;
        let sells = 0;
        for (const tr of trades) {
          if (tr.order_type === 'BUY') buys = Number(tr.total);
          if (tr.order_type === 'SELL') sells = Number(tr.total);
        }
        const impliedFunding = round2(Number(inv.balance) + buys - sells);
        if (impliedFunding > 0) {
          await db.query(
            'insert into Cashflows (investor_id, flow_type, amount, balance_after, note, created_at) values (?, "DEPOSIT", ?, ?, "Initial account funding", ?)',
            [inv.investor_id, impliedFunding, impliedFunding, inv.created_at || new Date()]
          );
        }
      }
    }
    console.log('Database schema & data synchronized successfully');
  } catch (err) {
    console.warn('Database initialization warning:', err.message);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  await initDatabase();
  console.log('Stock app running at http://localhost:' + PORT);
});
