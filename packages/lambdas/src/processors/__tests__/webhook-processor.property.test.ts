/**
 * Property-based tests for the Webhook Processor Lambda function.
 *
 * Property 16: Webhook dispatch failure on any URL causes full message retry
 *
 * Uses fast-check to generate random URL sets with partial failures and verify
 * that if ANY URL fails, the handler throws an error (full message retry),
 * and if ALL URLs succeed, the handler returns normally.
 *
 * Validates: Requirements 5.9
 */

import * as fc from 'fast-check';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { handler, WebhookQueueMessage } from '../webhook-processor';
import type { SQSEvent, SQSRecord } from 'aws-lambda';

const ddbMock = mockClient(DynamoDBDocumentClient);

// Store original fetch
const originalFetch = global.fetch;

beforeEach(() => {
  ddbMock.reset();
  global.fetch = jest.fn();
});

afterAll(() => {
  global.fetch = originalFetch;
});

/** Generate a valid webhook URL */
const webhookUrlArb = fc
  .tuple(
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), {
      minLength: 3,
      maxLength: 20,
    }),
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')), {
      minLength: 1,
      maxLength: 30,
    })
  )
  .map(([domain, path]) => `https://${domain}.com/${path}`);

/** Generate a set of 1-10 unique webhook URLs */
const webhookUrlSetArb = fc
  .uniqueArray(webhookUrlArb, { minLength: 1, maxLength: 10 })
  .filter((urls) => urls.length >= 1);

/** Generate a failure pattern (array of booleans indicating success/failure for each URL) */
const failurePatternArb = (size: number) =>
  fc.array(fc.boolean(), { minLength: size, maxLength: size });

/** Generate a valid WebhookQueueMessage */
const webhookMessageArb: fc.Arbitrary<WebhookQueueMessage> = fc.record({
  eventId: fc.uuid(),
  source: fc.constantFrom('eventforge.api', 'eventforge.workflow'),
  detailType: fc.constantFrom('order.created', 'order.completed', 'order.failed'),
  detail: fc.record({
    orderId: fc.uuid(),
    userId: fc.uuid(),
    status: fc.constantFrom('pending', 'processing', 'completed', 'failed'),
  }),
  timestamp: fc.date().map((d) => d.toISOString()),
});

function createSQSEvent(message: WebhookQueueMessage): SQSEvent {
  return {
    Records: [
      {
        messageId: 'msg-0',
        receiptHandle: 'handle-0',
        body: JSON.stringify(message),
        attributes: {
          ApproximateReceiveCount: '1',
          SentTimestamp: '1234567890',
          SenderId: 'sender-1',
          ApproximateFirstReceiveTimestamp: '1234567890',
        },
        messageAttributes: {},
        md5OfBody: 'md5',
        eventSource: 'aws:sqs',
        eventSourceARN: 'arn:aws:sqs:us-east-1:123456789:eventforge-webhook-queue',
        awsRegion: 'us-east-1',
      } as SQSRecord,
    ],
  };
}

function setupDynamoMock(urls: string[]): void {
  ddbMock.on(ScanCommand).resolves({
    Items: urls.map((url, i) => ({
      PK: `WEBHOOK#hash${i}`,
      SK: 'REGISTRATION',
      url,
      registeredAt: '2024-01-01T00:00:00Z',
      userId: `user-${i}`,
    })),
    LastEvaluatedKey: undefined,
  });
}

function setupFetchMock(successPattern: boolean[]): void {
  const mockFetch = global.fetch as jest.Mock;
  successPattern.forEach((success) => {
    if (success) {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });
    } else {
      // Randomly choose between non-2xx response and network error
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    }
  });
}

describe('Webhook Processor - Property 16: Webhook dispatch failure on any URL causes full message retry', () => {
  /**
   * **Validates: Requirements 5.9**
   *
   * Property: If ANY URL in the registered webhook set fails delivery,
   * the handler MUST throw an error to cause the entire SQS message to
   * return to the queue for retry on ALL URLs.
   */
  it('should throw an error when at least one URL fails delivery', async () => {
    await fc.assert(
      fc.asyncProperty(
        webhookUrlSetArb,
        webhookMessageArb,
        async (urls, message) => {
          ddbMock.reset();
          (global.fetch as jest.Mock).mockReset();

          // Generate a failure pattern where at least one URL fails
          const successPattern = urls.map((_, i) => (i === 0 ? false : true));
          // Shuffle to randomize which URL fails
          const shuffledPattern = [...successPattern].sort(() => Math.random() - 0.5);

          // Ensure at least one failure exists
          const hasFailure = shuffledPattern.some((s) => !s);
          if (!hasFailure) {
            shuffledPattern[0] = false;
          }

          setupDynamoMock(urls);
          setupFetchMock(shuffledPattern);

          const event = createSQSEvent(message);

          await expect(handler(event)).rejects.toThrow();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 5.9**
   *
   * Property: If ALL URLs in the registered webhook set succeed delivery,
   * the handler MUST return normally (no error thrown).
   */
  it('should return normally when all URLs succeed delivery', async () => {
    await fc.assert(
      fc.asyncProperty(
        webhookUrlSetArb,
        webhookMessageArb,
        async (urls, message) => {
          ddbMock.reset();
          (global.fetch as jest.Mock).mockReset();

          // All URLs succeed
          const successPattern = urls.map(() => true);

          setupDynamoMock(urls);
          setupFetchMock(successPattern);

          const event = createSQSEvent(message);

          await expect(handler(event)).resolves.toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 5.9**
   *
   * Property: For any random subset of URLs that fail (at least one),
   * the error message should indicate the number of failed URLs and
   * mention retry for all URLs.
   */
  it('should include failed URL count and retry message in error', async () => {
    await fc.assert(
      fc.asyncProperty(
        webhookUrlSetArb,
        webhookMessageArb,
        fc.nat(),
        async (urls, message, seed) => {
          ddbMock.reset();
          (global.fetch as jest.Mock).mockReset();

          // Generate random failure pattern with at least one failure
          const successPattern = urls.map((_, i) => {
            // Use seed to deterministically decide success/failure
            return ((seed + i) % 3) !== 0;
          });

          // Ensure at least one failure
          const hasFailure = successPattern.some((s) => !s);
          if (!hasFailure) {
            successPattern[0] = false;
          }

          const expectedFailCount = successPattern.filter((s) => !s).length;

          setupDynamoMock(urls);
          setupFetchMock(successPattern);

          const event = createSQSEvent(message);

          try {
            await handler(event);
            // Should not reach here
            expect(true).toBe(false);
          } catch (error: any) {
            expect(error.message).toContain(`${expectedFailCount} URL(s)`);
            expect(error.message).toContain('Message will be retried for all URLs');
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
