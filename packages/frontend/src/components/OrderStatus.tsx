/**
 * OrderStatus component showing order status and current workflow step.
 * Validates: Requirements 9.4
 *
 * Displays each order's status and maps it to the current workflow step:
 * ValidateOrder, ReserveInventory, ChargePayment, ConfirmOrder, or Failed.
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

/** Workflow steps in processing order */
const WORKFLOW_STEPS = [
  'ValidateOrder',
  'ReserveInventory',
  'ChargePayment',
  'ConfirmOrder',
] as const;

/**
 * Maps an order status to the current workflow step display value.
 */
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

/**
 * Returns a CSS modifier class based on the order status.
 */
function getStatusClass(status: string): string {
  switch (status) {
    case 'completed':
      return 'order-status__badge--completed';
    case 'failed':
      return 'order-status__badge--failed';
    case 'pending':
      return 'order-status__badge--pending';
    case 'processing':
    case 'charging':
      return 'order-status__badge--processing';
    default:
      return '';
  }
}

export function OrderStatus({ orders, loading }: OrderStatusProps): React.ReactElement {
  if (loading && orders.length === 0) {
    return (
      <div className="order-status order-status--loading">
        <h2>Order Status</h2>
        <p>Loading orders...</p>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="order-status order-status--empty">
        <h2>Order Status</h2>
        <p>No orders to display.</p>
      </div>
    );
  }

  return (
    <div className="order-status">
      <h2>Order Status</h2>
      <table className="order-status__table">
        <thead>
          <tr>
            <th>Order ID</th>
            <th>Status</th>
            <th>Workflow Step</th>
            <th>Total</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.orderId} className="order-status__row">
              <td className="order-status__cell order-status__cell--id">
                {order.orderId}
              </td>
              <td className="order-status__cell order-status__cell--status">
                <span className={`order-status__badge ${getStatusClass(order.status)}`}>
                  {order.status}
                </span>
              </td>
              <td className="order-status__cell order-status__cell--step">
                {getWorkflowStep(order.status)}
              </td>
              <td className="order-status__cell order-status__cell--total">
                ${order.total.toFixed(2)}
              </td>
              <td className="order-status__cell order-status__cell--created">
                {new Date(order.createdAt).toLocaleString()}
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
