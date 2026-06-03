import { mockClient } from 'aws-sdk-client-mock';
import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import * as AWSXRay from 'aws-xray-sdk-core';
import {
  publishEvent,
  setEventBridgeClient,
  setDelayFn,
  resetDelayFn,
  EventDetail,
} from '../event-publisher';

const ebMock = mockClient(EventBridgeClient);

// Mock aws-xray-sdk-core
jest.mock('aws-xray-sdk-core', () => ({
  getSegment: jest.fn(),
}));

describe('EventBridge Publisher', () => {
  const mockDetail: EventDetail = {
    orderId: 'order-123',
    userId: 'user-456',
    status: 'pending',
    timestamp: '2024-01-01T00:00:00.000Z',
  };

  let delayCallArgs: number[];

  beforeEach(() => {
    ebMock.reset();
    jest.clearAllMocks();
    delayCallArgs = [];
    // Inject the mocked client
    setEventBridgeClient(ebMock as unknown as EventBridgeClient);
    // Use a no-op delay to avoid real timeouts in tests
    setDelayFn(async (ms: number) => {
      delayCallArgs.push(ms);
    });
    // Default: no active X-Ray segment
    (AWSXRay.getSegment as jest.Mock).mockReturnValue(null);
  });

  afterEach(() => {
    resetDelayFn();
  });

  describe('publishEvent', () => {
    it('should publish an event successfully and return the event ID', async () => {
      ebMock.on(PutEventsCommand).resolves({
        FailedEntryCount: 0,
        Entries: [{ EventId: 'evt-abc-123' }],
      });

      const result = await publishEvent(
        'eventforge.api',
        'order.created',
        mockDetail
      );

      expect(result.eventId).toBe('evt-abc-123');

      const calls = ebMock.commandCalls(PutEventsCommand);
      expect(calls).toHaveLength(1);

      const input = calls[0].args[0].input;
      expect(input.Entries).toHaveLength(1);
      expect(input.Entries![0].Source).toBe('eventforge.api');
      expect(input.Entries![0].DetailType).toBe('order.created');
      expect(input.Entries![0].EventBusName).toBe('eventforge-bus');

      const parsedDetail = JSON.parse(input.Entries![0].Detail!);
      expect(parsedDetail.orderId).toBe('order-123');
      expect(parsedDetail.userId).toBe('user-456');
      expect(parsedDetail.status).toBe('pending');
      expect(parsedDetail.timestamp).toBe('2024-01-01T00:00:00.000Z');
    });

    it('should include X-Ray trace header when active trace context exists', async () => {
      (AWSXRay.getSegment as jest.Mock).mockReturnValue({
        trace_id: '1-abc-def123',
      });

      ebMock.on(PutEventsCommand).resolves({
        FailedEntryCount: 0,
        Entries: [{ EventId: 'evt-xyz-789' }],
      });

      const result = await publishEvent(
        'eventforge.api',
        'order.created',
        mockDetail
      );

      expect(result.eventId).toBe('evt-xyz-789');

      const calls = ebMock.commandCalls(PutEventsCommand);
      const parsedDetail = JSON.parse(
        calls[0].args[0].input.Entries![0].Detail!
      );
      expect(parsedDetail.traceId).toBe('1-abc-def123');
    });

    it('should not include traceId when no active trace context exists', async () => {
      (AWSXRay.getSegment as jest.Mock).mockReturnValue(null);

      ebMock.on(PutEventsCommand).resolves({
        FailedEntryCount: 0,
        Entries: [{ EventId: 'evt-no-trace' }],
      });

      await publishEvent('eventforge.api', 'order.created', mockDetail);

      const calls = ebMock.commandCalls(PutEventsCommand);
      const parsedDetail = JSON.parse(
        calls[0].args[0].input.Entries![0].Detail!
      );
      expect(parsedDetail.traceId).toBeUndefined();
    });

    it('should not include traceId when getSegment throws', async () => {
      (AWSXRay.getSegment as jest.Mock).mockImplementation(() => {
        throw new Error('No segment available');
      });

      ebMock.on(PutEventsCommand).resolves({
        FailedEntryCount: 0,
        Entries: [{ EventId: 'evt-err-trace' }],
      });

      const result = await publishEvent(
        'eventforge.api',
        'order.created',
        mockDetail
      );

      expect(result.eventId).toBe('evt-err-trace');

      const calls = ebMock.commandCalls(PutEventsCommand);
      const parsedDetail = JSON.parse(
        calls[0].args[0].input.Entries![0].Detail!
      );
      expect(parsedDetail.traceId).toBeUndefined();
    });

    it('should retry up to 3 times on transient errors with exponential backoff', async () => {
      const transientError = new Error('Service unavailable');
      transientError.name = 'ServiceUnavailableException';

      ebMock
        .on(PutEventsCommand)
        .rejectsOnce(transientError)
        .rejectsOnce(transientError)
        .resolves({
          FailedEntryCount: 0,
          Entries: [{ EventId: 'evt-retry-success' }],
        });

      const result = await publishEvent(
        'eventforge.api',
        'order.created',
        mockDetail
      );

      expect(result.eventId).toBe('evt-retry-success');

      const calls = ebMock.commandCalls(PutEventsCommand);
      expect(calls).toHaveLength(3); // initial + 2 retries

      // Verify exponential backoff delays: 1000ms, 2000ms
      expect(delayCallArgs).toEqual([1000, 2000]);
    });

    it('should throw after all retries are exhausted on transient errors', async () => {
      const transientError = new Error('Service unavailable');
      transientError.name = 'ServiceUnavailableException';

      ebMock.on(PutEventsCommand).rejects(transientError);

      await expect(
        publishEvent('eventforge.api', 'order.created', mockDetail)
      ).rejects.toThrow(/EventBridge publish failed after 3 retries/);

      const calls = ebMock.commandCalls(PutEventsCommand);
      expect(calls).toHaveLength(4); // initial + 3 retries

      // Verify exponential backoff delays: 1000ms, 2000ms, 4000ms
      expect(delayCallArgs).toEqual([1000, 2000, 4000]);
    });

    it('should not retry on non-transient errors', async () => {
      const nonTransientError = new Error('Access denied');
      nonTransientError.name = 'AccessDeniedException';

      ebMock.on(PutEventsCommand).rejects(nonTransientError);

      await expect(
        publishEvent('eventforge.api', 'order.created', mockDetail)
      ).rejects.toThrow('Access denied');

      const calls = ebMock.commandCalls(PutEventsCommand);
      expect(calls).toHaveLength(1); // No retries
      expect(delayCallArgs).toEqual([]); // No delays
    });

    it('should handle FailedEntryCount > 0 as a transient error and retry', async () => {
      ebMock
        .on(PutEventsCommand)
        .resolvesOnce({
          FailedEntryCount: 1,
          Entries: [
            {
              ErrorCode: 'InternalException',
              ErrorMessage: 'Internal service error',
            },
          ],
        })
        .resolves({
          FailedEntryCount: 0,
          Entries: [{ EventId: 'evt-recovered' }],
        });

      const result = await publishEvent(
        'eventforge.api',
        'order.created',
        mockDetail
      );

      expect(result.eventId).toBe('evt-recovered');

      const calls = ebMock.commandCalls(PutEventsCommand);
      expect(calls).toHaveLength(2);
      expect(delayCallArgs).toEqual([1000]);
    });

    it('should throw when response has no event ID', async () => {
      ebMock.on(PutEventsCommand).resolves({
        FailedEntryCount: 0,
        Entries: [{}],
      });

      await expect(
        publishEvent('eventforge.api', 'order.created', mockDetail)
      ).rejects.toThrow('EventBridge PutEvents returned no event ID');
    });

    it('should use the provided source parameter', async () => {
      ebMock.on(PutEventsCommand).resolves({
        FailedEntryCount: 0,
        Entries: [{ EventId: 'evt-custom-source' }],
      });

      await publishEvent('eventforge.workflow', 'order.completed', mockDetail);

      const calls = ebMock.commandCalls(PutEventsCommand);
      expect(calls[0].args[0].input.Entries![0].Source).toBe(
        'eventforge.workflow'
      );
    });

    it('should use default source when empty string is provided', async () => {
      ebMock.on(PutEventsCommand).resolves({
        FailedEntryCount: 0,
        Entries: [{ EventId: 'evt-default-source' }],
      });

      await publishEvent('', 'order.created', mockDetail);

      const calls = ebMock.commandCalls(PutEventsCommand);
      expect(calls[0].args[0].input.Entries![0].Source).toBe('eventforge.api');
    });

    it('should handle ThrottlingException as transient and retry', async () => {
      const throttleError = new Error('Rate exceeded');
      throttleError.name = 'ThrottlingException';

      ebMock
        .on(PutEventsCommand)
        .rejectsOnce(throttleError)
        .resolves({
          FailedEntryCount: 0,
          Entries: [{ EventId: 'evt-throttle-recovered' }],
        });

      const result = await publishEvent(
        'eventforge.api',
        'order.created',
        mockDetail
      );

      expect(result.eventId).toBe('evt-throttle-recovered');
      expect(delayCallArgs).toEqual([1000]);
    });
  });
});
