# Stock Exchange App

A simple stock trading website. Node.js + Express backend, MySQL database, plain HTML/CSS/JS frontend, Chart.js for graphs.

## How to run locally

1. Install [Node.js](https://nodejs.org/) (v18+) and [MySQL 8](https://dev.mysql.com/downloads/).
2. Run your `database.sql` file in MySQL Workbench (this creates the `stock_exchange` database with all the data).
3. Copy `.env.example` to `.env` and fill in your MySQL password:
   ```
   cp .env.example .env
   ```
   Edit `.env` and set `DB_PASSWORD` to your MySQL root password. The other defaults should work for a local setup.
4. In a terminal inside this folder:
   ```
   npm install
   node setup.js
   npm start
   ```
   `node setup.js` only needs to run once. It adds the `role` column, creates the admin user and sets real passwords.
5. Open http://localhost:3000

## Logins

| Who | Email | Password |
|---|---|---|
| Admin | admin@example.com | admin123 |
| Investor | aarav.mehta@gmail.com | password123 |
| Investor | diya.shah@gmail.com | password123 |
| Investor | vsingh64@gmail.com | password123 |

All 30 investors use `password123`. Their emails are in the `Investors` table (and on the Admin page).

> **Note:** To change the admin password, set `ADMIN_PASSWORD` in your `.env` file and restart the server. The admin hash is re-generated on each startup.

## Sample data

`database.sql` comes with 30 investors, 20 stocks, 383 orders, 353 transactions and one price for every stock on every trading day from 3 Aug to 22 Oct 2026 (about 56 points on each price graph). Six orders are left PENDING so you can try approving and rejecting them on the Admin page.

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DB_HOST` | No | `localhost` | MySQL hostname |
| `DB_PORT` | No | `3306` | MySQL port |
| `DB_USER` | No | `root` | MySQL user |
| `DB_PASSWORD` | **Yes** | — | MySQL password |
| `DB_NAME` | No | `stock_exchange` | MySQL database name |
| `DB_SSL` | No | `false` | Set to `true` to require SSL for the MySQL connection |
| `SESSION_SECRET` | Prod only | dev fallback | Secret for signing session cookies (required when `NODE_ENV=production`) |
| `ADMIN_PASSWORD` | No | `admin123` | Password for the admin@example.com account |
| `PORT` | No | `3000` | HTTP listen port |
| `NODE_ENV` | No | — | Set to `production` for secure cookies and required `SESSION_SECRET` |

## Deployment (Render + Railway)

### 1. Create a MySQL database on Railway

1. Go to [railway.app](https://railway.app/) and sign in (or create a free account).
2. Click **New Project → Provision MySQL**.
3. Open the MySQL service and go to the **Variables** tab. Note the values for `MYSQLHOST`, `MYSQLPORT`, `MYSQLUSER`, `MYSQLPASSWORD`, and `MYSQL_URL`.
4. Connect to the Railway MySQL instance (e.g. via MySQL Workbench or the `mysql` CLI using the host/port/user/password from step 3) and run the contents of `database.sql` **once**.

   > ⚠️ **Warning:** `database.sql` begins with `DROP DATABASE IF EXISTS stock_exchange`. Running it again will **destroy all data**. Only run it on initial setup.

5. After running `database.sql`, verify the `stock_exchange` database was created:
   ```sql
   SHOW DATABASES;
   USE stock_exchange;
   SHOW TABLES;
   ```

### 2. Create a Web Service on Render

1. Push this repository to GitHub.
2. Go to [render.com](https://render.com/) and sign in.
3. Click **New → Web Service** and connect your GitHub repository.
4. Configure the service:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. In the **Environment** section, add these variables:

   | Key | Value |
   |---|---|
   | `DB_HOST` | *(Railway's `MYSQLHOST`)* |
   | `DB_PORT` | *(Railway's `MYSQLPORT`)* |
   | `DB_USER` | *(Railway's `MYSQLUSER`)* |
   | `DB_PASSWORD` | *(Railway's `MYSQLPASSWORD`)* |
   | `DB_NAME` | `stock_exchange` |
   | `DB_SSL` | `true` |
   | `SESSION_SECRET` | *(generate a long random string, e.g. `openssl rand -hex 32`)* |
   | `ADMIN_PASSWORD` | *(choose a strong password)* |
   | `NODE_ENV` | `production` |

6. Click **Create Web Service**. Render will build and deploy automatically.

### Notes

- **Free tier sleep:** Render's free tier spins down the service after ~15 minutes of inactivity. The first request after sleeping takes a few seconds.
- **In-memory sessions:** Sessions are stored in server memory, so **users will be logged out whenever the service restarts** (deploys, sleeps, etc.). This is fine for a college project; for production, use a session store like Redis.
- **Admin password:** Set `ADMIN_PASSWORD` in Render's environment variables to something other than `admin123` for your deployed instance.

## Files

- `server.js` the entire backend (all routes + trade logic) in one file
- `db.js` MySQL connection
- `setup.js` one-time setup
- `database.sql` full schema and sample data
- `migrate.sql` incremental migration for existing databases
- `public/` the pages the browser shows (login, dashboard, portfolio, wallet, admin) with `css/` and `js/`
