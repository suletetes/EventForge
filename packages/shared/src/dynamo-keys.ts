/**
 * DynamoDB key construction utilities for EventForge single-table design.
 *
 * Key patterns:
 * - Order metadata: PK=ORDER#{orderId}, SK=METADATA
 * - Order events: PK=ORDER#{orderId}, SK=EVENT#{timestamp}#{eventId}
 * - User-order relationship: PK=USER#{userId}, SK=ORDER#{orderId}
 * - Idempotency keys: PK=IDEMPOTENCY#{key}, SK=LOCK
 */

export function orderKey(orderId: string): string {
  return `ORDER#${orderId}`;
}

export function orderMetadataSK(): string {
  return 'METADATA';
}

export function orderEventSK(timestamp: string, eventId: string): string {
  return `EVENT#${timestamp}#${eventId}`;
}

export function userKey(userId: string): string {
  return `USER#${userId}`;
}

export function userOrderSK(orderId: string): string {
  return `ORDER#${orderId}`;
}

export function idempotencyKey(key: string): string {
  return `IDEMPOTENCY#${key}`;
}

export function idempotencyLockSK(): string {
  return 'LOCK';
}
