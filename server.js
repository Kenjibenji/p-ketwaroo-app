const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function runMigrations() {
  await pool.query(`
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending'
  `);
  await pool.query(`
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS amount_paid DECIMAL(10,2) NOT NULL DEFAULT 0
  `);
}

function normalizeItems(items, oldLoadedMap) {
  return items.map(it => {
    const q = parseInt(it.quantity) || 0;
    const t = Math.max(0, Math.min(q, parseInt(it.taken) || 0));
    const wasLoaded = oldLoadedMap ? !!oldLoadedMap[it.id] : false;
    const incomingLoaded = it.loaded !== undefined ? !!it.loaded : wasLoaded;
    return {
      id: it.id,
      name: it.name,
      price: parseFloat(it.price) || 0,
      quantity: q,
      taken: t,
      loaded: t >= q ? true : incomingLoaded,
    };
  });
}

pool.query('SELECT NOW()').then(() => {
  console.log('Database connected');
  return runMigrations();
}).catch(err => console.error('Startup error:', err.message));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.get('/ping', (req, res) => res.json({ ok: true, version: 'v3-single-html', node: process.version, cwd: process.cwd() }));

// ===== STATS =====

app.get('/api/stats', async (req, res) => {
  try {
    const [todayOrders, pendingOrders, lowStock, revenue] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM orders WHERE created_at::date = CURRENT_DATE`),
      pool.query(`SELECT COUNT(*) FROM orders WHERE status = 'pending'`),
      pool.query(`SELECT COUNT(*) FROM products WHERE stock < 10`),
      pool.query(`SELECT COALESCE(SUM(total), 0) AS total FROM orders WHERE created_at::date = CURRENT_DATE`),
    ]);
    res.json({
      todayOrders: parseInt(todayOrders.rows[0].count),
      pendingOrders: parseInt(pendingOrders.rows[0].count),
      lowStockCount: parseInt(lowStock.rows[0].count),
      todayRevenue: parseFloat(revenue.rows[0].total),
    });
  } catch {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ===== CUSTOMERS =====

app.get('/api/customers', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT customer_name FROM orders ORDER BY customer_name`
    );
    res.json(result.rows.map(r => r.customer_name));
  } catch {
    res.status(500).json({ error: 'Failed to fetch customers' });
  }
});

// ===== PRODUCTS =====

app.get('/api/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products ORDER BY id');
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

app.post('/api/products', async (req, res) => {
  const { name, category, price, stock } = req.body;
  if (!name || !category || price == null || stock == null)
    return res.status(400).json({ error: 'name, category, price, and stock are required' });
  const parsedPrice = parseFloat(price);
  const parsedStock = parseInt(stock);
  if (isNaN(parsedPrice) || parsedPrice < 0) return res.status(400).json({ error: 'Invalid price' });
  if (isNaN(parsedStock) || parsedStock < 0) return res.status(400).json({ error: 'Invalid stock' });

  try {
    const result = await pool.query(
      'INSERT INTO products (name, category, price, stock) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, category, parsedPrice, parsedStock]
    );
    res.status(201).json(result.rows[0]);
  } catch {
    res.status(500).json({ error: 'Failed to add product' });
  }
});

