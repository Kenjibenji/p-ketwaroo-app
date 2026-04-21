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

pool.query('SELECT NOW()').then(() => {
  console.log('Database connected');
}).catch(err => {
  console.error('Database connection failed:', err.message);
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ===== PRODUCTS =====

app.get('/api/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

app.post('/api/products', async (req, res) => {
  const { name, category, price, stock } = req.body;
  if (!name || !category || price == null || stock == null) {
    return res.status(400).json({ error: 'name, category, price, and stock are required' });
  }
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
  } catch (err) {
    res.status(500).json({ error: 'Failed to add product' });
  }
});

app.put('/api/products/:id', async (req, res) => {
  const { id } = req.params;
  const { name, category, price, stock } = req.body;
  if (!name || !category || price == null || stock == null) {
    return res.status(400).json({ error: 'name, category, price, and stock are required' });
  }
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
  } catch (err) {
    res.status(500).json({ error: 'Failed to update product' });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM products WHERE id=$1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Product not found' });
    res.json({ message: 'Product deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// ===== ORDERS =====

app.post('/api/orders', async (req, res) => {
  const { customer_name, items, subtotal, tax, total } = req.body;
  if (!customer_name || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'customer_name and at least one item are required' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO orders (customer_name, items, subtotal, tax, total, created_at) VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *',
      [customer_name, JSON.stringify(items), subtotal ?? 0, tax ?? 0, total ?? 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create order' });
  }
});

app.get('/api/orders', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

app.delete('/api/orders/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM orders WHERE id=$1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Order not found' });
    res.json({ message: 'Order deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete order' });
  }
});

// Serve service worker without caching
app.get('/service-worker.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'frontend/build/service-worker.js'));
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'frontend/build')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend/build/index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
