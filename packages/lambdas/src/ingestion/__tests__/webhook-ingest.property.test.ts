/**
 * Property-based tests for the Webhook Ingestion Lambda handler.
 *
 * Property 19: Webhook ingestion validates and routes correctly
 *
 * Uses fast-check to generate random payloads (valid JSON with fields,
 * missing fields, non-JSON, oversized) and verify correct responses.
 *
 * Validates: Requirements 11.2, 11.3, 11.4
 */

import * as fc from 'fast-check';
import { mockClient } from 'aws-sdk-client-mock';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler, validatePayload } from '../webhook-ingest';

const ebMock = mockClient(EventBridgeClient);

beforeEach(() => {
  ebMock.reset();
  ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{ EventId: 'evt-1' }] });
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

/** Generate a non-empty string for source and detail-type fields */
const nonEmptyStringArb = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789.-_'.split('')),
  { minLength: 1, maxLength: 50 }
);

/** Generate a valid detail object (non-null, non-array object) */
const detailObjectArb = fc.dictionary(
  fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), {
    minLength: 1,
    maxLength: 15,
  }),
  fc.oneof(
    fc.string({ maxLength: 50 }),
    fc.integer(),
    fc.boolean(),
    fc.constant(null)
  ),
  { minKeys: 1, maxKeys: 10 }
);

/** Generate a valid webhook ingestion payload */
const validPayloadArb = fc.record({
  source: nonEmptyStringArb,
  'detail-type': nonEmptyStringArb,
  detail: detailObjectArb,
});

/** Generate a non-JSON string that will fail JSON.parse */
const nonJsonStringArb = fc
  .stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz{[!@#$%^&*'.split('')), {
    minLength: 1,
    maxLength: 100,
  })
  .filter((s) => {
    try {
      JSON.parse(s);
      return false;
    } catch {
      return true;
    }
  });

describe('Webhook Ingestion - Property 19: Webhook ingestion validates and routes correctly', () => {
  /**
   * **Validates: Requirements 11.2**
   *
   * Property: For any valid JSON payload containing "source" (non-empty string),
   * "detail-type" (non-empty string), and "detail" (object), the handler SHALL
   * publish the event to EventBridge and return 202 Accepted.
   */
  it('should return 202 Accepted for any valid payload with required fields', async () => {
    await fc.assert(
      fc.asyncProperty(validPayloadArb, async (payload) => {
        ebMock.reset();
        ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{ EventId: 'evt-1' }] });

        const body = JSON.stringify(payload);
        const event = makeEvent(body);
        const result = await handler(event);

        expect(result.statusCode).toBe(202);
        expect(JSON.parse(result.body)).toEqual({ message: 'Event accepted' });

        // Verify EventBridge was called with correct parameters
        const calls = ebMock.commandCalls(PutEventsCommand);
        expect(calls).toHaveLength(1);
        const input = calls[0].args[0].input;
        expect(input.Entries![0].Source).toBe(payload.source);
        expect(input.Entries![0].DetailType).toBe(payload['detail-type']);
        expect(input.Entries![0].Detail).toBe(JSON.stringify(payload.detail));
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 11.4**
   *
   * Property: For any valid JSON object missing the "source" field,
   * the handler SHALL return 400 with an error indicating the missing field.
   */
  it('should return 400 for payloads missing the source field', async () => {
    await fc.assert(
      fc.asyncProperty(nonEmptyStringArb, detailObjectArb, async (detailType, detail) => {
        const payload = { 'detail-type': detailType, detail };
        const body = JSON.stringify(payload);
        const event = makeEvent(body);
        const result = await handler(event);

        expect(result.statusCode).toBe(400);
        const responseBody = JSON.parse(result.body);
        expect(responseBody.error).toBe('Bad Request');
        expect(responseBody.message).toContain('source');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 11.4**
   *
   * Property: For any valid JSON object missing the "detail-type" field,
   * the handler SHALL return 400 with an error indicating the missing field.
   */
  it('should return 400 for payloads missing the detail-type field', async () => {
    await fc.assert(
      fc.asyncProperty(nonEmptyStringArb, detailObjectArb, async (source, detail) => {
        const payload = { source, detail };
        const body = JSON.stringify(payload);
        const event = makeEvent(body);
        const result = await handler(event);

        expect(result.statusCode).toBe(400);
        const responseBody = JSON.parse(result.body);
        expect(responseBody.error).toBe('Bad Request');
        expect(responseBody.message).toContain('detail-type');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 11.4**
   *
   * Property: For any valid JSON object missing the "detail" field,
   * the handler SHALL return 400 with an error indicating the missing field.
   */
  it('should return 400 for payloads missing the detail field', async () => {
    await fc.assert(
      fc.asyncProperty(nonEmptyStringArb, nonEmptyStringArb, async (source, detailType) => {
        const payload = { source, 'detail-type': detailType };
        const body = JSON.stringify(payload);
        const event = makeEvent(body);
        const result = await handler(event);

        expect(result.statusCode).toBe(400);
        const responseBody = JSON.parse(result.body);
        expect(responseBody.error).toBe('Bad Request');
        expect(responseBody.message).toContain('detail');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 11.3, 11.4**
   *
   * Property: For any non-JSON string body, the handler SHALL return 400
   * with an error indicating the body must be valid JSON.
   */
  it('should return 400 for non-JSON request bodies', async () => {
    await fc.assert(
      fc.asyncProperty(nonJsonStringArb, async (body) => {
        const event = makeEvent(body);
        const result = await handler(event);

        expect(result.statusCode).toBe(400);
        const responseBody = JSON.parse(result.body);
        expect(responseBody.error).toBe('Bad Request');
        expect(responseBody.message).toBe('Request body must be valid JSON');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 11.3**
   *
   * Property: For any payload exceeding 256 KB in size, the handler SHALL
   * return 400 with an error indicating the payload exceeds the maximum size.
   */
  it('should return 400 for oversized payloads exceeding 256 KB', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 100 }),
        nonEmptyStringArb,
        nonEmptyStringArb,
        async (extraKB, source, detailType) => {
          // Build a payload that exceeds 256 KB
          const basePayload = {
            source,
            'detail-type': detailType,
            detail: { data: '' },
          };
          const baseSize = JSON.stringify(basePayload).length;
          const targetSize = 256 * 1024 + extraKB * 1024;
          const paddingNeeded = targetSize - baseSize;
          basePayload.detail.data = 'x'.repeat(paddingNeeded > 0 ? paddingNeeded : 1);

          const body = JSON.stringify(basePayload);
          // Ensure it actually exceeds the limit
          if (body.length <= 256 * 1024) return;

          const event = makeEvent(body);
          const result = await handler(event);

          expect(result.statusCode).toBe(400);
          const responseBody = JSON.parse(result.body);
          expect(responseBody.error).toBe('Bad Request');
          expect(responseBody.message).toContain('256 KB');
        }
      ),
      { numRuns: 100 }
    );
  });
});
