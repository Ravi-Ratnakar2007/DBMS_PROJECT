require('dotenv').config();
const mysql = require('mysql2/promise');

const poolOptions = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'stock_exchange',
  dateStrings: false
};

if (process.env.DB_SSL === 'true') {
  poolOptions.ssl = { rejectUnauthorized: true };
}

const db = mysql.createPool(poolOptions);

module.exports = db;
