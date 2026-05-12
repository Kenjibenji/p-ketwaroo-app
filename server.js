const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
// override: true so .env values win over any empty shell env vars
require('dotenv').config({ override: true });

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
// Allow larger bodies for photo uploads
app.use(express.json({ limit: '15mb' }));

const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

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
  await pool.query(`
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      customer_name VARCHAR(255) NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      paid_at TIMESTAMP NOT NULL DEFAULT NOW(),
      note TEXT,
      allocations JSONB NOT NULL DEFAULT '[]'::jsonb
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_payments_customer ON payments(customer_name)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customer_meta (
      customer_name VARCHAR(255) PRIMARY KEY,
      phone VARCHAR(50),
      notes TEXT
    )
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

app.get('/api/customers/full', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        o.customer_name AS name,
        COUNT(DISTINCT o.id)::int AS order_count,
        COALESCE(SUM(o.total), 0)::numeric AS total_spent,
        COALESCE(SUM(o.total - o.amount_paid), 0)::numeric AS balance,
        MAX(o.created_at) AS last_order_at,
        m.phone,
        m.notes
      FROM orders o
      LEFT JOIN customer_meta m ON m.customer_name = o.customer_name
      GROUP BY o.customer_name, m.phone, m.notes
      ORDER BY MAX(o.created_at) DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch customers' });
  }
});

app.get('/api/customers/:name', async (req, res) => {
  const name = req.params.name;
  try {
    const [orders, payments, meta] = await Promise.all([
      pool.query('SELECT * FROM orders WHERE customer_name=$1 ORDER BY created_at DESC', [name]),
      pool.query('SELECT * FROM payments WHERE customer_name=$1 ORDER BY paid_at DESC', [name]),
      pool.query('SELECT phone, notes FROM customer_meta WHERE customer_name=$1', [name]),
    ]);
    if (orders.rows.length === 0) return res.status(404).json({ error: 'Customer not found' });
    const totals = orders.rows.reduce((acc, o) => {
      acc.total_spent += parseFloat(o.total) || 0;
      acc.balance += (parseFloat(o.total) || 0) - (parseFloat(o.amount_paid) || 0);
      return acc;
    }, { total_spent: 0, balance: 0 });
    res.json({
      name,
      phone: meta.rows[0]?.phone || '',
      notes: meta.rows[0]?.notes || '',
      total_spent: totals.total_spent,
      balance: totals.balance,
      orders: orders.rows,
      payments: payments.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch customer' });
  }
});

app.put('/api/customers/:name/meta', async (req, res) => {
  const name = req.params.name;
  const phone = (req.body?.phone || '').toString().trim() || null;
  const notes = (req.body?.notes || '').toString().trim() || null;
  try {
    const exists = await pool.query('SELECT 1 FROM orders WHERE customer_name=$1 LIMIT 1', [name]);
    if (!exists.rows.length) return res.status(404).json({ error: 'Customer not found' });
    await pool.query(`
      INSERT INTO customer_meta (customer_name, phone, notes)
      VALUES ($1, $2, $3)
      ON CONFLICT (customer_name) DO UPDATE SET phone=EXCLUDED.phone, notes=EXCLUDED.notes
    `, [name, phone, notes]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update customer' });
  }
});

app.put('/api/customers/:name/rename', async (req, res) => {
  const name = req.params.name;
  const newName = (req.body?.new_name || '').toString().trim();
  if (!newName) return res.status(400).json({ error: 'new_name is required' });
  if (newName === name) return res.json({ ok: true });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE orders SET customer_name=$1 WHERE customer_name=$2', [newName, name]);
    await client.query('UPDATE payments SET customer_name=$1 WHERE customer_name=$2', [newName, name]);
    // merge meta: if both exist, keep the destination meta; otherwise move
    const dst = await client.query('SELECT 1 FROM customer_meta WHERE customer_name=$1', [newName]);
    if (dst.rows.length) {
      await client.query('DELETE FROM customer_meta WHERE customer_name=$1', [name]);
    } else {
      await client.query('UPDATE customer_meta SET customer_name=$1 WHERE customer_name=$2', [newName, name]);
    }
    await client.query('COMMIT');
    res.json({ ok: true, name: newName });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to rename customer' });
  } finally {
    client.release();
  }
});

app.post('/api/customers/:name/payments', async (req, res) => {
  const name = req.params.name;
  const amount = Math.max(0, parseFloat(req.body?.amount) || 0);
  const note = (req.body?.note || '').toString().trim() || null;
  if (amount <= 0) return res.status(400).json({ error: 'amount must be > 0' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const unpaid = await client.query(
      `SELECT id, total, amount_paid FROM orders
       WHERE customer_name=$1 AND amount_paid < total
       ORDER BY created_at ASC FOR UPDATE`,
      [name]
    );
    let remaining = amount;
    const allocations = [];
    for (const o of unpaid.rows) {
      if (remaining <= 0) break;
      const owed = (parseFloat(o.total) || 0) - (parseFloat(o.amount_paid) || 0);
      if (owed <= 0) continue;
      const apply = Math.min(remaining, owed);
      const newPaid = (parseFloat(o.amount_paid) || 0) + apply;
      await client.query('UPDATE orders SET amount_paid=$1 WHERE id=$2', [newPaid, o.id]);
      allocations.push({ order_id: o.id, amount: apply });
      remaining -= apply;
    }
    const overpay = remaining > 0.0001 ? remaining : 0;
    const result = await client.query(
      `INSERT INTO payments (customer_name, amount, note, allocations)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [name, amount, note, JSON.stringify(allocations)]
    );
    await client.query('COMMIT');
    res.status(201).json({ payment: result.rows[0], applied: amount - overpay, overpay });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to log payment' });
  } finally {
    client.release();
  }
});

