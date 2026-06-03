import { validateOrderRequest } from '../order-validator';

describe('Order Validator', () => {
  const validOrder = {
    userId: 'user-123',
    items: [
      { productId: 'prod-1', name: 'Widget', quantity: 2, price: 9.99 },
    ],
    total: 19.98,
  };

  describe('valid orders', () => {
    it('accepts a valid order with one item', () => {
      const result = validateOrderRequest(validOrder);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.order.userId).toBe('user-123');
        expect(result.order.items).toHaveLength(1);
        expect(result.order.total).toBe(19.98);
      }
    });

    it('accepts a valid order with 50 items', () => {
      const items = Array.from({ length: 50 }, (_, i) => ({
        productId: `prod-${i}`,
        name: `Item ${i}`,
        quantity: 1,
        price: 1.0,
      }));
      const result = validateOrderRequest({ userId: 'user-1', items, total: 50.0 });
      expect(result.valid).toBe(true);
    });

    it('accepts minimum total of 0.01', () => {
      const result = validateOrderRequest({
        ...validOrder,
        total: 0.01,
      });
      expect(result.valid).toBe(true);
    });

    it('accepts maximum total of 999999.99', () => {
      const result = validateOrderRequest({
        ...validOrder,
        total: 999999.99,
      });
      expect(result.valid).toBe(true);
    });

    it('trims whitespace from string fields', () => {
      const result = validateOrderRequest({
        userId: '  user-123  ',
        items: [
          { productId: '  prod-1  ', name: '  Widget  ', quantity: 1, price: 5.0 },
        ],
        total: 5.0,
      });
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.order.userId).toBe('user-123');
        expect(result.order.items[0].productId).toBe('prod-1');
        expect(result.order.items[0].name).toBe('Widget');
      }
    });
  });

  describe('userId validation', () => {
    it('rejects missing userId', () => {
      const { userId, ...noUserId } = validOrder;
      const result = validateOrderRequest(noUserId);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('userId is required and must be a non-empty string');
      }
    });

    it('rejects empty string userId', () => {
      const result = validateOrderRequest({ ...validOrder, userId: '' });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('userId is required and must be a non-empty string');
      }
    });

    it('rejects whitespace-only userId', () => {
      const result = validateOrderRequest({ ...validOrder, userId: '   ' });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('userId is required and must be a non-empty string');
      }
    });

    it('rejects non-string userId', () => {
      const result = validateOrderRequest({ ...validOrder, userId: 123 });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('userId is required and must be a non-empty string');
      }
    });
  });

  describe('items validation', () => {
    it('rejects missing items', () => {
      const { items, ...noItems } = validOrder;
      const result = validateOrderRequest(noItems);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('items must be a non-empty array with at most 50 items');
      }
    });

    it('rejects empty items array', () => {
      const result = validateOrderRequest({ ...validOrder, items: [] });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('items must be a non-empty array with at most 50 items');
      }
    });

    it('rejects more than 50 items', () => {
      const items = Array.from({ length: 51 }, (_, i) => ({
        productId: `prod-${i}`,
        name: `Item ${i}`,
        quantity: 1,
        price: 1.0,
      }));
      const result = validateOrderRequest({ ...validOrder, items });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('items must be a non-empty array with at most 50 items');
      }
    });

    it('rejects items that are not an array', () => {
      const result = validateOrderRequest({ ...validOrder, items: 'not-array' });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('items must be a non-empty array with at most 50 items');
      }
    });
  });

  describe('item field validation', () => {
    it('rejects item with missing productId', () => {
      const result = validateOrderRequest({
        ...validOrder,
        items: [{ name: 'Widget', quantity: 1, price: 5.0 }],
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('items[0].productId is required and must be a non-empty string');
      }
    });

    it('rejects item with missing name', () => {
      const result = validateOrderRequest({
        ...validOrder,
        items: [{ productId: 'prod-1', quantity: 1, price: 5.0 }],
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('items[0].name is required and must be a non-empty string');
      }
    });

    it('rejects item with quantity less than 1', () => {
      const result = validateOrderRequest({
        ...validOrder,
        items: [{ productId: 'prod-1', name: 'Widget', quantity: 0, price: 5.0 }],
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('items[0].quantity must be an integer >= 1');
      }
    });

    it('rejects item with non-integer quantity', () => {
      const result = validateOrderRequest({
        ...validOrder,
        items: [{ productId: 'prod-1', name: 'Widget', quantity: 1.5, price: 5.0 }],
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('items[0].quantity must be an integer >= 1');
      }
    });

    it('rejects item with price of 0', () => {
      const result = validateOrderRequest({
        ...validOrder,
        items: [{ productId: 'prod-1', name: 'Widget', quantity: 1, price: 0 }],
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('items[0].price must be a number > 0');
      }
    });

    it('rejects item with negative price', () => {
      const result = validateOrderRequest({
        ...validOrder,
        items: [{ productId: 'prod-1', name: 'Widget', quantity: 1, price: -5 }],
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('items[0].price must be a number > 0');
      }
    });

    it('reports errors for correct item index', () => {
      const result = validateOrderRequest({
        ...validOrder,
        items: [
          { productId: 'prod-1', name: 'Widget', quantity: 1, price: 5.0 },
          { productId: 'prod-2', name: 'Gadget', quantity: 1, price: 5.0 },
          { productId: '', name: 'Bad', quantity: 0, price: -1 },
        ],
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('items[2].productId is required and must be a non-empty string');
        expect(result.errors).toContain('items[2].quantity must be an integer >= 1');
        expect(result.errors).toContain('items[2].price must be a number > 0');
      }
    });
  });

  describe('total validation', () => {
    it('rejects missing total', () => {
      const { total, ...noTotal } = validOrder;
      const result = validateOrderRequest(noTotal);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('total must be a number between 0.01 and 999999.99');
      }
    });

    it('rejects total below 0.01', () => {
      const result = validateOrderRequest({ ...validOrder, total: 0.001 });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('total must be a number between 0.01 and 999999.99');
      }
    });

    it('rejects total above 999999.99', () => {
      const result = validateOrderRequest({ ...validOrder, total: 1000000 });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('total must be a number between 0.01 and 999999.99');
      }
    });

    it('rejects non-number total', () => {
      const result = validateOrderRequest({ ...validOrder, total: '19.98' });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('total must be a number between 0.01 and 999999.99');
      }
    });

    it('rejects NaN total', () => {
      const result = validateOrderRequest({ ...validOrder, total: NaN });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('total must be a number between 0.01 and 999999.99');
      }
    });

    it('rejects Infinity total', () => {
      const result = validateOrderRequest({ ...validOrder, total: Infinity });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('total must be a number between 0.01 and 999999.99');
      }
    });
  });

  describe('request body validation', () => {
    it('rejects null body', () => {
      const result = validateOrderRequest(null);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('request body must be a JSON object');
      }
    });

    it('rejects undefined body', () => {
      const result = validateOrderRequest(undefined);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('request body must be a JSON object');
      }
    });

    it('rejects array body', () => {
      const result = validateOrderRequest([]);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('request body must be a JSON object');
      }
    });

    it('rejects string body', () => {
      const result = validateOrderRequest('not an object');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('request body must be a JSON object');
      }
    });
  });

  describe('multiple errors', () => {
    it('collects all validation errors at once', () => {
      const result = validateOrderRequest({
        userId: '',
        items: [],
        total: -1,
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.length).toBeGreaterThanOrEqual(3);
        expect(result.errors).toContain('userId is required and must be a non-empty string');
        expect(result.errors).toContain('items must be a non-empty array with at most 50 items');
        expect(result.errors).toContain('total must be a number between 0.01 and 999999.99');
      }
    });
  });
});
