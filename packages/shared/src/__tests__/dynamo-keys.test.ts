import {
  orderKey,
  orderMetadataSK,
  orderEventSK,
  userKey,
  userOrderSK,
  idempotencyKey,
  idempotencyLockSK,
} from '../dynamo-keys';

describe('DynamoDB key construction utilities', () => {
  describe('orderKey', () => {
    it('should construct ORDER#{orderId} pattern', () => {
      expect(orderKey('abc-123')).toBe('ORDER#abc-123');
    });

    it('should handle ULID-style order IDs', () => {
      expect(orderKey('01HXYZ1234567890ABCDEF')).toBe('ORDER#01HXYZ1234567890ABCDEF');
    });
  });

  describe('orderMetadataSK', () => {
    it('should return METADATA', () => {
      expect(orderMetadataSK()).toBe('METADATA');
    });
  });

  describe('orderEventSK', () => {
    it('should construct EVENT#{timestamp}#{eventId} pattern', () => {
      expect(orderEventSK('2024-01-15T10:30:00.000Z', 'evt-001')).toBe(
        'EVENT#2024-01-15T10:30:00.000Z#evt-001'
      );
    });
  });

  describe('userKey', () => {
    it('should construct USER#{userId} pattern', () => {
      expect(userKey('user-456')).toBe('USER#user-456');
    });
  });

  describe('userOrderSK', () => {
    it('should construct ORDER#{orderId} pattern', () => {
      expect(userOrderSK('order-789')).toBe('ORDER#order-789');
    });
  });

  describe('idempotencyKey', () => {
    it('should construct IDEMPOTENCY#{key} pattern', () => {
      expect(idempotencyKey('req-abc-123')).toBe('IDEMPOTENCY#req-abc-123');
    });
  });

  describe('idempotencyLockSK', () => {
    it('should return LOCK', () => {
      expect(idempotencyLockSK()).toBe('LOCK');
    });
  });
});
