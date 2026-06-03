/**
 * Entry point for the EventForge React application.
 * Validates: Requirements 9.1
 *
 * Configures Amplify auth and renders the root App component.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { configureAuth } from './auth';
import { App } from './App';

// Initialize Cognito authentication configuration
configureAuth();

// Mount the React application
const rootElement = document.getElementById('root');
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
