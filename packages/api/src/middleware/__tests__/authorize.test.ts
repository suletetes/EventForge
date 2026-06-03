import { Request, Response, NextFunction } from 'express';
import { authorizeOwner, ResourceOwnerExtractor } from '../authorize';

// Augment Express Request type for tests (mirrors auth.ts augmentation)
declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

// Test helpers
function createMockRequest(userId?: string, params: Record<string, string> = {}): Request {
  return {
    userId,
    params,
    path: '/api/orders/order-123',
    headers: {},
  } as unknown as Request;
}

function createMockResponse(): {
  res: Partial<Response>;
  getStatusCode: () => number | null;
  getJsonBody: () => unknown;
} {
  let statusCode: number | null = null;
  let jsonBody: unknown = null;

  const res: Partial<Response> = {
    status: jest.fn(function (this: Response, code: number) {
      statusCode = code;
      return this;
    }) as unknown as Response['status'],
    json: jest.fn(function (this: Response, body: unknown) {
      jsonBody = body;
      return this;
    }) as unknown as Response['json'],
  };

  return {
    res,
    getStatusCode: () => statusCode,
    getJsonBody: () => jsonBody,
  };
}

describe('authorizeOwner', () => {
  describe('when user matches resource owner', () => {
    it('should call next() when userId matches the resource owner', async () => {
      const extractor: ResourceOwnerExtractor = async () => 'user-123';
      const middleware = authorizeOwner(extractor);

      const req = createMockRequest('user-123');
      const { res } = createMockResponse();
      const next: NextFunction = jest.fn();

      await middleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should not return any error response when authorized', async () => {
      const extractor: ResourceOwnerExtractor = async () => 'user-abc';
      const middleware = authorizeOwner(extractor);

      const req = createMockRequest('user-abc');
      const { res } = createMockResponse();
      const next: NextFunction = jest.fn();

      await middleware(req as Request, res as Response, next);

      expect(res.json).not.toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('when user does not match resource owner', () => {
    it('should return 403 Forbidden when userId differs from resource owner', async () => {
      const extractor: ResourceOwnerExtractor = async () => 'user-456';
      const middleware = authorizeOwner(extractor);

      const req = createMockRequest('user-123');
      const { res, getStatusCode, getJsonBody } = createMockResponse();
      const next: NextFunction = jest.fn();

      await middleware(req as Request, res as Response, next);

      expect(getStatusCode()).toBe(403);
      expect(getJsonBody()).toEqual({
        error: 'Forbidden',
        message: 'You do not have permission to access this resource',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should return structured error with "Forbidden" error field', async () => {
      const extractor: ResourceOwnerExtractor = async () => 'other-user';
      const middleware = authorizeOwner(extractor);

      const req = createMockRequest('current-user');
      const { res, getJsonBody } = createMockResponse();
      const next: NextFunction = jest.fn();

      await middleware(req as Request, res as Response, next);

      const body = getJsonBody() as { error: string; message: string };
      expect(body.error).toBe('Forbidden');
      expect(body.message).toBeTruthy();
    });
  });

  describe('when resource owner cannot be determined', () => {
    it('should call next() when extractor returns undefined', async () => {
      const extractor: ResourceOwnerExtractor = async () => undefined;
      const middleware = authorizeOwner(extractor);

      const req = createMockRequest('user-123');
      const { res } = createMockResponse();
      const next: NextFunction = jest.fn();

      await middleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should call next() when extractor returns null', async () => {
      const extractor: ResourceOwnerExtractor = async () => null;
      const middleware = authorizeOwner(extractor);

      const req = createMockRequest('user-123');
      const { res } = createMockResponse();
      const next: NextFunction = jest.fn();

      await middleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith();
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('when extractor throws an error', () => {
    it('should pass the error to next()', async () => {
      const testError = new Error('Database connection failed');
      const extractor: ResourceOwnerExtractor = async () => {
        throw testError;
      };
      const middleware = authorizeOwner(extractor);

      const req = createMockRequest('user-123');
      const { res } = createMockResponse();
      const next: NextFunction = jest.fn();

      await middleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(testError);
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('extractor receives the request object', () => {
    it('should pass the request to the extractor for resource lookup', async () => {
      const extractor: ResourceOwnerExtractor = jest.fn(async (req: Request) => {
        // Simulate looking up a resource by params
        return req.params.id === 'order-123' ? 'user-123' : 'unknown';
      });
      const middleware = authorizeOwner(extractor);

      const req = createMockRequest('user-123', { id: 'order-123' });
      const { res } = createMockResponse();
      const next: NextFunction = jest.fn();

      await middleware(req as Request, res as Response, next);

      expect(extractor).toHaveBeenCalledWith(req);
      expect(next).toHaveBeenCalledWith();
    });
  });

  describe('edge cases', () => {
    it('should return 403 when req.userId is undefined and owner exists', async () => {
      const extractor: ResourceOwnerExtractor = async () => 'user-456';
      const middleware = authorizeOwner(extractor);

      const req = createMockRequest(undefined);
      const { res, getStatusCode } = createMockResponse();
      const next: NextFunction = jest.fn();

      await middleware(req as Request, res as Response, next);

      expect(getStatusCode()).toBe(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('should handle empty string userId comparison correctly', async () => {
      const extractor: ResourceOwnerExtractor = async () => 'user-123';
      const middleware = authorizeOwner(extractor);

      const req = createMockRequest('');
      const { res, getStatusCode } = createMockResponse();
      const next: NextFunction = jest.fn();

      await middleware(req as Request, res as Response, next);

      expect(getStatusCode()).toBe(403);
      expect(next).not.toHaveBeenCalled();
    });
  });
});
