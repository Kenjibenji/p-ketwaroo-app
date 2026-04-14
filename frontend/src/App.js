import React, { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [activeTab, setActiveTab] = useState('products');
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);

  // Product form states
  const [productForm, setProductForm] = useState({ name: '', category: '', price: '', stock: '' });
  const [editingProductId, setEditingProductId] = useState(null);

  // Order form states
  const [customerName, setCustomerName] = useState('');
  const [selectedItems, setSelectedItems] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [subtotal, setSubtotal] = useState(0);
  const [total, setTotal] = useState(0);

  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

  // ===== FETCH DATA =====
  const fetchProducts = async () => {
    try {
      const response = await fetch(`${API_URL}/products`);
      const data = await response.json();
      setProducts(data);
    } catch (error) {
      console.error('Error fetching products:', error);
    }
  };

  const fetchOrders = async () => {
    try {
      const response = await fetch(`${API_URL}/orders`);
      const data = await response.json();
      setOrders(data);
    } catch (error) {
      console.error('Error fetching orders:', error);
    }
  };

  useEffect(() => {
    fetchProducts();
    fetchOrders();
  }, []); // eslint-disable-next-line react-hooks/exhaustive-deps

  // ===== PRODUCT MANAGEMENT =====
  const handleAddProduct = async () => {
    if (!productForm.name || !productForm.category || !productForm.price || !productForm.stock) {
      alert('Please fill all fields');
      return;
    }

    setLoading(true);
    try {
      const method = editingProductId ? 'PUT' : 'POST';
      const url = editingProductId ? `${API_URL}/products/${editingProductId}` : `${API_URL}/products`;

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: productForm.name,
          category: productForm.category,
          price: parseFloat(productForm.price),
          stock: parseInt(productForm.stock)
        })
      });

      if (response.ok) {
        setProductForm({ name: '', category: '', price: '', stock: '' });
        setEditingProductId(null);
        fetchProducts();
        alert(editingProductId ? 'Product updated!' : 'Product added!');
      }
    } catch (error) {
      console.error('Error saving product:', error);
      alert('Error saving product');
    } finally {
      setLoading(false);
    }
  };

  const handleEditProduct = (product) => {
    setProductForm({
      name: product.name,
      category: product.category,
      price: product.price.toString(),
      stock: product.stock.toString()
    });
    setEditingProductId(product.id);
  };

  const handleDeleteProduct = async (id) => {
    if (!window.confirm('Delete this product?')) return;

    try {
      const response = await fetch(`${API_URL}/products/${id}`, { method: 'DELETE' });
      if (response.ok) {
        fetchProducts();
        alert('Product deleted!');
      }
    } catch (error) {
      console.error('Error deleting product:', error);
    }
  };

  // ===== ORDER MANAGEMENT - NEW SEARCHABLE DROPDOWN =====
  
  // Filter products based on search term
  const filteredProducts = products.filter(product =>
    product.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const addItemToOrder = (product) => {
    const existingItem = selectedItems.find(item => item.id === product.id);

    if (existingItem) {
      setSelectedItems(selectedItems.map(item =>
        item.id === product.id
          ? { ...item, quantity: item.quantity + 1 }
          : item
      ));
    } else {
      setSelectedItems([...selectedItems, { ...product, quantity: 1 }]);
    }

    setSearchTerm('');
    setShowDropdown(false);
    calculateTotals([...selectedItems, { ...product, quantity: 1 }]);
  };

  const removeItemFromOrder = (productId) => {
    const newItems = selectedItems.filter(item => item.id !== productId);
    setSelectedItems(newItems);
    calculateTotals(newItems);
  };

  const updateItemQuantity = (productId, quantity) => {
    if (quantity <= 0) {
      removeItemFromOrder(productId);
    } else {
      const newItems = selectedItems.map(item =>
        item.id === productId ? { ...item, quantity } : item
      );
      setSelectedItems(newItems);
      calculateTotals(newItems);
    }
  };

  const calculateTotals = (items) => {
    let sub = 0;
    items.forEach(item => {
      if (item.quantity && item.price) {
        sub += parseFloat(item.quantity) * parseFloat(item.price);
      }
    });
    setSubtotal(sub);
    setTotal(sub); // NO TAX - subtotal = total
  };

  const handleCreateOrder = async () => {
    if (!customerName) {
      alert('Please enter customer name');
      return;
    }

    if (selectedItems.length === 0) {
      alert('Please select at least one item');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_name: customerName,
          items: selectedItems,
          subtotal: subtotal,
          tax: 0, // No tax
          total: total
        })
      });

      if (response.ok) {
        setCustomerName('');
        setSelectedItems([]);
        setSearchTerm('');
        setSubtotal(0);
        setTotal(0);
        fetchOrders();
        alert('Order created successfully!');
      }
    } catch (error) {
      console.error('Error creating order:', error);
      alert('Error creating order');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteOrder = async (id) => {
    if (!window.confirm('Delete this order?')) return;

    try {
      const response = await fetch(`${API_URL}/orders/${id}`, { method: 'DELETE' });
      if (response.ok) {
        fetchOrders();
        alert('Order deleted!');
      }
    } catch (error) {
      console.error('Error deleting order:', error);
    }
  };

  const formatPrice = (price) => {
    return parseFloat(price).toFixed(2);
  };

  return (
    <div className="app-container">
      <header className="header">
        <h1>P.Ketwaroo and Sons Inventory System</h1>
      </header>

      <div className="tabs">
        <button
          className={`tab-button ${activeTab === 'products' ? 'active' : ''}`}
          onClick={() => setActiveTab('products')}
        >
          Products
        </button>
        <button
          className={`tab-button ${activeTab === 'orders' ? 'active' : ''}`}
          onClick={() => setActiveTab('orders')}
        >
          Create Order
        </button>
        <button
          className={`tab-button ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          Order History
        </button>
      </div>

      <div className="tab-content">
        {/* ===== PRODUCTS TAB ===== */}
        {activeTab === 'products' && (
          <div className="products-tab">
            <h2>Manage Products</h2>

            <div className="form-container">
              <h3>{editingProductId ? 'Edit Product' : 'Add New Product'}</h3>
              <div className="form-group">
                <input
                  type="text"
                  placeholder="Product Name"
                  value={productForm.name}
                  onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
                />
              </div>
              <div className="form-group">
                <input
                  type="text"
                  placeholder="Category"
                  value={productForm.category}
                  onChange={(e) => setProductForm({ ...productForm, category: e.target.value })}
                />
              </div>
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
              <button onClick={handleAddProduct} disabled={loading} className="btn btn-primary">
                {editingProductId ? 'Update Product' : 'Add Product'}
              </button>
              {editingProductId && (
                <button
                  onClick={() => {
                    setEditingProductId(null);
                    setProductForm({ name: '', category: '', price: '', stock: '' });
                  }}
                  className="btn btn-delete"
                  style={{ marginLeft: '10px' }}
                >
                  Cancel
                </button>
              )}
            </div>

            <div className="products-list">
              <h3>Current Products</h3>
              {products.length === 0 ? (
                <p>No products yet</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Name</th>
                      <th>Category</th>
                      <th>Price</th>
                      <th>Stock</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map(product => (
                      <tr key={product.id}>
                        <td>{product.id}</td>
                        <td>{product.name}</td>
                        <td>{product.category}</td>
                        <td>${formatPrice(product.price)}</td>
                        <td>{product.stock}</td>
                        <td>
                          <button onClick={() => handleEditProduct(product)} className="btn btn-edit">
                            Edit
                          </button>
                          <button onClick={() => handleDeleteProduct(product.id)} className="btn btn-delete">
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
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

              {/* SEARCHABLE PRODUCT DROPDOWN */}
              <div className="form-group">
                <label>Select Product</label>
                <div className="dropdown-container">
                  <input
                    type="text"
                    className="search-input"
                    placeholder="Search and select product..."
                    value={searchTerm}
                    onChange={(e) => {
                      setSearchTerm(e.target.value);
                      setShowDropdown(true);
                    }}
                    onFocus={() => setShowDropdown(true)}
                  />
                  {showDropdown && (
                    <div className="dropdown-options">
                      {filteredProducts.length > 0 ? (
                        filteredProducts.map(product => (
                          <div
                            key={product.id}
                            className="dropdown-option"
                            onClick={() => addItemToOrder(product)}
                          >
                            {product.name} - ${formatPrice(product.price)} (Stock: {product.stock})
                          </div>
                        ))
                      ) : (
                        <div className="dropdown-option" style={{ cursor: 'default' }}>
                          No products found
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* SELECTED ITEMS */}
              {selectedItems.length > 0 && (
                <div className="selected-items">
                  <h3>Selected Items</h3>
                  {selectedItems.map(item => (
                    <div key={item.id} className="selected-item">
                      <div>
                        <strong>{item.name}</strong> - ${formatPrice(item.price)} each
                      </div>
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        <input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(e) => updateItemQuantity(item.id, parseInt(e.target.value))}
                          style={{
                            width: '60px',
                            padding: '6px',
                            backgroundColor: '#3a3a3a',
                            color: '#e0e0e0',
                            border: '1px solid #404040',
                            borderRadius: '4px'
                          }}
                        />
                        <span>${formatPrice(item.price * item.quantity)}</span>
                        <button
                          type="button"
                          onClick={() => removeItemFromOrder(item.id)}
                          className="btn btn-delete"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* SUMMARY - NO TAX */}
              {selectedItems.length > 0 && (
                <div className="summary">
                  <div className="summary-row">
                    <span>Total:</span>
                    <span>${formatPrice(total)}</span>
                  </div>
                </div>
              )}

              <button
                onClick={handleCreateOrder}
                disabled={loading}
                className="btn btn-primary"
                style={{ marginTop: '20px', width: '100%' }}
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
                <p>No orders yet</p>
              ) : (
                orders.map(order => (
                  <div key={order.id} className="order-card">
                    <h4>{order.customer_name}</h4>
                    <p>Order ID: {order.id}</p>
                    <p>Date: {new Date(order.created_at).toLocaleDateString()}</p>
                    <p className="order-total">Total: ${formatPrice(order.total)}</p>
                    <details>
                      <summary>View Items</summary>
                      <ul>
                        {Array.isArray(order.items) ? (
                          order.items.map((item, idx) => (
                            <li key={idx}>
                              {item.name} - Qty: {item.quantity} x ${formatPrice(item.price)}
                            </li>
                          ))
                        ) : (
                          JSON.parse(order.items).map((item, idx) => {
                            const product = products.find(p => p.id === parseInt(item.productId));
                            return (
                              <li key={idx}>
                                {product?.name || 'Unknown Product'} - Qty: {item.quantity} x ${formatPrice(item.price)}
                              </li>
                            );
                          })
                        )}
                      </ul>
                    </details>
                    <button onClick={() => handleDeleteOrder(order.id)} className="btn btn-delete">
                      Delete Order
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js')
      .then(reg => console.log('✅ Service Worker registered'))
      .catch(err => console.log('❌ Service Worker registration failed:', err));
  });
}
