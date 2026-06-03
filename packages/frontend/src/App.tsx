/**
 * Main App component with authentication check.
 * Validates: Requirements 9.1, 9.5, 9.6
 *
 * - Checks authentication state on mount
 * - Redirects to Cognito login if unauthenticated or token expired
 * - Renders a loading state while checking auth
 * - Renders Dashboard when authenticated (task 14.2)
 */

import React, { useEffect, useState } from 'react';
import { isAuthenticated, redirectToLogin, logout } from './auth';
import { Dashboard } from './components/Dashboard';

type AuthState = 'loading' | 'authenticated' | 'unauthenticated';

export function App(): React.ReactElement {
  const [authState, setAuthState] = useState<AuthState>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth(): Promise<void> {
    try {
      const authenticated = await isAuthenticated();
      if (authenticated) {
        setAuthState('authenticated');
      } else {
        // Redirect to Cognito login page
        setAuthState('unauthenticated');
        await redirectToLogin();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication check failed');
      setAuthState('unauthenticated');
    }
  }

  async function handleLogout(): Promise<void> {
    await logout();
    setAuthState('unauthenticated');
  }

  if (authState === 'loading') {
    return (
      <div className="app app--loading">
        <p>Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app app--error">
        <p>Error: {error}</p>
        <button onClick={checkAuth}>Retry</button>
      </div>
    );
  }

  if (authState === 'unauthenticated') {
    return (
      <div className="app app--unauthenticated">
        <p>Redirecting to login...</p>
      </div>
    );
  }

  // Authenticated — render dashboard with event polling
  return (
    <div className="app app--authenticated">
      <header className="app-header">
        <h1>EventForge Dashboard</h1>
        <button onClick={handleLogout}>Sign Out</button>
      </header>
      <main className="app-main">
        <Dashboard />
      </main>
    </div>
  );
}

export default App;
