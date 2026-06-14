import React, { useEffect, useState } from 'react';
import { isAuthenticated, login, logout } from './auth';
import { Dashboard } from './components/Dashboard';

type AuthState = 'loading' | 'authenticated' | 'unauthenticated';

export function App(): React.ReactElement {
  const [authState, setAuthState] = useState<AuthState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    try {
      const authed = await isAuthenticated();
      setAuthState(authed ? 'authenticated' : 'unauthenticated');
    } catch {
      setAuthState('unauthenticated');
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoggingIn(true);
    setError(null);
    try {
      const success = await login(email, password);
      if (success) {
        setAuthState('authenticated');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
    }
    setLoggingIn(false);
  }

  async function handleLogout() {
    await logout();
    setAuthState('unauthenticated');
  }

  if (authState === 'loading') {
    return <div style={{ padding: 40, textAlign: 'center' }}>Loading...</div>;
  }

  if (authState === 'unauthenticated') {
    return (
      <div style={{ maxWidth: 400, margin: '80px auto', padding: 20, fontFamily: 'system-ui' }}>
        <h1 style={{ fontSize: 24 }}>EventForge</h1>
        <p style={{ color: '#666' }}>Sign in to view the event dashboard</p>
        {error && <p style={{ color: 'red' }}>{error}</p>}
        <form onSubmit={handleLogin}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ display: 'block', width: '100%', padding: 10, marginBottom: 10, boxSizing: 'border-box' }}
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ display: 'block', width: '100%', padding: 10, marginBottom: 10, boxSizing: 'border-box' }}
            required
          />
          <button
            type="submit"
            disabled={loggingIn}
            style={{ width: '100%', padding: 12, background: '#0066cc', color: 'white', border: 'none', cursor: 'pointer' }}
          >
            {loggingIn ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: 'system-ui', padding: 20 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, margin: 0 }}>EventForge Dashboard</h1>
        <button onClick={handleLogout} style={{ padding: '8px 16px', cursor: 'pointer' }}>Sign Out</button>
      </header>
      <Dashboard />
    </div>
  );
}

export default App;