app.delete('/api/payments/:id', async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pr = await client.query('SELECT * FROM payments WHERE id=$1 FOR UPDATE', [id]);
    if (!pr.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Payment not found' });
    }
    let allocs = pr.rows[0].allocations;
    if (typeof allocs === 'string') try { allocs = JSON.parse(allocs); } catch { allocs = []; }
    if (!Array.isArray(allocs)) allocs = [];
    for (const a of allocs) {
      const sr = await client.query('SELECT amount_paid FROM orders WHERE id=$1 FOR UPDATE', [a.order_id]);
      if (!sr.rows.length) continue;
      const newPaid = Math.max(0, (parseFloat(sr.rows[0].amount_paid) || 0) - (parseFloat(a.amount) || 0));
      await client.query('UPDATE orders SET amount_paid=$1 WHERE id=$2', [newPaid, a.order_id]);
    }
    await client.query('DELETE FROM payments WHERE id=$1', [id]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to delete payment' });
  } finally {
    client.release();
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

app.patch('/api/orders/:id/delivered', async (req, res) => {
  const { id } = req.params;
  const delivered = !!req.body?.delivered;
  try {
    const result = await pool.query(
      delivered
        ? 'UPDATE orders SET delivered_at = NOW() WHERE id=$1 RETURNING *'
        : 'UPDATE orders SET delivered_at = NULL WHERE id=$1 RETURNING *',
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Order not found' });
    res.json(result.rows[0]);
  } catch {
    res.status(500).json({ error: 'Failed to update delivery status' });
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

// ===== SCAN LIST (photo of handwritten list -> matched line items) =====

app.post('/api/scan-list', async (req, res) => {
  if (!anthropic) {
    return res.status(503).json({ error: 'Scanning is unavailable: ANTHROPIC_API_KEY is not configured on the server.' });
  }
  const { image, mime_type } = req.body || {};
  if (!image || typeof image !== 'string') {
    return res.status(400).json({ error: 'image (base64 string) is required' });
  }
  const mime = (mime_type || 'image/jpeg').toString();
  if (!/^image\/(jpeg|png|webp|gif)$/.test(mime)) {
    return res.status(400).json({ error: 'image must be jpeg/png/webp/gif' });
  }

  try {
    // Build the product catalog string. Stable order = better cache hit rate.
    const prodRes = await pool.query('SELECT id, name, category, price, stock FROM products ORDER BY id');
    const products = prodRes.rows;
    const catalogText = products
      .map(p => `${p.id}|${p.name}|${p.category}|${parseFloat(p.price)}|${p.stock}`)
      .join('\n');

    const systemBlocks = [
      {
        type: 'text',
        text:
          "You read photos of handwritten customer order lists for a Guyanese wholesale shop (P. Ketwaroo & Sons) " +
          "and convert them into structured order items by matching against this product catalog.\n\n" +
          "Catalog (id|name|category|price|stock):\n" + catalogText + "\n\n" +
          "Matching rules:\n" +
          "- Customers use abbreviations, shorthand, Creole spelling, and inconsistent casing. " +
          "  Examples: 'sard 1/4' -> '1/4 sard'; 'corn mut' -> 'corned mutton suri'; 'cnd milk' -> 'Cndse mlk moi'.\n" +
          "- If a line clearly maps to one catalog product, set product_id and confidence='high'.\n" +
          "- If two products plausibly match, pick the most likely and set confidence='medium', list other candidates in notes.\n" +
          "- If you cannot match at all, set product_id=null and confidence='low' so the human reviews it.\n" +
          "- Quantity: if not written, default qty=1. Numbers like '1c' or '1 case' mean 1.\n" +
          "- Skip lines that are obviously not items (totals, dates, names, doodles).\n",
        cache_control: { type: 'ephemeral' },
      },
    ];

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2048,
      system: systemBlocks,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mime, data: image } },
            {
              type: 'text',
              text:
                "Read every line on this handwritten list. Return STRICT JSON only, no markdown fence, in this exact shape:\n" +
                '{"items":[{"product_id":number|null,"qty":number,"confidence":"high"|"medium"|"low","raw_text":string,"note":string}]}\n' +
                "raw_text = the line as written. note = brief explanation if confidence < high (e.g. 'could also be X')."
            },
          ],
        },
      ],
    });

    const text = (msg.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim();
    let parsed;
    try {
      // Strip possible code fences just in case
      const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error('scan-list parse error:', e.message, 'raw:', text.slice(0, 500));
      return res.status(502).json({ error: 'Could not parse scan response', raw: text });
    }

    // Enrich with current product data so the client can render confidently
    const byId = new Map(products.map(p => [p.id, p]));
    const items = (parsed.items || []).map(it => {
      const p = it.product_id ? byId.get(it.product_id) : null;
      return {
        product_id: p ? p.id : null,
        name: p ? p.name : null,
        price: p ? parseFloat(p.price) : null,
        stock: p ? p.stock : null,
        qty: Math.max(1, parseInt(it.qty) || 1),
        confidence: ['high', 'medium', 'low'].includes(it.confidence) ? it.confidence : 'low',
        raw_text: (it.raw_text || '').toString().slice(0, 200),
        note: (it.note || '').toString().slice(0, 200),
      };
    });

    res.json({
      items,
      usage: msg.usage,
    });
  } catch (err) {
    console.error('scan-list error:', err);
    const raw = err?.message || '';
    let friendly = 'Scan failed. Try again with a clearer photo.';
    if (/credit balance/i.test(raw)) {
      friendly = 'Anthropic account is out of credits. Add credits at console.anthropic.com → Billing.';
    } else if (/rate.?limit|429/i.test(raw)) {
      friendly = 'Too many scans at once — wait a few seconds and try again.';
    } else if (/api[_ ]?key|401|authentication/i.test(raw)) {
      friendly = 'Anthropic API key is invalid or missing. Check ANTHROPIC_API_KEY in Render env vars.';
    } else if (/timeout/i.test(raw)) {
      friendly = 'The scan timed out. Try a smaller / clearer photo.';
    }
    res.status(500).json({ error: friendly });
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
