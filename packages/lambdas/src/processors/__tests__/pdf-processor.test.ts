/**
 * Unit tests for the PDF Processor Lambda function.
 *
 * Tests SQS message parsing, PDF generation, S3 upload, and error handling.
 * Requirements: 5.2, 5.5, 5.8
 */

import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import type { SQSEvent, Context, Callback } from 'aws-lambda';
import { handler, generatePDFBuffer, PDFQueueMessage } from '../pdf-processor';

const s3Mock = mockClient(S3Client);

beforeEach(() => {
  s3Mock.reset();
  process.env.RECEIPTS_BUCKET = 'test-receipts-bucket';
});

afterEach(() => {
  delete process.env.RECEIPTS_BUCKET;
});

const createSQSEvent = (messages: PDFQueueMessage[]): SQSEvent => ({
  Records: messages.map((msg, idx) => ({
    messageId: `msg-${idx}`,
    receiptHandle: `handle-${idx}`,
    body: JSON.stringify(msg),
    attributes: {
      ApproximateReceiveCount: '1',
      SentTimestamp: '1234567890',
      SenderId: 'sender-1',
      ApproximateFirstReceiveTimestamp: '1234567890',
    },
    messageAttributes: {},
    md5OfBody: 'md5',
    eventSource: 'aws:sqs',
    eventSourceARN: 'arn:aws:sqs:us-east-1:123456789:pdf-queue',
    awsRegion: 'us-east-1',
  })),
});

const validMessage: PDFQueueMessage = {
  orderId: '01HX1234567890ABCDEF',
  userId: 'user-123',
  items: [
    { name: 'Widget', quantity: 2, price: 29.99 },
    { name: 'Gadget', quantity: 1, price: 49.99 },
  ],
  total: 109.97,
  timestamp: '2024-01-15T10:30:00Z',
  s3Key: 'receipts/01HX1234567890ABCDEF.pdf',
};

describe('PDF Processor Lambda', () => {
  describe('handler', () => {
    it('should parse SQS message body and upload PDF to S3', async () => {
      s3Mock.on(PutObjectCommand).resolves({});

      const event = createSQSEvent([validMessage]);
      await handler(event, {} as Context, (() => {}) as Callback);

      const s3Calls = s3Mock.commandCalls(PutObjectCommand);
      expect(s3Calls).toHaveLength(1);

      const input = s3Calls[0].args[0].input;
      expect(input.Bucket).toBe('test-receipts-bucket');
      expect(input.Key).toBe('receipts/01HX1234567890ABCDEF.pdf');
      expect(input.ContentType).toBe('application/pdf');
      expect(input.Body).toBeInstanceOf(Buffer);
    });

    it('should use receipts/{orderId}.pdf as the S3 key', async () => {
      s3Mock.on(PutObjectCommand).resolves({});

      const message: PDFQueueMessage = {
        ...validMessage,
        orderId: 'order-abc-123',
      };
      const event = createSQSEvent([message]);
      await handler(event, {} as Context, (() => {}) as Callback);

      const s3Calls = s3Mock.commandCalls(PutObjectCommand);
      expect(s3Calls[0].args[0].input.Key).toBe('receipts/order-abc-123.pdf');
    });

    it('should process all records in the SQS event', async () => {
      s3Mock.on(PutObjectCommand).resolves({});

      const message2: PDFQueueMessage = {
        ...validMessage,
        orderId: 'order-second',
        total: 50.0,
      };
      const event = createSQSEvent([validMessage, message2]);
      await handler(event, {} as Context, (() => {}) as Callback);

      const s3Calls = s3Mock.commandCalls(PutObjectCommand);
      expect(s3Calls).toHaveLength(2);
      expect(s3Calls[0].args[0].input.Key).toBe('receipts/01HX1234567890ABCDEF.pdf');
      expect(s3Calls[1].args[0].input.Key).toBe('receipts/order-second.pdf');
    });

    it('should throw error on S3 transient failure to allow SQS retry', async () => {
      const transientError = new Error('Service Unavailable');
      transientError.name = 'ServiceUnavailable';
      s3Mock.on(PutObjectCommand).rejects(transientError);

      const event = createSQSEvent([validMessage]);
      await expect(
        handler(event, {} as Context, (() => {}) as Callback)
      ).rejects.toThrow('Service Unavailable');
    });

    it('should throw error on S3 internal error to allow SQS retry', async () => {
      const internalError = new Error('Internal Server Error');
      internalError.name = 'InternalError';
      s3Mock.on(PutObjectCommand).rejects(internalError);

      const event = createSQSEvent([validMessage]);
      await expect(
        handler(event, {} as Context, (() => {}) as Callback)
      ).rejects.toThrow('Internal Server Error');
    });

    it('should throw error on network timeout to allow SQS retry', async () => {
      const timeoutError = new Error('Connection timed out');
      timeoutError.name = 'TimeoutError';
      s3Mock.on(PutObjectCommand).rejects(timeoutError);

      const event = createSQSEvent([validMessage]);
      await expect(
        handler(event, {} as Context, (() => {}) as Callback)
      ).rejects.toThrow('Connection timed out');
    });
  });

  describe('generatePDFBuffer', () => {
    it('should return a Buffer', () => {
      const result = generatePDFBuffer(validMessage);
      expect(result).toBeInstanceOf(Buffer);
    });

    it('should generate a valid PDF starting with %PDF-1.4', () => {
      const result = generatePDFBuffer(validMessage);
      const header = result.toString('ascii', 0, 8);
      expect(header).toBe('%PDF-1.4');
    });

    it('should include order ID in the PDF content', () => {
      const result = generatePDFBuffer(validMessage);
      const content = result.toString('ascii');
      expect(content).toContain(validMessage.orderId);
    });

    it('should include all item names in the PDF content', () => {
      const result = generatePDFBuffer(validMessage);
      const content = result.toString('ascii');
      expect(content).toContain('Widget');
      expect(content).toContain('Gadget');
    });

    it('should include the total amount in the PDF content', () => {
      const result = generatePDFBuffer(validMessage);
      const content = result.toString('ascii');
      expect(content).toContain('109.97');
    });

    it('should include the timestamp in the PDF content', () => {
      const result = generatePDFBuffer(validMessage);
      const content = result.toString('ascii');
      expect(content).toContain('2024-01-15T10:30:00Z');
    });

    it('should include item quantities and prices', () => {
      const result = generatePDFBuffer(validMessage);
      const content = result.toString('ascii');
      expect(content).toContain('x2');
      expect(content).toContain('29.99');
      expect(content).toContain('x1');
      expect(content).toContain('49.99');
    });

    it('should end with %%EOF', () => {
      const result = generatePDFBuffer(validMessage);
      const content = result.toString('ascii');
      expect(content.trim()).toMatch(/%%EOF$/);
    });

    it('should handle single item orders', () => {
      const singleItemMessage: PDFQueueMessage = {
        orderId: 'order-single',
        userId: 'user-456',
        items: [{ name: 'Solo Item', quantity: 1, price: 9.99 }],
        total: 9.99,
        timestamp: '2024-02-01T08:00:00Z',
        s3Key: 'receipts/order-single.pdf',
      };

      const result = generatePDFBuffer(singleItemMessage);
      expect(result).toBeInstanceOf(Buffer);
      const content = result.toString('ascii');
      expect(content).toContain('Solo Item');
      expect(content).toContain('9.99');
    });
  });
});
