// EventForge Shared Package
// Common utilities, types, and data layer shared across the platform

export {
  orderKey,
  orderMetadataSK,
  orderEventSK,
  userKey,
  userOrderSK,
  idempotencyKey,
  idempotencyLockSK,
} from './dynamo-keys';

export {
  createOrder,
  getOrder,
  getOrderWithEvents,
  getUserOrders,
  updateOrderStatus,
} from './order-repository';

export type {
  Order,
  OrderItem,
  OrderEvent,
  OrderWithEvents,
  CreateOrderResult,
} from './order-repository';

export {
  storeEvent,
  getRecentEvents,
  getOrderEvents,
} from './event-repository';

export type { StoredEvent } from './event-repository';
