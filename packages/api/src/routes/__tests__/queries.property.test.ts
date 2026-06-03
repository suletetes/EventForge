/**
 * Property-based tests for order and event query functions.
 *
 * Tests that getUserOrders and getRecentEvents always return results
 * sorted by timestamp descending and capped at their respective limits.
 *
 * Validates: Requirements 2.2, 2.6
 */

import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import * as fc from 'fast-check';
import { getUserOrders, Order } from '@eventforge/shared';

// For getRecentEvents, we need to mock the module-level DynamoDB client.
// The event-repository creates its own DynamoDBDocumentClient internally,
// so we mock at the DynamoDBDocumentClient level which aws-sdk-client-mock intercepts.
const ddbMock = mockClient(DynamoDBDocumentClient);

// --- Arbitraries ---

const orderIdArb = fc.stringOf(
  fc.constantFrom(
    ...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')
  ),
  { minLength: 8, maxLength: 26 }
);

const userIdArb = fc.stringOf(
  fc.constantFrom(
    ...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')
  ),
  { minLength: 5, maxLength: 20 }
);

const statusArb = fc.constantFrom(
  'pending' as const,
  'processing' as const,
  'completed' as const,
  'failed' as const
);

/** Generate a random ISO timestamp within a reasonable range */
const isoTimestampArb = fc
  .date({
    min: new Date('2020-01-01T00:00:00.000Z'),
    max: new Date('2030-12-31T23:59:59.999Z'),
  })
  .map((d) => d.toISOString());

/** Generate a random order record as returned by DynamoDB GSI2 query */
const orderRecordArb = fc
  .tuple(orderIdArb, userIdArb, statusArb, isoTimestampArb, isoTimestampArb)
  .map(([orderId, userId, status, createdAt, updatedAt]) => ({
    orderId,
    userId,
    status,
    items: [{ productId: 'p1', name: 'Item', quantity: 1, price: 10.0 }],
    total: 10.0,
    createdAt,
    updatedAt,
    GSI2PK: userId,
    GSI2SK: createdAt,
  }));

/** Generate a random stored event record as returned by DynamoDB Scan */
const storedEventArb = fc
  .tuple(orderIdArb, isoTimestampArb, orderIdArb)
  .map(([orderId, timestamp, eventId]) => ({
    PK: `ORDER#${orderId}`,
    SK: `EVENT#${timestamp}#${eventId}`,
    orderId,
    eventId,
    eventType: 'order.created',
    payload: {},
    source: 'eventforge.api',
    timestamp,
  }));

