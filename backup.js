// Backup script: dumps products + orders to backups/YYYY-MM-DD.json
// Run manually: `node backup.js`
// Run on a schedule (recommended): GitHub Actions or Windows Task Scheduler
//
// Keeps the last 30 daily backups; older ones are deleted.

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config();

const KEEP_DAYS = 30;
const BACKUP_DIR = path.join(__dirname, 'backups');

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const c = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await c.connect();
    const products = (await c.query('SELECT * FROM products ORDER BY id')).rows;
    const orders = (await c.query('SELECT * FROM orders ORDER BY id')).rows;
    const today = new Date().toISOString().slice(0, 10);
    const file = path.join(BACKUP_DIR, `${today}.json`);
    fs.writeFileSync(
      file,
      JSON.stringify(
        { takenAt: new Date().toISOString(), counts: { products: products.length, orders: orders.length }, products, orders },
        null,
        2
      )
    );
    console.log(`Wrote ${file} (${products.length} products, ${orders.length} orders)`);

    // Prune old backups
    const cutoff = Date.now() - KEEP_DAYS * 86400000;
    for (const f of fs.readdirSync(BACKUP_DIR)) {
      if (!f.endsWith('.json')) continue;
      const p = path.join(BACKUP_DIR, f);
      if (fs.statSync(p).mtimeMs < cutoff) {
        fs.unlinkSync(p);
        console.log(`Pruned ${f}`);
      }
    }
  } catch (e) {
    console.error('Backup failed:', e.message);
    process.exit(1);
  } finally {
    try { await c.end(); } catch {}
  }
})();
