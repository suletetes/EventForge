/**
 * Unit tests for the ValidateOrder Lambda function.
 *
 * Tests input validation, DynamoDB order lookup, and error handling.
 */

import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { handler, validateInput, ValidationError } from '../validate-order';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

describe('validateInput', () => {
  it('should throw ValidationError when orderId is missing', () => {
    expect(() =>
      validateInput({ userId: 'user-1', items: [{ productId: 'p1', name: 'Item', quantity: 1, price: 10 }], total: 10, timestamp: '2024-01-01T00:00:00Z' })
    ).toThrow(ValidationError);
  });

  it('should throw ValidationError when orderId is empty string', () => {
    expect(() =>
      validateInput({ orderId: '', userId: 'user-1', items: [{ productId: 'p1', name: 'Item', quantity: 1, price: 10 }], total: 10, timestamp: '2024-01-01T00:00:00Z' })
    ).toThrow(ValidationError);
  });

  it('should throw ValidationError when orderId is whitespace only', () => {
    expect(() =>
      validateInput({ orderId: '   ', userId: 'user-1', items: [{ productId: 'p1', name: 'Item', quantity: 1, price: 10 }], total: 10, timestamp: '2024-01-01T00:00:00Z' })
    ).toThrow(ValidationError);
  });

  it('should throw ValidationError when userId is missing', () => {
    expect(() =>
      validateInput({ orderId: 'order-1', items: [{ productId: 'p1', name: 'Item', quantity: 1, price: 10 }], total: 10, timestamp: '2024-01-01T00:00:00Z' })
    ).toThrow(ValidationError);
  });

  it('should throw ValidationError when userId is empty string', () => {
    expect(() =>
      validateInput({ orderId: 'order-1', userId: '', items: [{ productId: 'p1', name: 'Item', quantity: 1, price: 10 }], total: 10, timestamp: '2024-01-01T00:00:00Z' })
    ).toThrow(ValidationError);
  });

  it('should throw ValidationError when items is not an array', () => {
    expect(() =>
      validateInput({ orderId: 'order-1', userId: 'user-1', items: 'not-array' as any, total: 10, timestamp: '2024-01-01T00:00:00Z' })
    ).toThrow(ValidationError);
  });

  it('should throw ValidationError when items is empty array', () => {
    expect(() =>
      validateInput({ orderId: 'order-1', userId: 'user-1', items: [], total: 10, timestamp: '2024-01-01T00:00:00Z' })
    ).toThrow(ValidationError);
  });

  it('should throw ValidationError when total is 0', () => {
    expect(() =>
      validateInput({ orderId: 'order-1', userId: 'user-1', items: [{ productId: 'p1', name: 'Item', quantity: 1, price: 10 }], total: 0, timestamp: '2024-01-01T00:00:00Z' })
    ).toThrow(ValidationError);
  });

  it('should throw ValidationError when total is negative', () => {
    expect(() =>
      validateInput({ orderId: 'order-1', userId: 'user-1', items: [{ productId: 'p1', name: 'Item', quantity: 1, price: 10 }], total: -5, timestamp: '2024-01-01T00:00:00Z' })
    ).toThrow(ValidationError);
  });

  it('should not throw for valid input', () => {
    expect(() =>
      validateInput({ orderId: 'order-1', userId: 'user-1', items: [{ productId: 'p1', name: 'Item', quantity: 1, price: 10 }], total: 10, timestamp: '2024-01-01T00:00:00Z' })
    ).not.toThrow();
  });
});

describe('handler', () => {
  const validInput = {
    orderId: 'order-123',
    userId: 'user-456',
    items: [{ productId: 'prod-1', name: 'Widget', quantity: 2, price: 25.00 }],
    total: 50.00,
    timestamp: '2024-01-15T10:30:00Z',
  };

  const storedOrder = {
    PK: 'ORDER#order-123',
    SK: 'METADATA',
    orderId: 'order-123',
    userId: 'user-456',
    status: 'pending',
    items: [{ productId: 'prod-1', name: 'Widget', quantity: 2, price: 25.00 }],
    total: 50.00,
    createdAt: '2024-01-15T10:30:00Z',
    updatedAt: '2024-01-15T10:30:00Z',
  };

  it('should return order context when input is valid and order exists', async () => {
    ddbMock.on(GetCommand).resolves({ Item: storedOrder });

    const result = await handler(validInput);

    expect(result).toEqual({
      orderId: 'order-123',
      userId: 'user-456',
      items: [{ productId: 'prod-1', name: 'Widget', quantity: 2, price: 25.00 }],
      total: 50.00,
      status: 'pending',
    });
  });

  it('should throw ValidationError when order does not exist in DynamoDB', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });

    await expect(handler(validInput)).rejects.toThrow(ValidationError);
    await expect(handler(validInput)).rejects.toThrow('Order order-123 not found in database');
  });

  it('should throw ValidationError with name "ValidationError" for invalid input', async () => {
    try {
      await handler({ orderId: '', userId: 'user-1', items: [], total: 0, timestamp: '' });
    } catch (error: any) {
      expect(error.name).toBe('ValidationError');
    }
  });

  it('should throw ValidationError when orderId is missing from input', async () => {
    await expect(handler({ userId: 'user-1', items: [{ productId: 'p1', name: 'Item', quantity: 1, price: 10 }], total: 10, timestamp: '2024-01-01T00:00:00Z' })).rejects.toThrow(ValidationError);
  });

  it('should throw ValidationError when items is empty', async () => {
    await expect(handler({ orderId: 'order-1', userId: 'user-1', items: [], total: 10, timestamp: '2024-01-01T00:00:00Z' })).rejects.toThrow(ValidationError);
  });

  it('should throw ValidationError when total is not positive', async () => {
    await expect(handler({ orderId: 'order-1', userId: 'user-1', items: [{ productId: 'p1', name: 'Item', quantity: 1, price: 10 }], total: -1, timestamp: '2024-01-01T00:00:00Z' })).rejects.toThrow(ValidationError);
  });
});
