import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  TransactWriteCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  createOrder,
  getOrder,
  getOrderWithEvents,
  getUserOrders,
  updateOrderStatus,
  Order,
} from '../order-repository';

const ddbClient = new DynamoDBClient({ region: 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(ddbClient);
const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

const sampleOrder: Order = {
  orderId: 'order-123',
  userId: 'user-456',
  status: 'pending',
  items: [{ productId: 'prod-1', name: 'Widget', quantity: 2, price: 9.99 }],
  total: 19.98,
  createdAt: '2024-01-15T10:00:00.000Z',
  updatedAt: '2024-01-15T10:00:00.000Z',
};

describe('createOrder', () => {
  it('should create an order with idempotency key using TransactWriteCommand', async () => {
    ddbMock.on(TransactWriteCommand).resolves({});

    const result = await createOrder(docClient, sampleOrder, 'idem-key-1');

    expect(result.created).toBe(true);
    expect(result.order).toEqual(sampleOrder);

    const calls = ddbMock.commandCalls(TransactWriteCommand);
    expect(calls).toHaveLength(1);

    const transactItems = calls[0].args[0].input.TransactItems!;
    expect(transactItems).toHaveLength(3);

    // Order metadata item
    expect(transactItems[0].Put!.Item!.PK).toBe('ORDER#order-123');
    expect(transactItems[0].Put!.Item!.SK).toBe('METADATA');
    expect(transactItems[0].Put!.ConditionExpression).toBe('attribute_not_exists(PK)');

    // User-order relationship item
    expect(transactItems[1].Put!.Item!.PK).toBe('USER#user-456');
    expect(transactItems[1].Put!.Item!.SK).toBe('ORDER#order-123');

    // Idempotency lock item
    expect(transactItems[2].Put!.Item!.PK).toBe('IDEMPOTENCY#idem-key-1');
    expect(transactItems[2].Put!.Item!.SK).toBe('LOCK');
    expect(transactItems[2].Put!.Item!.expiresAt).toBeGreaterThan(0);
  });

  it('should return existing order when idempotency key already exists', async () => {
    const txError = new Error('Transaction cancelled');
    txError.name = 'TransactionCanceledException';
    ddbMock.on(TransactWriteCommand).rejects(txError);
    ddbMock.on(GetCommand).resolves({
      Item: {
        PK: 'ORDER#order-123',
        SK: 'METADATA',
        ...sampleOrder,
      },
    });

    const result = await createOrder(docClient, sampleOrder, 'idem-key-1');

    expect(result.created).toBe(false);
    expect(result.order.orderId).toBe('order-123');
  });

  it('should include GSI attributes on order metadata', async () => {
    ddbMock.on(TransactWriteCommand).resolves({});

    await createOrder(docClient, sampleOrder, 'idem-key-2');

    const calls = ddbMock.commandCalls(TransactWriteCommand);
    const orderItem = calls[0].args[0].input.TransactItems![0].Put!.Item!;
    expect(orderItem.GSI1PK).toBe('pending');
    expect(orderItem.GSI1SK).toBe(sampleOrder.createdAt);
    expect(orderItem.GSI2PK).toBe('user-456');
    expect(orderItem.GSI2SK).toBe(sampleOrder.createdAt);
  });

  it('should set idempotency key TTL to approximately 24 hours from now', async () => {
    ddbMock.on(TransactWriteCommand).resolves({});

    const beforeTime = Math.floor(Date.now() / 1000);
    await createOrder(docClient, sampleOrder, 'idem-key-ttl');
    const afterTime = Math.floor(Date.now() / 1000);

    const calls = ddbMock.commandCalls(TransactWriteCommand);
    const idempotencyItem = calls[0].args[0].input.TransactItems![2].Put!.Item!;

    const expectedTTLMin = beforeTime + 24 * 60 * 60;
    const expectedTTLMax = afterTime + 24 * 60 * 60;

    expect(idempotencyItem.expiresAt).toBeGreaterThanOrEqual(expectedTTLMin);
    expect(idempotencyItem.expiresAt).toBeLessThanOrEqual(expectedTTLMax);
  });
});

describe('getOrder', () => {
  it('should return order metadata when found', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        PK: 'ORDER#order-123',
        SK: 'METADATA',
        ...sampleOrder,
      },
    });

    const result = await getOrder(docClient, 'order-123');

    expect(result).toEqual(sampleOrder);

    const calls = ddbMock.commandCalls(GetCommand);
    expect(calls[0].args[0].input.Key).toEqual({
      PK: 'ORDER#order-123',
      SK: 'METADATA',
    });
  });

  it('should return null when order not found', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });

    const result = await getOrder(docClient, 'nonexistent');

    expect(result).toBeNull();
  });
});

