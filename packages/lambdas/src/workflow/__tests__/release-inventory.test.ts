import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { handler, OrderContext } from '../release-inventory';

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

describe('ReleaseInventory handler', () => {
  it('should release inventory for each item', async () => {
    ddbMock.on(UpdateCommand).resolves({});

    const result = await handler(validOrderContext);

    const calls = ddbMock.commandCalls(UpdateCommand);
    // One call per item (2 items)
    expect(calls.length).toBe(2);
  });

  it('should use correct inventory key pattern for release', async () => {
    ddbMock.on(UpdateCommand).resolves({});

    await handler(validOrderContext);

    const calls = ddbMock.commandCalls(UpdateCommand);
    const firstCall = calls[0].args[0].input;

    expect(firstCall.Key).toEqual({
      PK: 'INVENTORY#prod-1',
      SK: 'RESERVATION#order-123',
    });
    expect(firstCall.ConditionExpression).toBe('attribute_exists(PK)');
  });

  it('should set reservation status to released', async () => {
    ddbMock.on(UpdateCommand).resolves({});

    await handler(validOrderContext);

    const calls = ddbMock.commandCalls(UpdateCommand);
    const firstCall = calls[0].args[0].input;

    expect(firstCall.ExpressionAttributeValues![':status']).toBe('released');
  });

  it('should return full order context unchanged', async () => {
    ddbMock.on(UpdateCommand).resolves({});

    const result = await handler(validOrderContext);

    expect(result).toEqual({
      orderId: 'order-123',
      userId: 'user-456',
      items: validOrderContext.items,
      total: 39.97,
      status: 'processing',
    });
  });

  it('should preserve original status (compensation step)', async () => {
    ddbMock.on(UpdateCommand).resolves({});

    const contextWithStatus: OrderContext = {
      ...validOrderContext,
      status: 'processing',
    };

    const result = await handler(contextWithStatus);

    // Status should remain unchanged - this is a compensation step
    expect(result.status).toBe('processing');
  });

  it('should handle single item orders', async () => {
    ddbMock.on(UpdateCommand).resolves({});

    const singleItemOrder: OrderContext = {
      orderId: 'order-single',
      userId: 'user-1',
      items: [{ productId: 'prod-x', name: 'Solo', quantity: 1, price: 5.0 }],
      total: 5.0,
      status: 'processing',
    };

    const result = await handler(singleItemOrder);

    expect(result.status).toBe('processing');
    const calls = ddbMock.commandCalls(UpdateCommand);
    expect(calls.length).toBe(1);
  });

  it('should propagate DynamoDB errors', async () => {
    ddbMock.on(UpdateCommand).rejects(new Error('ConditionalCheckFailedException'));

    await expect(handler(validOrderContext)).rejects.toThrow(
      'ConditionalCheckFailedException'
    );
  });
});
