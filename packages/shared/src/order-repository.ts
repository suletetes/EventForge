/**
 * Order Repository - DynamoDB data access layer for orders.
 *
 * Implements CRUD operations using single-table design with conditional writes
 * for idempotency and GSI queries for user order history.
 *
 * Validates: Requirements 7.1, 7.4
 */

import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  orderKey,
  orderMetadataSK,
  orderEventSK,
  userKey,
  userOrderSK,
  idempotencyKey,
  idempotencyLockSK,
} from './dynamo-keys';

const TABLE_NAME = process.env.DYNAMODB_TABLE || 'eventforge-events';

/** Order item within an order */
export interface OrderItem {
  productId: string;
  name: string;
  quantity: number;
  price: number;
}

/** Order metadata stored in DynamoDB */
export interface Order {
  orderId: string;
  userId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  items: OrderItem[];
  total: number;
  createdAt: string;
  updatedAt: string;
}

/** Order event stored in DynamoDB */
export interface OrderEvent {
  eventType: string;
  payload: Record<string, unknown>;
  source: string;
  timestamp: string;
  traceId?: string;
}

/** Order with its associated events */
export interface OrderWithEvents extends Order {
  events: OrderEvent[];
}

/** Result of an idempotent create operation */
export interface CreateOrderResult {
  order: Order;
  created: boolean;
}

/**
 * Creates an order with idempotency protection using a transactional write.
 *
 * Writes three items atomically:
 * 1. Order metadata (PK=ORDER#{orderId}, SK=METADATA)
 * 2. User-order relationship (PK=USER#{userId}, SK=ORDER#{orderId})
 * 3. Idempotency lock (PK=IDEMPOTENCY#{key}, SK=LOCK)
 *
 * If the idempotency key already exists, the write is rejected and the
 * existing order is returned.
 */
export async function createOrder(
  client: DynamoDBDocumentClient,
  order: Order,
  idempotencyKeyValue: string
): Promise<CreateOrderResult> {
  const now = Math.floor(Date.now() / 1000);
  const ttl = now + 24 * 60 * 60; // 24 hours

  try {
    await client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: TABLE_NAME,
              Item: {
                PK: orderKey(order.orderId),
                SK: orderMetadataSK(),
                orderId: order.orderId,
                userId: order.userId,
                status: order.status,
                items: order.items,
                total: order.total,
                createdAt: order.createdAt,
                updatedAt: order.updatedAt,
                GSI1PK: order.status,
                GSI1SK: order.createdAt,
                GSI2PK: order.userId,
                GSI2SK: order.createdAt,
              },
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
          {
            Put: {
              TableName: TABLE_NAME,
              Item: {
                PK: userKey(order.userId),
                SK: userOrderSK(order.orderId),
                status: order.status,
                total: order.total,
                createdAt: order.createdAt,
              },
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
          {
            Put: {
              TableName: TABLE_NAME,
              Item: {
                PK: idempotencyKey(idempotencyKeyValue),
                SK: idempotencyLockSK(),
                result: { orderId: order.orderId, status: order.status, createdAt: order.createdAt },
                expiresAt: ttl,
              },
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
        ],
      })
    );

    return { order, created: true };
  } catch (error: unknown) {
    // Transaction cancelled due to condition check failure (duplicate idempotency key)
    if (
      error instanceof Error &&
      error.name === 'TransactionCanceledException'
    ) {
      // Retrieve the existing order
      const existing = await getOrder(client, order.orderId);
      if (existing) {
        return { order: existing, created: false };
      }
      // If order doesn't exist but idempotency key does, try fetching from idempotency record
      throw error;
    }
    throw error;
  }
}

/**
 * Retrieves order metadata by order ID.
 *
 * Uses GetItem on PK=ORDER#{orderId}, SK=METADATA.
 */
export async function getOrder(
  client: DynamoDBDocumentClient,
  orderId: string
): Promise<Order | null> {
  const result = await client.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: orderKey(orderId),
        SK: orderMetadataSK(),
      },
    })
  );

  if (!result.Item) {
    return null;
  }

  return {
    orderId: result.Item.orderId,
    userId: result.Item.userId,
    status: result.Item.status,
    items: result.Item.items,
    total: result.Item.total,
    createdAt: result.Item.createdAt,
    updatedAt: result.Item.updatedAt,
  };
}

/**
 * Retrieves an order with its associated events.
 *
 * Uses Query on PK=ORDER#{orderId} with SK begins_with to fetch
 * both the METADATA item and all EVENT# items in a single query.
 */
export async function getOrderWithEvents(
  client: DynamoDBDocumentClient,
  orderId: string
): Promise<OrderWithEvents | null> {
  const result = await client.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': orderKey(orderId),
      },
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return null;
  }

  let order: Order | null = null;
  const events: OrderEvent[] = [];

  for (const item of result.Items) {
    if (item.SK === orderMetadataSK()) {
      order = {
        orderId: item.orderId,
        userId: item.userId,
        status: item.status,
        items: item.items,
        total: item.total,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      };
    } else if ((item.SK as string).startsWith('EVENT#')) {
      events.push({
        eventType: item.eventType,
        payload: item.payload,
        source: item.source,
        timestamp: item.timestamp,
        traceId: item.traceId,
      });
    }
  }

  if (!order) {
    return null;
  }

  return { ...order, events };
}

/**
 * Retrieves a user's orders sorted by creation date descending.
 *
 * Uses GSI2 (GSI2PK=userId, GSI2SK=createdAt) with ScanIndexForward=false
 * for descending order. Caps results at the lesser of `limit` or 50.
 */
export async function getUserOrders(
  client: DynamoDBDocumentClient,
  userId: string,
  limit: number = 50
): Promise<Order[]> {
  const cappedLimit = Math.min(Math.max(limit, 1), 50);

  const result = await client.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :userId',
      ExpressionAttributeValues: {
        ':userId': userId,
      },
      ScanIndexForward: false,
      Limit: cappedLimit,
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return [];
  }

  return result.Items.map((item) => ({
    orderId: item.orderId,
    userId: item.userId,
    status: item.status,
    items: item.items,
    total: item.total,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }));
}

/**
 * Updates the status of an order.
 *
 * Uses UpdateItem on PK=ORDER#{orderId}, SK=METADATA to set the new status
 * and updatedAt timestamp. Also updates the GSI1PK attribute for status-based queries.
 */
export async function updateOrderStatus(
  client: DynamoDBDocumentClient,
  orderId: string,
  status: Order['status']
): Promise<Order | null> {
  const updatedAt = new Date().toISOString();

  const result = await client.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: orderKey(orderId),
        SK: orderMetadataSK(),
      },
      UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt, GSI1PK = :status',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':status': status,
        ':updatedAt': updatedAt,
      },
      ConditionExpression: 'attribute_exists(PK)',
      ReturnValues: 'ALL_NEW',
    })
  );

  if (!result.Attributes) {
    return null;
  }

  return {
    orderId: result.Attributes.orderId,
    userId: result.Attributes.userId,
    status: result.Attributes.status,
    items: result.Attributes.items,
    total: result.Attributes.total,
    createdAt: result.Attributes.createdAt,
    updatedAt: result.Attributes.updatedAt,
  };
}
