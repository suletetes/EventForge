/**
 * Event repository for storing and querying order events in DynamoDB.
 *
 * Uses single-table design with:
 * - PK: ORDER#{orderId}, SK: EVENT#{timestamp}#{eventId}
 * - Attributes: eventType, payload, source, timestamp, traceId
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { orderKey, orderEventSK } from './dynamo-keys';

const TABLE_NAME = process.env.DYNAMODB_TABLE || 'eventforge-events';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

export interface OrderEvent {
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  source: string;
  timestamp: string;
  traceId?: string;
}

export interface StoredEvent extends OrderEvent {
  PK: string;
  SK: string;
  orderId: string;
}

/**
 * Store an event for a given order.
 * Writes an event item with a timestamp-based sort key.
 */
export async function storeEvent(
  orderId: string,
  event: OrderEvent
): Promise<StoredEvent> {
  const pk = orderKey(orderId);
  const sk = orderEventSK(event.timestamp, event.eventId);

  const item: StoredEvent = {
    PK: pk,
    SK: sk,
    orderId,
    ...event,
  };

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: item,
    })
  );

  return item;
}

/**
 * Get the most recent events across all orders.
 * Uses Scan with a limit (max 100), sorted by timestamp descending.
 *
 * Note: Scan does not guarantee ordering, so results are sorted in-memory.
 */
export async function getRecentEvents(
  limit: number = 100
): Promise<StoredEvent[]> {
  const effectiveLimit = Math.min(Math.max(limit, 1), 100);

  const result = await docClient.send(
    new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: 'begins_with(SK, :eventPrefix)',
      ExpressionAttributeValues: {
        ':eventPrefix': 'EVENT#',
      },
      Limit: effectiveLimit * 3, // Over-fetch to account for filtered items
    })
  );

  const events = (result.Items || []) as StoredEvent[];

  // Sort by timestamp descending and cap at the requested limit
  return events
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, effectiveLimit);
}

/**
 * Get all events for a specific order.
 * Uses Query on PK with SK begins_with EVENT# to retrieve only event items.
 * Results are sorted by timestamp descending.
 */
export async function getOrderEvents(
  orderId: string
): Promise<StoredEvent[]> {
  const pk = orderKey(orderId);

  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': pk,
        ':skPrefix': 'EVENT#',
      },
      ScanIndexForward: false, // Sort descending by SK (timestamp-based)
    })
  );

  return (result.Items || []) as StoredEvent[];
}