app.put('/api/products/:id', async (req, res) => {
  const { id } = req.params;
  const { name, category, price, stock } = req.body;
  if (!name || !category || price == null || stock == null)
    return res.status(400).json({ error: 'name, category, price, and stock are required' });
  const parsedPrice = parseFloat(price);
  const parsedStock = parseInt(stock);
  if (isNaN(parsedPrice) || parsedPrice < 0) return res.status(400).json({ error: 'Invalid price' });
  if (isNaN(parsedStock) || parsedStock < 0) return res.status(400).json({ error: 'Invalid stock' });

  try {
    const result = await pool.query(
      'UPDATE products SET name=$1, category=$2, price=$3, stock=$4 WHERE id=$5 RETURNING *',
      [name, category, parsedPrice, parsedStock, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Product not found' });
    res.json(result.rows[0]);
  } catch {
    res.status(500).json({ error: 'Failed to update product' });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM products WHERE id=$1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Product not found' });
    res.json({ message: 'Product deleted' });
  } catch {
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// ===== ORDERS =====

app.post('/api/orders', async (req, res) => {
  const { customer_name, items, subtotal, tax, total, amount_paid } = req.body;
  if (!customer_name || !items || !Array.isArray(items) || items.length === 0)
    return res.status(400).json({ error: 'customer_name and at least one item are required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const item of items) {
      const stockRes = await client.query(
        'SELECT stock, name FROM products WHERE id=$1 FOR UPDATE',
        [item.id]
      );
      if (stockRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: `Product "${item.name}" not found` });
      }
      const available = stockRes.rows[0].stock;
      if (available < item.quantity) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Not enough stock for "${item.name}". Available: ${available}, requested: ${item.quantity}`
        });
      }
      await client.query('UPDATE products SET stock = stock - $1 WHERE id=$2', [item.quantity, item.id]);
    }

    const normalized = normalizeItems(items, null);
    const initialStatus = normalized.every(i => i.loaded) ? 'loaded' : 'pending';
    const paid = Math.max(0, parseFloat(amount_paid) || 0);

    const result = await client.query(
      `INSERT INTO orders (customer_name, items, subtotal, tax, total, amount_paid, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING *`,
      [customer_name, JSON.stringify(normalized), subtotal ?? 0, tax ?? 0, total ?? 0, paid, initialStatus]
    );

    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to create order' });
  } finally {
    client.release();
  }
});

app.get('/api/orders', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

app.patch('/api/orders/:id/items', async (req, res) => {
  const { id } = req.params;
  const { items, status } = req.body;
  if (!items || !Array.isArray(items))
    return res.status(400).json({ error: 'items array is required' });
  const validStatuses = ['pending', 'loaded'];
  if (status && !validStatuses.includes(status))
    return res.status(400).json({ error: 'Invalid status' });

  try {
    const result = await pool.query(
      'UPDATE orders SET items=$1, status=$2 WHERE id=$3 RETURNING *',
      [JSON.stringify(items), status || 'pending', id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Order not found' });
    res.json(result.rows[0]);
  } catch {
    res.status(500).json({ error: 'Failed to update order' });
  }
});

app.patch('/api/orders/:id/paid', async (req, res) => {
  const { id } = req.params;
  const { amount_paid } = req.body;
  if (amount_paid === undefined) return res.status(400).json({ error: 'amount_paid is required' });
  const paid = Math.max(0, parseFloat(amount_paid) || 0);
  try {
    const result = await pool.query(
      'UPDATE orders SET amount_paid=$1 WHERE id=$2 RETURNING *',
      [paid, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Order not found' });
    res.json(result.rows[0]);
  } catch {
    res.status(500).json({ error: 'Failed to update payment' });
  }
});

app.patch('/api/orders/:id/customer', async (req, res) => {
  const { id } = req.params;
  const { customer_name } = req.body;
  const name = typeof customer_name === 'string' ? customer_name.trim() : '';
  if (!name) return res.status(400).json({ error: 'customer_name is required' });
  try {
    const result = await pool.query(
      'UPDATE orders SET customer_name=$1 WHERE id=$2 RETURNING *',
      [name, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Order not found' });
    res.json(result.rows[0]);
  } catch {
    res.status(500).json({ error: 'Failed to update customer name' });
  }
});

app.put('/api/orders/:id', async (req, res) => {
  const { id } = req.params;
  const { items, customer_name, amount_paid } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0)
    return res.status(400).json({ error: 'At least one item is required' });
  const newName = typeof customer_name === 'string' ? customer_name.trim() : null;
  if (customer_name !== undefined && !newName)
    return res.status(400).json({ error: 'customer_name cannot be empty' });
  const newPaid = amount_paid !== undefined ? Math.max(0, parseFloat(amount_paid) || 0) : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const orderRes = await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [id]);
    if (!orderRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Order not found' });
    }

    let oldItems = orderRes.rows[0].items;
    if (typeof oldItems === 'string') try { oldItems = JSON.parse(oldItems); } catch { oldItems = []; }
    if (!Array.isArray(oldItems)) oldItems = [];

    // Build qty maps and reconcile stock
    const oldQty = {}, newQty = {};
    for (const it of oldItems) oldQty[it.id] = (oldQty[it.id] || 0) + (it.quantity || 0);
    for (const it of items)    newQty[it.id] = (newQty[it.id] || 0) + (it.quantity || 0);

    const allPids = new Set([...Object.keys(oldQty), ...Object.keys(newQty)].map(Number));
    for (const pid of allPids) {
      const delta = (newQty[pid] || 0) - (oldQty[pid] || 0);
      if (delta === 0) continue;
      if (delta > 0) {
        const sr = await client.query('SELECT stock, name FROM products WHERE id=$1 FOR UPDATE', [pid]);
        if (!sr.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Product not found' }); }
        if (sr.rows[0].stock < delta) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `Not enough stock for "${sr.rows[0].name}". Available: ${sr.rows[0].stock}` });
        }
        await client.query('UPDATE products SET stock = stock - $1 WHERE id=$2', [delta, pid]);
      } else {
        await client.query('UPDATE products SET stock = stock + $1 WHERE id=$2', [-delta, pid]);
      }
    }

    const oldLoaded = {};
    for (const it of oldItems) oldLoaded[it.id] = it.loaded || false;
    const updated = normalizeItems(items, oldLoaded);
    const total = updated.reduce((s, it) => s + it.price * it.quantity, 0);
    const status = updated.every(it => it.loaded) ? 'loaded' : 'pending';

    const setParts = ['items=$1','subtotal=$2','tax=0','total=$3','status=$4'];
    const params = [JSON.stringify(updated), total, total, status];
    if (newName !== null) { params.push(newName); setParts.push(`customer_name=$${params.length}`); }
    if (newPaid !== null) { params.push(newPaid);  setParts.push(`amount_paid=$${params.length}`); }
    params.push(id);
    const result = await client.query(
      `UPDATE orders SET ${setParts.join(', ')} WHERE id=$${params.length} RETURNING *`,
      params
    );
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to update order' });
  } finally {
    client.release();
  }
});

app.delete('/api/orders/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM orders WHERE id=$1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Order not found' });
    res.json({ message: 'Order deleted' });
  } catch {
    res.status(500).json({ error: 'Failed to delete order' });
  }
});

// Kill the old CRA service worker so it stops serving cached pages
app.get('/service-worker.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-store');
  res.send(`
    self.addEventListener('install', () => self.skipWaiting());
    self.addEventListener('activate', async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
      await self.clients.claim();
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach(c => c.navigate(c.url));
    });
  `);
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
