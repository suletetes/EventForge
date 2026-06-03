import { Request, Response, NextFunction } from 'express';
import jwt, { JwtHeader, SigningKeyCallback } from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

/**
 * Type augmentation for Express Request to include userId from JWT.
 */
declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

/**
 * Configuration for Cognito JWT validation.
 * Reads from environment variables with sensible defaults.
 */
interface AuthConfig {
  userPoolId: string;
  region: string;
  issuer: string;
  jwksUri: string;
}

function getAuthConfig(): AuthConfig {
  const userPoolId = process.env.COGNITO_USER_POOL_ID || '';
  const region = process.env.COGNITO_REGION || 'us-east-1';
  const issuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
  const jwksUri = `${issuer}/.well-known/jwks.json`;

  return { userPoolId, region, issuer, jwksUri };
}

/**
 * JWKS client with caching for signing key retrieval.
 * Keys are cached for 10 minutes and rate-limited to prevent abuse.
 */
let cachedClient: jwksClient.JwksClient | null = null;

function getJwksClient(): jwksClient.JwksClient {
  if (!cachedClient) {
    const config = getAuthConfig();
    cachedClient = jwksClient({
      jwksUri: config.jwksUri,
      cache: true,
      cacheMaxEntries: 5,
      cacheMaxAge: 600000, // 10 minutes
      rateLimit: true,
      jwksRequestsPerMinute: 10,
    });
  }
  return cachedClient;
}

/**
 * Retrieves the signing key from the JWKS endpoint based on the token's kid.
 */
function getSigningKey(header: JwtHeader, callback: SigningKeyCallback): void {
  const client = getJwksClient();
  const kid = header.kid;

  if (!kid) {
    callback(new Error('Token header missing kid'));
    return;
  }

  client.getSigningKey(kid, (err, key) => {
    if (err) {
      callback(err);
      return;
    }
    const signingKey = key?.getPublicKey();
    callback(null, signingKey);
  });
}

/**
 * Structured error response for authentication failures.
 */
interface AuthErrorResponse {
  error: string;
  message: string;
}

function createAuthError(message: string): AuthErrorResponse {
  return {
    error: 'Unauthorized',
    message,
  };
}

/**
 * JWT Authentication Middleware for Express.
 *
 * Validates JWT tokens issued by AWS Cognito:
 * 1. Skips validation for /health endpoint
 * 2. Extracts Bearer token from Authorization header
 * 3. Decodes token header to get kid (key ID)
 * 4. Fetches signing key from Cognito JWKS endpoint (with caching)
 * 5. Verifies token signature, expiration, and issuer
 * 6. Attaches userId (from sub claim) to req.userId
 * 7. Returns 401 with structured error on any failure
 *
 * Requirements: 8.3, 8.4, 8.5
 */
export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Skip validation for /health endpoint
  if (req.path === '/health') {
    next();
    return;
  }

  const authHeader = req.headers.authorization;

  // Check for missing Authorization header
  if (!authHeader) {
    res.status(401).json(createAuthError('Missing authorization token'));
    return;
  }

  // Check for Bearer token format
  if (!authHeader.startsWith('Bearer ')) {
    res.status(401).json(createAuthError('Invalid authorization format. Expected: Bearer <token>'));
    return;
  }

  const token = authHeader.slice(7).trim();

  // Check for empty token
  if (!token) {
    res.status(401).json(createAuthError('Missing authorization token'));
    return;
  }

  const config = getAuthConfig();

  // Verify the JWT token
  jwt.verify(
    token,
    getSigningKey,
    {
      algorithms: ['RS256'],
      issuer: config.issuer,
    },
    (err, decoded) => {
      if (err) {
        if (err.name === 'TokenExpiredError') {
          res.status(401).json(createAuthError('Token has expired'));
          return;
        }
        if (err.name === 'JsonWebTokenError') {
          res.status(401).json(createAuthError('Invalid token: ' + err.message));
          return;
        }
        if (err.name === 'NotBeforeError') {
          res.status(401).json(createAuthError('Token not yet active'));
          return;
        }
        res.status(401).json(createAuthError('Token validation failed'));
        return;
      }

      // Extract userId from the sub claim
      if (!decoded || typeof decoded === 'string') {
        res.status(401).json(createAuthError('Invalid token payload'));
        return;
      }

      const userId = decoded.sub;
      if (!userId) {
        res.status(401).json(createAuthError('Token missing sub claim'));
        return;
      }

      // Attach userId to request context
      req.userId = userId;
      next();
    }
  );
}

/**
 * Reset the cached JWKS client (useful for testing).
 */
export function resetJwksClient(): void {
  cachedClient = null;
}

export { getAuthConfig, getJwksClient };
