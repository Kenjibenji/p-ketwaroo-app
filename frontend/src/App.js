import React, { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';

// ===== TOAST =====

function useToast() {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);
  const show = useCallback((message, type = 'info') => {
    const id = ++idRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  }, []);
  const dismiss = useCallback((id) => setToasts(prev => prev.filter(t => t.id !== id)), []);
  return { toasts, show, dismiss };
}

function Toast({ toasts, onDismiss }) {
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`} onClick={() => onDismiss(t.id)}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

// ===== CONFIRM MODAL =====

function useConfirm() {
  const [pending, setPending] = useState(null);
  const confirm = (message) => new Promise(resolve => setPending({ message, resolve }));
  const handleConfirm = () => { pending.resolve(true); setPending(null); };
  const handleCancel = () => { pending.resolve(false); setPending(null); };
  const modal = pending ? (
    <div className="modal-overlay">
      <div className="modal">
        <p>{pending.message}</p>
        <div className="modal-actions">
          <button className="btn btn-danger" onClick={handleConfirm}>Delete</button>
          <button className="btn btn-ghost" onClick={handleCancel}>Cancel</button>
        </div>
      </div>
    </div>
  ) : null;
  return { confirm, modal };
}

// ===== SHARED COMPONENTS =====

function StatusBadge({ status }) {
  const map = { pending: 'Pending', loaded: 'Loaded' };
  return <span className={`status-badge status-${status}`}>{map[status] || status}</span>;
}

function StockBadge({ stock }) {
  if (stock === 0) return <span className="stock-badge stock-out">Out</span>;
  if (stock < 5)  return <span className="stock-badge stock-critical">{stock}</span>;
  if (stock < 10) return <span className="stock-badge stock-low">{stock}</span>;
  return <span>{stock}</span>;
}

function StatCard({ icon, label, value, accent }) {
  return (
    <div className={`stat-card accent-${accent}`}>
      <div className="stat-icon">{icon}</div>
      <div className="stat-body">
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}

const fmt = (n) => parseFloat(n || 0).toFixed(2);

const parseItems = (items) => {
  if (Array.isArray(items)) return items;
  try { return JSON.parse(items); } catch { return []; }
};

// ===== DASHBOARD =====

function DashboardTab({ stats, orders, onTabChange }) {
  const recent = orders.slice(0, 6);
  return (
    <div className="dashboard-tab">
      <div className="stat-grid">
        <StatCard icon="📦" label="Orders Today"     value={stats.todayOrders  ?? '—'} accent="blue" />
        <StatCard icon="💰" label="Today's Revenue"  value={`$${fmt(stats.todayRevenue)}`} accent="green" />
        <StatCard icon="⏳" label="Pending Orders"   value={stats.pendingOrders ?? '—'} accent="amber" />
        <StatCard icon="⚠️" label="Low Stock Items"  value={stats.lowStockCount ?? '—'} accent="red" />
      </div>

      <div className="panel">
        <div className="panel-header">
          <h3>Recent Orders</h3>
          <button className="btn-link" onClick={() => onTabChange('orders')}>View all →</button>
        </div>
        {recent.length === 0 ? (
          <p className="empty-state">No orders yet.</p>
        ) : (
          <div className="recent-list">
            {recent.map(o => (
              <div key={o.id} className="recent-row">
                <div className="recent-left">
                  <span className="tag-muted">#{o.id}</span>
                  <span className="recent-customer">{o.customer_name}</span>
                  <span className="tag-muted">{new Date(o.created_at).toLocaleDateString()}</span>
                </div>
                <div className="recent-right">
                  <span className="recent-amount">${fmt(o.total)}</span>
                  <StatusBadge status={o.status || 'pending'} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ===== PRODUCTS =====

function ProductsTab({ products, onRefresh, toast, confirm, API_URL }) {
  const [form, setForm] = useState({ name: '', category: '', price: '', stock: '' });
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('All');

  const categories = ['All', ...Array.from(new Set(products.map(p => p.category).filter(Boolean))).sort()];

  const filtered = products.filter(p => {
    const q = search.toLowerCase();
    return (
      (p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q) || p.id.toString().includes(q)) &&
      (catFilter === 'All' || p.category === catFilter)
    );
  });

  const resetForm = () => { setForm({ name: '', category: '', price: '', stock: '' }); setEditingId(null); };

  const handleSave = async () => {
    if (!form.name || !form.category || !form.price || !form.stock) {
      toast('Please fill all fields', 'error'); return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        editingId ? `${API_URL}/products/${editingId}` : `${API_URL}/products`,
        {
          method: editingId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: form.name, category: form.category,
            price: parseFloat(form.price), stock: parseInt(form.stock),
          }),
        }
      );
      if (res.ok) { resetForm(); onRefresh(); toast(editingId ? 'Product updated' : 'Product added', 'success'); }
      else { const d = await res.json(); toast(d.error || 'Failed to save', 'error'); }
    } catch { toast('Failed to save product', 'error'); }
    finally { setLoading(false); }
  };

  const handleDelete = async (id) => {
    if (!await confirm('Delete this product?')) return;
    try {
      const res = await fetch(`${API_URL}/products/${id}`, { method: 'DELETE' });
      if (res.ok) { onRefresh(); toast('Product deleted', 'success'); }
      else { const d = await res.json(); toast(d.error || 'Failed to delete', 'error'); }
    } catch { toast('Failed to delete product', 'error'); }
  };

  return (
    <div className="products-tab">
      <div className="panel">
        <h3 className="panel-title">{editingId ? 'Edit Product' : 'Add New Product'}</h3>
        <div className="form-grid-4">
          <div className="form-group">
            <label>Product Name</label>
            <input type="text" placeholder="e.g. Cement Bag 50kg" value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Category</label>
            <input type="text" placeholder="e.g. Building Materials" value={form.category}
              onChange={e => setForm({ ...form, category: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Price ($)</label>
            <input type="number" step="0.01" min="0" placeholder="0.00" value={form.price}
              onChange={e => setForm({ ...form, price: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Stock</label>
            <input type="number" min="0" placeholder="0" value={form.stock}
              onChange={e => setForm({ ...form, stock: e.target.value })} />
          </div>
        </div>
        <div className="form-actions">
          <button onClick={handleSave} disabled={loading} className="btn btn-primary">
            {loading ? 'Saving...' : editingId ? 'Update Product' : 'Add Product'}
          </button>
          {editingId && <button onClick={resetForm} className="btn btn-ghost">Cancel</button>}
        </div>
      </div>

      <div className="panel">
        <h3 className="panel-title">Products</h3>
        <div className="filter-bar">
          <input type="text" className="search-input" placeholder="Search by name, category, or ID..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="pill-row">
          {categories.map(cat => (
            <button key={cat} className={`pill ${catFilter === cat ? 'pill-active' : ''}`}
              onClick={() => setCatFilter(cat)}>{cat}</button>
          ))}
        </div>

        {products.length === 0 ? (
          <p className="empty-state">No products yet. Add your first one above.</p>
        ) : filtered.length === 0 ? (
          <p className="empty-state">No products match your search.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th><th>Name</th><th>Category</th><th>Price</th><th>Stock</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => (
                  <tr key={p.id} className={p.stock === 0 ? 'row-critical' : p.stock < 5 ? 'row-critical' : p.stock < 10 ? 'row-warning' : ''}>
                    <td className="td-muted">{p.id}</td>
                    <td><strong>{p.name}</strong></td>
                    <td><span className="cat-tag">{p.category}</span></td>
                    <td>${fmt(p.price)}</td>
                    <td><StockBadge stock={p.stock} /></td>
                    <td>
                      <div className="action-btns">
                        <button onClick={() => { setForm({ name: p.name, category: p.category, price: p.price.toString(), stock: p.stock.toString() }); setEditingId(p.id); }} className="btn btn-sm btn-success">Edit</button>
                        <button onClick={() => handleDelete(p.id)} className="btn btn-sm btn-danger">Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ===== CREATE ORDER =====

function CreateOrderTab({ products, customers, onOrderCreated, toast, API_URL }) {
  const [customerName, setCustomerName] = useState('');
  const [showCustDrop, setShowCustDrop] = useState(false);
  const [selectedItems, setSelectedItems] = useState([]);
  const [productSearch, setProductSearch] = useState('');
  const [showProdDrop, setShowProdDrop] = useState(false);
  const [loading, setLoading] = useState(false);

  const filteredCustomers = customers.filter(c =>
    c.toLowerCase().includes(customerName.toLowerCase())
  ).slice(0, 8);

  const filteredProducts = products.filter(p =>
    p.name.toLowerCase().includes(productSearch.toLowerCase())
  );

  const total = selectedItems.reduce((sum, i) => sum + parseFloat(i.price) * i.quantity, 0);

  const addItem = (product) => {
    setSelectedItems(prev => {
      const existing = prev.find(i => i.id === product.id);
      return existing
        ? prev.map(i => i.id === product.id ? { ...i, quantity: i.quantity + 1 } : i)
        : [...prev, { ...product, quantity: 1 }];
    });
    setProductSearch('');
    setShowProdDrop(false);
  };

  const removeItem = (id) => setSelectedItems(prev => prev.filter(i => i.id !== id));

  const updateQty = (id, qty) => {
    if (qty <= 0) return removeItem(id);
    setSelectedItems(prev => prev.map(i => i.id === id ? { ...i, quantity: qty } : i));
  };

  const handleCreate = async () => {
    if (!customerName.trim()) { toast('Enter a customer name', 'error'); return; }
    if (selectedItems.length === 0) { toast('Select at least one item', 'error'); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_name: customerName.trim(), items: selectedItems, subtotal: total, tax: 0, total }),
      });
      if (res.ok) {
        setCustomerName(''); setSelectedItems([]);
        onOrderCreated();
        toast('Order created', 'success');
      } else {
        const d = await res.json(); toast(d.error || 'Failed to create order', 'error');
      }
    } catch { toast('Failed to create order', 'error'); }
    finally { setLoading(false); }
  };

  return (
    <div className="create-order-tab">
      <div className="panel">
        <h3 className="panel-title">New Order</h3>

        <div className="form-group">
          <label>Customer Name</label>
          <div className="dropdown-container">
            <input type="text" placeholder="Type or select customer..."
              value={customerName}
              onChange={e => { setCustomerName(e.target.value); setShowCustDrop(true); }}
              onFocus={() => setShowCustDrop(true)}
              onBlur={() => setTimeout(() => setShowCustDrop(false), 150)}
            />
            {showCustDrop && customerName.length > 0 && filteredCustomers.length > 0 && (
              <div className="dropdown-options">
                {filteredCustomers.map((c, i) => (
                  <div key={i} className="dropdown-option"
                    onMouseDown={() => { setCustomerName(c); setShowCustDrop(false); }}>
                    {c}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="form-group">
          <label>Add Products</label>
          <div className="dropdown-container">
            <input type="text" className="search-input" placeholder="Search product..."
              value={productSearch}
              onChange={e => { setProductSearch(e.target.value); setShowProdDrop(true); }}
              onFocus={() => setShowProdDrop(true)}
              onBlur={() => setTimeout(() => setShowProdDrop(false), 150)}
            />
            {showProdDrop && productSearch && (
              <div className="dropdown-options">
                {filteredProducts.length > 0 ? filteredProducts.map(p => (
                  <div key={p.id} className="dropdown-option" onMouseDown={() => addItem(p)}>
                    <span>{p.name}</span>
                    <span className="drop-meta">${fmt(p.price)} · {p.stock} in stock</span>
                  </div>
                )) : (
                  <div className="dropdown-option dropdown-empty">No products found</div>
                )}
              </div>
            )}
          </div>
        </div>

        {selectedItems.length > 0 && (
          <div className="order-items-box">
            <div className="order-items-title">Order Items</div>
            {selectedItems.map(item => (
              <div key={item.id} className="order-item-row">
                <div className="order-item-info">
                  <strong>{item.name}</strong>
                  <span className="tag-muted">${fmt(item.price)} each</span>
                </div>
                <div className="order-item-controls">
                  <button className="qty-btn" onClick={() => updateQty(item.id, item.quantity - 1)}>−</button>
                  <span className="qty-val">{item.quantity}</span>
                  <button className="qty-btn" onClick={() => updateQty(item.id, item.quantity + 1)}>+</button>
                  <span className="item-total">${fmt(item.price * item.quantity)}</span>
                  <button className="btn btn-sm btn-danger" onClick={() => removeItem(item.id)}>×</button>
                </div>
              </div>
            ))}
            <div className="order-total-bar">
              <span>Total</span>
              <span className="grand-total">${fmt(total)}</span>
            </div>
          </div>
        )}

        <button onClick={handleCreate} disabled={loading} className="btn btn-primary btn-full">
          {loading ? 'Creating...' : 'Create Order'}
        </button>
      </div>
    </div>
  );
}

// ===== ORDERS =====

function OrdersTab({ orders, onRefresh, toast, confirm, API_URL }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [expandedId, setExpandedId] = useState(null);
  const [localOrders, setLocalOrders] = useState(orders);

  useEffect(() => setLocalOrders(orders), [orders]);

  const filtered = localOrders.filter(o => {
    const q = search.toLowerCase();
    const matchSearch = o.customer_name.toLowerCase().includes(q) || o.id.toString().includes(q);
    const matchStatus = statusFilter === 'all' || (o.status || 'pending') === statusFilter;
    return matchSearch && matchStatus;
  });

  const toggleItem = async (order, idx) => {
    const items = parseItems(order.items).map((item, i) =>
      i === idx ? { ...item, loaded: !item.loaded } : item
    );
    const allLoaded = items.every(i => i.loaded);
    const newStatus = allLoaded ? 'loaded' : 'pending';

    setLocalOrders(prev => prev.map(o => o.id === order.id ? { ...o, items, status: newStatus } : o));

    try {
      await fetch(`${API_URL}/orders/${order.id}/items`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, status: newStatus }),
      });
    } catch {
      toast('Failed to save', 'error');
      onRefresh();
    }
  };

  const markAllLoaded = async (order) => {
    const items = parseItems(order.items).map(i => ({ ...i, loaded: true }));
    setLocalOrders(prev => prev.map(o => o.id === order.id ? { ...o, items, status: 'loaded' } : o));
    try {
      await fetch(`${API_URL}/orders/${order.id}/items`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, status: 'loaded' }),
      });
      toast('Order marked as loaded', 'success');
    } catch {
      toast('Failed to update order', 'error');
      onRefresh();
    }
  };

  const handleDelete = async (id) => {
    if (!await confirm('Delete this order?')) return;
    try {
      const res = await fetch(`${API_URL}/orders/${id}`, { method: 'DELETE' });
      if (res.ok) { onRefresh(); toast('Order deleted', 'success'); }
      else { const d = await res.json(); toast(d.error || 'Failed to delete', 'error'); }
    } catch { toast('Failed to delete order', 'error'); }
  };

  return (
    <div className="orders-tab">
      <div className="filter-bar">
        <input type="text" className="search-input" placeholder="Search by customer or order #..."
          value={search} onChange={e => setSearch(e.target.value)} />
        <div className="pill-row no-margin">
          {['all', 'pending', 'loaded'].map(s => (
            <button key={s} className={`pill ${statusFilter === s ? 'pill-active' : ''}`}
              onClick={() => setStatusFilter(s)}>
              {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="empty-state">No orders found.</p>
      ) : (
        <div className="orders-list">
          {filtered.map(order => {
            const items = parseItems(order.items).map(i => ({ ...i, loaded: i.loaded ?? false }));
            const status = order.status || 'pending';
            const loadedCount = items.filter(i => i.loaded).length;
            const allLoaded = loadedCount === items.length;
            const isExpanded = expandedId === order.id;

            return (
              <div key={order.id} className={`order-card ${status === 'loaded' ? 'order-done' : ''}`}>
                <div className="order-card-head" onClick={() => setExpandedId(isExpanded ? null : order.id)}>
                  <div className="order-head-left">
                    <span className="tag-muted">#{order.id}</span>
                    <span className="order-cust-name">{order.customer_name}</span>
                  </div>
                  <div className="order-head-right">
                    <span className="order-amt">${fmt(order.total)}</span>
                    <StatusBadge status={status} />
                    <span className="chevron">{isExpanded ? '▲' : '▼'}</span>
                  </div>
                </div>
                <div className="order-card-date">
                  {new Date(order.created_at).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                </div>

                {isExpanded && (
                  <div className="order-detail">
                    <div className="checklist-header">
                      <span className="checklist-title">Loading Checklist</span>
                      <span className="checklist-progress">{loadedCount}/{items.length} loaded</span>
                    </div>

                    <div className="checklist">
                      {items.map((item, idx) => (
                        <label key={idx} className={`checklist-item ${item.loaded ? 'checklist-done' : ''}`}>
                          <input type="checkbox" checked={item.loaded}
                            onChange={() => toggleItem({ ...order, items }, idx)} />
                          <span className="ci-name">{item.name}</span>
                          <span className="ci-qty">× {item.quantity}</span>
                          <span className="ci-price">${fmt(item.price * item.quantity)}</span>
                        </label>
                      ))}
                    </div>

                    {status !== 'loaded' ? (
                      <button
                        className={`btn btn-full ${allLoaded ? 'btn-success' : 'btn-ghost'}`}
                        onClick={() => allLoaded && markAllLoaded({ ...order, items })}
                        disabled={!allLoaded}
                      >
                        {allLoaded ? '✓ Mark as Fully Loaded' : `Check off all ${items.length} items to complete`}
                      </button>
                    ) : (
                      <div className="loaded-confirm">✓ All items loaded and verified</div>
                    )}

                    <button onClick={() => handleDelete(order.id)} className="btn btn-sm btn-danger order-delete-btn">
                      Delete Order
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ===== APP =====

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [stats, setStats] = useState({});

  const { toasts, show: toast, dismiss } = useToast();
  const { confirm, modal: confirmModal } = useConfirm();

  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

  const fetchAll = useCallback(async () => {
    try {
      const [p, o, c, s] = await Promise.all([
        fetch(`${API_URL}/products`).then(r => r.json()),
        fetch(`${API_URL}/orders`).then(r => r.json()),
        fetch(`${API_URL}/customers`).then(r => r.json()),
        fetch(`${API_URL}/stats`).then(r => r.json()),
      ]);
      setProducts(Array.isArray(p) ? p : []);
      setOrders(Array.isArray(o) ? o : []);
      setCustomers(Array.isArray(c) ? c : []);
      setStats(s && !s.error ? s : {});
    } catch {
      toast('Failed to load data', 'error');
    }
  }, [API_URL, toast]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const tabs = [
    { id: 'dashboard',     label: 'Dashboard' },
    { id: 'products',      label: 'Products' },
    { id: 'create-order',  label: 'Create Order' },
    { id: 'orders',        label: 'Orders' },
  ];

  return (
    <div className="app">
      <Toast toasts={toasts} onDismiss={dismiss} />
      {confirmModal}

      <header className="app-header">
        <div className="header-inner">
          <div className="header-logo">P.Ketwaroo <span className="header-amp">&amp;</span> Sons</div>
          <div className="header-sub">Inventory Management System</div>
        </div>
      </header>

      <nav className="app-nav">
        <div className="nav-inner">
          {tabs.map(tab => (
            <button key={tab.id}
              className={`nav-tab ${activeTab === tab.id ? 'nav-tab-active' : ''}`}
              onClick={() => setActiveTab(tab.id)}>
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      <main className="app-main">
        {activeTab === 'dashboard'    && <DashboardTab stats={stats} orders={orders} onTabChange={setActiveTab} />}
        {activeTab === 'products'     && <ProductsTab products={products} onRefresh={fetchAll} toast={toast} confirm={confirm} API_URL={API_URL} />}
        {activeTab === 'create-order' && <CreateOrderTab products={products} customers={customers} onOrderCreated={fetchAll} toast={toast} API_URL={API_URL} />}
        {activeTab === 'orders'       && <OrdersTab orders={orders} onRefresh={fetchAll} toast={toast} confirm={confirm} API_URL={API_URL} />}
      </main>
    </div>
  );
}

export default App;
