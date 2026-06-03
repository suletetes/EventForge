import { randomBytes } from 'crypto';

/**
 * ChargePayment Lambda function
 *
 * Step Functions workflow step that simulates charging a payment via an external gateway.
 * - Succeeds for totals <= 500000
 * - Fails for totals > 500000 (triggers saga compensation via ReleaseInventory)
 * - Generates a mock transactionId (ULID format)
 * - Passes through full order context
 *
 * Requirements: 4.1, 4.4, 4.6
 */

interface OrderItem {
  productId: string;
  name: string;
  quantity: number;
  price: number;
}

interface ChargePaymentInput {
  orderId: string;
  userId: string;
  items: OrderItem[];
  total: number;
  status: string;
}

interface ChargePaymentOutput extends ChargePaymentInput {
  transactionId: string;
}

/**
 * Generates a ULID (Universally Unique Lexicographically Sortable Identifier).
 * Uses timestamp (48 bits) + randomness (80 bits) encoded in Crockford Base32.
 */
function generateUlid(): string {
  const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const ENCODING_LEN = ENCODING.length;
  const TIME_LEN = 10;
  const RANDOM_LEN = 16;

  const now = Date.now();
  let timeStr = '';
  let remaining = now;

  for (let i = TIME_LEN - 1; i >= 0; i--) {
    timeStr = ENCODING[remaining % ENCODING_LEN] + timeStr;
    remaining = Math.floor(remaining / ENCODING_LEN);
  }

  const bytes = randomBytes(10);
  let randomStr = '';
  for (let i = 0; i < RANDOM_LEN; i++) {
    const byteIndex = Math.floor((i * 10) / RANDOM_LEN);
    randomStr += ENCODING[bytes[byteIndex] % ENCODING_LEN];
  }

  return timeStr + randomStr;
}

export const handler = async (event: ChargePaymentInput): Promise<ChargePaymentOutput> => {
  const { orderId, userId, items, total, status } = event;

  console.log(`Processing payment for order ${orderId}, total: ${total}`);

  // Simulate payment gateway call
  // Mock behavior: fail if total exceeds 500000 (triggers compensation)
  if (total > 500000) {
    console.error(`Payment failed for order ${orderId}: amount ${total} exceeds gateway limit`);
    throw new Error(
      `Payment declined: amount ${total} exceeds maximum allowed transaction limit`
    );
  }

  // Simulate successful payment processing
  const transactionId = generateUlid();

  console.log(`Payment successful for order ${orderId}, transactionId: ${transactionId}`);

  // Return full order context with transaction ID appended
  return {
    orderId,
    userId,
    items,
    total,
    status,
    transactionId,
  };
};
