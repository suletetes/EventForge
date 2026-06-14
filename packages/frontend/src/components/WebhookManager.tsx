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

  const inputStyle = { padding: '6px 10px', border: '1px solid #ddd', borderRadius: 4, fontSize: 14 };

  return (
    <div style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 16, marginBottom: 20 }}>
      <h3 style={{ margin: '0 0 12px' }}>Webhook Subscriptions</h3>
      {error && <p style={{ color: 'red', fontSize: 13 }}>{error}</p>}
      <form onSubmit={handleRegister} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          type="url"
          placeholder="https://your-endpoint.com/webhook"
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          required
          style={{ ...inputStyle, flex: 1 }}
        />
        <button type="submit" disabled={submitting} style={{ padding: '6px 14px', background: '#0066cc', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
          {submitting ? '...' : 'Register'}
        </button>
      </form>
      {webhooks.length === 0 ? (
        <p style={{ fontSize: 13, color: '#666' }}>No webhooks registered.</p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {webhooks.map((wh) => (
            <li key={wh.url} style={{ fontSize: 13, padding: '4px 0', borderBottom: '1px solid #f0f0f0' }}>
              <code style={{ fontSize: 12 }}>{wh.url}</code>
              <span style={{ color: '#999', marginLeft: 8 }}>since {new Date(wh.registeredAt).toLocaleDateString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
