/**
 * Unit tests for the webhook ingestion Lambda handler.
 *
 * Tests JSON parsing, field validation, payload size limits,
 * EventBridge publishing, and response codes.
 *
 * Validates: Requirements 11.2, 11.3, 11.4
 */

import { mockClient } from 'aws-sdk-client-mock';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler, validatePayload } from '../webhook-ingest';

const ebMock = mockClient(EventBridgeClient);

beforeEach(() => {
  ebMock.reset();
  process.env.EVENT_BUS_NAME = 'test-bus';
});

afterEach(() => {
  delete process.env.EVENT_BUS_NAME;
});

function makeEvent(body: string | null): APIGatewayProxyEvent {
  return {
    body,
    headers: { 'content-type': 'application/json' },
    httpMethod: 'POST',
    isBase64Encoded: false,
    path: '/webhooks/ingest',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as any,
    resource: '',
    multiValueHeaders: {},
  };
}

describe('validatePayload', () => {
  it('should return valid for a correct payload', () => {
    const result = validatePayload({
      source: 'external.system',
      'detail-type': 'payment.confirmed',
      detail: { orderId: 'order-123' },
    });
    expect(result).toEqual({ valid: true });
  });

  it('should reject when source is missing', () => {
    const result = validatePayload({
      'detail-type': 'payment.confirmed',
      detail: { orderId: 'order-123' },
    });
    expect(result).toEqual({ valid: false, message: 'Missing or invalid required field: source' });
  });

  it('should reject when source is not a string', () => {
    const result = validatePayload({
      source: 123,
      'detail-type': 'payment.confirmed',
      detail: { orderId: 'order-123' },
    });
    expect(result).toEqual({ valid: false, message: 'Missing or invalid required field: source' });
  });

  it('should reject when source is empty string', () => {
    const result = validatePayload({
      source: '',
      'detail-type': 'payment.confirmed',
      detail: { orderId: 'order-123' },
    });
    expect(result).toEqual({ valid: false, message: 'Missing or invalid required field: source' });
  });

  it('should reject when detail-type is missing', () => {
    const result = validatePayload({
      source: 'external.system',
      detail: { orderId: 'order-123' },
    });
    expect(result).toEqual({ valid: false, message: 'Missing or invalid required field: detail-type' });
  });

  it('should reject when detail-type is not a string', () => {
    const result = validatePayload({
      source: 'external.system',
      'detail-type': 42,
      detail: { orderId: 'order-123' },
    });
    expect(result).toEqual({ valid: false, message: 'Missing or invalid required field: detail-type' });
  });

  it('should reject when detail is missing', () => {
    const result = validatePayload({
      source: 'external.system',
      'detail-type': 'payment.confirmed',
    });
    expect(result).toEqual({ valid: false, message: 'Missing or invalid required field: detail' });
  });

  it('should reject when detail is null', () => {
    const result = validatePayload({
      source: 'external.system',
      'detail-type': 'payment.confirmed',
      detail: null,
    });
    expect(result).toEqual({ valid: false, message: 'Missing or invalid required field: detail' });
  });

  it('should reject when detail is an array', () => {
    const result = validatePayload({
      source: 'external.system',
      'detail-type': 'payment.confirmed',
      detail: [1, 2, 3],
    });
    expect(result).toEqual({ valid: false, message: 'Missing or invalid required field: detail' });
  });

  it('should reject when detail is a string', () => {
    const result = validatePayload({
      source: 'external.system',
      'detail-type': 'payment.confirmed',
      detail: 'not-an-object',
    });
    expect(result).toEqual({ valid: false, message: 'Missing or invalid required field: detail' });
  });

  it('should reject when payload is not an object', () => {
    const result = validatePayload('string-payload');
    expect(result).toEqual({ valid: false, message: 'Payload must be a JSON object' });
  });

  it('should reject when payload is null', () => {
    const result = validatePayload(null);
    expect(result).toEqual({ valid: false, message: 'Payload must be a JSON object' });
  });

  it('should reject when payload is an array', () => {
    const result = validatePayload([1, 2, 3]);
    expect(result).toEqual({ valid: false, message: 'Payload must be a JSON object' });
  });
});

