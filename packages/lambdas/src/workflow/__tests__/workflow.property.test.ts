/**
 * Property-based tests for workflow Lambda handlers.
 *
 * Uses fast-check to verify correctness properties across random inputs:
 * - Property 13: Saga compensation executes on failure after inventory reservation
 * - Property 14: Order context preserved through workflow steps
 * - Property 15: Failed workflow updates order status to "failed"
 *
 * **Validates: Requirements 4.4, 4.6, 4.7, 4.8**
 */

import * as fc from 'fast-check';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { handler as releaseInventoryHandler } from '../release-inventory';
import { handler as orderFailedHandler } from '../order-failed';
import { handler as reserveInventoryHandler } from '../reserve-inventory';
import { handler as chargePaymentHandler } from '../charge-payment';
import { handler as confirmOrderHandler } from '../confirm-order';

const ddbMock = mockClient(DynamoDBDocumentClient);
const ebMock = mockClient(EventBridgeClient);

beforeEach(() => {
  ddbMock.reset();
  ebMock.reset();
});

// --- Generators ---

/** Generates a random non-empty alphanumeric string for IDs */
const arbId = () =>
  fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'), {
    minLength: 5,
    maxLength: 26,
  });

/** Generates a random order item */
const arbOrderItem = () =>
  fc.record({
    productId: arbId(),
    name: fc.string({ minLength: 1, maxLength: 50 }),
    quantity: fc.integer({ min: 1, max: 100 }),
    price: fc.double({ min: 0.01, max: 9999.99, noNaN: true }),
  });

/** Generates a random order context with valid fields */
const arbOrderContext = () =>
  fc.record({
    orderId: arbId(),
    userId: arbId(),
    items: fc.array(arbOrderItem(), { minLength: 1, maxLength: 10 }),
    total: fc.double({ min: 0.01, max: 500000, noNaN: true }),
    status: fc.constantFrom('pending', 'processing', 'completed', 'failed'),
  });

/**
 * Property 13: Saga compensation executes on failure after inventory reservation
 *
 * Since we can't test Step Functions routing directly, we verify that the
 * ReleaseInventory handler correctly releases items for any order context.
 * This confirms the compensation step works correctly when invoked by the
 * workflow after ChargePayment or ConfirmOrder fails.
 *
 * For any order context with N items, ReleaseInventory SHALL:
 * 1. Issue exactly N DynamoDB UpdateCommands (one per item)
 * 2. Set each reservation status to "released"
 * 3. Use the correct INVENTORY#{productId} / RESERVATION#{orderId} key pattern
 *
 * **Validates: Requirements 4.4, 4.7**
 */
describe('Property 13: Saga compensation executes on failure after inventory reservation', () => {
  it('releases inventory for every item in any order context', async () => {
    await fc.assert(
      fc.asyncProperty(arbOrderContext(), async (orderContext) => {
        ddbMock.reset();
        ddbMock.on(UpdateCommand).resolves({});

        await releaseInventoryHandler(orderContext);

        const calls = ddbMock.commandCalls(UpdateCommand);

        // One UpdateCommand per item
        expect(calls.length).toBe(orderContext.items.length);

        // Each call targets the correct inventory key and sets status to "released"
        for (let i = 0; i < orderContext.items.length; i++) {
          const input = calls[i].args[0].input;
          expect(input.Key).toEqual({
            PK: `INVENTORY#${orderContext.items[i].productId}`,
            SK: `RESERVATION#${orderContext.orderId}`,
          });
          expect(input.ExpressionAttributeValues![':status']).toBe('released');
        }
      }),
      { numRuns: 100 }
    );
  });
});

/**
 * Property 14: Order context preserved through workflow steps
 *
 * For any order input containing orderId, userId, items, and total,
 * each workflow step SHALL receive and return all four fields with values
 * identical to the original input (or correctly transformed per step contract).
 *
 * We test:
 * - reserve-inventory: preserves orderId, userId, items, total
 * - release-inventory: preserves orderId, userId, items, total
 * - charge-payment: preserves orderId, userId, items, total (adds transactionId)
 * - confirm-order: preserves orderId, userId, items, total (changes status to "completed")
 * - order-failed: preserves orderId, userId, items, total
 *
 * **Validates: Requirements 4.6**
 */