describe('getOrderWithEvents', () => {
  it('should return order with events from query', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        {
          PK: 'ORDER#order-123',
          SK: 'METADATA',
          ...sampleOrder,
        },
        {
          PK: 'ORDER#order-123',
          SK: 'EVENT#2024-01-15T10:01:00.000Z#evt-1',
          eventType: 'order.created',
          payload: { orderId: 'order-123' },
          source: 'eventforge.api',
          timestamp: '2024-01-15T10:01:00.000Z',
          traceId: 'trace-abc',
        },
      ],
    });

    const result = await getOrderWithEvents(docClient, 'order-123');

    expect(result).not.toBeNull();
    expect(result!.orderId).toBe('order-123');
    expect(result!.events).toHaveLength(1);
    expect(result!.events[0].eventType).toBe('order.created');
    expect(result!.events[0].traceId).toBe('trace-abc');
  });

  it('should return null when no items found', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    const result = await getOrderWithEvents(docClient, 'nonexistent');

    expect(result).toBeNull();
  });

  it('should query with correct key condition', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    await getOrderWithEvents(docClient, 'order-123');

    const calls = ddbMock.commandCalls(QueryCommand);
    expect(calls[0].args[0].input.KeyConditionExpression).toBe('PK = :pk');
    expect(calls[0].args[0].input.ExpressionAttributeValues).toEqual({
      ':pk': 'ORDER#order-123',
    });
  });
});

describe('getUserOrders', () => {
  it('should query GSI2 with userId sorted descending', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { ...sampleOrder, GSI2PK: 'user-456', GSI2SK: sampleOrder.createdAt },
      ],
    });

    const result = await getUserOrders(docClient, 'user-456');

    expect(result).toHaveLength(1);
    expect(result[0].orderId).toBe('order-123');

    const calls = ddbMock.commandCalls(QueryCommand);
    expect(calls[0].args[0].input.IndexName).toBe('GSI2');
    expect(calls[0].args[0].input.ScanIndexForward).toBe(false);
    expect(calls[0].args[0].input.KeyConditionExpression).toBe('GSI2PK = :userId');
  });

  it('should cap limit at 50', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    await getUserOrders(docClient, 'user-456', 100);

    const calls = ddbMock.commandCalls(QueryCommand);
    expect(calls[0].args[0].input.Limit).toBe(50);
  });

  it('should enforce minimum limit of 1', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    await getUserOrders(docClient, 'user-456', 0);

    const calls = ddbMock.commandCalls(QueryCommand);
    expect(calls[0].args[0].input.Limit).toBe(1);
  });

  it('should return empty array when no orders found', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    const result = await getUserOrders(docClient, 'user-no-orders');

    expect(result).toEqual([]);
  });
});

describe('updateOrderStatus', () => {
  it('should update status and updatedAt', async () => {
    ddbMock.on(UpdateCommand).resolves({
      Attributes: {
        ...sampleOrder,
        status: 'completed',
        updatedAt: '2024-01-15T11:00:00.000Z',
      },
    });

    const result = await updateOrderStatus(docClient, 'order-123', 'completed');

    expect(result).not.toBeNull();
    expect(result!.status).toBe('completed');

    const calls = ddbMock.commandCalls(UpdateCommand);
    expect(calls[0].args[0].input.Key).toEqual({
      PK: 'ORDER#order-123',
      SK: 'METADATA',
    });
    expect(calls[0].args[0].input.ConditionExpression).toBe('attribute_exists(PK)');
  });

  it('should return null when order does not exist', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: undefined });

    const result = await updateOrderStatus(docClient, 'nonexistent', 'failed');

    expect(result).toBeNull();
  });

  it('should update GSI1PK for status-based queries', async () => {
    ddbMock.on(UpdateCommand).resolves({
      Attributes: { ...sampleOrder, status: 'failed' },
    });

    await updateOrderStatus(docClient, 'order-123', 'failed');

    const calls = ddbMock.commandCalls(UpdateCommand);
    const updateExpr = calls[0].args[0].input.UpdateExpression;
    expect(updateExpr).toContain('GSI1PK = :status');
  });
});
