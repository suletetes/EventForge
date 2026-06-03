import { Request, Response, NextFunction } from 'express';

/**
 * A function that extracts the resource owner's userId from the request.
 * Returns the owner userId string, or undefined/null if the resource owner
 * cannot be determined yet (e.g., resource not found).
 */
export type ResourceOwnerExtractor = (req: Request) => Promise<string | undefined | null>;

/**
 * Structured error response for authorization failures.
 */
interface ForbiddenErrorResponse {
  error: string;
  message: string;
}

function createForbiddenError(message: string): ForbiddenErrorResponse {
  return {
    error: 'Forbidden',
    message,
  };
}

/**
 * Authorization middleware factory.
 *
 * Creates an Express middleware that compares the authenticated user's ID
 * (req.userId, set by the auth middleware) with the resource owner's userId
 * extracted via the provided function.
 *
 * Behavior:
 * - If the extractor returns a userId that differs from req.userId, responds with 403 Forbidden.
 * - If the extractor returns undefined/null (resource owner can't be determined yet),
 *   calls next() to let the route handler perform its own checks.
 * - If the extractor throws an error, passes it to next() for error handling.
 * - If userIds match, calls next() to proceed.
 *
 * Requirements: 8.6
 */
export function authorizeOwner(extractOwner: ResourceOwnerExtractor) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const resourceOwnerId = await extractOwner(req);

      // If we can't determine the owner yet, let the route handler decide
      if (resourceOwnerId === undefined || resourceOwnerId === null) {
        next();
        return;
      }

      // Compare authenticated user with resource owner
      if (req.userId !== resourceOwnerId) {
        res.status(403).json(
          createForbiddenError('You do not have permission to access this resource')
        );
        return;
      }

      // User is authorized
      next();
    } catch (error) {
      next(error);
    }
  };
}
