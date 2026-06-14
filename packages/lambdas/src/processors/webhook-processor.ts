/**
 * Webhook Processor Lambda function.
 *
 * Triggered by the webhook SQS queue, this function dispatches event payloads
 * to all registered webhook URLs. If ANY URL fails delivery (timeout, connection
 * error, or non-2xx response), the function throws an error so the entire SQS
 * message returns to the queue for retry on all URLs.
 *
 * Configuration: timeout 30s, memory 128MB, batch size 1
 *
 * Validates: Requirements 5.3, 5.6, 5.9
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { storeEvent } from '@eventforge/shared';
import type { SQSEvent } from 'aws-lambda';

const TABLE_NAME = process.env.DYNAMODB_TABLE || 'eventforge-events';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

/** Message structure received from the webhook SQS queue */
export interface WebhookQueueMessage {
  eventId: string;
  source: string;
  detailType: string;
  detail: Record<string, unknown>;
  timestamp: string;
}

/** A registered webhook URL record from DynamoDB */
export interface WebhookRegistration {
  PK: string;
  SK: string;
  url: string;
  registeredAt: string;
  userId: string;
}

/**
 * Fetches all registered webhook URLs from DynamoDB.
 * Scans for items where SK = 'REGISTRATION' and PK begins with 'WEBHOOK#'.
 */
export async function getRegisteredWebhookUrls(
  client: DynamoDBDocumentClient
): Promise<string[]> {
  const urls: string[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await client.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'SK = :sk AND begins_with(PK, :pkPrefix)',
        ExpressionAttributeValues: {
          ':sk': 'REGISTRATION',
          ':pkPrefix': 'WEBHOOK#',
        },
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    if (result.Items) {
      for (const item of result.Items) {
        if (item.url && typeof item.url === 'string') {
          urls.push(item.url);
        }
      }
    }

    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  return urls;
}

/**
 * Delivers the event payload to a single webhook URL with a 10-second timeout.
 * Returns true if delivery succeeded (2xx response), false otherwise.
 */
export async function deliverToUrl(
  url: string,
  payload: WebhookQueueMessage
): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    return response.ok;
  } catch {
    // Timeout, connection error, or other network failure
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Extracts the webhook message from an SQS record body.
 *
 * Unwraps the EventBridge envelope when present, mapping envelope fields
 * (`id` -> eventId, `detail-type` -> detailType) into the domain shape.
 * Falls back to treating the parsed body as the domain message directly
 * (supports direct SQS sends and unit tests).
 */
export function extractWebhookMessage(body: string): WebhookQueueMessage {
  const parsed = JSON.parse(body) as Record<string, unknown>;

  const isEnvelope =
    parsed && typeof parsed === 'object' &&
    typeof parsed['detail'] === 'object' && parsed['detail'] !== null &&
    'detail-type' in parsed;

  if (isEnvelope) {
    const detail = parsed['detail'] as Record<string, unknown>;
    return {
      eventId: (parsed['id'] as string) ?? '',
      source: (parsed['source'] as string) ?? '',
      detailType: (parsed['detail-type'] as string) ?? '',
      detail,
      timestamp: (parsed['time'] as string) ?? (detail['timestamp'] as string) ?? new Date().toISOString(),
    };
  }

  return parsed as unknown as WebhookQueueMessage;
}

/**
 * Lambda handler for the Webhook Processor.
 *
 * For each SQS record:
 * 1. Parses the message body as a WebhookQueueMessage
 * 2. Fetches all registered webhook URLs from DynamoDB
 * 3. POSTs the event payload to each URL with a 10-second per-URL timeout
 * 4. If ANY URL fails delivery, throws an error to retry the entire message
 * 5. Only returns normally if ALL URLs succeed
 */
export async function handler(event: SQSEvent): Promise<void> {
  for (const record of event.Records) {
    const message = extractWebhookMessage(record.body);

    // Persist the event to DynamoDB so it appears in the dashboard's
    // "Recent Events" panel and the per-order event history. Events tied to
    // an order (detail.orderId) are stored under that order's partition.
    // storeEvent is idempotent on (orderId, eventId+timestamp), so SQS
    // re-delivery does not create duplicates.
    const orderId = message.detail?.['orderId'];
    if (orderId && typeof orderId === 'string') {
      try {
        await storeEvent(orderId, {
          eventId: message.eventId || `${message.timestamp}-${message.detailType}`,
          eventType: message.detailType,
          payload: message.detail,
          source: message.source,
          timestamp: message.timestamp,
        });
      } catch (err) {
        // Persistence failure should not block webhook delivery; log and continue.
        console.error(`Failed to persist event for order ${orderId}:`, err);
      }
    }

    const urls = await getRegisteredWebhookUrls(docClient);

    if (urls.length === 0) {
      // No registered webhooks — nothing to deliver
      continue;
    }

    const results = await Promise.all(
      urls.map((url) => deliverToUrl(url, message))
    );

    const failedUrls = urls.filter((_, index) => !results[index]);

    if (failedUrls.length > 0) {
      throw new Error(
        `Webhook delivery failed for ${failedUrls.length} URL(s): ${failedUrls.join(', ')}. ` +
          `Message will be retried for all URLs.`
      );
    }
  }
}
