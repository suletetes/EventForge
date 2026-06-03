import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { authMiddleware, resetJwksClient } from '../auth';

// Mock jwks-rsa
jest.mock('jwks-rsa', () => {
  return jest.fn(() => ({
    getSigningKey: jest.fn((kid: string, callback: Function) => {
      if (kid === 'valid-kid') {
        callback(null, {
          getPublicKey: () => testPublicKey,
        });
      } else {
        callback(new Error('Unable to find a signing key that matches'));
      }
    }),
  }));
});

// Generate RSA key pair for testing
import crypto from 'crypto';

const { publicKey: testPublicKey, privateKey: testPrivateKey } =
  crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

// Test helpers
function createMockRequest(overrides: Partial<Request> = {}): Partial<Request> {
  return {
    path: '/api/orders',
    headers: {},
    ...overrides,
  };
}

function createMockResponse(): {
  res: Partial<Response>;
  statusCode: number | null;
  jsonBody: unknown;
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

  return { res, get statusCode() { return statusCode; }, get jsonBody() { return jsonBody; } };
}

function createValidToken(claims: Record<string, unknown> = {}): string {
  return jwt.sign(
    {
      sub: 'user-123',
      iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_testpool',
      ...claims,
    },
    testPrivateKey,
    {
      algorithm: 'RS256',
      expiresIn: '1h',
      header: { alg: 'RS256', kid: 'valid-kid' },
    }
  );
}

