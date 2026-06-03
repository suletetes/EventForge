import { Request, Response, NextFunction } from 'express';
import * as AWSXRay from 'aws-xray-sdk-core';
import { openSegment, closeSegment, captureAWSClient, setupTracing, isTracingEnabled } from '../tracing';

// Mock aws-xray-sdk-core
jest.mock('aws-xray-sdk-core', () => {
  const mockSegment = {
    close: jest.fn(),
    addErrorFlag: jest.fn(),
    addFaultFlag: jest.fn(),
  };

  const mockNamespace = {
    bindEmitter: jest.fn(),
    run: jest.fn((fn: () => void) => fn()),
  };

  return {
    middleware: {
      setDefaultName: jest.fn(),
      setSamplingRules: jest.fn(),
      traceRequestResponseCycle: jest.fn(() => mockSegment),
    },
    enableAutomaticMode: jest.fn(),
    getNamespace: jest.fn(() => mockNamespace),
    setSegment: jest.fn(),
    resolveSegment: jest.fn(() => mockSegment),
    captureAWSv3Client: jest.fn((client: unknown) => client),
  };
});

function createMockReq(path: string): Partial<Request> {
  return {
    path,
    headers: {},
  };
}

function createMockRes(statusCode = 200) {
  const onMock = jest.fn();
  return {
    statusCode,
    on: onMock,
  } as unknown as Response & { on: jest.Mock };
}