describe('Property 14: Order context preserved through workflow steps', () => {
  it('reserve-inventory preserves orderId, userId, items, total', async () => {
    await fc.assert(
      fc.asyncProperty(arbOrderContext(), async (orderContext) => {
        ddbMock.reset();
        ddbMock.on(UpdateCommand).resolves({
          Attributes: {
            orderId: orderContext.orderId,
            userId: orderContext.userId,
            status: 'processing',
            items: orderContext.items,
            total: orderContext.total,
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T01:00:00.000Z',
          },
        });

        const result = await reserveInventoryHandler(orderContext);

        expect(result.orderId).toBe(orderContext.orderId);
        expect(result.userId).toBe(orderContext.userId);
        expect(result.items).toEqual(orderContext.items);
        expect(result.total).toBe(orderContext.total);
      }),
      { numRuns: 100 }
    );
  });

  it('release-inventory preserves orderId, userId, items, total', async () => {
    await fc.assert(
      fc.asyncProperty(arbOrderContext(), async (orderContext) => {
        ddbMock.reset();
        ddbMock.on(UpdateCommand).resolves({});

        const result = await releaseInventoryHandler(orderContext);

        expect(result.orderId).toBe(orderContext.orderId);
        expect(result.userId).toBe(orderContext.userId);
        expect(result.items).toEqual(orderContext.items);
        expect(result.total).toBe(orderContext.total);
      }),
      { numRuns: 100 }
    );
  });

  it('charge-payment preserves orderId, userId, items, total', async () => {
    await fc.assert(
      fc.asyncProperty(arbOrderContext(), async (orderContext) => {
        // ChargePayment only succeeds for total <= 500000 (our generator caps at 500000)
        const result = await chargePaymentHandler(orderContext);

        expect(result.orderId).toBe(orderContext.orderId);
        expect(result.userId).toBe(orderContext.userId);
        expect(result.items).toEqual(orderContext.items);
        expect(result.total).toBe(orderContext.total);
      }),
      { numRuns: 100 }
    );
  });

  it('confirm-order preserves orderId, userId, items, total', async () => {
    await fc.assert(
      fc.asyncProperty(arbOrderContext(), async (orderContext) => {
        ddbMock.reset();
        ebMock.reset();
        ddbMock.on(UpdateCommand).resolves({
          Attributes: {
            orderId: orderContext.orderId,
            userId: orderContext.userId,
            status: 'completed',
            items: orderContext.items,
            total: orderContext.total,
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T01:00:00.000Z',
          },
        });
        ebMock.on(PutEventsCommand).resolves({
          FailedEntryCount: 0,
          Entries: [{ EventId: 'evt-1' }],
        });

        const result = await confirmOrderHandler(orderContext);

        expect(result.orderId).toBe(orderContext.orderId);
        expect(result.userId).toBe(orderContext.userId);
        expect(result.items).toEqual(orderContext.items);
        expect(result.total).toBe(orderContext.total);
      }),
      { numRuns: 100 }
    );
  });

  it('order-failed preserves orderId, userId, items, total', async () => {
    await fc.assert(
      fc.asyncProperty(arbOrderContext(), async (orderContext) => {
        ddbMock.reset();
        ddbMock.on(UpdateCommand).resolves({
          Attributes: {
            orderId: orderContext.orderId,
            userId: orderContext.userId,
            status: 'failed',
            items: orderContext.items,
            total: orderContext.total,
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T01:00:00.000Z',
          },
        });

        const result = await orderFailedHandler(orderContext);

        expect(result.orderId).toBe(orderContext.orderId);
        expect(result.userId).toBe(orderContext.userId);
        expect(result.items).toEqual(orderContext.items);
        expect(result.total).toBe(orderContext.total);
      }),
      { numRuns: 100 }
    );
  });
});

/**
 * Property 15: Failed workflow updates order status to "failed"
 *
 * For any order context that reaches the OrderFailed state, the order-failed
 * handler SHALL call updateOrderStatus with status "failed" in DynamoDB.
 * This verifies the DynamoDB UpdateCommand is issued with ':status' = 'failed'
 * regardless of the input order context.
 *
 * **Validates: Requirements 4.8**
 */
describe('Property 15: Failed workflow updates order status to "failed"', () => {
  it('calls updateOrderStatus with "failed" for any order context', async () => {
    await fc.assert(
      fc.asyncProperty(arbOrderContext(), async (orderContext) => {
        ddbMock.reset();
        ddbMock.on(UpdateCommand).resolves({
          Attributes: {
            orderId: orderContext.orderId,
            userId: orderContext.userId,
            status: 'failed',
            items: orderContext.items,
            total: orderContext.total,
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T01:00:00.000Z',
          },
        });

        await orderFailedHandler(orderContext);

        const calls = ddbMock.commandCalls(UpdateCommand);
        expect(calls.length).toBe(1);

        const input = calls[0].args[0].input;
        // Verify the status is set to "failed"
        expect(input.ExpressionAttributeValues![':status']).toBe('failed');
        // Verify the correct order key is used
        expect(input.Key).toEqual({
          PK: `ORDER#${orderContext.orderId}`,
          SK: 'METADATA',
        });
      }),
      { numRuns: 100 }
    );
  });
});
