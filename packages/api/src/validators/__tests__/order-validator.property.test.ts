import * as fc from 'fast-check';
import { validateOrderRequest } from '../order-validator';

/**
 * Property-based tests for order validation.
 *
 * Feature: eventforge-platform, Property 1: Valid order creation produces pending order and event
 * Feature: eventforge-platform, Property 2: Invalid order payloads are rejected with specific errors
 *
 * **Validates: Requirements 2.1, 2.9**
 */

const NUM_RUNS = 100;

/** Generator for a valid order item */
const validItemArb = fc.record({
  productId: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
  name: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
  quantity: fc.integer({ min: 1, max: 1000 }),
  price: fc.double({ min: 0.01, max: 99999.99, noNaN: true }),
});

/** Generator for a valid order request */
const validOrderArb = fc.record({
  userId: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
  items: fc.array(validItemArb, { minLength: 1, maxLength: 50 }),
  total: fc.double({ min: 0.01, max: 999999.99, noNaN: true }),
});

describe('Property 1: Valid order creation produces pending order and event', () => {
  it('any valid order (userId non-empty, 1-50 items with valid fields, total 0.01-999999.99) passes validation', () => {
    fc.assert(
      fc.property(validOrderArb, (order) => {
        const result = validateOrderRequest(order);
        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.order.userId).toBe(order.userId.trim());
          expect(result.order.items).toHaveLength(order.items.length);
          expect(result.order.total).toBe(order.total);
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

describe('Property 2: Invalid order payloads are rejected with specific errors', () => {
  it('any order with empty userId fails with specific error', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('', '   ', '\t', '\n'),
        fc.array(validItemArb, { minLength: 1, maxLength: 5 }),
        fc.double({ min: 0.01, max: 999999.99, noNaN: true }),
        (userId, items, total) => {
          const result = validateOrderRequest({ userId, items, total });
          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.errors).toContain(
              'userId is required and must be a non-empty string'
            );
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it('any order with 0 items fails', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
        fc.double({ min: 0.01, max: 999999.99, noNaN: true }),
        (userId, total) => {
          const result = validateOrderRequest({ userId, items: [], total });
          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.errors).toContain(
              'items must be a non-empty array with at most 50 items'
            );
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it('any order with >50 items fails', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
        fc.integer({ min: 51, max: 100 }),
        fc.double({ min: 0.01, max: 999999.99, noNaN: true }),
        (userId, itemCount, total) => {
          const items = Array.from({ length: itemCount }, (_, i) => ({
            productId: `prod-${i}`,
            name: `Item ${i}`,
            quantity: 1,
            price: 1.0,
          }));
          const result = validateOrderRequest({ userId, items, total });
          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.errors).toContain(
              'items must be a non-empty array with at most 50 items'
            );
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it('any order with total outside bounds fails', () => {
    const invalidTotalArb = fc.oneof(
      fc.double({ min: -1000000, max: 0.009, noNaN: true }),
      fc.double({ min: 1000000, max: 9999999, noNaN: true })
    );

    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
        fc.array(validItemArb, { minLength: 1, maxLength: 5 }),
        invalidTotalArb,
        (userId, items, total) => {
          const result = validateOrderRequest({ userId, items, total });
          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.errors).toContain(
              'total must be a number between 0.01 and 999999.99'
            );
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it('any order with invalid item fields (quantity < 1, price <= 0, missing productId/name) fails', () => {
    const invalidItemArb = fc.oneof(
      // Missing productId
      fc.record({
        name: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
        quantity: fc.integer({ min: 1, max: 100 }),
        price: fc.double({ min: 0.01, max: 999.99, noNaN: true }),
      }),
      // Missing name
      fc.record({
        productId: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
        quantity: fc.integer({ min: 1, max: 100 }),
        price: fc.double({ min: 0.01, max: 999.99, noNaN: true }),
      }),
      // Invalid quantity (< 1)
      fc.record({
        productId: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
        name: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
        quantity: fc.integer({ min: -100, max: 0 }),
        price: fc.double({ min: 0.01, max: 999.99, noNaN: true }),
      }),
      // Invalid price (<= 0)
      fc.record({
        productId: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
        name: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
        quantity: fc.integer({ min: 1, max: 100 }),
        price: fc.double({ min: -1000, max: 0, noNaN: true }),
      })
    );

    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
        invalidItemArb,
        fc.double({ min: 0.01, max: 999999.99, noNaN: true }),
        (userId, invalidItem, total) => {
          const result = validateOrderRequest({
            userId,
            items: [invalidItem],
            total,
          });
          expect(result.valid).toBe(false);
          if (!result.valid) {
            // At least one item-level error should be present
            const hasItemError = result.errors.some(
              (e) =>
                e.includes('productId is required') ||
                e.includes('name is required') ||
                e.includes('quantity must be an integer >= 1') ||
                e.includes('price must be a number > 0')
            );
            expect(hasItemError).toBe(true);
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