describe('Query Property Tests', () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  afterAll(() => {
    ddbMock.restore();
  });

  /**
   * Property 3: User orders query returns sorted results capped at 50
   *
   * For any user with N orders in the data store, a GET /api/orders request
   * SHALL return min(N, 50) orders sorted by createdAt in descending order,
   * where each consecutive pair satisfies orders[i].createdAt >= orders[i+1].createdAt.
   *
   * **Validates: Requirements 2.2**
   */
  describe('Property 3: User orders query returns sorted results capped at 50', () => {
    it('should return results sorted by createdAt descending and capped at 50', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(orderRecordArb, { minLength: 0, maxLength: 120 }),
          async (orders) => {
            ddbMock.reset();

            // DynamoDB GSI2 query with ScanIndexForward=false returns items
            // sorted by GSI2SK (createdAt) descending, capped by Limit.
            // Simulate what DynamoDB would return: sorted desc, capped at 50.
            const sortedOrders = [...orders]
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              .slice(0, 50);

            ddbMock.on(QueryCommand).resolves({
              Items: sortedOrders,
            });

            const result = await getUserOrders(
              ddbMock as unknown as DynamoDBDocumentClient,
              'test-user',
              50
            );

            // 1. Results never exceed 50
            expect(result.length).toBeLessThanOrEqual(50);

            // 2. Results count matches what DynamoDB returned (already capped)
            expect(result.length).toBe(sortedOrders.length);

            // 3. For any consecutive pair: items[i].createdAt >= items[i+1].createdAt
            for (let i = 0; i < result.length - 1; i++) {
              expect(result[i].createdAt >= result[i + 1].createdAt).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should send a Limit parameter to DynamoDB that is always capped at 50', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 500 }),
          async (requestedLimit) => {
            ddbMock.reset();
            ddbMock.on(QueryCommand).resolves({ Items: [] });

            await getUserOrders(
              ddbMock as unknown as DynamoDBDocumentClient,
              'test-user',
              requestedLimit
            );

            const calls = ddbMock.commandCalls(QueryCommand);
            expect(calls).toHaveLength(1);

            const sentLimit = calls[0].args[0].input.Limit;
            // The function caps the limit at 50
            expect(sentLimit).toBeLessThanOrEqual(50);
            expect(sentLimit).toBeGreaterThanOrEqual(1);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should query with ScanIndexForward=false for descending order', async () => {
      await fc.assert(
        fc.asyncProperty(
          userIdArb,
          async (userId) => {
            ddbMock.reset();
            ddbMock.on(QueryCommand).resolves({ Items: [] });

            await getUserOrders(
              ddbMock as unknown as DynamoDBDocumentClient,
              userId,
              50
            );

            const calls = ddbMock.commandCalls(QueryCommand);
            expect(calls).toHaveLength(1);

            // Must use ScanIndexForward=false for descending sort
            expect(calls[0].args[0].input.ScanIndexForward).toBe(false);
            // Must use GSI2 index
            expect(calls[0].args[0].input.IndexName).toBe('GSI2');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 4: Events query returns sorted results capped at 100
   *
   * For any set of N events in the data store, a GET /api/events request
   * SHALL return min(N, 100) events sorted by timestamp in descending order,
   * where each consecutive pair satisfies events[i].timestamp >= events[i+1].timestamp.
   *
   * **Validates: Requirements 2.6**
   */
  describe('Property 4: Events query returns sorted results capped at 100', () => {
    // Import getRecentEvents - it uses the module-level DynamoDB client
    // which aws-sdk-client-mock intercepts at the DynamoDBDocumentClient level
    let getRecentEvents: typeof import('@eventforge/shared').getRecentEvents;

    beforeAll(async () => {
      // Dynamic import to ensure mock is set up first
      const shared = await import('@eventforge/shared');
      getRecentEvents = shared.getRecentEvents;
    });

    it('should return results sorted by timestamp descending and capped at 100', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(storedEventArb, { minLength: 0, maxLength: 200 }),
          async (events) => {
            ddbMock.reset();

            // Scan returns events in arbitrary order; getRecentEvents sorts in-memory
            ddbMock.on(ScanCommand).resolves({
              Items: events,
            });

            const result = await getRecentEvents(100);

            // 1. Results never exceed 100
            expect(result.length).toBeLessThanOrEqual(100);

            // 2. Results count is min(events.length, 100)
            expect(result.length).toBe(Math.min(events.length, 100));

            // 3. For any consecutive pair: events[i].timestamp >= events[i+1].timestamp
            for (let i = 0; i < result.length - 1; i++) {
              expect(result[i].timestamp >= result[i + 1].timestamp).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should cap results at 100 even with large event sets', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(storedEventArb, { minLength: 101, maxLength: 250 }),
          async (events) => {
            ddbMock.reset();

            ddbMock.on(ScanCommand).resolves({
              Items: events,
            });

            const result = await getRecentEvents(100);

            // Results must never exceed 100
            expect(result.length).toBeLessThanOrEqual(100);

            // Results must be sorted by timestamp descending
            for (let i = 0; i < result.length - 1; i++) {
              expect(result[i].timestamp >= result[i + 1].timestamp).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should enforce requested limit when less than 100', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 99 }),
          fc.array(storedEventArb, { minLength: 0, maxLength: 150 }),
          async (requestedLimit, events) => {
            ddbMock.reset();

            ddbMock.on(ScanCommand).resolves({
              Items: events,
            });

            const result = await getRecentEvents(requestedLimit);

            // Results should not exceed the requested limit
            expect(result.length).toBeLessThanOrEqual(requestedLimit);

            // Results must be sorted by timestamp descending
            for (let i = 0; i < result.length - 1; i++) {
              expect(result[i].timestamp >= result[i + 1].timestamp).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
