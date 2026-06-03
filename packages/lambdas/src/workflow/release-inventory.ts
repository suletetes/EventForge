/**
 * ReleaseInventory Lambda - Step Functions compensation step.
 *
 * Releases previously reserved inventory when a downstream step fails.
 * This is the compensation (rollback) step in the saga pattern.
 * For each item in the order, removes the inventory reservation.
 *
 * Validates: Requirements 4.4, 4.6, 4.7
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

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
 * Releases inventory reservations for each item in the order.
 *
 * This is the compensation step executed when ChargePayment or ConfirmOrder fails.
 * Marks each reservation as "released" to free up inventory.
 * Returns the full order context unchanged (compensation step before failure).
 *
 * @param event - Full order context from the workflow
 * @returns Order context passed through unchanged
 */
export async function handler(event: OrderContext): Promise<OrderContext> {
  const { orderId, userId, items, total, status } = event;

  // Release inventory reservation for each item
  for (const item of items) {
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `INVENTORY#${item.productId}`,
          SK: `RESERVATION#${orderId}`,
        },
        UpdateExpression: 'SET #s = :status, releasedAt = :now',
        ExpressionAttributeNames: {
          '#s': 'status',
        },
        ExpressionAttributeValues: {
          ':status': 'released',
          ':now': new Date().toISOString(),
        },
        ConditionExpression: 'attribute_exists(PK)',
      })
    );
  }

  // Return full order context unchanged (compensation step)
  return {
    orderId,
    userId,
    items,
    total,
    status,
  };
}
