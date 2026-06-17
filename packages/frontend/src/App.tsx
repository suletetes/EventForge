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
    return (
      <div className="loading-page">
        <div className="spinner" />
        <span>Loading EventForge...</span>
      </div>
    );
  }

  if (authState === 'unauthenticated') {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-card__logo">
            <div className="login-card__logo-icon">⚡</div>
            <h1 className="login-card__title">EventForge</h1>
          </div>
          <p className="login-card__subtitle">Sign in to access the event dashboard</p>
          {error && <div className="login-card__error">{error}</div>}
          <form className="login-card__form" onSubmit={handleLogin}>
            <input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="login-card__input"
              required
              autoComplete="email"
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="login-card__input"
              required
              autoComplete="current-password"
            />
            <button
              type="submit"
              disabled={loggingIn}
              className="login-card__button"
            >
              {loggingIn ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__brand">
          <div className="app-header__icon">⚡</div>
          <span className="app-header__title">EventForge</span>
        </div>
        <div className="app-header__nav">
          <span className="app-header__status">
            <span className="app-header__status-dot" />
            Live
          </span>
          <button onClick={handleLogout} className="app-header__logout">
            Sign Out
          </button>
        </div>
      </header>
      <main className="app-main">
        <Dashboard />
      </main>
    </div>
  );
}

export default App;
