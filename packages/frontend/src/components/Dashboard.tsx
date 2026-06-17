/**
 * Main Dashboard component with 10-second polling.
 * Validates: Requirements 9.3, 9.4, 9.7
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { fetchEvents, fetchOrders } from '../api';
import { EventList, EventItem } from './EventList';
import { OrderStatus, OrderItem } from './OrderStatus';
import { CreateOrder } from './CreateOrder';
import { WebhookManager } from './WebhookManager';

const POLL_INTERVAL_MS = 10_000;

export function Dashboard(): React.ReactElement {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadData = useCallback(async () => {
    const eventsResponse = await fetchEvents();
    if (eventsResponse.error) {
      setEventsError(eventsResponse.error);
    } else if (eventsResponse.data) {
      setEvents(eventsResponse.data.slice(0, 50));
      setEventsError(null);
    }

    const ordersResponse = await fetchOrders();
    if (ordersResponse.error) {
      setOrdersError(ordersResponse.error);
    } else if (ordersResponse.data) {
      setOrders(ordersResponse.data);
      setOrdersError(null);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
    intervalRef.current = setInterval(loadData, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [loadData]);

  return (
    <div className="dashboard">
      {(eventsError || ordersError) && (
        <div className="dashboard__error" role="alert">
          {eventsError && (
            <p className="dashboard__error-message">
              Events: {eventsError}. Retrying...
            </p>
          )}
          {ordersError && (
            <p className="dashboard__error-message">
              Orders: {ordersError}. Retrying...
            </p>
          )}
        </div>
      )}

      <div className="dashboard__grid-top">
        <CreateOrder onOrderCreated={loadData} />
        <WebhookManager />
      </div>

      <div className="dashboard__grid-bottom">
        <div className="card">
          <div className="card__header">
            <h2 className="card__title">Recent Events</h2>
            <span className="card__badge" style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}>
              {events.length} events
            </span>
          </div>
          <EventList events={events} loading={loading} />
        </div>

        <div className="card">
          <div className="card__header">
            <h2 className="card__title">Order Status</h2>
            <span className="card__badge" style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}>
              {orders.length} orders
            </span>
          </div>
          <OrderStatus orders={orders} loading={loading} />
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
