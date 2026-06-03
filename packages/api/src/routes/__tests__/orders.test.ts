/**
 * Unit tests for order routes.
 *
 * Tests the order CRUD endpoints with mocked dependencies.
 */

import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { orderRoutes, setS3Client } from '../orders';

// Declare the userId augmentation for tests
declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

// Mock dependencies
jest.mock('../../services/event-publisher', () => ({
  publishEvent: jest.fn().mockResolvedValue({ eventId: 'mock-event-id' }),
}));

jest.mock('../../services/dynamo-client', () => ({
  getDynamoClient: jest.fn().mockReturnValue({}),
}));

jest.mock('@eventforge/shared', () => ({
  createOrder: jest.fn().mockImplementation((_client, order) =>
    Promise.resolve({ order, created: true })
  ),
  getOrder: jest.fn(),
  getOrderWithEvents: jest.fn(),
  getUserOrders: jest.fn(),
}));

jest.mock('ulid', () => ({
  ulid: jest.fn().mockReturnValue('01HTEST000000000000000000'),
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(),
  HeadObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://s3.amazonaws.com/presigned-url'),
}));

import { publishEvent } from '../../services/event-publisher';
import {
  createOrder,
  getOrder,
  getOrderWithEvents,
  getUserOrders,
} from '@eventforge/shared';

// Create a test app with the order routes
function createTestApp() {
  const app = express();
  app.use(express.json());

  // Mock auth middleware - sets userId on request
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.userId = 'user-123';
    next();
  });

  app.use('/api/orders', orderRoutes);
  return app;
}

