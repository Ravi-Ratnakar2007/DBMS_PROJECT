-- migrate.sql - Run this on your existing database if updating from previous version.
-- Run in MySQL Workbench or via: mysql -u root -p stock_exchange < migrate.sql

USE stock_exchange;

-- 1. Add FLAGGED to the status enum on Orders
ALTER TABLE Orders
  MODIFY COLUMN status ENUM('PENDING','EXECUTED','REJECTED','CANCELLED','FLAGGED')
  NOT NULL DEFAULT 'PENDING';

-- 2. Add is_flagged to Transactions table
ALTER TABLE Transactions
  ADD COLUMN IF NOT EXISTS is_flagged BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. Create Cashflows table
CREATE TABLE IF NOT EXISTS Cashflows (
  cashflow_id INT AUTO_INCREMENT PRIMARY KEY,
  investor_id INT NOT NULL,
  flow_type ENUM('DEPOSIT','WITHDRAW') NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  balance_after DECIMAL(15,2) NOT NULL,
  note VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (investor_id) REFERENCES Investors(investor_id),
  CHECK (amount > 0)
);

SELECT 'Migration complete! FLAGGED status, is_flagged column, and Cashflows table ready.' AS result;
