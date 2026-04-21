import React, { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';

// ===== TOAST =====

function useToast() {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);
  const show = useCallback((message, type) => {
    const t = type || 'info';
    const id = ++idRef.current;
    setToasts(function(prev) { return [...prev, { id: id, message: message, type: t }]; });
    setTimeout(function() { setToasts(function(prev) { return prev.filter(function(x) { return x.id !== id; }); }); }, 3000);
  }, []);
  const dismiss = useCallback(function(id) {
    setToasts(function(prev) { return prev.filter(function(x) { return x.id !== id; }); });
  }, []);
  return { toasts: toasts, show: show, dismiss: dismiss };
}

function Toast({ toasts, onDismiss }) {
  return (
    <div className="toast-container">
      {toasts.map(function(t) {
        return (
          <div key={t.id} className={'toast toast-' + t.type} onClick={function() { onDismiss(t.id); }}>
            {t.message}
          </div>
        );
      })}
    </div>
  );
}

// ===== CONFIRM MODAL =====

function useConfirm() {
  const [pending, setPending] = useState(null);
  const confirm = function(message) {
    return new Promise(function(resolve) { setPending({ message: message, resolve: resolve }); });
  };
  const handleConfirm = function() { pending.resolve(true); setPending(null); };
  const handleCancel = function() { pending.resolve(false); setPending(null); };
  var modal = pending ? (
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
  return { confirm: confirm, modal: modal };
}

// ===== SHARED COMPONENTS =====

function StatusBadge({ status }) {
  var labels = { pending: 'Pending', loaded: 'Loaded' };
  return <span className={'status-badge status-' + status}>{labels[status] || status}</span>;
}

function StockBadge({ stock }) {
  if (stock === 0) return <span className="stock-badge stock-out">Out</span>;
  if (stock < 5)  return <span className="stock-badge stock-critical">{stock}</span>;
  if (stock < 10) return <span className="stock-badge stock-low">{stock}</span>;
  return <span>{stock}</span>;
}

function StatCard({ icon, label, value, accent }) {
  return (
    <div className={'stat-card accent-' + accent}>
      <div className="stat-icon">{icon}</div>
      <div className="stat-body">
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}

function fmt(n) {
  return parseFloat(n || 0).toFixed(2);
}

function parseItems(items) {
  if (Array.isArray(items)) return items;
  try {
    return JSON.parse(items);
  } catch (err) {
    return [];
  }
}

// ===== DASHBOARD =====

function DashboardTab({ stats, orders, onTabChange }) {
  var recent = orders.slice(0, 6);
  return (
    <div className="dashboard-tab">
      <div className="stat-grid">
        <StatCard icon="📦" label="Orders Today"    value={stats.todayOrders  != null ? stats.todayOrders  : '—'} accent="blue" />
        <StatCard icon="💰" label="Today's Revenue" value={'$' + fmt(stats.todayRevenue)} accent="green" />
        <StatCard icon="⏳" label="Pending Orders"  value={stats.pendingOrders != null ? stats.pendingOrders : '—'} accent="amber" />
        <StatCard icon="⚠️" label="Low Stock Items" value={stats.lowStockCount != null ? stats.lowStockCount : '—'} accent="red" />
      </div>

      <div className="panel">
        <div className="panel-header">
          <h3>Recent Orders</h3>
          <button className="btn-link" onClick={function() { onTabChange('orders'); }}>View all →</button>
        </div>
        {recent.length === 0 ? (
          <p className="empty-state">No orders yet.</p>
        ) : (
          <div className="recent-list">
            {recent.map(function(o) {
              return (
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
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ===== PRODUCTS =====

function ProductsTab({ products, onRefresh, toast, confirm, API_URL }) {
  var emptyForm = { name: '', category: '', price: '', stock: '' };
  var [form, setForm] = useState(emptyForm);
  var [editingId, setEditingId] = useState(null);
  var [saving, setSaving] = useState(false);
  var [search, setSearch] = useState('');
  var [catFilter, setCatFilter] = useState('All');

  var catSet = ['All'];
  products.forEach(function(p) { if (p.category && catSet.indexOf(p.category) === -1) catSet.push(p.category); });
  catSet.sort(function(a, b) { return a === 'All' ? -1 : b === 'All' ? 1 : a.localeCompare(b); });

  var filtered = products.filter(function(p) {
    var q = search.toLowerCase();
    var matchQ = p.name.toLowerCase().indexOf(q) !== -1 ||
                 p.category.toLowerCase().indexOf(q) !== -1 ||
                 String(p.id).indexOf(q) !== -1;
    var matchCat = catFilter === 'All' || p.category === catFilter;
    return matchQ && matchCat;
  });

  function resetForm() { setForm(emptyForm); setEditingId(null); }

  async function handleSave() {
    if (!form.name || !form.category || !form.price || !form.stock) {
      toast('Please fill all fields', 'error'); return;
    }
    setSaving(true);
    try {
      var url = editingId ? API_URL + '/products/' + editingId : API_URL + '/products';
      var res = await fetch(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name, category: form.category,
          price: parseFloat(form.price), stock: parseInt(form.stock, 10),
        }),
      });
      if (res.ok) {
        resetForm(); onRefresh();
        toast(editingId ? 'Product updated' : 'Product added', 'success');
      } else {
        var d = await res.json();
        toast(d.error || 'Failed to save', 'error');
      }
    } catch (err) { toast('Failed to save product', 'error'); }
    finally { setSaving(false); }
  }

  async function handleDelete(id) {
    var ok = await confirm('Delete this product?');
    if (!ok) return;
    try {
      var res = await fetch(API_URL + '/products/' + id, { method: 'DELETE' });
      if (res.ok) { onRefresh(); toast('Product deleted', 'success'); }
      else { var d = await res.json(); toast(d.error || 'Failed to delete', 'error'); }
    } catch (err) { toast('Failed to delete product', 'error'); }
  }

  return (
    <div className="products-tab">
      <div className="panel">
        <h3 className="panel-title">{editingId ? 'Edit Product' : 'Add New Product'}</h3>
        <div className="form-grid-4">
          <div className="form-group">
            <label>Product Name</label>
            <input type="text" placeholder="e.g. Cement Bag 50kg" value={form.name}
              onChange={function(e) { setForm(Object.assign({}, form, { name: e.target.value })); }} />
          </div>
          <div className="form-group">
            <label>Category</label>
            <input type="text" placeholder="e.g. Building Materials" value={form.category}
              onChange={function(e) { setForm(Object.assign({}, form, { category: e.target.value })); }} />
          </div>
          <div className="form-group">
            <label>Price ($)</label>
            <input type="number" step="0.01" min="0" placeholder="0.00" value={form.price}
              onChange={function(e) { setForm(Object.assign({}, form, { price: e.target.value })); }} />
          </div>
          <div className="form-group">
            <label>Stock</label>
            <input type="number" min="0" placeholder="0" value={form.stock}
              onChange={function(e) { setForm(Object.assign({}, form, { stock: e.target.value })); }} />
          </div>
        </div>
        <div className="form-actions">
          <button onClick={handleSave} disabled={saving} className="btn btn-primary">
            {saving ? 'Saving...' : editingId ? 'Update Product' : 'Add Product'}
          </button>
          {editingId && (
            <button onClick={resetForm} className="btn btn-ghost">Cancel</button>
          )}
        </div>
      </div>

      <div className="panel">
        <h3 className="panel-title">Products</h3>
        <div className="filter-bar">
          <input type="text" className="search-input" placeholder="Search by name, category, or ID..."
            value={search} onChange={function(e) { setSearch(e.target.value); }} />
        </div>
        <div className="pill-row">
          {catSet.map(function(cat) {
            return (
              <button key={cat} className={'pill' + (catFilter === cat ? ' pill-active' : '')}
                onClick={function() { setCatFilter(cat); }}>
                {cat}
              </button>
            );
          })}
        </div>
        {products.length === 0 ? (
          <p className="empty-state">No products yet. Add your first one above.</p>
        ) : filtered.length === 0 ? (
          <p className="empty-state">No products match your search.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>ID</th><th>Name</th><th>Category</th><th>Price</th><th>Stock</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {filtered.map(function(p) {
                  var rowClass = p.stock < 5 ? 'row-critical' : p.stock < 10 ? 'row-warning' : '';
                  return (
                    <tr key={p.id} className={rowClass}>
                      <td className="td-muted">{p.id}</td>
                      <td><strong>{p.name}</strong></td>
                      <td><span className="cat-tag">{p.category}</span></td>
                      <td>${fmt(p.price)}</td>
                      <td><StockBadge stock={p.stock} /></td>
                      <td>
                        <div className="action-btns">
                          <button className="btn btn-sm btn-success" onClick={function() {
                            setForm({ name: p.name, category: p.category, price: String(p.price), stock: String(p.stock) });
                            setEditingId(p.id);
                          }}>Edit</button>
                          <button className="btn btn-sm btn-danger" onClick={function() { handleDelete(p.id); }}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
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
  var [customerName, setCustomerName] = useState('');
  var [showCustDrop, setShowCustDrop] = useState(false);
  var [selectedItems, setSelectedItems] = useState([]);
  var [productSearch, setProductSearch] = useState('');
  var [showProdDrop, setShowProdDrop] = useState(false);
  var [saving, setSaving] = useState(false);

  var filteredCustomers = customers.filter(function(c) {
    return c.toLowerCase().indexOf(customerName.toLowerCase()) !== -1;
  }).slice(0, 8);

  var filteredProducts = products.filter(function(p) {
    return p.name.toLowerCase().indexOf(productSearch.toLowerCase()) !== -1;
  });

  var total = selectedItems.reduce(function(sum, i) {
    return sum + parseFloat(i.price) * i.quantity;
  }, 0);

  function addItem(product) {
    setSelectedItems(function(prev) {
      var existing = prev.find(function(i) { return i.id === product.id; });
      if (existing) {
        return prev.map(function(i) { return i.id === product.id ? Object.assign({}, i, { quantity: i.quantity + 1 }) : i; });
      }
      return [...prev, Object.assign({}, product, { quantity: 1 })];
    });
    setProductSearch('');
    setShowProdDrop(false);
  }

  function removeItem(id) {
    setSelectedItems(function(prev) { return prev.filter(function(i) { return i.id !== id; }); });
  }

  function updateQty(id, qty) {
    if (qty <= 0) { removeItem(id); return; }
    setSelectedItems(function(prev) { return prev.map(function(i) { return i.id === id ? Object.assign({}, i, { quantity: qty }) : i; }); });
  }

  async function handleCreate() {
    if (!customerName.trim()) { toast('Enter a customer name', 'error'); return; }
    if (selectedItems.length === 0) { toast('Select at least one item', 'error'); return; }
    setSaving(true);
    try {
      var res = await fetch(API_URL + '/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_name: customerName.trim(),
          items: selectedItems,
          subtotal: total, tax: 0, total: total,
        }),
      });
      if (res.ok) {
        setCustomerName(''); setSelectedItems([]);
        onOrderCreated();
        toast('Order created', 'success');
      } else {
        var d = await res.json();
        toast(d.error || 'Failed to create order', 'error');
      }
    } catch (err) { toast('Failed to create order', 'error'); }
    finally { setSaving(false); }
  }

  return (
    <div className="create-order-tab">
      <div className="panel">
        <h3 className="panel-title">New Order</h3>

        <div className="form-group">
          <label>Customer Name</label>
          <div className="dropdown-container">
            <input type="text" placeholder="Type or select customer..." value={customerName}
              onChange={function(e) { setCustomerName(e.target.value); setShowCustDrop(true); }}
              onFocus={function() { setShowCustDrop(true); }}
              onBlur={function() { setTimeout(function() { setShowCustDrop(false); }, 150); }} />
            {showCustDrop && customerName.length > 0 && filteredCustomers.length > 0 && (
              <div className="dropdown-options">
                {filteredCustomers.map(function(c, i) {
                  return (
                    <div key={i} className="dropdown-option"
                      onMouseDown={function() { setCustomerName(c); setShowCustDrop(false); }}>
                      {c}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="form-group">
          <label>Add Products</label>
          <div className="dropdown-container">
            <input type="text" className="search-input" placeholder="Search product..." value={productSearch}
              onChange={function(e) { setProductSearch(e.target.value); setShowProdDrop(true); }}
              onFocus={function() { setShowProdDrop(true); }}
              onBlur={function() { setTimeout(function() { setShowProdDrop(false); }, 150); }} />
            {showProdDrop && productSearch && (
              <div className="dropdown-options">
                {filteredProducts.length > 0 ? filteredProducts.map(function(p) {
                  return (
                    <div key={p.id} className="dropdown-option" onMouseDown={function() { addItem(p); }}>
                      <span>{p.name}</span>
                      <span className="drop-meta">${fmt(p.price)} · {p.stock} in stock</span>
                    </div>
                  );
                }) : (
                  <div className="dropdown-option dropdown-empty">No products found</div>
                )}
              </div>
            )}
          </div>
        </div>

        {selectedItems.length > 0 && (
          <div className="order-items-box">
            <div className="order-items-title">Order Items</div>
            {selectedItems.map(function(item) {
              return (
                <div key={item.id} className="order-item-row">
                  <div className="order-item-info">
                    <strong>{item.name}</strong>
                    <span className="tag-muted">${fmt(item.price)} each</span>
                  </div>
                  <div className="order-item-controls">
                    <button className="qty-btn" onClick={function() { updateQty(item.id, item.quantity - 1); }}>−</button>
                    <span className="qty-val">{item.quantity}</span>
                    <button className="qty-btn" onClick={function() { updateQty(item.id, item.quantity + 1); }}>+</button>
                    <span className="item-total">${fmt(item.price * item.quantity)}</span>
                    <button className="btn btn-sm btn-danger" onClick={function() { removeItem(item.id); }}>×</button>
                  </div>
                </div>
              );
            })}
            <div className="order-total-bar">
              <span>Total</span>
              <span className="grand-total">${fmt(total)}</span>
            </div>
          </div>
        )}

        <button onClick={handleCreate} disabled={saving} className="btn btn-primary btn-full">
          {saving ? 'Creating...' : 'Create Order'}
        </button>
      </div>
    </div>
  );
}

// ===== ORDERS =====

function OrdersTab({ orders, onRefresh, toast, confirm, API_URL }) {
  var [search, setSearch] = useState('');
  var [statusFilter, setStatusFilter] = useState('all');
  var [expandedId, setExpandedId] = useState(null);
  var [localOrders, setLocalOrders] = useState(orders);

  useEffect(function() { setLocalOrders(orders); }, [orders]);

  var filtered = localOrders.filter(function(o) {
    var q = search.toLowerCase();
    var matchSearch = o.customer_name.toLowerCase().indexOf(q) !== -1 || String(o.id).indexOf(q) !== -1;
    var matchStatus = statusFilter === 'all' || (o.status || 'pending') === statusFilter;
    return matchSearch && matchStatus;
  });

  async function toggleItem(order, idx) {
    var items = parseItems(order.items).map(function(item, i) {
      return i === idx ? Object.assign({}, item, { loaded: !item.loaded }) : item;
    });
    var allLoaded = items.every(function(i) { return i.loaded; });
    var newStatus = allLoaded ? 'loaded' : 'pending';

    setLocalOrders(function(prev) {
      return prev.map(function(o) { return o.id === order.id ? Object.assign({}, o, { items: items, status: newStatus }) : o; });
    });

    try {
      await fetch(API_URL + '/orders/' + order.id + '/items', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: items, status: newStatus }),
      });
    } catch (err) { toast('Failed to save', 'error'); onRefresh(); }
  }

  async function markAllLoaded(order) {
    var items = parseItems(order.items).map(function(i) { return Object.assign({}, i, { loaded: true }); });
    setLocalOrders(function(prev) {
      return prev.map(function(o) { return o.id === order.id ? Object.assign({}, o, { items: items, status: 'loaded' }) : o; });
    });
    try {
      await fetch(API_URL + '/orders/' + order.id + '/items', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: items, status: 'loaded' }),
      });
      toast('Order marked as loaded', 'success');
    } catch (err) { toast('Failed to update order', 'error'); onRefresh(); }
  }

  async function handleDelete(id) {
    var ok = await confirm('Delete this order?');
    if (!ok) return;
    try {
      var res = await fetch(API_URL + '/orders/' + id, { method: 'DELETE' });
      if (res.ok) { onRefresh(); toast('Order deleted', 'success'); }
      else { var d = await res.json(); toast(d.error || 'Failed to delete', 'error'); }
    } catch (err) { toast('Failed to delete order', 'error'); }
  }

  return (
    <div className="orders-tab">
      <div className="filter-bar">
        <input type="text" className="search-input" placeholder="Search by customer or order #..."
          value={search} onChange={function(e) { setSearch(e.target.value); }} />
        <div className="pill-row no-margin">
          {['all', 'pending', 'loaded'].map(function(s) {
            return (
              <button key={s} className={'pill' + (statusFilter === s ? ' pill-active' : '')}
                onClick={function() { setStatusFilter(s); }}>
                {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            );
          })}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="empty-state">No orders found.</p>
      ) : (
        <div className="orders-list">
          {filtered.map(function(order) {
            var items = parseItems(order.items).map(function(i) { return Object.assign({}, i, { loaded: i.loaded === true }); });
            var status = order.status || 'pending';
            var loadedCount = items.filter(function(i) { return i.loaded; }).length;
            var allLoaded = loadedCount === items.length && items.length > 0;
            var isExpanded = expandedId === order.id;

            return (
              <div key={order.id} className={'order-card' + (status === 'loaded' ? ' order-done' : '')}>
                <div className="order-card-head" onClick={function() { setExpandedId(isExpanded ? null : order.id); }}>
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
                      {items.map(function(item, idx) {
                        return (
                          <label key={idx} className={'checklist-item' + (item.loaded ? ' checklist-done' : '')}>
                            <input type="checkbox" checked={item.loaded}
                              onChange={function() { toggleItem(Object.assign({}, order, { items: items }), idx); }} />
                            <span className="ci-name">{item.name}</span>
                            <span className="ci-qty">x {item.quantity}</span>
                            <span className="ci-price">${fmt(item.price * item.quantity)}</span>
                          </label>
                        );
                      })}
                    </div>
                    {status !== 'loaded' ? (
                      <button
                        className={'btn btn-full ' + (allLoaded ? 'btn-success' : 'btn-ghost')}
                        onClick={function() { if (allLoaded) { markAllLoaded(Object.assign({}, order, { items: items })); } }}
                        disabled={!allLoaded}>
                        {allLoaded ? '✓ Mark as Fully Loaded' : 'Check off all ' + items.length + ' items to complete'}
                      </button>
                    ) : (
                      <div className="loaded-confirm">✓ All items loaded and verified</div>
                    )}
                    <button onClick={function() { handleDelete(order.id); }} className="btn btn-sm btn-danger order-delete-btn">
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
  var [activeTab, setActiveTab] = useState('dashboard');
  var [products, setProducts] = useState([]);
  var [orders, setOrders] = useState([]);
  var [customers, setCustomers] = useState([]);
  var [stats, setStats] = useState({});

  var toastHook = useToast();
  var toast = toastHook.show;
  var toasts = toastHook.toasts;
  var dismiss = toastHook.dismiss;

  var confirmHook = useConfirm();
  var confirm = confirmHook.confirm;
  var confirmModal = confirmHook.modal;

  var API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

  var fetchAll = useCallback(async function() {
    try {
      var results = await Promise.all([
        fetch(API_URL + '/products').then(function(r) { return r.json(); }),
        fetch(API_URL + '/orders').then(function(r) { return r.json(); }),
        fetch(API_URL + '/customers').then(function(r) { return r.json(); }),
        fetch(API_URL + '/stats').then(function(r) { return r.json(); }),
      ]);
      var p = results[0]; var o = results[1]; var c = results[2]; var s = results[3];
      setProducts(Array.isArray(p) ? p : []);
      setOrders(Array.isArray(o) ? o : []);
      setCustomers(Array.isArray(c) ? c : []);
      setStats(s && !s.error ? s : {});
    } catch (err) {
      toast('Failed to load data', 'error');
    }
  }, [API_URL, toast]);

  useEffect(function() { fetchAll(); }, [fetchAll]);

  var tabs = [
    { id: 'dashboard',    label: 'Dashboard' },
    { id: 'products',     label: 'Products' },
    { id: 'create-order', label: 'Create Order' },
    { id: 'orders',       label: 'Orders' },
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
          {tabs.map(function(tab) {
            return (
              <button key={tab.id}
                className={'nav-tab' + (activeTab === tab.id ? ' nav-tab-active' : '')}
                onClick={function() { setActiveTab(tab.id); }}>
                {tab.label}
              </button>
            );
          })}
        </div>
      </nav>

      <main className="app-main">
        {activeTab === 'dashboard' && (
          <DashboardTab stats={stats} orders={orders} onTabChange={setActiveTab} />
        )}
        {activeTab === 'products' && (
          <ProductsTab products={products} onRefresh={fetchAll} toast={toast} confirm={confirm} API_URL={API_URL} />
        )}
        {activeTab === 'create-order' && (
          <CreateOrderTab products={products} customers={customers} onOrderCreated={fetchAll} toast={toast} API_URL={API_URL} />
        )}
        {activeTab === 'orders' && (
          <OrdersTab orders={orders} onRefresh={fetchAll} toast={toast} confirm={confirm} API_URL={API_URL} />
        )}
      </main>
    </div>
  );
}

export default App;
