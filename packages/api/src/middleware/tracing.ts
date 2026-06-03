/**
 * X-Ray Tracing Middleware for the EventForge API service.
 *
 * Provides Express middleware for opening/closing X-Ray segments on each request,
 * skipping the /health endpoint. Also instruments AWS SDK v3 clients for automatic
 * subsegment capture on DynamoDB, EventBridge, and S3 calls.
 *
 * Tracing is conditional — only active when AWS_XRAY_DAEMON_ADDRESS is set,
 * allowing local development without an X-Ray daemon.
 */

import { Request, Response, NextFunction } from 'express';
import * as AWSXRay from 'aws-xray-sdk-core';

const SEGMENT_NAME = 'eventforge-api';

/**
 * Whether X-Ray tracing is enabled. Tracing is only active when the
 * AWS_XRAY_DAEMON_ADDRESS environment variable is set (indicating a daemon
 * is available to receive trace data).
 */
export function isTracingEnabled(): boolean {
  return !!process.env.AWS_XRAY_DAEMON_ADDRESS;
}

/**
 * Configure X-Ray sampling rules.
 * Sampling: 1 request/second fixed rate + 5% of additional requests.
 */
function configureSampling(): void {
  AWSXRay.middleware.setSamplingRules({
    version: 2,
    default: {
      fixed_target: 1,
      rate: 0.05,
    },
    rules: [],
  });
}

/**
 * Initialize X-Ray tracing for the API service.
 * Sets the default segment name, configures sampling rules,
 * and enables automatic mode for context propagation.
 *
 * Call this once during application startup (before registering middleware).
 */
export function setupTracing(): void {
  if (!isTracingEnabled()) {
    return;
  }

  AWSXRay.middleware.setDefaultName(SEGMENT_NAME);
  configureSampling();
  AWSXRay.enableAutomaticMode();
}

/**
 * Express middleware that opens an X-Ray segment for each incoming request.
 * Skips the /health endpoint to avoid noisy health check traces.
 *
 * Must be registered before route handlers.
 */
export function openSegment(req: Request, res: Response, next: NextFunction): void {
  // Skip tracing for health checks
  if (req.path === '/health') {
    next();
    return;
  }

  // Skip if tracing is not enabled (local dev)
  if (!isTracingEnabled()) {
    next();
    return;
  }

  const segment = AWSXRay.middleware.traceRequestResponseCycle(req, res);
  // Store segment in the async local storage namespace for downstream access
  const ns = AWSXRay.getNamespace();
  ns.bindEmitter(req);
  ns.bindEmitter(res);

  ns.run(() => {
    AWSXRay.setSegment(segment);
    next();
  });
}

/**
 * Express middleware that closes the X-Ray segment when the response finishes.
 * Skips the /health endpoint.
 *
 * Must be registered after route handlers (or as error-handling middleware).
 */
export function closeSegment(req: Request, res: Response, next: NextFunction): void {
  // Skip for health checks or when tracing is disabled
  if (req.path === '/health' || !isTracingEnabled()) {
    next();
    return;
  }

  res.on('finish', () => {
    try {
      const segment = AWSXRay.resolveSegment();
      if (segment) {
        // Record error/fault flags based on response status
        if (res.statusCode >= 500) {
          segment.addFaultFlag();
        } else if (res.statusCode >= 400) {
          segment.addErrorFlag();
        }
        segment.close();
      }
    } catch {
      // Segment may already be closed or missing — safe to ignore
    }
  });

  next();
}

/**
 * Instruments an AWS SDK v3 client with X-Ray for automatic subsegment capture.
 * Records latency, error/fault flags on SDK call failures.
 *
 * @param client - Any AWS SDK v3 client (DynamoDB, EventBridge, S3, etc.)
 * @returns The instrumented client
 */
export function captureAWSClient<T extends { middlewareStack: { remove: unknown; use: unknown }; config: unknown }>(
  client: T
): T {
  if (!isTracingEnabled()) {
    return client;
  }
  return AWSXRay.captureAWSv3Client(client);
}
