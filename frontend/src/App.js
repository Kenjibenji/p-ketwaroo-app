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
  const [orderItems, setOrderItems] = useState([{ productId: '', quantity: '', price: '' }]);
  const [subtotal, setSubtotal] = useState(0);
  const [tax, setTax] = useState(0);
  const [total, setTotal] = useState(0);

  const API_URL = 'http://localhost:5000/api';

  // ===== FETCH DATA =====
  useEffect(() => {
    fetchProducts();
    fetchOrders();
  }, []);

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

  // ===== ORDER MANAGEMENT =====
  const handleAddOrderItem = () => {
    setOrderItems([...orderItems, { productId: '', quantity: '', price: '' }]);
  };

  const handleRemoveOrderItem = (index) => {
    const newItems = orderItems.filter((_, i) => i !== index);
    setOrderItems(newItems);
    calculateTotals(newItems);
  };

  const handleOrderItemChange = (index, field, value) => {
    const newItems = [...orderItems];
    newItems[index][field] = value;

    // Auto-fill price when product is selected
    if (field === 'productId' && value) {
      const selectedProduct = products.find(p => p.id === parseInt(value));
      if (selectedProduct) {
        newItems[index].price = parseFloat(selectedProduct.price).toString();
      }
    }

    setOrderItems(newItems);
    calculateTotals(newItems);
  };

  const calculateTotals = (items) => {
    let sub = 0;
    items.forEach(item => {
      if (item.quantity && item.price) {
        sub += parseFloat(item.quantity) * parseFloat(item.price);
      }
    });
    const taxAmount = sub * 0.1; // 10% tax
    setSubtotal(sub);
    setTax(taxAmount);
    setTotal(sub + taxAmount);
  };

  const handleCreateOrder = async () => {
    if (!customerName) {
      alert('Please enter customer name');
      return;
    }

    if (orderItems.some(item => !item.productId || !item.quantity)) {
      alert('Please fill all order items');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_name: customerName,
          items: orderItems,
          subtotal: subtotal,
          tax: tax,
          total: total
        })
      });

      if (response.ok) {
        setCustomerName('');
        setOrderItems([{ productId: '', quantity: '', price: '' }]);
        setSubtotal(0);
        setTax(0);
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
    <div className="app">
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

            <div className="form-section">
              <h3>{editingProductId ? 'Edit Product' : 'Add New Product'}</h3>
              <input
                type="text"
                placeholder="Product Name"
                value={productForm.name}
                onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
              />
              <input
                type="text"
                placeholder="Category"
                value={productForm.category}
                onChange={(e) => setProductForm({ ...productForm, category: e.target.value })}
              />
              <input
                type="number"
                step="0.01"
                placeholder="Price"
                value={productForm.price}
                onChange={(e) => setProductForm({ ...productForm, price: e.target.value })}
              />
              <input
                type="number"
                placeholder="Stock"
                value={productForm.stock}
                onChange={(e) => setProductForm({ ...productForm, stock: e.target.value })}
              />
              <button onClick={handleAddProduct} disabled={loading}>
                {editingProductId ? 'Update Product' : 'Add Product'}
              </button>
              {editingProductId && (
                <button
                  onClick={() => {
                    setEditingProductId(null);
                    setProductForm({ name: '', category: '', price: '', stock: '' });
                  }}
                  className="cancel-btn"
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
                          <button onClick={() => handleEditProduct(product)} className="edit-btn">
                            Edit
                          </button>
                          <button onClick={() => handleDeleteProduct(product.id)} className="delete-btn">
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
            <h2>Create New Order</h2>

            <div className="order-form">
              <label>Customer Name:</label>
              <input
                type="text"
                placeholder="Enter customer name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />

              <h3>Order Items</h3>
              {orderItems.map((item, index) => (
                <div key={index} className="order-item">
                  <select
                    value={item.productId}
                    onChange={(e) => handleOrderItemChange(index, 'productId', e.target.value)}
                  >
                    <option value="">Select Product</option>
                    {products.map(product => (
                      <option key={product.id} value={product.id}>
                        {product.name} - ${formatPrice(product.price)}
                      </option>
                    ))}
                  </select>

                  <input
                    type="number"
                    step="1"
                    placeholder="Quantity"
                    value={item.quantity}
                    onChange={(e) => handleOrderItemChange(index, 'quantity', e.target.value)}
                  />

                  <input
                    type="number"
                    step="0.01"
                    placeholder="Price"
                    value={item.price}
                    onChange={(e) => handleOrderItemChange(index, 'price', e.target.value)}
                    disabled
                  />

                  <button onClick={() => handleRemoveOrderItem(index)} className="remove-btn">
                    Remove
                  </button>
                </div>
              ))}

              <button onClick={handleAddOrderItem} className="add-item-btn">
                + Add Item
              </button>

              <div className="order-summary">
                <p>Subtotal: <strong>${formatPrice(subtotal)}</strong></p>
                <p>Tax (10%): <strong>${formatPrice(tax)}</strong></p>
                <p className="total">Total: <strong>${formatPrice(total)}</strong></p>
              </div>

              <button onClick={handleCreateOrder} disabled={loading} className="create-order-btn">
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
                    <p>Subtotal: ${formatPrice(order.subtotal)}</p>
                    <p>Tax: ${formatPrice(order.tax)}</p>
                    <p className="order-total">Total: ${formatPrice(order.total)}</p>
                    <details>
                      <summary>View Items</summary>
                      <ul>
                        {JSON.parse(order.items).map((item, idx) => {
                          const product = products.find(p => p.id === parseInt(item.productId));
                          return (
                            <li key={idx}>
                              {product?.name || 'Unknown Product'} - Qty: {item.quantity} x ${formatPrice(item.price)}
                            </li>
                          );
                        })}
                      </ul>
                    </details>
                    <button onClick={() => handleDeleteOrder(order.id)} className="delete-btn">
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
