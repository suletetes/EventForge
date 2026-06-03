import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { ulid } from 'ulid';
import { authMiddleware } from './middleware/auth';
import { orderRoutes } from './routes/orders';
import { webhooksRouter } from './routes/webhooks';
import { eventsRouter } from './routes/events';

const app = express();

// CORS middleware
app.use(cors());

// JSON body parser with 256KB limit
app.use(express.json({ limit: '256kb' }));

// Request ID generation middleware (ULID)
app.use((req: Request, _res: Response, next: NextFunction) => {
  req.headers['x-request-id'] = req.headers['x-request-id'] || ulid();
  next();
});

// Health endpoint - no auth, no X-Ray
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
});

// Apply auth middleware to all routes below
app.use(authMiddleware);

// Order routes (protected)
app.use('/api/orders', orderRoutes);

// Webhook routes (protected)
app.use('/api/webhooks', webhooksRouter);

// Events routes (protected)
app.use('/api/events', eventsRouter);

// 404 catch-all for unmatched routes
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
    message: 'The requested resource was not found',
  });
});

// Error handling middleware returning structured error responses
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error & { statusCode?: number; violations?: string[] }, _req: Request, res: Response, _next: NextFunction) => {
  const statusCode = err.statusCode || 500;
  const message = statusCode === 500 ? 'Internal Server Error' : err.message;

  const body: Record<string, unknown> = {
    error: statusCode === 400 ? 'Bad Request'
      : statusCode === 401 ? 'Unauthorized'
      : statusCode === 403 ? 'Forbidden'
      : statusCode === 404 ? 'Not Found'
      : 'Internal Server Error',
    message,
  };

  if (err.violations) {
    body.violations = err.violations;
  }

  res.status(statusCode).json(body);
});

export { app };
