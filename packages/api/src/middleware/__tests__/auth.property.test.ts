import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import * as fc from 'fast-check';
import { authMiddleware, resetJwksClient } from '../auth';

/**
 * Property-based tests for JWT authentication middleware.
 *
 * Validates: Requirements 2.7, 8.3, 8.4, 8.5
 */

// Generate RSA key pair for testing
const { publicKey: testPublicKey, privateKey: testPrivateKey } =
  crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

// A second key pair to simulate wrong signature
const { privateKey: wrongPrivateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

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

// Alphanumeric character arbitrary
const alphaNumChar = fc.constantFrom(
  ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')
);

// Alphanumeric string arbitrary
function alphaNumString(opts: { minLength?: number; maxLength?: number } = {}) {
  return fc.stringOf(alphaNumChar, {
    minLength: opts.minLength ?? 1,
    maxLength: opts.maxLength ?? 36,
  });
}

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

function createValidToken(sub: string): string {
  return jwt.sign(
    {
      sub,
      iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_testpool',
    },
    testPrivateKey,
    {
      algorithm: 'RS256',
      expiresIn: '1h',
      header: { alg: 'RS256', kid: 'valid-kid' },
    }
  );
}

function runMiddleware(
  req: Partial<Request>,
  res: Partial<Response>
): Promise<{ nextCalled: boolean; request: Partial<Request> }> {
  return new Promise((resolve) => {
    let nextCalled = false;
    const next: NextFunction = () => {
      nextCalled = true;
      resolve({ nextCalled, request: req });
    };

    authMiddleware(req as Request, res as Response, next);

    // Allow async jwt.verify callback to complete
    setTimeout(() => {
      resolve({ nextCalled, request: req });
    }, 150);
  });
}

describe('Auth Middleware Property Tests', () => {
  // Increase timeout for crypto-heavy property tests
  jest.setTimeout(60000);

  beforeEach(() => {
    process.env.COGNITO_USER_POOL_ID = 'us-east-1_testpool';
    process.env.COGNITO_REGION = 'us-east-1';
    resetJwksClient();
  });

  afterEach(() => {
    delete process.env.COGNITO_USER_POOL_ID;
    delete process.env.COGNITO_REGION;
  });

  /**
   * Property 6: Invalid JWT tokens are rejected with 401
   *
   * For any JWT token that is expired, malformed, has an invalid signature,
   * has an issuer not matching the configured Cognito user pool, or is missing
   * entirely, the API SHALL reject the request with a 401 Unauthorized response.
   *
   * **Validates: Requirements 2.7, 8.4**
   */
  describe('Property 6: Invalid JWT tokens are rejected with 401', () => {
    // Generator for expired tokens
    const expiredTokenArb = alphaNumString({ minLength: 1, maxLength: 36 }).map(
      (sub) =>
        jwt.sign(
          {
            sub,
            iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_testpool',
          },
          testPrivateKey,
          {
            algorithm: 'RS256',
            expiresIn: '-1h',
            header: { alg: 'RS256', kid: 'valid-kid' },
          }
        )
    );

    // Generator for tokens with wrong signature (signed with different key)
    const wrongSignatureTokenArb = alphaNumString({
      minLength: 1,
      maxLength: 36,
    }).map((sub) =>
      jwt.sign(
        {
          sub,
          iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_testpool',
        },
        wrongPrivateKey,
        {
          algorithm: 'RS256',
          expiresIn: '1h',
          header: { alg: 'RS256', kid: 'valid-kid' },
        }
      )
    );

    // Generator for tokens with wrong issuer
    const wrongIssuerTokenArb = alphaNumString({
      minLength: 5,
      maxLength: 20,
    })
      .filter((poolId) => poolId !== 'testpool')
      .map((poolId) =>
        jwt.sign(
          {
            sub: 'user-123',
            iss: `https://cognito-idp.us-east-1.amazonaws.com/us-east-1_${poolId}`,
          },
          testPrivateKey,
          {
            algorithm: 'RS256',
            expiresIn: '1h',
            header: { alg: 'RS256', kid: 'valid-kid' },
          }
        )
      );

    // Generator for malformed tokens (random strings that aren't valid JWTs)
    const malformedTokenArb = fc.oneof(
      // Random string
      alphaNumString({ minLength: 1, maxLength: 100 }),
      // String with dots but not valid JWT structure
      fc
        .tuple(
          alphaNumString({ minLength: 1, maxLength: 50 }),
          alphaNumString({ minLength: 1, maxLength: 50 }),
          alphaNumString({ minLength: 1, maxLength: 50 })
        )
        .map(([a, b, c]) => `${a}.${b}.${c}`),
      // Partial JWT (only header-like base64)
      alphaNumString({ minLength: 5, maxLength: 50 }).map((s) =>
        Buffer.from(JSON.stringify({ alg: 'RS256', kid: s })).toString(
          'base64url'
        )
      )
    );

    // Generator for missing token scenarios
    const missingTokenArb = fc.constantFrom(
      undefined as string | undefined,
      '',
      'Basic abc123',
      'Bearer ',
      'Token abc123'
    );

    // Combined generator for all invalid token types
    const invalidTokenArb = fc.oneof(
      { weight: 2, arbitrary: expiredTokenArb.map((t) => `Bearer ${t}` as string | undefined) },
      { weight: 2, arbitrary: wrongSignatureTokenArb.map((t) => `Bearer ${t}` as string | undefined) },
      { weight: 2, arbitrary: wrongIssuerTokenArb.map((t) => `Bearer ${t}` as string | undefined) },
      { weight: 2, arbitrary: malformedTokenArb.map((t) => `Bearer ${t}` as string | undefined) },
      { weight: 1, arbitrary: missingTokenArb }
    );

    it('should reject all invalid tokens with 401 status', async () => {
      await fc.assert(
        fc.asyncProperty(invalidTokenArb, async (authHeader) => {
          const headers: Record<string, string> = {};
          if (authHeader !== undefined && authHeader !== '') {
            headers.authorization = authHeader;
          }

          const req = createMockRequest({
            path: '/api/orders',
            headers,
          });
          const { res, getStatusCode } = createMockResponse();

          const { nextCalled } = await runMiddleware(req, res);

          // Must return 401 and NOT call next()
          expect(nextCalled).toBe(false);
          expect(getStatusCode()).toBe(401);
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 7: Authentication middleware applies to all paths except /health
   *
   * For any HTTP request path that is not "/health", the API SHALL execute
   * JWT validation middleware. For the "/health" path, the API SHALL skip
   * JWT validation.
   *
   * **Validates: Requirements 8.3**
   */
  describe('Property 7: Authentication middleware applies to all paths except /health', () => {
    // Path segment characters
    const pathChar = fc.constantFrom(
      ...'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('')
    );

    // Generator for non-health paths
    const nonHealthPathArb = fc
      .tuple(
        fc.constantFrom(
          '/api',
          '/orders',
          '/events',
          '/webhooks',
          '/users',
          '/admin',
          '/status',
          '/metrics'
        ),
        fc.array(fc.stringOf(pathChar, { minLength: 1, maxLength: 20 }), {
          minLength: 0,
          maxLength: 3,
        })
      )
      .map(([prefix, segments]) => {
        if (segments.length === 0) return prefix;
        return `${prefix}/${segments.join('/')}`;
      })
      .filter((path) => path !== '/health');

    it('should require authentication for all non-health paths', async () => {
      await fc.assert(
        fc.asyncProperty(nonHealthPathArb, async (path) => {
          // Request without auth token on a non-health path
          const req = createMockRequest({
            path,
            headers: {},
          });
          const { res, getStatusCode } = createMockResponse();

          const { nextCalled } = await runMiddleware(req, res);

          // Middleware should reject (401) since no token provided
          expect(nextCalled).toBe(false);
          expect(getStatusCode()).toBe(401);
        }),
        { numRuns: 100 }
      );
    });

    it('should skip authentication for /health path', async () => {
      const req = createMockRequest({
        path: '/health',
        headers: {},
      });
      const { res } = createMockResponse();

      const { nextCalled } = await runMiddleware(req, res);

      // Middleware should call next() without checking auth
      expect(nextCalled).toBe(true);
    });
  });

  /**
   * Property 8: User ID extraction from JWT matches token sub claim
   *
   * For any valid JWT token with a sub claim, the API SHALL extract the
   * user ID such that the extracted value is identical to the token's sub claim.
   *
   * **Validates: Requirements 8.5**
   */
  describe('Property 8: User ID extraction from JWT matches token sub claim', () => {
    // Generator for valid sub claims (user IDs)
    const subClaimArb = fc.oneof(
      // UUID-like strings
      fc.uuid(),
      // Alphanumeric user IDs
      alphaNumString({ minLength: 1, maxLength: 64 }),
      // Prefixed user IDs (common pattern)
      fc
        .tuple(
          fc.constantFrom('user-', 'usr_', 'auth0|', 'cognito-'),
          alphaNumString({ minLength: 1, maxLength: 36 })
        )
        .map(([prefix, id]) => `${prefix}${id}`)
    );

    it('should extract userId matching the sub claim from valid tokens', async () => {
      await fc.assert(
        fc.asyncProperty(subClaimArb, async (subClaim) => {
          const token = createValidToken(subClaim);
          const req = createMockRequest({
            path: '/api/orders',
            headers: { authorization: `Bearer ${token}` },
          });
          const { res } = createMockResponse();

          const { nextCalled, request } = await runMiddleware(req, res);

          // Middleware should call next() and set userId to the sub claim
          expect(nextCalled).toBe(true);
          expect(request.userId).toBe(subClaim);
        }),
        { numRuns: 100 }
      );
    });
  });
});
