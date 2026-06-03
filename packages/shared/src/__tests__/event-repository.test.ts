import { storeEvent, getRecentEvents, getOrderEvents, OrderEvent } from '../event-repository';

// Mock the AWS SDK
const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockReturnValue({ send: (...args: unknown[]) => mockSend(...args) }),
  },
  PutCommand: jest.fn().mockImplementation((input) => ({ input, type: 'Put' })),
  QueryCommand: jest.fn().mockImplementation((input) => ({ input, type: 'Query' })),
  ScanCommand: jest.fn().mockImplementation((input) => ({ input, type: 'Scan' })),
}));

describe('event-repository', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  describe('storeEvent', () => {
    it('should store an event with correct PK and SK', async () => {
      mockSend.mockResolvedValue({});

      const event: OrderEvent = {
        eventId: 'evt-001',
        eventType: 'order.created',
        payload: { items: ['item1'] },
        source: 'eventforge.api',
        timestamp: '2024-01-15T10:30:00.000Z',
        traceId: 'trace-123',
      };

      const result = await storeEvent('order-123', event);

      expect(result.PK).toBe('ORDER#order-123');
      expect(result.SK).toBe('EVENT#2024-01-15T10:30:00.000Z#evt-001');
      expect(result.orderId).toBe('order-123');
      expect(result.eventType).toBe('order.created');
      expect(result.payload).toEqual({ items: ['item1'] });
      expect(result.source).toBe('eventforge.api');
      expect(result.timestamp).toBe('2024-01-15T10:30:00.000Z');
      expect(result.traceId).toBe('trace-123');
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should store an event without traceId', async () => {
      mockSend.mockResolvedValue({});

      const event: OrderEvent = {
        eventId: 'evt-002',
        eventType: 'order.completed',
        payload: {},
        source: 'eventforge.workflow',
        timestamp: '2024-01-15T11:00:00.000Z',
      };

      const result = await storeEvent('order-456', event);

      expect(result.PK).toBe('ORDER#order-456');
      expect(result.SK).toBe('EVENT#2024-01-15T11:00:00.000Z#evt-002');
      expect(result.traceId).toBeUndefined();
    });
  });

  describe('getRecentEvents', () => {
    it('should return events sorted by timestamp descending', async () => {
      const items = [
        { PK: 'ORDER#o1', SK: 'EVENT#2024-01-15T09:00:00Z#e1', orderId: 'o1', eventId: 'e1', eventType: 'order.created', payload: {}, source: 'eventforge.api', timestamp: '2024-01-15T09:00:00Z' },
        { PK: 'ORDER#o2', SK: 'EVENT#2024-01-15T11:00:00Z#e2', orderId: 'o2', eventId: 'e2', eventType: 'order.completed', payload: {}, source: 'eventforge.workflow', timestamp: '2024-01-15T11:00:00Z' },
        { PK: 'ORDER#o3', SK: 'EVENT#2024-01-15T10:00:00Z#e3', orderId: 'o3', eventId: 'e3', eventType: 'inventory.reserved', payload: {}, source: 'eventforge.workflow', timestamp: '2024-01-15T10:00:00Z' },
      ];

      mockSend.mockResolvedValue({ Items: items });

      const result = await getRecentEvents(100);

      expect(result).toHaveLength(3);
      expect(result[0].timestamp).toBe('2024-01-15T11:00:00Z');
      expect(result[1].timestamp).toBe('2024-01-15T10:00:00Z');
      expect(result[2].timestamp).toBe('2024-01-15T09:00:00Z');
    });

    it('should cap results at the specified limit', async () => {
      const items = Array.from({ length: 10 }, (_, i) => ({
        PK: `ORDER#o${i}`,
        SK: `EVENT#2024-01-${String(i + 1).padStart(2, '0')}T00:00:00Z#e${i}`,
        orderId: `o${i}`,
        eventId: `e${i}`,
        eventType: 'order.created',
        payload: {},
        source: 'eventforge.api',
        timestamp: `2024-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
      }));

      mockSend.mockResolvedValue({ Items: items });

      const result = await getRecentEvents(5);

      expect(result).toHaveLength(5);
    });

    it('should enforce maximum limit of 100', async () => {
      mockSend.mockResolvedValue({ Items: [] });

      await getRecentEvents(200);

      // The ScanCommand should have been called with a limit based on 100 (not 200)
      const { ScanCommand } = require('@aws-sdk/lib-dynamodb');
      const lastCall = ScanCommand.mock.calls[ScanCommand.mock.calls.length - 1][0];
      expect(lastCall.Limit).toBe(300); // 100 * 3 over-fetch
    });

    it('should enforce minimum limit of 1', async () => {
      mockSend.mockResolvedValue({ Items: [] });

      await getRecentEvents(0);

      const { ScanCommand } = require('@aws-sdk/lib-dynamodb');
      const lastCall = ScanCommand.mock.calls[ScanCommand.mock.calls.length - 1][0];
      expect(lastCall.Limit).toBe(3); // 1 * 3 over-fetch
    });

    it('should return empty array when no events exist', async () => {
      mockSend.mockResolvedValue({ Items: [] });

      const result = await getRecentEvents();

      expect(result).toEqual([]);
    });
  });

  describe('getOrderEvents', () => {
    it('should query events for a specific order using correct key condition', async () => {
      const items = [
        { PK: 'ORDER#order-123', SK: 'EVENT#2024-01-15T11:00:00Z#e2', orderId: 'order-123', eventId: 'e2', eventType: 'order.completed', payload: {}, source: 'eventforge.workflow', timestamp: '2024-01-15T11:00:00Z' },
        { PK: 'ORDER#order-123', SK: 'EVENT#2024-01-15T10:00:00Z#e1', orderId: 'order-123', eventId: 'e1', eventType: 'order.created', payload: {}, source: 'eventforge.api', timestamp: '2024-01-15T10:00:00Z' },
      ];

      mockSend.mockResolvedValue({ Items: items });

      const result = await getOrderEvents('order-123');

      expect(result).toHaveLength(2);
      // Verify the QueryCommand was called with correct params
      const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
      const lastCall = QueryCommand.mock.calls[QueryCommand.mock.calls.length - 1][0];
      expect(lastCall.KeyConditionExpression).toBe('PK = :pk AND begins_with(SK, :skPrefix)');
      expect(lastCall.ExpressionAttributeValues[':pk']).toBe('ORDER#order-123');
      expect(lastCall.ExpressionAttributeValues[':skPrefix']).toBe('EVENT#');
      expect(lastCall.ScanIndexForward).toBe(false);
    });

    it('should return empty array when order has no events', async () => {
      mockSend.mockResolvedValue({ Items: [] });

      const result = await getOrderEvents('order-no-events');

      expect(result).toEqual([]);
    });

    it('should handle undefined Items in response', async () => {
      mockSend.mockResolvedValue({});

      const result = await getOrderEvents('order-missing');

      expect(result).toEqual([]);
    });
  });
});
