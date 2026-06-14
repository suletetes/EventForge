/**
 * Main Dashboard component with 10-second polling.
 * Validates: Requirements 9.3, 9.4, 9.7
 *
 * - Polls /api/events every 10 seconds
 * - On success, updates state with new events
 * - On failure, shows error indicator but keeps previous data, retries on next cycle
 * - Cleans up interval on unmount
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { fetchEvents, fetchOrders } from '../api';
import { EventList, EventItem } from './EventList';
import { OrderStatus, OrderItem } from './OrderStatus';
import { CreateOrder } from './CreateOrder';
import { WebhookManager } from './WebhookManager';

const POLL_INTERVAL_MS = 10_000;

export interface DashboardProps {}

export function Dashboard(_props: DashboardProps): React.ReactElement {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadData = useCallback(async () => {
    // Fetch events
    const eventsResponse = await fetchEvents();
    if (eventsResponse.error) {
      setEventsError(eventsResponse.error);
      // Keep previous data on failure, retry on next cycle
    } else if (eventsResponse.data) {
      setEvents(eventsResponse.data.slice(0, 50));
      setEventsError(null);
    }

    // Fetch orders
    const ordersResponse = await fetchOrders();
    if (ordersResponse.error) {
      setOrdersError(ordersResponse.error);
      // Keep previous data on failure, retry on next cycle
    } else if (ordersResponse.data) {
      setOrders(ordersResponse.data);
      setOrdersError(null);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    // Initial data load
    loadData();

    // Set up polling at 10-second intervals
    intervalRef.current = setInterval(loadData, POLL_INTERVAL_MS);

    // Clean up interval on unmount
    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [loadData]);

  return (
    <div className="dashboard">
      <CreateOrder onOrderCreated={loadData} />
      <WebhookManager />
      {(eventsError || ordersError) && (
        <div className="dashboard__error" role="alert">
          {eventsError && (
            <p className="dashboard__error-message">
              Events error: {eventsError}. Retrying...
            </p>
          )}
          {ordersError && (
            <p className="dashboard__error-message">
              Orders error: {ordersError}. Retrying...
            </p>
          )}
        </div>
      )}
      <div className="dashboard__content">
        <section className="dashboard__section dashboard__section--events">
          <EventList events={events} loading={loading} />
        </section>
        <section className="dashboard__section dashboard__section--orders">
          <OrderStatus orders={orders} loading={loading} />
        </section>
      </div>
    </div>
  );
}

export default Dashboard;
