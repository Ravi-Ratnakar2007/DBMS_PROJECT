require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');

async function main() {
  const [cols] = await db.query("show columns from Investors like 'role'");
  if (cols.length === 0) {
    await db.query("alter table Investors add column role enum('INVESTOR','ADMIN') not null default 'INVESTOR'");
    console.log('Added role column');
  }

  // 1b. add is_flagged column to Transactions if not exists
  const [flagCols] = await db.query("show columns from Transactions like 'is_flagged'");
  if (flagCols.length === 0) {
    await db.query("alter table Transactions add column is_flagged boolean not null default false");
    console.log('Added is_flagged column to Transactions');
  }

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
  console.log('Cashflows table ready');

  const [investorRows] = await db.query("select investor_id, balance, created_at from Investors where role = 'INVESTOR'");
  let seededCount = 0;
  for (const inv of investorRows) {
    const [cfs] = await db.query("select cashflow_id from Cashflows where investor_id = ? limit 1", [inv.investor_id]);
    if (cfs.length === 0) {
      const [tradeRows] = await db.query(
        `select o.order_type, coalesce(sum(t.total_amount), 0) as total
         from Transactions t
         join Orders o on t.order_id = o.order_id
         where o.investor_id = ?
         group by o.order_type`,
        [inv.investor_id]
      );
      let buys = 0;
      let sells = 0;
      for (const tr of tradeRows) {
        if (tr.order_type === 'BUY') buys = Number(tr.total);
        if (tr.order_type === 'SELL') sells = Number(tr.total);
      }
      const impliedFunding = Math.round((Number(inv.balance) + buys - sells) * 100) / 100;
      if (impliedFunding > 0) {
        await db.query(
          'insert into Cashflows (investor_id, flow_type, amount, balance_after, note, created_at) values (?, "DEPOSIT", ?, ?, "Initial account funding", ?)',
          [inv.investor_id, impliedFunding, impliedFunding, inv.created_at || new Date()]
        );
        seededCount++;
      }
    }
  }
  if (seededCount > 0) {
    console.log('Seeded initial funding cashflows for ' + seededCount + ' investors');
  }

  const [admin] = await db.query("select investor_id from Investors where email = 'admin@example.com'");
  if (admin.length === 0) {
    await db.query(
      "insert into Investors (full_name, email, password_hash, phone, balance, role) values ('Admin', 'admin@example.com', 'x', '9000000000', 0, 'ADMIN')"
    );
    console.log('Created admin user');
  }
  const userHash = await bcrypt.hash('password123', 10);
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  const adminHash = await bcrypt.hash(adminPassword, 10);
  await db.query("update Investors set password_hash = ? where role = 'INVESTOR'", [userHash]);
  await db.query("update Investors set password_hash = ? where role = 'ADMIN'", [adminHash]);

  console.log('Done!');
  console.log('Admin login:  admin@example.com / admin123');
  console.log('User login:   aarav.mehta@gmail.com / password123 (all users use password123)');
  process.exit(0);
}

main().catch(err => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
