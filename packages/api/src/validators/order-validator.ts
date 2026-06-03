/**
 * Order Validator - Validates incoming order creation requests.
 *
 * Accepts an unknown request body and returns either a validated order
 * or structured error messages identifying which constraints were violated.
 *
 * Validates: Requirements 2.1, 2.9
 */

import { OrderItem } from '@eventforge/shared';

/** A validated order ready for processing (pre-persistence fields) */
export interface ValidatedOrder {
  userId: string;
  items: OrderItem[];
  total: number;
}

/** Successful validation result */
export interface ValidationSuccess {
  valid: true;
  order: ValidatedOrder;
}

/** Failed validation result with structured error messages */
export interface ValidationFailure {
  valid: false;
  errors: string[];
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

/**
 * Validates a request body for order creation.
 *
 * Checks:
 * - userId is a non-empty string
 * - items is a non-empty array with at most 50 items
 * - Each item has productId (non-empty string), name (non-empty string),
 *   quantity (integer >= 1), and price (number > 0)
 * - total is a number between 0.01 and 999999.99
 *
 * @param body - The raw request body (unknown type)
 * @returns ValidationSuccess with the validated order, or ValidationFailure with error messages
 */
export function validateOrderRequest(body: unknown): ValidationResult {
  const errors: string[] = [];

  if (body === null || body === undefined || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, errors: ['request body must be a JSON object'] };
  }

  const request = body as Record<string, unknown>;

  // Validate userId
  if (
    request.userId === undefined ||
    request.userId === null ||
    typeof request.userId !== 'string' ||
    request.userId.trim().length === 0
  ) {
    errors.push('userId is required and must be a non-empty string');
  }

  // Validate items array
  if (!Array.isArray(request.items) || request.items.length === 0 || request.items.length > 50) {
    errors.push('items must be a non-empty array with at most 50 items');
  } else {
    // Validate each item
    for (let i = 0; i < request.items.length; i++) {
      const item = request.items[i];

      if (item === null || item === undefined || typeof item !== 'object' || Array.isArray(item)) {
        errors.push(`items[${i}] must be an object`);
        continue;
      }

      const orderItem = item as Record<string, unknown>;

      if (
        orderItem.productId === undefined ||
        orderItem.productId === null ||
        typeof orderItem.productId !== 'string' ||
        orderItem.productId.trim().length === 0
      ) {
        errors.push(`items[${i}].productId is required and must be a non-empty string`);
      }

      if (
        orderItem.name === undefined ||
        orderItem.name === null ||
        typeof orderItem.name !== 'string' ||
        orderItem.name.trim().length === 0
      ) {
        errors.push(`items[${i}].name is required and must be a non-empty string`);
      }

      if (
        orderItem.quantity === undefined ||
        orderItem.quantity === null ||
        typeof orderItem.quantity !== 'number' ||
        !Number.isInteger(orderItem.quantity) ||
        orderItem.quantity < 1
      ) {
        errors.push(`items[${i}].quantity must be an integer >= 1`);
      }

      if (
        orderItem.price === undefined ||
        orderItem.price === null ||
        typeof orderItem.price !== 'number' ||
        !Number.isFinite(orderItem.price) ||
        orderItem.price <= 0
      ) {
        errors.push(`items[${i}].price must be a number > 0`);
      }
    }
  }

  // Validate total
  if (
    request.total === undefined ||
    request.total === null ||
    typeof request.total !== 'number' ||
    !Number.isFinite(request.total) ||
    request.total < 0.01 ||
    request.total > 999999.99
  ) {
    errors.push('total must be a number between 0.01 and 999999.99');
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    order: {
      userId: (request.userId as string).trim(),
      items: (request.items as Record<string, unknown>[]).map((item) => ({
        productId: (item.productId as string).trim(),
        name: (item.name as string).trim(),
        quantity: item.quantity as number,
        price: item.price as number,
      })),
      total: request.total as number,
    },
  };
}
