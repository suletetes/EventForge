/**
 * Unit tests for events route.
 *
 * Tests the GET /api/events endpoint with mocked dependencies.
 */

import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';

// Declare the userId augmentation for tests
declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

const mockGetRecentEvents = jest.fn();

jest.mock('@eventforge/shared', () => ({
  getRecentEvents: (...args: unknown[]) => mockGetRecentEvents(...args),
}));

import { eventsRouter } from '../events';

function createTestApp() {
  const app = express();
  app.use(express.json());

  // Mock auth middleware - sets userId on request
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.userId = 'user-123';
    next();
  });

  app.use('/api/events', eventsRouter);

  // Error handling middleware (mirrors app.ts)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: 'Internal Server Error' });
  });

  return app;
}

describe('Events Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    app = createTestApp();
    jest.clearAllMocks();
  });

  describe('GET /api/events', () => {
    it('should return most recent 100 events wrapped in events property', async () => {
      const mockEvents = [
        {
          PK: 'ORDER#order-1',
          SK: 'EVENT#2024-01-02T00:00:00.000Z#evt-1',
          orderId: 'order-1',
          eventId: 'evt-1',
          eventType: 'order.created',
          payload: {},
          source: 'eventforge.api',
          timestamp: '2024-01-02T00:00:00.000Z',
        },
        {
          PK: 'ORDER#order-2',
          SK: 'EVENT#2024-01-01T00:00:00.000Z#evt-2',
          orderId: 'order-2',
          eventId: 'evt-2',
          eventType: 'order.completed',
          payload: {},
          source: 'eventforge.workflow',
          timestamp: '2024-01-01T00:00:00.000Z',
        },
      ];

      mockGetRecentEvents.mockResolvedValueOnce(mockEvents);

      const response = await request(app)
        .get('/api/events')
        .expect(200);

      expect(response.body.events).toHaveLength(2);
      expect(response.body.events[0].eventType).toBe('order.created');
      expect(response.body.events[1].eventType).toBe('order.completed');
    });

    it('should call getRecentEvents with limit 100', async () => {
      mockGetRecentEvents.mockResolvedValueOnce([]);

      await request(app).get('/api/events').expect(200);

      expect(mockGetRecentEvents).toHaveBeenCalledWith(100);
    });

    it('should return empty events array when no events exist', async () => {
      mockGetRecentEvents.mockResolvedValueOnce([]);

      const response = await request(app)
        .get('/api/events')
        .expect(200);

      expect(response.body.events).toHaveLength(0);
    });

    it('should return 500 when getRecentEvents fails', async () => {
      mockGetRecentEvents.mockRejectedValueOnce(new Error('DynamoDB error'));

      const response = await request(app)
        .get('/api/events')
        .expect(500);

      expect(response.body.error).toBe('Internal Server Error');
    });
  });
});
