import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

// Type augmentation for req.userId (set by auth middleware)
declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

const TABLE_NAME = process.env.DYNAMODB_TABLE || 'eventforge-events';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const router = Router();

/**
 * Validates that a given string is a valid HTTPS URL with max 2048 characters.
 * Returns an error message if invalid, or null if valid.
 */
export function validateWebhookUrl(url: unknown): string | null {
  if (typeof url !== 'string' || url.trim() === '') {
    return 'URL is required and must be a non-empty string';
  }

  if (url.length > 2048) {
    return 'URL must not exceed 2048 characters';
  }

  if (!url.startsWith('https://')) {
    return 'URL must use HTTPS protocol';
  }

  try {
    new URL(url);
  } catch {
    return 'URL is not a valid URL';
  }

  return null;
}

/**
 * POST /api/webhooks
 *
 * Registers a webhook URL for event delivery.
 * Validates that the URL is HTTPS, valid, and <= 2048 characters.
 * Stores the registration in DynamoDB with PK=WEBHOOK#{url_hash}, SK=REGISTRATION.
 *
 * Requirements: 2.5
 */
router.post('/', async (req: Request, res: Response) => {
  const { url } = req.body;

  const validationError = validateWebhookUrl(url);
  if (validationError) {
    res.status(400).json({
      error: 'Bad Request',
      message: validationError,
    });
    return;
  }

  const urlHash = crypto.createHash('sha256').update(url).digest('hex');
  const registeredAt = new Date().toISOString();

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `WEBHOOK#${urlHash}`,
        SK: 'REGISTRATION',
        url,
        registeredAt,
        userId: req.userId,
      },
    })
  );

  res.status(201).json({
    url,
    registeredAt,
  });
});

export { router as webhooksRouter };
