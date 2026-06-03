/**
 * ConfirmOrder Lambda function
 *
 * Step Functions workflow step that confirms an order by:
 * 1. Updating the order status to "completed" in DynamoDB
 * 2. Publishing an order.completed event to EventBridge
 * 3. Passing through the full order context
 *
 * Requirements: 4.5, 4.9
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import { updateOrderStatus } from '@eventforge/shared';

const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || 'eventforge-bus';

interface OrderItem {
  productId: string;
  name: string;
  quantity: number;
  price: number;
}

export interface ConfirmOrderInput {
  orderId: string;
  userId: string;
  items: OrderItem[];
  total: number;
  status: string;
}

export interface ConfirmOrderOutput {
  orderId: string;
  userId: string;
  items: OrderItem[];
  total: number;
  status: 'completed';
}

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const eventBridgeClient = new EventBridgeClient({});

export const handler = async (event: ConfirmOrderInput): Promise<ConfirmOrderOutput> => {
  const { orderId, userId, items, total } = event;

  console.log(`Confirming order ${orderId} for user ${userId}`);

  // Update order status to "completed" in DynamoDB
  const updatedOrder = await updateOrderStatus(docClient, orderId, 'completed');

  if (!updatedOrder) {
    throw new Error(`Failed to update order ${orderId}: order not found`);
  }

  console.log(`Order ${orderId} status updated to "completed"`);

  // Publish order.completed event to EventBridge
  await eventBridgeClient.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: 'eventforge.workflow',
          DetailType: 'order.completed',
          Detail: JSON.stringify({
            orderId,
            userId,
            items,
            total,
            status: 'completed',
            timestamp: new Date().toISOString(),
          }),
          EventBusName: EVENT_BUS_NAME,
        },
      ],
    })
  );

  console.log(`Published order.completed event for order ${orderId}`);

  // Return full order context with updated status
  return {
    orderId,
    userId,
    items,
    total,
    status: 'completed',
  };
};
