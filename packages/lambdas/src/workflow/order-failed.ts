/**
 * OrderFailed Lambda - Persists failure status before the Fail state.
 *
 * Updates the order status to "failed" in DynamoDB using the shared
 * updateOrderStatus utility. This step is called before the Step Functions
 * Fail state to ensure the failure is persisted in the data store.
 *
 * Validates: Requirements 4.8
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { updateOrderStatus } from '@eventforge/shared';

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
  error?: string;
}

/**
 * Persists the order failure status in DynamoDB.
 *
 * Called as a step before the Fail state in the Step Functions workflow
 * to ensure the order status is updated to "failed" in the data store.
 * Returns the full order context unchanged for downstream processing.
 *
 * @param event - Full order context from the workflow
 * @returns Order context passed through unchanged
 */
export async function handler(event: OrderContext): Promise<OrderContext> {
  const { orderId, userId, items, total, status, error } = event;

  await updateOrderStatus(docClient, orderId, 'failed');

  return {
    orderId,
    userId,
    items,
    total,
    status,
    ...(error !== undefined && { error }),
  };
}
