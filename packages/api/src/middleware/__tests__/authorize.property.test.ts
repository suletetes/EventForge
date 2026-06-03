import { Request, Response, NextFunction } from 'express';
import * as fc from 'fast-check';
import { authorizeOwner, ResourceOwnerExtractor } from '../authorize';

/**
 * Property-based tests for authorization middleware.
 *
 * Property 9: Cross-user resource access is forbidden
 *
 * For any authenticated request where the JWT's user ID differs from the owner
 * of the requested resource, the API SHALL reject the request with a 403 Forbidden
 * response without returning the resource data.
 *
 * **Validates: Requirements 8.6**
 */

// Alphanumeric character arbitrary
const alphaNumChar = fc.constantFrom(
  ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')
);

// Alphanumeric string arbitrary for user IDs
function alphaNumString(opts: { minLength?: number; maxLength?: number } = {}) {
  return fc.stringOf(alphaNumChar, {
    minLength: opts.minLength ?? 1,
    maxLength: opts.maxLength ?? 36,
  });
}

// Generator for user IDs (various formats)
const userIdArb = fc.oneof(
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

// Generator for pairs of distinct user IDs
const distinctUserIdPairArb = fc
  .tuple(userIdArb, userIdArb)
  .filter(([a, b]) => a !== b);

// Test helpers
function createMockRequest(userId?: string): Request {
  return {
    userId,
    params: {},
    path: '/api/orders/order-123',
    headers: {},
  } as unknown as Request;
}

function createMockResponse(): {
  res: Response;
  getStatusCode: () => number | null;
  getJsonBody: () => unknown;
} {
  let statusCode: number | null = null;
  let jsonBody: unknown = null;

  const res = {
    status: jest.fn(function (this: Response, code: number) {
      statusCode = code;
      return this;
    }),
    json: jest.fn(function (this: Response, body: unknown) {
      jsonBody = body;
      return this;
    }),
  } as unknown as Response;

  return {
    res,
    getStatusCode: () => statusCode,
    getJsonBody: () => jsonBody,
  };
}

describe('Authorization Middleware Property Tests', () => {
  /**
   * Property 9: Cross-user resource access is forbidden
   *
   * For any authenticated request where JWT userId differs from resource owner,
   * verify 403 response.
   *
   * **Validates: Requirements 8.6**
   */
  describe('Property 9: Cross-user resource access is forbidden', () => {
    it('should return 403 for any request where JWT userId differs from resource owner', async () => {
      await fc.assert(
        fc.asyncProperty(distinctUserIdPairArb, async ([requestUserId, resourceOwnerId]) => {
          // Create an extractor that returns the resource owner's ID
          const extractor: ResourceOwnerExtractor = async () => resourceOwnerId;
          const middleware = authorizeOwner(extractor);

          // Create request with a different userId than the resource owner
          const req = createMockRequest(requestUserId);
          const { res, getStatusCode, getJsonBody } = createMockResponse();
          const next: NextFunction = jest.fn();

          await middleware(req, res, next);

          // Must return 403 Forbidden
          expect(getStatusCode()).toBe(403);

          // Must include structured error response
          const body = getJsonBody() as { error: string; message: string };
          expect(body.error).toBe('Forbidden');
          expect(body.message).toBeTruthy();

          // Must NOT call next() (resource data not returned)
          expect(next).not.toHaveBeenCalled();
        }),
        { numRuns: 100 }
      );
    });

    it('should allow access when JWT userId matches resource owner', async () => {
      await fc.assert(
        fc.asyncProperty(userIdArb, async (userId) => {
          // Create an extractor that returns the same userId
          const extractor: ResourceOwnerExtractor = async () => userId;
          const middleware = authorizeOwner(extractor);

          // Create request with matching userId
          const req = createMockRequest(userId);
          const { res, getStatusCode } = createMockResponse();
          const next: NextFunction = jest.fn();

          await middleware(req, res, next);

          // Must call next() (access allowed)
          expect(next).toHaveBeenCalledWith();

          // Must NOT return 403
          expect(getStatusCode()).toBeNull();
        }),
        { numRuns: 100 }
      );
    });
  });
});