describe('Order Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    app = createTestApp();
    jest.clearAllMocks();
  });

  describe('POST /api/orders', () => {
    const validOrderBody = {
      userId: 'user-123',
      items: [
        { productId: 'prod-1', name: 'Widget', quantity: 2, price: 9.99 },
      ],
      total: 19.98,
    };

    it('should create an order and return 201', async () => {
      const response = await request(app)
        .post('/api/orders')
        .send(validOrderBody)
        .expect(201);

      expect(response.body).toHaveProperty('orderId');
      expect(response.body.status).toBe('pending');
      expect(response.body).toHaveProperty('createdAt');
    });

    it('should publish an order.created event', async () => {
      await request(app)
        .post('/api/orders')
        .send(validOrderBody)
        .expect(201);

      expect(publishEvent).toHaveBeenCalledWith(
        'eventforge.api',
        'order.created',
        expect.objectContaining({
          orderId: expect.any(String),
          userId: 'user-123',
          status: 'pending',
          timestamp: expect.any(String),
        })
      );
    });

    it('should return 400 for invalid request body', async () => {
      const response = await request(app)
        .post('/api/orders')
        .send({ userId: '', items: [], total: -1 })
        .expect(400);

      expect(response.body.error).toBe('Bad Request');
      expect(response.body.violations).toBeDefined();
      expect(response.body.violations.length).toBeGreaterThan(0);
    });

    it('should return 400 when body is missing', async () => {
      const response = await request(app)
        .post('/api/orders')
        .send({})
        .expect(400);

      expect(response.body.error).toBe('Bad Request');
    });

    it('should return 500 when createOrder fails', async () => {
      (createOrder as jest.Mock).mockRejectedValueOnce(new Error('DynamoDB error'));

      const response = await request(app)
        .post('/api/orders')
        .send(validOrderBody)
        .expect(500);

      expect(response.body.error).toBe('Internal Server Error');
    });
  });

  describe('GET /api/orders', () => {
    it('should return user orders', async () => {
      const mockOrders = [
        {
          orderId: 'order-1',
          userId: 'user-123',
          status: 'completed',
          items: [],
          total: 50.0,
          createdAt: '2024-01-02T00:00:00.000Z',
          updatedAt: '2024-01-02T00:00:00.000Z',
        },
        {
          orderId: 'order-2',
          userId: 'user-123',
          status: 'pending',
          items: [],
          total: 25.0,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ];

      (getUserOrders as jest.Mock).mockResolvedValueOnce(mockOrders);

      const response = await request(app)
        .get('/api/orders')
        .expect(200);

      expect(response.body.orders).toHaveLength(2);
      expect(response.body.orders[0].orderId).toBe('order-1');
    });

    it('should return empty array when user has no orders', async () => {
      (getUserOrders as jest.Mock).mockResolvedValueOnce([]);

      const response = await request(app)
        .get('/api/orders')
        .expect(200);

      expect(response.body.orders).toHaveLength(0);
    });

    it('should call getUserOrders with userId and limit 50', async () => {
      (getUserOrders as jest.Mock).mockResolvedValueOnce([]);

      await request(app).get('/api/orders').expect(200);

      expect(getUserOrders).toHaveBeenCalledWith(expect.anything(), 'user-123', 50);
    });

    it('should return 500 when getUserOrders fails', async () => {
      (getUserOrders as jest.Mock).mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app)
        .get('/api/orders')
        .expect(500);

      expect(response.body.error).toBe('Internal Server Error');
    });
  });

  describe('GET /api/orders/:id', () => {
    const mockOrderWithEvents = {
      orderId: 'order-1',
      userId: 'user-123',
      status: 'completed',
      items: [{ productId: 'prod-1', name: 'Widget', quantity: 1, price: 10.0 }],
      total: 10.0,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      events: [
        {
          eventType: 'order.created',
          payload: {},
          source: 'eventforge.api',
          timestamp: '2024-01-01T00:00:00.000Z',
        },
      ],
    };

    it('should return order with events', async () => {
      (getOrderWithEvents as jest.Mock).mockResolvedValueOnce(mockOrderWithEvents);

      const response = await request(app)
        .get('/api/orders/order-1')
        .expect(200);

      expect(response.body.orderId).toBe('order-1');
      expect(response.body.events).toHaveLength(1);
    });

    it('should return 404 when order does not exist', async () => {
      (getOrderWithEvents as jest.Mock).mockResolvedValueOnce(null);

      const response = await request(app)
        .get('/api/orders/nonexistent')
        .expect(404);

      expect(response.body.error).toBe('Not Found');
    });

    it('should return 403 when order belongs to another user', async () => {
      const otherUserOrder = { ...mockOrderWithEvents, userId: 'other-user' };
      (getOrderWithEvents as jest.Mock).mockResolvedValueOnce(otherUserOrder);

      const response = await request(app)
        .get('/api/orders/order-1')
        .expect(403);

      expect(response.body.error).toBe('Forbidden');
    });

    it('should return 500 when getOrderWithEvents fails', async () => {
      (getOrderWithEvents as jest.Mock).mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app)
        .get('/api/orders/order-1')
        .expect(500);

      expect(response.body.error).toBe('Internal Server Error');
    });
  });

  describe('GET /api/orders/:id/receipt', () => {
    beforeEach(() => {
      // Mock S3 client
      const mockS3Client = {
        send: jest.fn(),
      };
      setS3Client(mockS3Client as any);
    });

    it('should return 404 when order does not exist', async () => {
      (getOrder as jest.Mock).mockResolvedValueOnce(null);

      const response = await request(app)
        .get('/api/orders/order-1/receipt')
        .expect(404);

      expect(response.body.error).toBe('Not Found');
      expect(response.body.message).toBe('Order not found');
    });

    it('should return 403 when order belongs to another user', async () => {
      (getOrder as jest.Mock).mockResolvedValueOnce({
        orderId: 'order-1',
        userId: 'other-user',
        status: 'completed',
        items: [],
        total: 10.0,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      const response = await request(app)
        .get('/api/orders/order-1/receipt')
        .expect(403);

      expect(response.body.error).toBe('Forbidden');
    });

    it('should return 404 when receipt does not exist in S3', async () => {
      (getOrder as jest.Mock).mockResolvedValueOnce({
        orderId: 'order-1',
        userId: 'user-123',
        status: 'completed',
        items: [],
        total: 10.0,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      const notFoundError = new Error('Not Found');
      notFoundError.name = 'NotFound';
      const mockS3Client = { send: jest.fn().mockRejectedValueOnce(notFoundError) };
      setS3Client(mockS3Client as any);

      const response = await request(app)
        .get('/api/orders/order-1/receipt')
        .expect(404);

      expect(response.body.message).toBe('Receipt not yet available');
    });

    it('should return 500 when S3 throws unexpected error', async () => {
      (getOrder as jest.Mock).mockResolvedValueOnce({
        orderId: 'order-1',
        userId: 'user-123',
        status: 'completed',
        items: [],
        total: 10.0,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      const unexpectedError = new Error('Access Denied');
      unexpectedError.name = 'AccessDenied';
      const mockS3Client = { send: jest.fn().mockRejectedValueOnce(unexpectedError) };
      setS3Client(mockS3Client as any);

      const response = await request(app)
        .get('/api/orders/order-1/receipt')
        .expect(500);

      expect(response.body.error).toBe('Internal Server Error');
    });
  });
});
