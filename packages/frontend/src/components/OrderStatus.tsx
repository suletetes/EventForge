/**
 * OrderStatus component showing order status and current workflow step.
 * Validates: Requirements 9.4
 */

import React from 'react';

export interface OrderItem {
  orderId: string;
  status: string;
  total: number;
  createdAt: string;
}

export interface OrderStatusProps {
  orders: OrderItem[];
  loading: boolean;
}

const WORKFLOW_STEPS = [
  'ValidateOrder',
  'ReserveInventory',
  'ChargePayment',
  'ConfirmOrder',
] as const;

function getWorkflowStep(status: string): string {
  switch (status) {
    case 'pending':
      return 'ValidateOrder';
    case 'processing':
      return 'ReserveInventory';
    case 'charging':
      return 'ChargePayment';
    case 'completed':
      return 'ConfirmOrder';
    case 'failed':
      return 'Failed';
    default:
      return status;
  }
}

function getStatusBadgeClass(status: string): string {
  switch (status) {
    case 'completed':
      return 'status-badge status-badge--completed';
    case 'failed':
      return 'status-badge status-badge--failed';
    case 'pending':
      return 'status-badge status-badge--pending';
    case 'processing':
    case 'charging':
      return 'status-badge status-badge--processing';
    default:
      return 'status-badge';
  }
}

export function OrderStatus({ orders, loading }: OrderStatusProps): React.ReactElement {
  if (loading && orders.length === 0) {
    return (
      <div className="order-status__empty">
        <div className="spinner" style={{ margin: '0 auto 8px' }} />
        Loading orders...
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="order-status__empty">
        No orders yet. Place your first order above.
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="order-status__table">
        <thead>
          <tr>
            <th>Order ID</th>
            <th>Status</th>
            <th>Step</th>
            <th>Total</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.orderId}>
              <td>
                <span className="order-status__id">
                  {order.orderId.slice(0, 10)}...
                </span>
              </td>
              <td>
                <span className={getStatusBadgeClass(order.status)}>
                  {order.status}
                </span>
              </td>
              <td>
                <span className="workflow-step">{getWorkflowStep(order.status)}</span>
              </td>
              <td>
                <span className="order-total">${order.total.toFixed(2)}</span>
              </td>
              <td>
                <span className="event-list__time">
                  {new Date(order.createdAt).toLocaleString()}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export { getWorkflowStep, WORKFLOW_STEPS };
export default OrderStatus;
