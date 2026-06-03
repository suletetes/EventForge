/**
 * ReserveInventory Lambda - Step Functions workflow step.
 *
 * Simulates inventory reservation using DynamoDB conditional writes.
 * For each item in the order, marks inventory as reserved.
 * Updates order status to "processing" in DynamoDB.
 *
 * Validates: Requirements 4.3, 4.4, 4.6, 4.7
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { updateOrderStatus } from '@eventforge/shared';

const TABLE_NAME = process.env.DYNAMODB_TABLE || 'eventforge-events';

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

/** Order context passed through workflow steps */
export interface OrderContext {
  orderId: string;
  userId: string;
  items: Array<{
    productId: string;
    name: string;
    quantity: number;
    price: number;
  }>;
  total: number;
  status: string;
}

/**
 * Reserves inventory for each item in the order using DynamoDB conditional writes.
 *
 * For each item, creates/updates an inventory reservation record with a condition
 * that prevents double-reservation. Updates order status to "processing".
 *
 * @param event - Full order context from the previous workflow step
 * @returns Order context with status updated to "processing"
 */
export async function handler(event: OrderContext): Promise<OrderContext> {
  const { orderId, userId, items, total } = event;

  // Reserve inventory for each item using conditional writes
  for (const item of items) {
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `INVENTORY#${item.productId}`,
          SK: `RESERVATION#${orderId}`,
        },
        UpdateExpression:
          'SET quantity = :qty, orderId = :orderId, reservedAt = :now, #s = :status',
        ExpressionAttributeNames: {
          '#s': 'status',
        },
        ExpressionAttributeValues: {
          ':qty': item.quantity,
          ':orderId': orderId,
          ':now': new Date().toISOString(),
          ':status': 'reserved',
        },
        ConditionExpression: 'attribute_not_exists(PK) OR #s <> :status',
      })
    );
  }

  // Update order status to "processing"
  await updateOrderStatus(docClient, orderId, 'processing');

  return {
    orderId,
    userId,
    items,
    total,
    status: 'processing',
  };
}
