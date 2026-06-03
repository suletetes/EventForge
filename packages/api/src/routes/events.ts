import { Router, Request, Response } from 'express';
import { getRecentEvents } from '@eventforge/shared';

const router = Router();

/**
 * GET /api/events
 *
 * Returns the most recent 100 events sorted by timestamp descending.
 *
 * Requirements: 2.6
 */
router.get('/', async (_req: Request, res: Response) => {
  const events = await getRecentEvents(100);
  res.status(200).json({ events });
});

export { router as eventsRouter };