describe('authMiddleware', () => {
  beforeEach(() => {
    process.env.COGNITO_USER_POOL_ID = 'us-east-1_testpool';
    process.env.COGNITO_REGION = 'us-east-1';
    resetJwksClient();
  });

  afterEach(() => {
    delete process.env.COGNITO_USER_POOL_ID;
    delete process.env.COGNITO_REGION;
  });

  describe('health endpoint bypass', () => {
    it('should skip validation for /health path', (done) => {
      const req = createMockRequest({ path: '/health' });
      const { res } = createMockResponse();
      const next: NextFunction = () => {
        // next() was called, meaning auth was skipped
        expect(req.userId).toBeUndefined();
        done();
      };

      authMiddleware(req as Request, res as Response, next);
    });
  });

  describe('missing or malformed authorization', () => {
    it('should return 401 when Authorization header is missing', (done) => {
      const req = createMockRequest({ headers: {} });
      const { res } = createMockResponse();
      const next: NextFunction = jest.fn();

      authMiddleware(req as Request, res as Response, next);

      // Give async operations time to complete
      setTimeout(() => {
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            error: 'Unauthorized',
            message: 'Missing authorization token',
          })
        );
        expect(next).not.toHaveBeenCalled();
        done();
      }, 10);
    });

    it('should return 401 when Authorization header does not start with Bearer', (done) => {
      const req = createMockRequest({
        headers: { authorization: 'Basic abc123' },
      });
      const { res } = createMockResponse();
      const next: NextFunction = jest.fn();

      authMiddleware(req as Request, res as Response, next);

      setTimeout(() => {
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            error: 'Unauthorized',
            message: expect.stringContaining('Invalid authorization format'),
          })
        );
        expect(next).not.toHaveBeenCalled();
        done();
      }, 10);
    });

    it('should return 401 when Bearer token is empty', (done) => {
      const req = createMockRequest({
        headers: { authorization: 'Bearer ' },
      });
      const { res } = createMockResponse();
      const next: NextFunction = jest.fn();

      authMiddleware(req as Request, res as Response, next);

      setTimeout(() => {
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            error: 'Unauthorized',
            message: 'Missing authorization token',
          })
        );
        expect(next).not.toHaveBeenCalled();
        done();
      }, 10);
    });
  });

  describe('invalid tokens', () => {
    it('should return 401 for a malformed token', (done) => {
      const req = createMockRequest({
        headers: { authorization: 'Bearer not-a-valid-jwt' },
      });
      const { res } = createMockResponse();
      const next: NextFunction = jest.fn();

      authMiddleware(req as Request, res as Response, next);

      setTimeout(() => {
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            error: 'Unauthorized',
          })
        );
        expect(next).not.toHaveBeenCalled();
        done();
      }, 100);
    });

    it('should return 401 for an expired token', (done) => {
      const expiredToken = jwt.sign(
        {
          sub: 'user-123',
          iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_testpool',
        },
        testPrivateKey,
        {
          algorithm: 'RS256',
          expiresIn: '-1h', // Already expired
          header: { alg: 'RS256', kid: 'valid-kid' },
        }
      );

      const req = createMockRequest({
        headers: { authorization: `Bearer ${expiredToken}` },
      });
      const { res } = createMockResponse();
      const next: NextFunction = jest.fn();

      authMiddleware(req as Request, res as Response, next);

      setTimeout(() => {
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            error: 'Unauthorized',
            message: 'Token has expired',
          })
        );
        expect(next).not.toHaveBeenCalled();
        done();
      }, 100);
    });

    it('should return 401 for a token with wrong issuer', (done) => {
      const wrongIssuerToken = jwt.sign(
        {
          sub: 'user-123',
          iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_wrongpool',
        },
        testPrivateKey,
        {
          algorithm: 'RS256',
          expiresIn: '1h',
          header: { alg: 'RS256', kid: 'valid-kid' },
        }
      );

      const req = createMockRequest({
        headers: { authorization: `Bearer ${wrongIssuerToken}` },
      });
      const { res } = createMockResponse();
      const next: NextFunction = jest.fn();

      authMiddleware(req as Request, res as Response, next);

      setTimeout(() => {
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            error: 'Unauthorized',
          })
        );
        expect(next).not.toHaveBeenCalled();
        done();
      }, 100);
    });

    it('should return 401 for a token with invalid kid', (done) => {
      const invalidKidToken = jwt.sign(
        {
          sub: 'user-123',
          iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_testpool',
        },
        testPrivateKey,
        {
          algorithm: 'RS256',
          expiresIn: '1h',
          header: { alg: 'RS256', kid: 'invalid-kid' },
        }
      );

      const req = createMockRequest({
        headers: { authorization: `Bearer ${invalidKidToken}` },
      });
      const { res } = createMockResponse();
      const next: NextFunction = jest.fn();

      authMiddleware(req as Request, res as Response, next);

      setTimeout(() => {
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            error: 'Unauthorized',
          })
        );
        expect(next).not.toHaveBeenCalled();
        done();
      }, 100);
    });
  });

  describe('valid tokens', () => {
    it('should extract userId from sub claim and call next()', (done) => {
      const token = createValidToken({ sub: 'user-abc-123' });
      const req = createMockRequest({
        headers: { authorization: `Bearer ${token}` },
      });
      const { res } = createMockResponse();
      const next: NextFunction = () => {
        expect(req.userId).toBe('user-abc-123');
        done();
      };

      authMiddleware(req as Request, res as Response, next);
    });

    it('should handle different sub claim values', (done) => {
      const token = createValidToken({ sub: 'another-user-456' });
      const req = createMockRequest({
        headers: { authorization: `Bearer ${token}` },
      });
      const { res } = createMockResponse();
      const next: NextFunction = () => {
        expect(req.userId).toBe('another-user-456');
        done();
      };

      authMiddleware(req as Request, res as Response, next);
    });
  });

  describe('non-health paths require auth', () => {
    it('should require auth for /api/orders', (done) => {
      const req = createMockRequest({ path: '/api/orders', headers: {} });
      const { res } = createMockResponse();
      const next: NextFunction = jest.fn();

      authMiddleware(req as Request, res as Response, next);

      setTimeout(() => {
        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
        done();
      }, 10);
    });

    it('should require auth for /api/events', (done) => {
      const req = createMockRequest({ path: '/api/events', headers: {} });
      const { res } = createMockResponse();
      const next: NextFunction = jest.fn();

      authMiddleware(req as Request, res as Response, next);

      setTimeout(() => {
        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
        done();
      }, 10);
    });

    it('should require auth for /api/webhooks', (done) => {
      const req = createMockRequest({ path: '/api/webhooks', headers: {} });
      const { res } = createMockResponse();
      const next: NextFunction = jest.fn();

      authMiddleware(req as Request, res as Response, next);

      setTimeout(() => {
        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
        done();
      }, 10);
    });
  });
});