describe('Tracing Middleware', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('isTracingEnabled', () => {
    it('returns false when AWS_XRAY_DAEMON_ADDRESS is not set', () => {
      delete process.env.AWS_XRAY_DAEMON_ADDRESS;
      expect(isTracingEnabled()).toBe(false);
    });

    it('returns true when AWS_XRAY_DAEMON_ADDRESS is set', () => {
      process.env.AWS_XRAY_DAEMON_ADDRESS = '127.0.0.1:2000';
      expect(isTracingEnabled()).toBe(true);
    });
  });

  describe('setupTracing', () => {
    it('does nothing when tracing is disabled', () => {
      delete process.env.AWS_XRAY_DAEMON_ADDRESS;
      setupTracing();
      expect(AWSXRay.middleware.setDefaultName).not.toHaveBeenCalled();
      expect(AWSXRay.middleware.setSamplingRules).not.toHaveBeenCalled();
    });

    it('configures X-Ray when tracing is enabled', () => {
      process.env.AWS_XRAY_DAEMON_ADDRESS = '127.0.0.1:2000';
      setupTracing();
      expect(AWSXRay.middleware.setDefaultName).toHaveBeenCalledWith('eventforge-api');
      expect(AWSXRay.middleware.setSamplingRules).toHaveBeenCalledWith({
        version: 2,
        default: {
          fixed_target: 1,
          rate: 0.05,
        },
        rules: [],
      });
      expect(AWSXRay.enableAutomaticMode).toHaveBeenCalled();
    });
  });

  describe('openSegment', () => {
    it('skips tracing for /health endpoint', () => {
      process.env.AWS_XRAY_DAEMON_ADDRESS = '127.0.0.1:2000';
      const req = createMockReq('/health');
      const res = createMockRes();
      const next = jest.fn();

      openSegment(req as Request, res as unknown as Response, next as NextFunction);

      expect(next).toHaveBeenCalled();
      expect(AWSXRay.middleware.traceRequestResponseCycle).not.toHaveBeenCalled();
    });

    it('skips tracing when disabled (no daemon address)', () => {
      delete process.env.AWS_XRAY_DAEMON_ADDRESS;
      const req = createMockReq('/api/orders');
      const res = createMockRes();
      const next = jest.fn();

      openSegment(req as Request, res as unknown as Response, next as NextFunction);

      expect(next).toHaveBeenCalled();
      expect(AWSXRay.middleware.traceRequestResponseCycle).not.toHaveBeenCalled();
    });

    it('opens a segment for non-health requests when tracing is enabled', () => {
      process.env.AWS_XRAY_DAEMON_ADDRESS = '127.0.0.1:2000';
      const req = createMockReq('/api/orders');
      const res = createMockRes();
      const next = jest.fn();

      openSegment(req as Request, res as unknown as Response, next as NextFunction);

      expect(AWSXRay.middleware.traceRequestResponseCycle).toHaveBeenCalledWith(req, res);
      expect(AWSXRay.setSegment).toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });
  });

  describe('closeSegment', () => {
    it('skips for /health endpoint', () => {
      process.env.AWS_XRAY_DAEMON_ADDRESS = '127.0.0.1:2000';
      const req = createMockReq('/health');
      const res = createMockRes();
      const next = jest.fn();

      closeSegment(req as Request, res as unknown as Response, next as NextFunction);

      expect(next).toHaveBeenCalled();
      expect(res.on).not.toHaveBeenCalled();
    });

    it('skips when tracing is disabled', () => {
      delete process.env.AWS_XRAY_DAEMON_ADDRESS;
      const req = createMockReq('/api/orders');
      const res = createMockRes();
      const next = jest.fn();

      closeSegment(req as Request, res as unknown as Response, next as NextFunction);

      expect(next).toHaveBeenCalled();
      expect(res.on).not.toHaveBeenCalled();
    });

    it('registers a finish listener that closes the segment', () => {
      process.env.AWS_XRAY_DAEMON_ADDRESS = '127.0.0.1:2000';
      const req = createMockReq('/api/orders');
      const res = createMockRes(200);
      const next = jest.fn();

      closeSegment(req as Request, res as unknown as Response, next as NextFunction);

      expect(next).toHaveBeenCalled();
      expect(res.on).toHaveBeenCalledWith('finish', expect.any(Function));

      // Simulate response finish
      const finishCb = res.on.mock.calls[0][1];
      finishCb();

      const segment = (AWSXRay.resolveSegment as jest.Mock)();
      expect(segment.close).toHaveBeenCalled();
    });

    it('sets fault flag on 5xx responses', () => {
      process.env.AWS_XRAY_DAEMON_ADDRESS = '127.0.0.1:2000';
      const req = createMockReq('/api/orders');
      const res = createMockRes(500);
      const next = jest.fn();

      closeSegment(req as Request, res as unknown as Response, next as NextFunction);

      const finishCb = res.on.mock.calls[0][1];
      finishCb();

      const segment = (AWSXRay.resolveSegment as jest.Mock)();
      expect(segment.addFaultFlag).toHaveBeenCalled();
    });

    it('sets error flag on 4xx responses', () => {
      process.env.AWS_XRAY_DAEMON_ADDRESS = '127.0.0.1:2000';
      const req = createMockReq('/api/orders');
      const res = createMockRes(404);
      const next = jest.fn();

      closeSegment(req as Request, res as unknown as Response, next as NextFunction);

      const finishCb = res.on.mock.calls[0][1];
      finishCb();

      const segment = (AWSXRay.resolveSegment as jest.Mock)();
      expect(segment.addErrorFlag).toHaveBeenCalled();
    });
  });

  describe('captureAWSClient', () => {
    it('returns client unchanged when tracing is disabled', () => {
      delete process.env.AWS_XRAY_DAEMON_ADDRESS;
      const mockClient = { middlewareStack: { remove: jest.fn(), use: jest.fn() }, config: {} };

      const result = captureAWSClient(mockClient);

      expect(result).toBe(mockClient);
      expect(AWSXRay.captureAWSv3Client).not.toHaveBeenCalled();
    });

    it('instruments client with X-Ray when tracing is enabled', () => {
      process.env.AWS_XRAY_DAEMON_ADDRESS = '127.0.0.1:2000';
      const mockClient = { middlewareStack: { remove: jest.fn(), use: jest.fn() }, config: {} };

      const result = captureAWSClient(mockClient);

      expect(AWSXRay.captureAWSv3Client).toHaveBeenCalledWith(mockClient);
      expect(result).toBe(mockClient);
    });
  });
});
