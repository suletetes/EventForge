/**
 * Authentication configuration and helpers using AWS Amplify/Cognito.
 * Validates: Requirements 9.5, 9.6
 *
 * - Configures Amplify with Cognito user pool settings
 * - Provides helpers to check auth state and get JWT tokens
 * - Redirects to Cognito login if unauthenticated or token expired
 */

import { Amplify } from 'aws-amplify';
import {
  fetchAuthSession,
  signInWithRedirect,
  signOut,
  getCurrentUser,
} from '@aws-amplify/auth';

/** Auth configuration loaded from environment variables */
const authConfig = {
  userPoolId: process.env.REACT_APP_COGNITO_USER_POOL_ID || '',
  userPoolClientId: process.env.REACT_APP_COGNITO_CLIENT_ID || '',
  loginWith: {
    oauth: {
      domain: process.env.REACT_APP_COGNITO_DOMAIN || '',
      scopes: ['openid', 'email', 'profile'],
      redirectSignIn: [process.env.REACT_APP_REDIRECT_SIGN_IN || window.location.origin],
      redirectSignOut: [process.env.REACT_APP_REDIRECT_SIGN_OUT || window.location.origin],
      responseType: 'code' as const,
    },
  },
};

/** Initialize Amplify with Cognito configuration */
export function configureAuth(): void {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: authConfig.userPoolId,
        userPoolClientId: authConfig.userPoolClientId,
        loginWith: authConfig.loginWith,
      },
    },
  });
}

/**
 * Get the current JWT access token.
 * Returns the token string if authenticated, or null if not.
 */
export async function getAccessToken(): Promise<string | null> {
  try {
    const session = await fetchAuthSession();
    const token = session.tokens?.accessToken?.toString() ?? null;
    return token;
  } catch {
    return null;
  }
}

/**
 * Check if the user is currently authenticated with a valid session.
 * Returns true if a valid token exists, false otherwise.
 */
export async function isAuthenticated(): Promise<boolean> {
  try {
    await getCurrentUser();
    const token = await getAccessToken();
    return token !== null;
  } catch {
    return false;
  }
}

/**
 * Redirect the user to the Cognito hosted login page.
 * Called when the user is not authenticated or their token has expired.
 */
export async function redirectToLogin(): Promise<void> {
  await signInWithRedirect();
}

/**
 * Sign out the current user and clear the session.
 */
export async function logout(): Promise<void> {
  await signOut();
}

/**
 * Ensure the user is authenticated. If not, redirect to login.
 * Returns the JWT token if authenticated.
 */
export async function ensureAuthenticated(): Promise<string> {
  const token = await getAccessToken();
  if (!token) {
    await redirectToLogin();
    // This line won't execute since redirectToLogin navigates away,
    // but TypeScript needs a return path
    throw new Error('Redirecting to login');
  }
  return token;
}
