import React, { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';

// ===== TOAST =====

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

function useToast() {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const show = useCallback((message, type = 'info') => {
    const id = ++idRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  }, []);

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return { toasts, show, dismiss };
}

// ===== CONFIRM MODAL =====

function ConfirmModal({ message, onConfirm, onCancel }) {
  return (
    <div className="modal-overlay">
      <div className="modal">
        <p>{message}</p>
        <div className="modal-actions">
          <button className="btn btn-delete" onClick={onConfirm}>Delete</button>
          <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function useConfirm() {
  const [pending, setPending] = useState(null);

  const confirm = (message) =>
    new Promise(resolve => setPending({ message, resolve }));

  const handleConfirm = () => { pending.resolve(true); setPending(null); };
  const handleCancel = () => { pending.resolve(false); setPending(null); };

  const modal = pending ? (
    <ConfirmModal message={pending.message} onConfirm={handleConfirm} onCancel={handleCancel} />
  ) : null;

  return { confirm, modal };
}

// ===== APP =====

function App() {
  const [activeTab, setActiveTab] = useState('products');
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);

  const [productForm, setProductForm] = useState({ name: '', category: '', price: '', stock: '' });
  const [editingProductId, setEditingProductId] = useState(null);
  const [productSearchTerm, setProductSearchTerm] = useState('');

  const [customerName, setCustomerName] = useState('');
  const [selectedItems, setSelectedItems] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);

  const { toasts, show: toast, dismiss } = useToast();
  const { confirm, modal: confirmModal } = useConfirm();

  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

  const fetchProducts = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/products`);
      setProducts(await res.json());
    } catch {
      toast('Failed to load products', 'error');
    }
  }, [API_URL, toast]);

  const fetchOrders = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/orders`);
      setOrders(await res.json());
    } catch {
      toast('Failed to load orders', 'error');
    }
  }, [API_URL, toast]);

  useEffect(() => {
    fetchProducts();
    fetchOrders();
  }, [fetchProducts, fetchOrders]);

  // ===== PRODUCTS =====

  const handleSaveProduct = async () => {
    if (!productForm.name || !productForm.category || !productForm.price || !productForm.stock) {
      toast('Please fill all fields', 'error');
      return;
    }
    setLoading(true);
    try {
      const method = editingProductId ? 'PUT' : 'POST';
      const url = editingProductId
        ? `${API_URL}/products/${editingProductId}`
        : `${API_URL}/products`;

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: productForm.name,
          category: productForm.category,
          price: parseFloat(productForm.price),
          stock: parseInt(productForm.stock),
        }),
      });

      if (res.ok) {
        setProductForm({ name: '', category: '', price: '', stock: '' });
        setEditingProductId(null);
        fetchProducts();
        toast(editingProductId ? 'Product updated' : 'Product added', 'success');
      } else {
        const data = await res.json();
        toast(data.error || 'Failed to save product', 'error');
      }
    } catch {
      toast('Failed to save product', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleEditProduct = (product) => {
    setProductForm({
      name: product.name,
      category: product.category,
      price: product.price.toString(),
      stock: product.stock.toString(),
    });
    setEditingProductId(product.id);
  };

  const handleDeleteProduct = async (id) => {
    const ok = await confirm('Delete this product?');
    if (!ok) return;
    try {
      const res = await fetch(`${API_URL}/products/${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchProducts();
        toast('Product deleted', 'success');
      } else {
        const data = await res.json();
        toast(data.error || 'Failed to delete product', 'error');
      }
    } catch {
      toast('Failed to delete product', 'error');
    }
  };

  // ===== ORDERS =====

  const filteredDropdown = products.filter(p =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredProductsTable = products.filter(p =>
    p.name.toLowerCase().includes(productSearchTerm.toLowerCase()) ||
    p.category.toLowerCase().includes(productSearchTerm.toLowerCase()) ||
    p.id.toString().includes(productSearchTerm)
  );

  const calcTotal = (items) =>
    items.reduce((sum, item) => sum + parseFloat(item.price) * item.quantity, 0);

  const addItemToOrder = (product) => {
    setSelectedItems(prev => {
      const existing = prev.find(i => i.id === product.id);
      return existing
        ? prev.map(i => i.id === product.id ? { ...i, quantity: i.quantity + 1 } : i)
        : [...prev, { ...product, quantity: 1 }];
    });
    setSearchTerm('');
    setShowDropdown(false);
  };

  const removeItemFromOrder = (productId) => {
    setSelectedItems(prev => prev.filter(i => i.id !== productId));
  };

  const updateItemQuantity = (productId, quantity) => {
    if (quantity <= 0) return removeItemFromOrder(productId);
    setSelectedItems(prev => prev.map(i => i.id === productId ? { ...i, quantity } : i));
  };

  const handleCreateOrder = async () => {
    if (!customerName) { toast('Please enter customer name', 'error'); return; }
    if (selectedItems.length === 0) { toast('Please select at least one item', 'error'); return; }

    const total = calcTotal(selectedItems);
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_name: customerName,
          items: selectedItems,
          subtotal: total,
          tax: 0,
          total,
        }),
      });

      if (res.ok) {
        setCustomerName('');
        setSelectedItems([]);
        setSearchTerm('');
        fetchOrders();
        toast('Order created', 'success');
      } else {
        const data = await res.json();
        toast(data.error || 'Failed to create order', 'error');
      }
    } catch {
      toast('Failed to create order', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteOrder = async (id) => {
    const ok = await confirm('Delete this order?');
    if (!ok) return;
    try {
      const res = await fetch(`${API_URL}/orders/${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchOrders();
        toast('Order deleted', 'success');
      } else {
        const data = await res.json();
        toast(data.error || 'Failed to delete order', 'error');
      }
    } catch {
      toast('Failed to delete order', 'error');
    }
  };

  const fmt = (price) => parseFloat(price).toFixed(2);

  return (
    <div className="app-container">
      <Toast toasts={toasts} onDismiss={dismiss} />
      {confirmModal}

      <header className="header">
        <h1>P.Ketwaroo and Sons Inventory System</h1>
      </header>

      <div className="tabs">
        {['products', 'orders', 'history'].map(tab => (
          <button
            key={tab}
            className={`tab-button ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'products' ? 'Products' : tab === 'orders' ? 'Create Order' : 'Order History'}
          </button>
        ))}
      </div>

      <div className="tab-content">

        {/* ===== PRODUCTS TAB ===== */}
        {activeTab === 'products' && (
          <div className="products-tab">
            <h2>Manage Products</h2>

            <div className="form-container">
              <h3>{editingProductId ? 'Edit Product' : 'Add New Product'}</h3>
              {['name', 'category'].map(field => (
                <div className="form-group" key={field}>
                  <input
                    type="text"
                    placeholder={field.charAt(0).toUpperCase() + field.slice(1)}
                    value={productForm[field]}
                    onChange={(e) => setProductForm({ ...productForm, [field]: e.target.value })}
                  />
                </div>
              ))}
              <div className="form-group">
                <input
                  type="number"
                  step="0.01"
                  placeholder="Price"
                  value={productForm.price}
                  onChange={(e) => setProductForm({ ...productForm, price: e.target.value })}
                />
              </div>
              <div className="form-group">
                <input
                  type="number"
                  placeholder="Stock"
                  value={productForm.stock}
                  onChange={(e) => setProductForm({ ...productForm, stock: e.target.value })}
                />
              </div>
              <div className="form-actions">
                <button onClick={handleSaveProduct} disabled={loading} className="btn btn-primary">
                  {editingProductId ? 'Update Product' : 'Add Product'}
                </button>
                {editingProductId && (
                  <button
                    onClick={() => { setEditingProductId(null); setProductForm({ name: '', category: '', price: '', stock: '' }); }}
                    className="btn btn-secondary"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>

            <div className="products-list">
              <h3>Current Products</h3>
              <div className="form-group">
                <input
                  type="text"
                  placeholder="Search by name, category, or ID..."
                  value={productSearchTerm}
                  onChange={(e) => setProductSearchTerm(e.target.value)}
                  className="search-input"
                />
              </div>

              {products.length === 0 ? (
                <p className="empty-state">No products yet</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>ID</th><th>Name</th><th>Category</th><th>Price</th><th>Stock</th><th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProductsTable.length > 0 ? (
                      filteredProductsTable.map(product => (
                        <tr key={product.id}>
                          <td>{product.id}</td>
                          <td>{product.name}</td>
                          <td>{product.category}</td>
                          <td>${fmt(product.price)}</td>
                          <td>{product.stock}</td>
                          <td className="actions-cell">
                            <button onClick={() => handleEditProduct(product)} className="btn btn-edit">Edit</button>
                            <button onClick={() => handleDeleteProduct(product.id)} className="btn btn-delete">Delete</button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr><td colSpan="6" className="empty-state">No products found</td></tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ===== CREATE ORDER TAB ===== */}
        {activeTab === 'orders' && (
          <div className="orders-tab">
            <div className="form-container">
              <h2>Create New Order</h2>

              <div className="form-group">
                <label>Customer Name</label>
                <input
                  type="text"
                  placeholder="Enter customer name"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>Select Product</label>
                <div className="dropdown-container">
                  <input
                    type="text"
                    className="search-input"
                    placeholder="Search and select product..."
                    value={searchTerm}
                    onChange={(e) => { setSearchTerm(e.target.value); setShowDropdown(true); }}
                    onFocus={() => setShowDropdown(true)}
                  />
                  {showDropdown && (
                    <div className="dropdown-options">
                      {filteredDropdown.length > 0 ? (
                        filteredDropdown.map(product => (
                          <div
                            key={product.id}
                            className="dropdown-option"
                            onMouseDown={() => addItemToOrder(product)}
                          >
                            {product.name} — ${fmt(product.price)} (Stock: {product.stock})
                          </div>
                        ))
                      ) : (
                        <div className="dropdown-option dropdown-empty">No products found</div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {selectedItems.length > 0 && (
                <div className="selected-items">
                  <h3>Selected Items</h3>
                  {selectedItems.map(item => (
                    <div key={item.id} className="selected-item">
                      <div>
                        <strong>{item.name}</strong> — ${fmt(item.price)} each
                      </div>
                      <div className="selected-item-controls">
                        <input
                          type="number"
                          min="1"
                          value={item.quantity}
                          className="qty-input"
                          onChange={(e) => updateItemQuantity(item.id, parseInt(e.target.value))}
                        />
                        <span>${fmt(item.price * item.quantity)}</span>
                        <button type="button" onClick={() => removeItemFromOrder(item.id)} className="btn btn-delete">
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {selectedItems.length > 0 && (
                <div className="summary">
                  <div className="summary-row total-row">
                    <span>Total:</span>
                    <span>${fmt(calcTotal(selectedItems))}</span>
                  </div>
                </div>
              )}

              <button
                onClick={handleCreateOrder}
                disabled={loading}
                className="btn btn-primary btn-full"
              >
                Create Order
              </button>
            </div>
          </div>
        )}

        {/* ===== ORDER HISTORY TAB ===== */}
        {activeTab === 'history' && (
          <div className="history-tab">
            <h2>Order History</h2>
            <div className="orders-list">
              {orders.length === 0 ? (
                <p className="empty-state">No orders yet</p>
              ) : (
                orders.map(order => {
                  const items = Array.isArray(order.items)
                    ? order.items
                    : JSON.parse(order.items);
                  return (
                    <div key={order.id} className="order-card">
                      <h4>{order.customer_name}</h4>
                      <p>Order #{order.id}</p>
                      <p>{new Date(order.created_at).toLocaleDateString()}</p>
                      <p className="order-total">Total: ${fmt(order.total)}</p>
                      <details>
                        <summary>View Items</summary>
                        <ul>
                          {items.map((item, idx) => (
                            <li key={idx}>
                              {item.name} — Qty: {item.quantity} × ${fmt(item.price)}
                            </li>
                          ))}
                        </ul>
                      </details>
                      <button onClick={() => handleDeleteOrder(order.id)} className="btn btn-delete">
                        Delete Order
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

export default App;
