/**
 * ValidateOrder Lambda function for the Order Processing Workflow.
 *
 * Receives Step Functions input with order details, validates the input structure,
 * reads the order from DynamoDB to confirm it exists, and returns the full order context.
 *
 * Validates: Requirements 4.1, 4.2
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { getOrder } from '@eventforge/shared';

/** Custom error thrown when order validation fails */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** Input received from Step Functions */
export interface ValidateOrderInput {
  orderId: string;
  userId: string;
  items: Array<{ productId: string; name: string; quantity: number; price: number }>;
  total: number;
  timestamp: string;
}

/** Output returned on successful validation */
export interface ValidateOrderOutput {
  orderId: string;
  userId: string;
  items: Array<{ productId: string; name: string; quantity: number; price: number }>;
  total: number;
  status: string;
}

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

/**
 * Validates the input fields from Step Functions.
 * Throws ValidationError if any field is invalid.
 */
export function validateInput(input: Partial<ValidateOrderInput>): void {
  if (!input.orderId || typeof input.orderId !== 'string' || input.orderId.trim() === '') {
    throw new ValidationError('orderId must be a non-empty string');
  }

  if (!input.userId || typeof input.userId !== 'string' || input.userId.trim() === '') {
    throw new ValidationError('userId must be a non-empty string');
  }

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new ValidationError('items must be a non-empty array');
  }

  if (typeof input.total !== 'number' || input.total <= 0) {
    throw new ValidationError('total must be greater than 0');
  }
}

/**
 * Lambda handler for the ValidateOrder step.
 *
 * 1. Validates orderId and userId are non-empty strings
 * 2. Validates items is a non-empty array
 * 3. Validates total > 0
 * 4. Reads order from DynamoDB to confirm it exists
 * 5. Returns the full order context on success
 */
export async function handler(event: Partial<ValidateOrderInput>): Promise<ValidateOrderOutput> {
  // Validate input structure
  validateInput(event);

  // Read order from DynamoDB to confirm it exists
  const order = await getOrder(docClient, event.orderId!);

  if (!order) {
    throw new ValidationError(`Order ${event.orderId} not found in database`);
  }

  // Return the full order context for subsequent workflow steps
  return {
    orderId: order.orderId,
    userId: order.userId,
    items: order.items,
    total: order.total,
    status: order.status,
  };
}
