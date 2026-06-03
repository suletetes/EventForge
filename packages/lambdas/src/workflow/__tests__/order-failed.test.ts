import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { handler, OrderContext } from '../order-failed';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

const validOrderContext: OrderContext = {
  orderId: 'order-123',
  userId: 'user-456',
  items: [
    { productId: 'prod-1', name: 'Widget', quantity: 2, price: 9.99 },
    { productId: 'prod-2', name: 'Gadget', quantity: 1, price: 19.99 },
  ],
  total: 39.97,
  status: 'processing',
};

describe('OrderFailed handler', () => {
  it('should update order status to "failed" in DynamoDB', async () => {
    ddbMock.on(UpdateCommand).resolves({
      Attributes: {
        orderId: 'order-123',
        userId: 'user-456',
        status: 'failed',
        items: validOrderContext.items,
        total: 39.97,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T01:00:00.000Z',
      },
    });

    await handler(validOrderContext);

    const calls = ddbMock.commandCalls(UpdateCommand);
    expect(calls.length).toBe(1);

    const input = calls[0].args[0].input;
    expect(input.ExpressionAttributeValues![':status']).toBe('failed');
  });

  it('should use the correct order key pattern', async () => {
    ddbMock.on(UpdateCommand).resolves({
      Attributes: {
        orderId: 'order-123',
        userId: 'user-456',
        status: 'failed',
        items: validOrderContext.items,
        total: 39.97,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T01:00:00.000Z',
      },
    });

    await handler(validOrderContext);

    const calls = ddbMock.commandCalls(UpdateCommand);
    const input = calls[0].args[0].input;

    expect(input.Key).toEqual({
      PK: 'ORDER#order-123',
      SK: 'METADATA',
    });
  });

  it('should return full order context unchanged', async () => {
    ddbMock.on(UpdateCommand).resolves({
      Attributes: {
        orderId: 'order-123',
        userId: 'user-456',
        status: 'failed',
        items: validOrderContext.items,
        total: 39.97,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T01:00:00.000Z',
      },
    });

    const result = await handler(validOrderContext);

    expect(result).toEqual({
      orderId: 'order-123',
      userId: 'user-456',
      items: validOrderContext.items,
      total: 39.97,
      status: 'processing',
    });
  });

  it('should preserve error field when present', async () => {
    ddbMock.on(UpdateCommand).resolves({
      Attributes: {
        orderId: 'order-123',
        userId: 'user-456',
        status: 'failed',
        items: validOrderContext.items,
        total: 39.97,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T01:00:00.000Z',
      },
    });

    const contextWithError: OrderContext = {
      ...validOrderContext,
      error: 'Payment declined',
    };

    const result = await handler(contextWithError);

    expect(result.error).toBe('Payment declined');
  });

  it('should not include error field when not present in input', async () => {
    ddbMock.on(UpdateCommand).resolves({
      Attributes: {
        orderId: 'order-123',
        userId: 'user-456',
        status: 'failed',
        items: validOrderContext.items,
        total: 39.97,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T01:00:00.000Z',
      },
    });

    const result = await handler(validOrderContext);

    expect(result).not.toHaveProperty('error');
  });

  it('should propagate DynamoDB errors', async () => {
    ddbMock.on(UpdateCommand).rejects(new Error('ConditionalCheckFailedException'));

    await expect(handler(validOrderContext)).rejects.toThrow(
      'ConditionalCheckFailedException'
    );
  });

  it('should handle single item orders', async () => {
    ddbMock.on(UpdateCommand).resolves({
      Attributes: {
        orderId: 'order-single',
        userId: 'user-1',
        status: 'failed',
        items: [{ productId: 'prod-x', name: 'Solo', quantity: 1, price: 5.0 }],
        total: 5.0,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T01:00:00.000Z',
      },
    });

    const singleItemOrder: OrderContext = {
      orderId: 'order-single',
      userId: 'user-1',
      items: [{ productId: 'prod-x', name: 'Solo', quantity: 1, price: 5.0 }],
      total: 5.0,
      status: 'pending',
    };

    const result = await handler(singleItemOrder);

    expect(result.orderId).toBe('order-single');
    expect(result.status).toBe('pending');
    const calls = ddbMock.commandCalls(UpdateCommand);
    expect(calls.length).toBe(1);
  });
});