describe('handler', () => {
  const validPayload = {
    source: 'external.payment',
    'detail-type': 'payment.confirmed',
    detail: { orderId: 'order-123', amount: 50.0 },
  };

  it('should return 202 Accepted for a valid payload', async () => {
    ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{ EventId: 'evt-1' }] });

    const event = makeEvent(JSON.stringify(validPayload));
    const result = await handler(event);

    expect(result.statusCode).toBe(202);
    expect(JSON.parse(result.body)).toEqual({ message: 'Event accepted' });
  });

  it('should publish event to EventBridge with correct parameters', async () => {
    ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{ EventId: 'evt-1' }] });

    const event = makeEvent(JSON.stringify(validPayload));
    await handler(event);

    const calls = ebMock.commandCalls(PutEventsCommand);
    expect(calls).toHaveLength(1);

    const input = calls[0].args[0].input;
    expect(input.Entries).toHaveLength(1);
    expect(input.Entries![0]).toEqual({
      EventBusName: 'test-bus',
      Source: 'external.payment',
      DetailType: 'payment.confirmed',
      Detail: JSON.stringify({ orderId: 'order-123', amount: 50.0 }),
    });
  });

  it('should return 400 when body is null', async () => {
    const event = makeEvent(null);
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toEqual({
      error: 'Bad Request',
      message: 'Request body is required',
    });
  });

  it('should return 400 when body is not valid JSON', async () => {
    const event = makeEvent('not-json{{{');
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toEqual({
      error: 'Bad Request',
      message: 'Request body must be valid JSON',
    });
  });

  it('should return 400 when payload exceeds 256 KB', async () => {
    // Create a body that exceeds 256 KB
    const largeBody = JSON.stringify({
      source: 'external.system',
      'detail-type': 'large.event',
      detail: { data: 'x'.repeat(256 * 1024) },
    });

    const event = makeEvent(largeBody);
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toEqual({
      error: 'Bad Request',
      message: 'Payload exceeds maximum size of 256 KB',
    });
  });

  it('should return 400 when source field is missing', async () => {
    const event = makeEvent(JSON.stringify({
      'detail-type': 'payment.confirmed',
      detail: { orderId: 'order-123' },
    }));
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).message).toBe('Missing or invalid required field: source');
  });

  it('should return 400 when detail-type field is missing', async () => {
    const event = makeEvent(JSON.stringify({
      source: 'external.system',
      detail: { orderId: 'order-123' },
    }));
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).message).toBe('Missing or invalid required field: detail-type');
  });

  it('should return 400 when detail field is missing', async () => {
    const event = makeEvent(JSON.stringify({
      source: 'external.system',
      'detail-type': 'payment.confirmed',
    }));
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).message).toBe('Missing or invalid required field: detail');
  });

  it('should return 400 when body is a JSON array', async () => {
    const event = makeEvent(JSON.stringify([1, 2, 3]));
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).message).toBe('Payload must be a JSON object');
  });

  it('should return 400 when body is a JSON string', async () => {
    const event = makeEvent(JSON.stringify('just a string'));
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).message).toBe('Payload must be a JSON object');
  });

  it('should accept payload exactly at 256 KB', async () => {
    ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{ EventId: 'evt-1' }] });

    // Create a payload that is exactly at the limit
    const basePayload = {
      source: 'external.system',
      'detail-type': 'test.event',
      detail: { data: '' },
    };
    const baseSize = JSON.stringify(basePayload).length;
    const paddingNeeded = 256 * 1024 - baseSize;
    basePayload.detail.data = 'x'.repeat(paddingNeeded);

    const body = JSON.stringify(basePayload);
    // Ensure it's exactly at the limit
    expect(body.length).toBeLessThanOrEqual(256 * 1024);

    const event = makeEvent(body);
    const result = await handler(event);

    expect(result.statusCode).toBe(202);
  });
});
