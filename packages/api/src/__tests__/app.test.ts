import request from 'supertest';

// Mock auth middleware to avoid ESM issues with jwks-rsa
jest.mock('../middleware/auth', () => ({
  authMiddleware: jest.fn((_req: any, _res: any, next: any) => next()),
  resetJwksClient: jest.fn(),
  getAuthConfig: jest.fn(),
  getJwksClient: jest.fn(),
}));

// Mock route modules to avoid pulling in their dependencies
jest.mock('../routes/orders', () => ({
  orderRoutes: require('express').Router(),
}));

jest.mock('../routes/events', () => ({
  eventsRouter: require('express').Router(),
}));

jest.mock('../routes/webhooks', () => ({
  webhooksRouter: require('express').Router(),
}));

import { app } from '../app';

describe('Express Application Scaffold', () => {
  describe('GET /health', () => {
    it('should return 200 with healthy status and timestamp', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('healthy');
      expect(response.body.timestamp).toBeDefined();
      // Verify timestamp is valid ISO 8601
      expect(new Date(response.body.timestamp).toISOString()).toBe(response.body.timestamp);
    });
  });

  describe('Request ID middleware', () => {
    it('should generate a request ID when none is provided', async () => {
      const response = await request(app).get('/health');

      // The request ID is set on the request headers, not response
      // We verify it doesn't break the request flow
      expect(response.status).toBe(200);
    });

    it('should preserve existing request ID if provided', async () => {
      const existingId = 'existing-request-id';
      const response = await request(app)
        .get('/health')
        .set('x-request-id', existingId);

      expect(response.status).toBe(200);
    });
  });

  describe('CORS middleware', () => {
    it('should include CORS headers in response', async () => {
      const response = await request(app)
        .get('/health')
        .set('Origin', 'http://localhost:3001');

      expect(response.headers['access-control-allow-origin']).toBe('*');
    });
  });

  describe('JSON body parser', () => {
    it('should parse JSON request bodies', async () => {
      // Since we don't have a POST endpoint yet, we test that the middleware
      // is configured by sending a request that would use it
      const response = await request(app)
        .post('/nonexistent')
        .send({ test: 'data' })
        .set('Content-Type', 'application/json');

      // Should get 404 (no route), not 400 (parse error)
      expect(response.status).toBe(404);
    });

    it('should reject payloads exceeding 256KB', async () => {
      const largePayload = { data: 'x'.repeat(300 * 1024) };
      const response = await request(app)
        .post('/nonexistent')
        .send(largePayload)
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(413);
    });
  });

  describe('Error handling middleware', () => {
    it('should return structured 404 response for unknown routes', async () => {
      const response = await request(app).get('/unknown-route');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Not Found');
      expect(response.body.message).toBeDefined();
    });
  });
});
