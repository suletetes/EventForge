import React, { useState, useEffect } from 'react';
import { fetchWebhooks, registerWebhook } from '../api';

export function WebhookManager(): React.ReactElement {
  const [webhooks, setWebhooks] = useState<Array<{ url: string; registeredAt: string }>>([]);
  const [newUrl, setNewUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function loadWebhooks() {
    const result = await fetchWebhooks();
    if (result.data) {
      setWebhooks(result.data);
    }
  }

  useEffect(() => {
    loadWebhooks();
  }, []);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = await registerWebhook(newUrl);
    setSubmitting(false);
    if (result.error) {
      setError(result.error);
    } else {
      setNewUrl('');
      loadWebhooks();
    }
  }

  return (
    <div className="card">
      <div className="card__header">
        <h2 className="card__title">Webhook Subscriptions</h2>
        <span className="card__badge" style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}>
          {webhooks.length} active
        </span>
      </div>
      {error && <div className="create-order__error">{error}</div>}
      <form className="webhook__form" onSubmit={handleRegister}>
        <input
          type="url"
          placeholder="https://your-endpoint.com/webhook"
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          required
          className="webhook__input"
        />
        <button
          type="submit"
          disabled={submitting}
          className="webhook__register-btn"
        >
          {submitting ? '...' : 'Register'}
        </button>
      </form>
      {webhooks.length === 0 ? (
        <p className="webhook__empty">No webhooks registered yet.</p>
      ) : (
        <ul className="webhook__list">
          {webhooks.map((wh) => (
            <li key={wh.url} className="webhook__item">
              <span className="webhook__url">{wh.url}</span>
              <span className="webhook__date">
                since {new Date(wh.registeredAt).toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
