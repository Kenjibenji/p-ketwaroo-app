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
}

pool.query('SELECT NOW()').then(() => {
  console.log('Database connected');
  return runMigrations();
}).catch(err => console.error('Startup error:', err.message));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

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
  const { customer_name, items, subtotal, tax, total } = req.body;
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

    const itemsWithLoaded = items.map(i => ({ ...i, loaded: false }));
    const result = await client.query(
      `INSERT INTO orders (customer_name, items, subtotal, tax, total, status, created_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', NOW()) RETURNING *`,
      [customer_name, JSON.stringify(itemsWithLoaded), subtotal ?? 0, tax ?? 0, total ?? 0]
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

app.get('/service-worker.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'frontend/build/service-worker.js'));
});

app.use(express.static(path.join(__dirname, 'frontend/build')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend/build/index.html'), (err) => {
    if (err) res.status(200).send('<html><body><h2>App loading...</h2><p>Build not found. Server is up.</p></body></html>');
  });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
