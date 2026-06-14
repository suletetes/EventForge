import React, { useState } from 'react';
import { createOrder, CreateOrderPayload } from '../api';
import { getCurrentUser } from '@aws-amplify/auth';

interface CreateOrderProps {
  onOrderCreated: () => void;
}

export function CreateOrder({ onOrderCreated }: CreateOrderProps): React.ReactElement {
  const [email, setEmail] = useState('');
  const [items, setItems] = useState([{ productId: '', name: '', quantity: 1, price: 0 }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function addItem() {
    setItems([...items, { productId: '', name: '', quantity: 1, price: 0 }]);
  }

  function removeItem(index: number) {
    setItems(items.filter((_, i) => i !== index));
  }

  function updateItem(index: number, field: string, value: string | number) {
    const updated = [...items];
    updated[index] = { ...updated[index], [field]: value };
    setItems(updated);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);

    const total = items.reduce((sum, item) => sum + item.quantity * item.price, 0);

    let userId = 'current-user';
    try {
      const user = await getCurrentUser();
      userId = user.userId;
    } catch { /* use fallback */ }

    const payload: CreateOrderPayload = {
      userId,
      customerEmail: email,
      items: items.map(i => ({
        productId: i.productId || `PROD-${Math.random().toString(36).slice(2, 8)}`,
        name: i.name,
        quantity: i.quantity,
        price: i.price,
      })),
      total: Math.round(total * 100) / 100,
    };

    const result = await createOrder(payload);
    setSubmitting(false);

    if (result.error) {
      setError(result.error);
    } else {
      setSuccess(`Order ${result.data?.orderId} created`);
      setEmail('');
      setItems([{ productId: '', name: '', quantity: 1, price: 0 }]);
      onOrderCreated();
    }
  }

  const inputStyle = { padding: '6px 10px', border: '1px solid #ddd', borderRadius: 4, fontSize: 14 };

  return (
    <div style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 16, marginBottom: 20 }}>
      <h3 style={{ margin: '0 0 12px' }}>Create Order</h3>
      {error && <p style={{ color: 'red', fontSize: 13 }}>{error}</p>}
      {success && <p style={{ color: 'green', fontSize: 13 }}>{success}</p>}
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 10 }}>
          <input
            type="email"
            placeholder="Customer email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
          />
        </div>
        {items.map((item, idx) => (
          <div key={idx} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
            <input
              placeholder="Name"
              value={item.name}
              onChange={(e) => updateItem(idx, 'name', e.target.value)}
              required
              style={{ ...inputStyle, flex: 2 }}
            />
            <input
              type="number"
              placeholder="Qty"
              min={1}
              value={item.quantity}
              onChange={(e) => updateItem(idx, 'quantity', parseInt(e.target.value) || 1)}
              required
              style={{ ...inputStyle, width: 60 }}
            />
            <input
              type="number"
              placeholder="Price"
              min={0.01}
              step={0.01}
              value={item.price || ''}
              onChange={(e) => updateItem(idx, 'price', parseFloat(e.target.value) || 0)}
              required
              style={{ ...inputStyle, width: 80 }}
            />
            {items.length > 1 && (
              <button type="button" onClick={() => removeItem(idx)} style={{ padding: '4px 8px', cursor: 'pointer' }}>×</button>
            )}
          </div>
        ))}
        <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
          <button type="button" onClick={addItem} style={{ padding: '6px 12px', cursor: 'pointer' }}>+ Item</button>
          <button type="submit" disabled={submitting} style={{ padding: '6px 16px', background: '#0066cc', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
            {submitting ? 'Creating...' : 'Place Order'}
          </button>
          <span style={{ alignSelf: 'center', fontSize: 13, color: '#666' }}>
            Total: ${items.reduce((s, i) => s + i.quantity * i.price, 0).toFixed(2)}
          </span>
        </div>
      </form>
    </div>
  );
}
