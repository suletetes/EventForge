import { mockClient } from 'aws-sdk-client-mock';
import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import * as AWSXRay from 'aws-xray-sdk-core';
import * as fc from 'fast-check';
import {
  publishEvent,
  setEventBridgeClient,
  setDelayFn,
  resetDelayFn,
  EventDetail,
} from '../event-publisher';

/**
 * Property-based tests for EventBridge event publishing.
 *
 * Validates: Requirements 3.1, 3.7, 10.8
 */

const ebMock = mockClient(EventBridgeClient);

// Mock aws-xray-sdk-core
jest.mock('aws-xray-sdk-core', () => ({
  getSegment: jest.fn(),
}));

// --- Arbitraries ---

const orderIdArb = fc.stringOf(
  fc.constantFrom(
    ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'.split(
      ''
    )
  ),
  { minLength: 1, maxLength: 36 }
);

const userIdArb = fc.stringOf(
  fc.constantFrom(
    ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'.split(
      ''
    )
  ),
  { minLength: 1, maxLength: 36 }
);

const statusArb = fc.constantFrom(
  'pending',
  'processing',
  'completed',
  'failed'
);

const isoTimestampArb = fc
  .date({
    min: new Date('2020-01-01T00:00:00.000Z'),
    max: new Date('2030-12-31T23:59:59.999Z'),
  })
  .map((d) => d.toISOString());

const sourceArb = fc.constantFrom('eventforge.api', 'eventforge.workflow');

const detailTypeArb = fc.constantFrom(
  'order.created',
  'order.completed',
  'order.failed',
  'inventory.reserved',
  'payment.charged'
);

const eventDetailArb = fc
  .tuple(orderIdArb, userIdArb, statusArb, isoTimestampArb)
  .map(
    ([orderId, userId, status, timestamp]): EventDetail => ({
      orderId,
      userId,
      status,
      timestamp,
    })
  );

const traceIdArb = fc
  .tuple(
    fc.hexaString({ minLength: 8, maxLength: 8 }),
    fc.hexaString({ minLength: 24, maxLength: 24 })
  )
  .map(([time, id]) => `1-${time}-${id}`);

// Transient error names that the publisher retries on
const transientErrorNameArb = fc.constantFrom(
  'InternalException',
  'ServiceUnavailableException',
  'ThrottlingException',
  'RequestLimitExceeded',
  'InternalFailure',
  'ServiceException'
);

// Non-transient error names that the publisher does NOT retry on
const nonTransientErrorNameArb = fc.constantFrom(
  'AccessDeniedException',
  'ResourceNotFoundException',
  'ValidationException',
  'InvalidParameterException'
);

