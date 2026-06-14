/**
 * Authentication using AWS Amplify with Cognito.
 * Uses direct sign-in (username/password) instead of OAuth redirect
 * since S3 static hosting only serves HTTP.
 */

import { Amplify } from 'aws-amplify';
import {
  fetchAuthSession,
  signIn,
  signOut,
  signUp,
  getCurrentUser,
} from '@aws-amplify/auth';

/** Initialize Amplify with Cognito configuration */
export function configureAuth(): void {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID || '',
        userPoolClientId: import.meta.env.VITE_COGNITO_CLIENT_ID || '',
      },
    },
  });
}

/**
 * Get the current JWT access token.
 */
export async function getAccessToken(): Promise<string | null> {
  try {
    const session = await fetchAuthSession();
    return session.tokens?.accessToken?.toString() ?? null;
  } catch {
    return null;
  }
}

/**
 * Check if user is authenticated.
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
 * Sign in with username and password.
 */
export async function login(username: string, password: string): Promise<boolean> {
  try {
    const result = await signIn({ username, password });
    return result.isSignedIn;
  } catch (error) {
    console.error('Login failed:', error);
    throw error;
  }
}

/**
 * Sign up a new user.
 */
export async function register(email: string, password: string): Promise<void> {
  await signUp({
    username: email,
    password,
    options: { userAttributes: { email } },
  });
}

/**
 * Sign out.
 */
export async function logout(): Promise<void> {
  await signOut();
}

/** No-op for backwards compat */
export async function redirectToLogin(): Promise<void> {
  // No redirect needed, app shows login form
}
