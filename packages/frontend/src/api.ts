/**
 * API client for EventForge backend.
 * Validates: Requirements 9.5
 *
 * All requests include the JWT token in the Authorization header.
 * If a request returns 401, the user is redirected to login.
 */

import { getAccessToken, redirectToLogin } from './auth';

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || '/api';

export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
  status: number;
}

/**
 * Make an authenticated API request.
 * Includes the JWT token in the Authorization header.
 * Redirects to login on 401 responses.
 */
async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const token = await getAccessToken();

  if (!token) {
    await redirectToLogin();
    return { data: null, error: 'Not authenticated', status: 401 };
  }

  const url = `${API_BASE_URL}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    ...(options.headers as Record<string, string> || {}),
  };

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (response.status === 401) {
      // Token expired or invalid — redirect to login
      await redirectToLogin();
      return { data: null, error: 'Token expired', status: 401 };
    }

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      return {
        data: null,
        error: (errorBody as { error?: string }).error || `Request failed with status ${response.status}`,
        status: response.status,
      };
    }

    const data = await response.json() as T;
    return { data, error: null, status: response.status };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : 'Network error',
      status: 0,
    };
  }
}

/** GET request with authentication */
export function get<T>(path: string): Promise<ApiResponse<T>> {
  return request<T>(path, { method: 'GET' });
}

/** POST request with authentication */
export function post<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
  return request<T>(path, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Fetch recent events from the API */
export function fetchEvents() {
  return get<Array<{ eventType: string; timestamp: string; source: string }>>('/events');
}

/** Fetch user's orders from the API */
export function fetchOrders() {
  return get<Array<{ orderId: string; status: string; total: number; createdAt: string }>>('/orders');
}

/** Fetch a single order by ID */
export function fetchOrder(orderId: string) {
  return get<{
    orderId: string;
    userId: string;
    status: string;
    items: Array<{ productId: string; name: string; quantity: number; price: number }>;
    total: number;
    createdAt: string;
    updatedAt: string;
    events: Array<{ eventType: string; timestamp: string; source: string }>;
  }>(`/orders/${orderId}`);
}
