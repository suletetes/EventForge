/**
 * Order Routes - Express router for order management endpoints.
 *
 * Handles:
 * - POST /api/orders: Create a new order
 * - GET /api/orders: List user's orders
 * - GET /api/orders/:id: Get order details with events
 * - GET /api/orders/:id/receipt: Get presigned URL for receipt PDF
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.8, 2.10
 */

import { Router, Request, Response } from 'express';
import { ulid } from 'ulid';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { validateOrderRequest } from '../validators/order-validator';
import { publishEvent } from '../services/event-publisher';
import {
  createOrder,
  getOrder,
  getOrderWithEvents,
  getUserOrders,
  Order,
} from '@eventforge/shared';
import { getDynamoClient } from '../services/dynamo-client';

const RECEIPTS_BUCKET = process.env.RECEIPTS_BUCKET || 'eventforge-receipts';

let s3ClientInstance: S3Client | null = null;

export function getS3Client(): S3Client {
  if (!s3ClientInstance) {
    s3ClientInstance = new S3Client({});
  }
  return s3ClientInstance;
}

export function setS3Client(client: S3Client): void {
  s3ClientInstance = client;
}

const router = Router();

/**
 * POST /api/orders
 * Creates a new order with idempotency protection.
 * Validates body → generates orderId (ULID) → creates order → publishes event → returns 201
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const validation = validateOrderRequest(req.body);

  if (!validation.valid) {
    res.status(400).json({
      error: 'Bad Request',
      message: 'Validation failed',
      violations: validation.errors,
    });
    return;
  }

  const { order: validatedOrder } = validation;
  const orderId = ulid();
  const now = new Date().toISOString();
  const idempotencyKeyValue = req.headers['x-idempotency-key'] as string || orderId;

  const order: Order = {
    orderId,
    userId: req.userId!,
    status: 'pending',
    items: validatedOrder.items,
    total: validatedOrder.total,
    createdAt: now,
    updatedAt: now,
  };

  try {
    const client = getDynamoClient();
    const result = await createOrder(client, order, idempotencyKeyValue);

    // Publish order.created event
    await publishEvent('eventforge.api', 'order.created', {
      orderId: result.order.orderId,
      userId: result.order.userId,
      status: result.order.status,
      timestamp: result.order.createdAt,
    });

    res.status(201).json({
      orderId: result.order.orderId,
      status: result.order.status,
      createdAt: result.order.createdAt,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to create order',
    });
  }
});

/**
 * GET /api/orders
 * Returns the authenticated user's orders sorted by creation date descending, max 50.
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const userId = req.userId!;

  try {
    const client = getDynamoClient();
    const orders = await getUserOrders(client, userId, 50);

    res.status(200).json({ orders });
  } catch (error) {
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to retrieve orders',
    });
  }
});

/**
 * GET /api/orders/:id
 * Returns order details with events. Verifies ownership (403 if not owner).
 */
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  const userId = req.userId!;

  try {
    const client = getDynamoClient();
    const orderWithEvents = await getOrderWithEvents(client, id);

    if (!orderWithEvents) {
      res.status(404).json({
        error: 'Not Found',
        message: 'Order not found',
      });
      return;
    }

    // Verify ownership
    if (orderWithEvents.userId !== userId) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'You do not have permission to access this resource',
      });
      return;
    }

    res.status(200).json(orderWithEvents);
  } catch (error) {
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to retrieve order',
    });
  }
});

/**
 * GET /api/orders/:id/receipt
 * Checks if receipt PDF exists in S3, generates presigned URL (15 min expiry).
 * Returns 404 if receipt not yet generated.
 */
router.get('/:id/receipt', async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  const userId = req.userId!;

  try {
    // First verify the order exists and belongs to the user
    const client = getDynamoClient();
    const order = await getOrder(client, id);

    if (!order) {
      res.status(404).json({
        error: 'Not Found',
        message: 'Order not found',
      });
      return;
    }

    if (order.userId !== userId) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'You do not have permission to access this resource',
      });
      return;
    }

    // Check if receipt exists in S3
    const s3Client = getS3Client();
    const receiptKey = `receipts/${id}.pdf`;

    try {
      await s3Client.send(
        new HeadObjectCommand({
          Bucket: RECEIPTS_BUCKET,
          Key: receiptKey,
        })
      );
    } catch (headError: unknown) {
      // If the object doesn't exist, return 404
      if (headError instanceof Error && headError.name === 'NotFound') {
        res.status(404).json({
          error: 'Not Found',
          message: 'Receipt not yet available',
        });
        return;
      }
      // Also handle the case where the error code is NoSuchKey
      if (headError instanceof Error && (headError as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) {
        res.status(404).json({
          error: 'Not Found',
          message: 'Receipt not yet available',
        });
        return;
      }
      throw headError;
    }

    // Generate presigned URL with 15-minute expiry
    const command = new GetObjectCommand({
      Bucket: RECEIPTS_BUCKET,
      Key: receiptKey,
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn: 900 }); // 15 minutes

    res.status(200).json({ url });
  } catch (error) {
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to retrieve receipt',
    });
  }
});

export { router as orderRoutes };
