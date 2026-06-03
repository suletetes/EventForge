/**
 * Unit tests for the ConfirmOrder Lambda function.
 *
 * Tests order status update, EventBridge event publishing, and error handling.
 */

import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { handler } from '../confirm-order';

const ddbMock = mockClient(DynamoDBDocumentClient);
const ebMock = mockClient(EventBridgeClient);

beforeEach(() => {
  ddbMock.reset();
  ebMock.reset();
});

describe('ConfirmOrder Lambda', () => {
  const validInput = {
    orderId: '01HX1234567890ABCDEF',
    userId: 'user-123',
    items: [
      { productId: 'prod-1', name: 'Widget', quantity: 2, price: 29.99 },
      { productId: 'prod-2', name: 'Gadget', quantity: 1, price: 49.99 },
    ],
    total: 109.97,
    status: 'processing',
  };

  const updatedOrderAttributes = {
    PK: 'ORDER#01HX1234567890ABCDEF',
    SK: 'METADATA',
    orderId: '01HX1234567890ABCDEF',
    userId: 'user-123',
    status: 'completed',
    items: [
      { productId: 'prod-1', name: 'Widget', quantity: 2, price: 29.99 },
      { productId: 'prod-2', name: 'Gadget', quantity: 1, price: 49.99 },
    ],
    total: 109.97,
    createdAt: '2024-01-15T10:30:00Z',
    updatedAt: '2024-01-15T12:00:00Z',
  };

  it('should update order status to "completed" and publish event', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: updatedOrderAttributes });
    ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{ EventId: 'evt-1' }] });

    const result = await handler(validInput);

    expect(result.orderId).toBe(validInput.orderId);
    expect(result.userId).toBe(validInput.userId);
    expect(result.items).toEqual(validInput.items);
    expect(result.total).toBe(validInput.total);
    expect(result.status).toBe('completed');
  });

  it('should pass through full order context', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: updatedOrderAttributes });
    ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{ EventId: 'evt-1' }] });

    const result = await handler(validInput);

    expect(result.orderId).toBe(validInput.orderId);
    expect(result.userId).toBe(validInput.userId);
    expect(result.items).toEqual(validInput.items);
    expect(result.total).toBe(validInput.total);
  });

  it('should call DynamoDB UpdateCommand with correct parameters', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: updatedOrderAttributes });
    ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{ EventId: 'evt-1' }] });

    await handler(validInput);

    const updateCalls = ddbMock.commandCalls(UpdateCommand);
    expect(updateCalls).toHaveLength(1);

    const updateInput = updateCalls[0].args[0].input;
    expect(updateInput.Key).toEqual({
      PK: 'ORDER#01HX1234567890ABCDEF',
      SK: 'METADATA',
    });
    expect(updateInput.ExpressionAttributeValues).toMatchObject({
      ':status': 'completed',
    });
  });

  it('should publish order.completed event to EventBridge with correct source', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: updatedOrderAttributes });
    ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{ EventId: 'evt-1' }] });

    await handler(validInput);

    const putEventsCalls = ebMock.commandCalls(PutEventsCommand);
    expect(putEventsCalls).toHaveLength(1);

    const entries = putEventsCalls[0].args[0].input.Entries;
    expect(entries).toHaveLength(1);
    expect(entries![0].Source).toBe('eventforge.workflow');
    expect(entries![0].DetailType).toBe('order.completed');
    expect(entries![0].EventBusName).toBe('eventforge-bus');

    const detail = JSON.parse(entries![0].Detail!);
    expect(detail.orderId).toBe(validInput.orderId);
    expect(detail.userId).toBe(validInput.userId);
    expect(detail.items).toEqual(validInput.items);
    expect(detail.total).toBe(validInput.total);
    expect(detail.status).toBe('completed');
    expect(detail.timestamp).toBeDefined();
  });

  it('should throw error when order is not found in DynamoDB', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: undefined });

    await expect(handler(validInput)).rejects.toThrow(
      'Failed to update order 01HX1234567890ABCDEF: order not found'
    );
  });

  it('should throw error when DynamoDB update fails with condition check', async () => {
    const conditionError = new Error('The conditional request failed');
    conditionError.name = 'ConditionalCheckFailedException';
    ddbMock.on(UpdateCommand).rejects(conditionError);

    await expect(handler(validInput)).rejects.toThrow();
  });

  it('should throw error when EventBridge publish fails', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: updatedOrderAttributes });
    ebMock.on(PutEventsCommand).rejects(new Error('EventBridge service error'));

    await expect(handler(validInput)).rejects.toThrow('EventBridge service error');
  });

  it('should include timestamp in the published event detail', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: updatedOrderAttributes });
    ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{ EventId: 'evt-1' }] });

    await handler(validInput);

    const putEventsCalls = ebMock.commandCalls(PutEventsCommand);
    const detail = JSON.parse(putEventsCalls[0].args[0].input.Entries![0].Detail!);

    // Verify timestamp is a valid ISO 8601 string
    const timestamp = new Date(detail.timestamp);
    expect(timestamp.toISOString()).toBe(detail.timestamp);
  });

  it('should not publish event if DynamoDB update fails', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: undefined });

    try {
      await handler(validInput);
    } catch {
      // Expected to throw
    }

    const putEventsCalls = ebMock.commandCalls(PutEventsCommand);
    expect(putEventsCalls).toHaveLength(0);
  });
});
