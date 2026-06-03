import {
  EventBridgeClient,
  PutEventsCommand,
  PutEventsRequestEntry,
} from '@aws-sdk/client-eventbridge';
import * as AWSXRay from 'aws-xray-sdk-core';

const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || 'eventforge-bus';

const DEFAULT_SOURCE = 'eventforge.api';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

export interface EventDetail {
  orderId: string;
  userId: string;
  status: string;
  timestamp: string;
  traceId?: string;
  metadata?: Record<string, unknown>;
}

export interface PublishEventResult {
  eventId: string;
}

let clientInstance: EventBridgeClient | null = null;

export function getEventBridgeClient(): EventBridgeClient {
  if (!clientInstance) {
    clientInstance = new EventBridgeClient({});
  }
  return clientInstance;
}

export function setEventBridgeClient(client: EventBridgeClient): void {
  clientInstance = client;
}

function getXRayTraceHeader(): string | undefined {
  try {
    const segment = AWSXRay.getSegment();
    if (segment) {
      // Segment has trace_id; Subsegment has parent segment with trace_id
      const traceId = (segment as { trace_id?: string }).trace_id;
      if (traceId) {
        return traceId;
      }
      // For subsegments, access the parent segment's trace_id
      const parentSegment = (segment as { segment?: { trace_id?: string } })
        .segment;
      if (parentSegment?.trace_id) {
        return parentSegment.trace_id;
      }
    }
  } catch {
    // No active trace context — this is expected in non-traced environments
  }
  return undefined;
}

function isTransientError(error: unknown): boolean {
  if (error instanceof Error) {
    const name = error.name;
    return (
      name === 'InternalException' ||
      name === 'ServiceUnavailableException' ||
      name === 'ThrottlingException' ||
      name === 'RequestLimitExceeded' ||
      name === 'InternalFailure' ||
      name === 'ServiceException'
    );
  }
  return false;
}

/** Delay helper — exposed for testability */
let delayFn: (ms: number) => Promise<void> = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function setDelayFn(fn: (ms: number) => Promise<void>): void {
  delayFn = fn;
}

export function resetDelayFn(): void {
  delayFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
}

export async function publishEvent(
  source: string,
  detailType: string,
  detail: EventDetail
): Promise<PublishEventResult> {
  const client = getEventBridgeClient();

  // Inject X-Ray trace header if active trace context exists
  const traceId = getXRayTraceHeader();
  const enrichedDetail: EventDetail = traceId
    ? { ...detail, traceId }
    : detail;

  const entry: PutEventsRequestEntry = {
    Source: source || DEFAULT_SOURCE,
    DetailType: detailType,
    Detail: JSON.stringify(enrichedDetail),
    EventBusName: EVENT_BUS_NAME,
  };

  const command = new PutEventsCommand({ Entries: [entry] });

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await client.send(command);

      // Check for failed entries in the response
      if (response.FailedEntryCount && response.FailedEntryCount > 0) {
        const failedEntry = response.Entries?.[0];
        const error = new Error(
          `EventBridge PutEvents failed: ${failedEntry?.ErrorCode} - ${failedEntry?.ErrorMessage}`
        );
        error.name = failedEntry?.ErrorCode || 'PutEventsError';
        throw error;
      }

      const eventId = response.Entries?.[0]?.EventId;
      if (!eventId) {
        throw new Error('EventBridge PutEvents returned no event ID');
      }

      return { eventId };
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Only retry on transient errors and if we haven't exhausted retries
      if (attempt < MAX_RETRIES && isTransientError(lastError)) {
        const delayMs = BASE_DELAY_MS * Math.pow(2, attempt);
        await delayFn(delayMs);
        continue;
      }

      // Non-transient error or retries exhausted — throw immediately
      if (!isTransientError(lastError)) {
        throw lastError;
      }
    }
  }

  // All retries exhausted
  throw new Error(
    `EventBridge publish failed after ${MAX_RETRIES} retries: ${lastError?.message}`
  );
}
