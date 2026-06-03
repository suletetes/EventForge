/**
 * Webhook Ingestion Lambda handler for API Gateway HTTP API.
 *
 * Receives external webhook events via POST /webhooks/ingest,
 * validates the payload, and publishes to EventBridge.
 *
 * Validates: Requirements 11.2, 11.3, 11.4
 */

import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const MAX_PAYLOAD_SIZE_BYTES = 256 * 1024; // 256 KB

const eventBridgeClient = new EventBridgeClient({});

/**
 * Builds a 400 Bad Request response.
 */
function badRequest(message: string): APIGatewayProxyResult {
  return {
    statusCode: 400,
    body: JSON.stringify({ error: 'Bad Request', message }),
  };
}

/**
 * Builds a 202 Accepted response.
 */
function accepted(): APIGatewayProxyResult {
  return {
    statusCode: 202,
    body: JSON.stringify({ message: 'Event accepted' }),
  };
}

/**
 * Validates the parsed payload has the required fields:
 * - source (string)
 * - detail-type (string)
 * - detail (object)
 */
export function validatePayload(payload: unknown): { valid: true } | { valid: false; message: string } {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { valid: false, message: 'Payload must be a JSON object' };
  }

  const obj = payload as Record<string, unknown>;

  if (!obj['source'] || typeof obj['source'] !== 'string') {
    return { valid: false, message: 'Missing or invalid required field: source' };
  }

  if (!obj['detail-type'] || typeof obj['detail-type'] !== 'string') {
    return { valid: false, message: 'Missing or invalid required field: detail-type' };
  }

  if (!obj['detail'] || typeof obj['detail'] !== 'object' || obj['detail'] === null || Array.isArray(obj['detail'])) {
    return { valid: false, message: 'Missing or invalid required field: detail' };
  }

  return { valid: true };
}

/**
 * Lambda handler for webhook ingestion.
 *
 * 1. Validates payload size does not exceed 256 KB
 * 2. Parses body as JSON (returns 400 if not valid JSON)
 * 3. Validates required fields: source (string), detail-type (string), detail (object)
 * 4. Publishes event to EventBridge custom bus
 * 5. Returns 202 Accepted on success
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = event.body;

  // Check if body exists
  if (!body) {
    return badRequest('Request body is required');
  }

  // Validate payload size (check raw body length)
  if (body.length > MAX_PAYLOAD_SIZE_BYTES) {
    return badRequest('Payload exceeds maximum size of 256 KB');
  }

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return badRequest('Request body must be valid JSON');
  }

  // Validate required fields
  const validation = validatePayload(parsed);
  if (!validation.valid) {
    return badRequest(validation.message);
  }

  const payload = parsed as { source: string; 'detail-type': string; detail: Record<string, unknown> };

  // Publish to EventBridge
  const busName = process.env.EVENT_BUS_NAME || 'eventforge-bus';
  const command = new PutEventsCommand({
    Entries: [
      {
        EventBusName: busName,
        Source: payload.source,
        DetailType: payload['detail-type'],
        Detail: JSON.stringify(payload.detail),
      },
    ],
  });

  await eventBridgeClient.send(command);

  return accepted();
}
