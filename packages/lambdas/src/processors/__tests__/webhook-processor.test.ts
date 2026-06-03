/**
 * Unit tests for the Webhook Processor Lambda function.
 *
 * Tests SQS message parsing, DynamoDB scan for registrations,
 * HTTP delivery to webhook URLs, and retry behavior on failure.
 */

import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import {
  handler,
  getRegisteredWebhookUrls,
  deliverToUrl,
  WebhookQueueMessage,
} from '../webhook-processor';
import type { SQSEvent, SQSRecord } from 'aws-lambda';

const ddbMock = mockClient(DynamoDBDocumentClient);

// Create a real DynamoDBDocumentClient for unit-testing getRegisteredWebhookUrls
const testDynamoClient = new DynamoDBClient({ region: 'us-east-1' });
const testDocClient = DynamoDBDocumentClient.from(testDynamoClient);

// Mock global fetch
const originalFetch = global.fetch;

beforeEach(() => {
  ddbMock.reset();
  global.fetch = jest.fn();
});

afterAll(() => {
  global.fetch = originalFetch;
});

function createSQSEvent(messages: WebhookQueueMessage[]): SQSEvent {
  return {
    Records: messages.map((msg, index) => ({
      messageId: `msg-${index}`,
      receiptHandle: `handle-${index}`,
      body: JSON.stringify(msg),
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
    })) as SQSRecord[],
  };
}

const sampleMessage: WebhookQueueMessage = {
  eventId: 'evt-001',
  source: 'eventforge.api',
  detailType: 'order.created',
  detail: { orderId: 'order-123', userId: 'user-456', status: 'pending' },
  timestamp: '2024-01-15T10:30:00Z',
};

describe('getRegisteredWebhookUrls', () => {
  it('should return all registered webhook URLs', async () => {
    ddbMock.on(ScanCommand).resolves({
      Items: [
        { PK: 'WEBHOOK#hash1', SK: 'REGISTRATION', url: 'https://example.com/hook1' },
        { PK: 'WEBHOOK#hash2', SK: 'REGISTRATION', url: 'https://example.com/hook2' },
      ],
      LastEvaluatedKey: undefined,
    });

    const urls = await getRegisteredWebhookUrls(testDocClient);
    expect(urls).toEqual(['https://example.com/hook1', 'https://example.com/hook2']);
  });

  it('should return empty array when no webhooks are registered', async () => {
    ddbMock.on(ScanCommand).resolves({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    const urls = await getRegisteredWebhookUrls(testDocClient);
    expect(urls).toEqual([]);
  });

  it('should handle paginated scan results', async () => {
    ddbMock
      .on(ScanCommand)
      .resolvesOnce({
        Items: [{ PK: 'WEBHOOK#hash1', SK: 'REGISTRATION', url: 'https://example.com/hook1' }],
        LastEvaluatedKey: { PK: 'WEBHOOK#hash1', SK: 'REGISTRATION' },
      })
      .resolvesOnce({
        Items: [{ PK: 'WEBHOOK#hash2', SK: 'REGISTRATION', url: 'https://example.com/hook2' }],
        LastEvaluatedKey: undefined,
      });

    const urls = await getRegisteredWebhookUrls(testDocClient);
    expect(urls).toEqual(['https://example.com/hook1', 'https://example.com/hook2']);
  });

  it('should skip items without a valid url field', async () => {
    ddbMock.on(ScanCommand).resolves({
      Items: [
        { PK: 'WEBHOOK#hash1', SK: 'REGISTRATION', url: 'https://example.com/hook1' },
        { PK: 'WEBHOOK#hash2', SK: 'REGISTRATION', url: null },
        { PK: 'WEBHOOK#hash3', SK: 'REGISTRATION' },
      ],
      LastEvaluatedKey: undefined,
    });

    const urls = await getRegisteredWebhookUrls(testDocClient);
    expect(urls).toEqual(['https://example.com/hook1']);
  });
});

describe('deliverToUrl', () => {
  it('should return true for a successful 2xx response', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200 });

    const result = await deliverToUrl('https://example.com/hook', sampleMessage);
    expect(result).toBe(true);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://example.com/hook',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sampleMessage),
      })
    );
  });

  it('should return false for a non-2xx response', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500 });

    const result = await deliverToUrl('https://example.com/hook', sampleMessage);
    expect(result).toBe(false);
  });

  it('should return false when fetch throws a network error', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Connection refused'));

    const result = await deliverToUrl('https://example.com/hook', sampleMessage);
    expect(result).toBe(false);
  });

  it('should return false when fetch is aborted (timeout)', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new DOMException('Aborted', 'AbortError'));

    const result = await deliverToUrl('https://example.com/hook', sampleMessage);
    expect(result).toBe(false);
  });
});

