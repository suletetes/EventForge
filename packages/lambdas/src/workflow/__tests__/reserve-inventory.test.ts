import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { handler, OrderContext } from '../reserve-inventory';

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
  status: 'pending',
};

describe('ReserveInventory handler', () => {
  it('should reserve inventory for each item and update order status to processing', async () => {
    ddbMock.on(UpdateCommand).resolves({});

    const result = await handler(validOrderContext);

    expect(result.status).toBe('processing');
    expect(result.orderId).toBe('order-123');
    expect(result.userId).toBe('user-456');
    expect(result.items).toEqual(validOrderContext.items);
    expect(result.total).toBe(39.97);
  });

  it('should make a DynamoDB conditional write for each item', async () => {
    ddbMock.on(UpdateCommand).resolves({});

    await handler(validOrderContext);

    // 2 items + 1 order status update = 3 UpdateCommand calls
    const calls = ddbMock.commandCalls(UpdateCommand);
    expect(calls.length).toBe(3);
  });

  it('should use correct inventory key pattern for reservation', async () => {
    ddbMock.on(UpdateCommand).resolves({});

    await handler(validOrderContext);

    const calls = ddbMock.commandCalls(UpdateCommand);
    const firstCall = calls[0].args[0].input;

    expect(firstCall.Key).toEqual({
      PK: 'INVENTORY#prod-1',
      SK: 'RESERVATION#order-123',
    });
    expect(firstCall.ConditionExpression).toBe(
      'attribute_not_exists(PK) OR #s <> :status'
    );
  });

  it('should pass through full order context with updated status', async () => {
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

  it('should handle single item orders', async () => {
    ddbMock.on(UpdateCommand).resolves({});

    const singleItemOrder: OrderContext = {
      orderId: 'order-single',
      userId: 'user-1',
      items: [{ productId: 'prod-x', name: 'Solo', quantity: 1, price: 5.0 }],
      total: 5.0,
      status: 'pending',
    };

    const result = await handler(singleItemOrder);

    expect(result.status).toBe('processing');
    // 1 item + 1 status update = 2 calls
    const calls = ddbMock.commandCalls(UpdateCommand);
    expect(calls.length).toBe(2);
  });

  it('should propagate DynamoDB errors', async () => {
    ddbMock.on(UpdateCommand).rejects(new Error('ConditionalCheckFailedException'));

    await expect(handler(validOrderContext)).rejects.toThrow(
      'ConditionalCheckFailedException'
    );
  });
});
