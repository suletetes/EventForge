import { handler } from '../charge-payment';

describe('ChargePayment Lambda', () => {
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

  it('should return payment confirmation with transactionId for valid total', async () => {
    const result = await handler(validInput);

    expect(result.orderId).toBe(validInput.orderId);
    expect(result.userId).toBe(validInput.userId);
    expect(result.items).toEqual(validInput.items);
    expect(result.total).toBe(validInput.total);
    expect(result.status).toBe(validInput.status);
    expect(result.transactionId).toBeDefined();
    expect(typeof result.transactionId).toBe('string');
    expect(result.transactionId.length).toBe(26);
  });

  it('should pass through full order context', async () => {
    const result = await handler(validInput);

    // All original fields must be preserved
    expect(result.orderId).toBe(validInput.orderId);
    expect(result.userId).toBe(validInput.userId);
    expect(result.items).toEqual(validInput.items);
    expect(result.total).toBe(validInput.total);
    expect(result.status).toBe(validInput.status);
  });

  it('should generate unique transactionIds for each call', async () => {
    const result1 = await handler(validInput);
    const result2 = await handler(validInput);

    expect(result1.transactionId).not.toBe(result2.transactionId);
  });

  it('should succeed for total exactly at 500000', async () => {
    const input = { ...validInput, total: 500000 };
    const result = await handler(input);

    expect(result.transactionId).toBeDefined();
    expect(result.total).toBe(500000);
  });

  it('should throw error when total exceeds 500000', async () => {
    const input = { ...validInput, total: 500001 };

    await expect(handler(input)).rejects.toThrow(
      'Payment declined: amount 500001 exceeds maximum allowed transaction limit'
    );
  });

  it('should throw error for very large totals', async () => {
    const input = { ...validInput, total: 999999.99 };

    await expect(handler(input)).rejects.toThrow('Payment declined');
  });

  it('should generate a ULID-format transactionId (26 chars, Crockford Base32)', async () => {
    const result = await handler(validInput);
    const ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/;

    expect(result.transactionId).toMatch(ulidRegex);
  });
});
