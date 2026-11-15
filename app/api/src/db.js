const mysql = require('mysql2/promise');
const { log } = require('./app');

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS links (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(10) NOT NULL UNIQUE,
    original_url TEXT NOT NULL,
    clicks INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createDb(env = process.env) {
  const pool = mysql.createPool({
    host: env.DB_HOST || 'localhost',
    port: Number(env.DB_PORT) || 3306,
    user: env.DB_USER || 'shortlink',
    password: env.DB_PASSWORD,
    database: env.DB_NAME || 'shortlink',
    waitForConnections: true,
    connectionLimit: 10,
    // Azure Database for MySQL requires TLS. Node's built-in CA list trusts Azure's certificates.
    ssl: env.DB_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
  });

  // Creates the table on startup. Retries so the API can start before the DB is ready.
  async function init({ retries = 15, delayMs = 4000 } = {}) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await pool.query(CREATE_TABLE_SQL);
        log('info', 'database ready');
        return;
      } catch (err) {
        if (attempt === retries) throw err;
        log('warn', 'database not ready, retrying', { attempt, error: err.message });
        await sleep(delayMs);
      }
    }
  }

  return {
    init,

    async ping() {
      await pool.query('SELECT 1');
    },

    async insertLink(code, originalUrl) {
      await pool.execute('INSERT INTO links (code, original_url) VALUES (?, ?)', [code, originalUrl]);
    },

    async findByCode(code) {
      const [rows] = await pool.execute('SELECT code, original_url FROM links WHERE code = ?', [code]);
      return rows[0] || null;
    },

    async incrementClicks(code) {
      await pool.execute('UPDATE links SET clicks = clicks + 1 WHERE code = ?', [code]);
    },

    async listLinks(limit = 50) {
      const [rows] = await pool.query(
        'SELECT code, original_url AS originalUrl, clicks, created_at AS createdAt FROM links ORDER BY id DESC LIMIT ?',
        [limit]
      );
      return rows;
    },

    close() {
      return pool.end();
    },
  };
}

module.exports = { createDb };
