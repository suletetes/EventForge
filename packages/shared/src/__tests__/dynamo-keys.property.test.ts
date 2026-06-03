import * as fc from 'fast-check';
import {
  orderKey,
  orderMetadataSK,
  orderEventSK,
  userKey,
  userOrderSK,
  idempotencyKey,
  idempotencyLockSK,
} from '../dynamo-keys';

/**
 * Property-based tests for DynamoDB key construction.
 *
 * Feature: eventforge-platform, Property 17: DynamoDB key construction follows entity patterns
 *
 * For any random orderId, userId, timestamp, or idempotency key value,
 * verify constructed PK/SK match expected patterns.
 *
 * **Validates: Requirements 7.1**
 */
describe('Property 17: DynamoDB key construction follows entity patterns', () => {
  const NUM_RUNS = 100;

  it('orderKey(orderId) always produces ORDER#{orderId}', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (orderId) => {
        const result = orderKey(orderId);
        expect(result).toBe(`ORDER#${orderId}`);
        expect(result.startsWith('ORDER#')).toBe(true);
        expect(result.slice('ORDER#'.length)).toBe(orderId);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('orderMetadataSK() always produces METADATA', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const result = orderMetadataSK();
        expect(result).toBe('METADATA');
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('orderEventSK(timestamp, eventId) always produces EVENT#{timestamp}#{eventId}', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        (timestamp, eventId) => {
          const result = orderEventSK(timestamp, eventId);
          expect(result).toBe(`EVENT#${timestamp}#${eventId}`);
          expect(result.startsWith('EVENT#')).toBe(true);
          // Verify the structure contains both parts separated by #
          const withoutPrefix = result.slice('EVENT#'.length);
          expect(withoutPrefix).toContain(timestamp);
          expect(withoutPrefix).toContain(eventId);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it('userKey(userId) always produces USER#{userId}', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (userId) => {
        const result = userKey(userId);
        expect(result).toBe(`USER#${userId}`);
        expect(result.startsWith('USER#')).toBe(true);
        expect(result.slice('USER#'.length)).toBe(userId);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('userOrderSK(orderId) always produces ORDER#{orderId}', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (orderId) => {
        const result = userOrderSK(orderId);
        expect(result).toBe(`ORDER#${orderId}`);
        expect(result.startsWith('ORDER#')).toBe(true);
        expect(result.slice('ORDER#'.length)).toBe(orderId);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('idempotencyKey(key) always produces IDEMPOTENCY#{key}', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (key) => {
        const result = idempotencyKey(key);
        expect(result).toBe(`IDEMPOTENCY#${key}`);
        expect(result.startsWith('IDEMPOTENCY#')).toBe(true);
        expect(result.slice('IDEMPOTENCY#'.length)).toBe(key);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('idempotencyLockSK() always produces LOCK', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const result = idempotencyLockSK();
        expect(result).toBe('LOCK');
      }),
      { numRuns: NUM_RUNS }
    );
  });
});