describe('handler', () => {
  it('should succeed when all webhook URLs return 2xx', async () => {
    ddbMock.on(ScanCommand).resolves({
      Items: [
        { PK: 'WEBHOOK#hash1', SK: 'REGISTRATION', url: 'https://example.com/hook1' },
        { PK: 'WEBHOOK#hash2', SK: 'REGISTRATION', url: 'https://example.com/hook2' },
      ],
      LastEvaluatedKey: undefined,
    });

    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200 });

    const event = createSQSEvent([sampleMessage]);
    await expect(handler(event)).resolves.toBeUndefined();

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('should throw error when any webhook URL fails', async () => {
    ddbMock.on(ScanCommand).resolves({
      Items: [
        { PK: 'WEBHOOK#hash1', SK: 'REGISTRATION', url: 'https://example.com/hook1' },
        { PK: 'WEBHOOK#hash2', SK: 'REGISTRATION', url: 'https://example.com/hook2' },
      ],
      LastEvaluatedKey: undefined,
    });

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: false, status: 503 });

    const event = createSQSEvent([sampleMessage]);
    await expect(handler(event)).rejects.toThrow('Webhook delivery failed');
    await expect(handler(event)).rejects.toThrow('https://example.com/hook2');
  });

  it('should throw error when a webhook URL times out', async () => {
    ddbMock.on(ScanCommand).resolves({
      Items: [
        { PK: 'WEBHOOK#hash1', SK: 'REGISTRATION', url: 'https://example.com/hook1' },
      ],
      LastEvaluatedKey: undefined,
    });

    (global.fetch as jest.Mock).mockRejectedValue(new DOMException('Aborted', 'AbortError'));

    const event = createSQSEvent([sampleMessage]);
    await expect(handler(event)).rejects.toThrow('Webhook delivery failed');
  });

  it('should succeed when no webhook URLs are registered', async () => {
    ddbMock.on(ScanCommand).resolves({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    const event = createSQSEvent([sampleMessage]);
    await expect(handler(event)).resolves.toBeUndefined();

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should parse SQS message body correctly', async () => {
    ddbMock.on(ScanCommand).resolves({
      Items: [
        { PK: 'WEBHOOK#hash1', SK: 'REGISTRATION', url: 'https://example.com/hook1' },
      ],
      LastEvaluatedKey: undefined,
    });

    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200 });

    const event = createSQSEvent([sampleMessage]);
    await handler(event);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://example.com/hook1',
      expect.objectContaining({
        body: JSON.stringify(sampleMessage),
      })
    );
  });

  it('should throw error mentioning all failed URLs', async () => {
    ddbMock.on(ScanCommand).resolves({
      Items: [
        { PK: 'WEBHOOK#hash1', SK: 'REGISTRATION', url: 'https://a.com/hook' },
        { PK: 'WEBHOOK#hash2', SK: 'REGISTRATION', url: 'https://b.com/hook' },
        { PK: 'WEBHOOK#hash3', SK: 'REGISTRATION', url: 'https://c.com/hook' },
      ],
      LastEvaluatedKey: undefined,
    });

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockRejectedValueOnce(new Error('Connection refused'));

    const event = createSQSEvent([sampleMessage]);

    try {
      await handler(event);
      fail('Expected handler to throw');
    } catch (error: any) {
      expect(error.message).toContain('2 URL(s)');
      expect(error.message).toContain('https://b.com/hook');
      expect(error.message).toContain('https://c.com/hook');
      expect(error.message).toContain('Message will be retried for all URLs');
    }
  });
});