describe('Event Publisher Property Tests', () => {
  let delayCallArgs: number[];

  beforeEach(() => {
    ebMock.reset();
    jest.clearAllMocks();
    delayCallArgs = [];
    setEventBridgeClient(ebMock as unknown as EventBridgeClient);
    setDelayFn(async (ms: number) => {
      delayCallArgs.push(ms);
    });
    (AWSXRay.getSegment as jest.Mock).mockReturnValue(null);
  });

  afterEach(() => {
    resetDelayFn();
  });

  /**
   * Property 10: Published events contain required structure
   *
   * For any state change event published to EventBridge, the event SHALL contain:
   * source matching "eventforge.api" or "eventforge.workflow", a detail-type
   * matching the state change, and a detail object containing orderId (non-empty string),
   * userId (non-empty string), status (valid enum value), and timestamp (valid ISO 8601).
   *
   * **Validates: Requirements 3.1**
   */
  describe('Property 10: Published events contain required structure', () => {
    it('should publish events with correct structure for any valid state change', async () => {
      await fc.assert(
        fc.asyncProperty(
          sourceArb,
          detailTypeArb,
          eventDetailArb,
          async (source, detailType, detail) => {
            ebMock.reset();
            ebMock.on(PutEventsCommand).resolves({
              FailedEntryCount: 0,
              Entries: [{ EventId: 'evt-test-id' }],
            });

            const result = await publishEvent(source, detailType, detail);

            // Verify successful publish
            expect(result.eventId).toBe('evt-test-id');

            // Verify the PutEventsCommand was called
            const calls = ebMock.commandCalls(PutEventsCommand);
            expect(calls).toHaveLength(1);

            const entry = calls[0].args[0].input.Entries![0];

            // Verify source
            expect(entry.Source).toBe(source);

            // Verify detail-type
            expect(entry.DetailType).toBe(detailType);

            // Verify event bus name
            expect(entry.EventBusName).toBe('eventforge-bus');

            // Parse and verify detail structure
            const parsedDetail = JSON.parse(entry.Detail!);

            // orderId must be a non-empty string
            expect(typeof parsedDetail.orderId).toBe('string');
            expect(parsedDetail.orderId.length).toBeGreaterThan(0);
            expect(parsedDetail.orderId).toBe(detail.orderId);

            // userId must be a non-empty string
            expect(typeof parsedDetail.userId).toBe('string');
            expect(parsedDetail.userId.length).toBeGreaterThan(0);
            expect(parsedDetail.userId).toBe(detail.userId);

            // status must be a valid enum value
            expect(
              ['pending', 'processing', 'completed', 'failed'].includes(
                parsedDetail.status
              )
            ).toBe(true);
            expect(parsedDetail.status).toBe(detail.status);

            // timestamp must be a valid ISO 8601 string
            expect(typeof parsedDetail.timestamp).toBe('string');
            const parsedDate = new Date(parsedDetail.timestamp);
            expect(parsedDate.toISOString()).toBe(parsedDetail.timestamp);
            expect(parsedDetail.timestamp).toBe(detail.timestamp);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 11: X-Ray trace header propagated in published events
   *
   * For any event published to EventBridge while an active X-Ray trace context
   * exists, the event detail SHALL include the X-Ray trace header so that
   * downstream services can correlate traces across the asynchronous boundary.
   *
   * **Validates: Requirements 10.8**
   */
  describe('Property 11: X-Ray trace header propagated in published events', () => {
    it('should include traceId in event detail when X-Ray trace is active', async () => {
      await fc.assert(
        fc.asyncProperty(
          sourceArb,
          detailTypeArb,
          eventDetailArb,
          traceIdArb,
          async (source, detailType, detail, traceId) => {
            ebMock.reset();
            ebMock.on(PutEventsCommand).resolves({
              FailedEntryCount: 0,
              Entries: [{ EventId: 'evt-trace-test' }],
            });

            // Simulate active X-Ray trace
            (AWSXRay.getSegment as jest.Mock).mockReturnValue({
              trace_id: traceId,
            });

            await publishEvent(source, detailType, detail);

            const calls = ebMock.commandCalls(PutEventsCommand);
            const parsedDetail = JSON.parse(
              calls[0].args[0].input.Entries![0].Detail!
            );

            // traceId must be present and match the active trace
            expect(parsedDetail.traceId).toBe(traceId);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should NOT include traceId in event detail when no X-Ray trace is active', async () => {
      await fc.assert(
        fc.asyncProperty(
          sourceArb,
          detailTypeArb,
          eventDetailArb,
          async (source, detailType, detail) => {
            ebMock.reset();
            ebMock.on(PutEventsCommand).resolves({
              FailedEntryCount: 0,
              Entries: [{ EventId: 'evt-no-trace' }],
            });

            // No active trace
            (AWSXRay.getSegment as jest.Mock).mockReturnValue(null);

            await publishEvent(source, detailType, detail);

            const calls = ebMock.commandCalls(PutEventsCommand);
            const parsedDetail = JSON.parse(
              calls[0].args[0].input.Entries![0].Detail!
            );

            // traceId must NOT be present
            expect(parsedDetail.traceId).toBeUndefined();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 12: Event publish retries up to 3 times with exponential backoff
   *
   * For any EventBridge PutEvents call that fails with a transient error,
   * the API SHALL retry up to 3 times with exponential backoff. If all 3 retries
   * fail, the API SHALL return an error response. If any retry succeeds, the API
   * SHALL return a success response.
   *
   * **Validates: Requirements 3.7**
   */
  describe('Property 12: Event publish retries up to 3 times with exponential backoff', () => {
    it('should succeed when a transient error resolves within retry limit', async () => {
      // Generate a number of failures (1-3) before success
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 3 }),
          transientErrorNameArb,
          eventDetailArb,
          async (failureCount, errorName, detail) => {
            ebMock.reset();
            delayCallArgs = [];

            const transientError = new Error(`Transient: ${errorName}`);
            transientError.name = errorName;

            // Set up mock: fail `failureCount` times, then succeed
            let callCount = 0;
            ebMock.on(PutEventsCommand).callsFake(() => {
              callCount++;
              if (callCount <= failureCount) {
                throw transientError;
              }
              return {
                FailedEntryCount: 0,
                Entries: [{ EventId: `evt-retry-${callCount}` }],
              };
            });

            const result = await publishEvent(
              'eventforge.api',
              'order.created',
              detail
            );

            // Should succeed
            expect(result.eventId).toBe(`evt-retry-${failureCount + 1}`);

            // Verify exponential backoff delays
            expect(delayCallArgs).toHaveLength(failureCount);
            for (let i = 0; i < failureCount; i++) {
              expect(delayCallArgs[i]).toBe(1000 * Math.pow(2, i));
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should fail after exhausting all 3 retries on persistent transient errors', async () => {
      await fc.assert(
        fc.asyncProperty(
          transientErrorNameArb,
          eventDetailArb,
          async (errorName, detail) => {
            ebMock.reset();
            delayCallArgs = [];

            const transientError = new Error(`Persistent: ${errorName}`);
            transientError.name = errorName;

            ebMock.on(PutEventsCommand).callsFake(() => {
              throw transientError;
            });

            await expect(
              publishEvent('eventforge.api', 'order.created', detail)
            ).rejects.toThrow();

            // Should have attempted initial + 3 retries = 4 total calls
            const calls = ebMock.commandCalls(PutEventsCommand);
            expect(calls).toHaveLength(4);

            // Verify exponential backoff: 1000ms, 2000ms, 4000ms
            expect(delayCallArgs).toEqual([1000, 2000, 4000]);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should NOT retry on non-transient errors', async () => {
      await fc.assert(
        fc.asyncProperty(
          nonTransientErrorNameArb,
          eventDetailArb,
          async (errorName, detail) => {
            ebMock.reset();
            delayCallArgs = [];

            const nonTransientError = new Error(
              `Non-transient: ${errorName}`
            );
            nonTransientError.name = errorName;

            ebMock.on(PutEventsCommand).callsFake(() => {
              throw nonTransientError;
            });

            await expect(
              publishEvent('eventforge.api', 'order.created', detail)
            ).rejects.toThrow();

            // Should have only 1 call (no retries)
            const calls = ebMock.commandCalls(PutEventsCommand);
            expect(calls).toHaveLength(1);

            // No delays should have been called
            expect(delayCallArgs).toEqual([]);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
