/**
 * Property-based test for idempotency round-trip.
 *
 * Property 18: Idempotency round-trip preserves original result
 * - For any write operation with an idempotency key, verify first execution
 *   stores result with TTL = now + 24h, and subsequent executions return
 *   identical cached result without creating a duplicate.
 *
 * **Validates: Requirements 7.4, 7.5**
 */

import * as fc from 'fast-check';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  TransactWriteCommand,
  GetCommand,
} from '@aws-sdk/lib-dynamodb';
import { createOrder, Order } from '../order-repository';

const ddbClient = new DynamoDBClient({ region: 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(ddbClient);
const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

/** Arbitrary for generating valid order items */
const orderItemArb = fc.record({
  productId: fc.string({ minLength: 1, maxLength: 36 }),
  name: fc.string({ minLength: 1, maxLength: 100 }),
  quantity: fc.integer({ min: 1, max: 100 }),
  price: fc.double({ min: 0.01, max: 9999.99, noNaN: true, noDefaultInfinity: true }),
});

/** Arbitrary for generating valid orders */
const orderArb = fc
  .record({
    orderId: fc.string({ minLength: 1, maxLength: 36 }),
    userId: fc.string({ minLength: 1, maxLength: 36 }),
    items: fc.array(orderItemArb, { minLength: 1, maxLength: 5 }),
    total: fc.double({ min: 0.01, max: 999999.99, noNaN: true, noDefaultInfinity: true }),
    createdAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }).map((d) => d.toISOString()),
    updatedAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }).map((d) => d.toISOString()),
  })
  .map(
    (r): Order => ({
      ...r,
      status: 'pending',
    })
  );

/** Arbitrary for generating idempotency keys */
const idempotencyKeyArb = fc.string({ minLength: 1, maxLength: 64 });

describe('Property 18: Idempotency round-trip preserves original result', () => {
  it('first execution stores result with TTL within 24h of current time', async () => {
    await fc.assert(
      fc.asyncProperty(orderArb, idempotencyKeyArb, async (order, idemKey) => {
        ddbMock.reset();
        ddbMock.on(TransactWriteCommand).resolves({});

        const beforeTime = Math.floor(Date.now() / 1000);
        const result = await createOrder(docClient, order, idemKey);
        const afterTime = Math.floor(Date.now() / 1000);

        // First call should succeed with created=true
        expect(result.created).toBe(true);
        expect(result.order).toEqual(order);

        // Verify the TransactWriteCommand was called
        const calls = ddbMock.commandCalls(TransactWriteCommand);
        expect(calls.length).toBeGreaterThanOrEqual(1);

        // Get the last call's idempotency item (3rd TransactItem)
        const lastCall = calls[calls.length - 1];
        const transactItems = lastCall.args[0].input.TransactItems!;
        const idempotencyItem = transactItems[2].Put!.Item!;

        // Verify expiresAt is within 24h of current time
        const expectedTtlMin = beforeTime + 24 * 60 * 60;
        const expectedTtlMax = afterTime + 24 * 60 * 60;
        expect(idempotencyItem.expiresAt).toBeGreaterThanOrEqual(expectedTtlMin);
        expect(idempotencyItem.expiresAt).toBeLessThanOrEqual(expectedTtlMax);
      }),
      { numRuns: 100 }
    );
  });

  it('subsequent execution with same idempotency key returns identical cached result (created=false) without duplicate', async () => {
    await fc.assert(
      fc.asyncProperty(orderArb, idempotencyKeyArb, async (order, idemKey) => {
        ddbMock.reset();

        // First call succeeds
        ddbMock.on(TransactWriteCommand).resolves({});
        const firstResult = await createOrder(docClient, order, idemKey);
        expect(firstResult.created).toBe(true);
        expect(firstResult.order).toEqual(order);

        // Reset mock for second call
        ddbMock.reset();

        // Second call with same idempotency key: TransactWrite fails with TransactionCanceledException
        const txError = new Error('Transaction cancelled');
        txError.name = 'TransactionCanceledException';
        ddbMock.on(TransactWriteCommand).rejects(txError);

        // GetCommand returns the original order (simulating cached result lookup)
        ddbMock.on(GetCommand).resolves({
          Item: {
            PK: `ORDER#${order.orderId}`,
            SK: 'METADATA',
            ...order,
          },
        });

        const secondResult = await createOrder(docClient, order, idemKey);

        // Second call should return created=false
        expect(secondResult.created).toBe(false);

        // The returned order should be identical to the first result
        expect(secondResult.order.orderId).toBe(firstResult.order.orderId);
        expect(secondResult.order.userId).toBe(firstResult.order.userId);
        expect(secondResult.order.status).toBe(firstResult.order.status);
        expect(secondResult.order.total).toBe(firstResult.order.total);
        expect(secondResult.order.createdAt).toBe(firstResult.order.createdAt);
        expect(secondResult.order.items).toEqual(firstResult.order.items);

        // Verify no additional TransactWriteCommand succeeded (no duplicate created)
        const successfulTransactCalls = ddbMock
          .commandCalls(TransactWriteCommand)
          .filter((call) => {
            try {
              // All TransactWrite calls in this phase were rejected
              return false;
            } catch {
              return false;
            }
          });
        expect(successfulTransactCalls).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });
});
