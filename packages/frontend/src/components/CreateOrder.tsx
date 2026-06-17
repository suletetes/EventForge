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
      setSuccess(`Order ${result.data?.orderId} created successfully`);
      setEmail('');
      setItems([{ productId: '', name: '', quantity: 1, price: 0 }]);
      onOrderCreated();
    }
  }

  const total = items.reduce((s, i) => s + i.quantity * i.price, 0);

  return (
    <div className="card">
      <div className="card__header">
        <h2 className="card__title">Create Order</h2>
      </div>
      {error && <div className="create-order__error">{error}</div>}
      {success && <div className="create-order__success">{success}</div>}
      <form className="create-order__form" onSubmit={handleSubmit}>
        <input
          type="email"
          placeholder="Customer email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="create-order__input"
        />
        {items.map((item, idx) => (
          <div key={idx} className="create-order__item-row">
            <input
              placeholder="Item name"
              value={item.name}
              onChange={(e) => updateItem(idx, 'name', e.target.value)}
              required
              className="create-order__input create-order__input--name"
            />
            <input
              type="number"
              placeholder="Qty"
              min={1}
              value={item.quantity}
              onChange={(e) => updateItem(idx, 'quantity', parseInt(e.target.value) || 1)}
              required
              className="create-order__input create-order__input--qty"
            />
            <input
              type="number"
              placeholder="Price"
              min={0.01}
              step={0.01}
              value={item.price || ''}
              onChange={(e) => updateItem(idx, 'price', parseFloat(e.target.value) || 0)}
              required
              className="create-order__input create-order__input--price"
            />
            {items.length > 1 && (
              <button
                type="button"
                onClick={() => removeItem(idx)}
                className="create-order__remove-btn"
                aria-label="Remove item"
              >
                ×
              </button>
            )}
          </div>
        ))}
        <div className="create-order__actions">
          <button type="button" onClick={addItem} className="create-order__add-btn">
            + Add Item
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="create-order__submit-btn"
          >
            {submitting ? 'Creating...' : 'Place Order'}
          </button>
          <span className="create-order__total">
            ${total.toFixed(2)}
          </span>
        </div>
      </form>
    </div>
  );
}
