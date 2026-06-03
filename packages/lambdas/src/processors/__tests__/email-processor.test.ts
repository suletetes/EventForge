/**
 * Unit tests for the Email Processor Lambda function.
 *
 * Tests SQS message parsing, SES email sending, and error handling.
 */

import { mockClient } from 'aws-sdk-client-mock';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import type { SQSEvent, Context, Callback } from 'aws-lambda';
import { handler, buildEmailBody, isTransientError, EmailQueueMessage } from '../email-processor';

const sesMock = mockClient(SESClient);

beforeEach(() => {
  sesMock.reset();
});

function createSQSEvent(messages: EmailQueueMessage[]): SQSEvent {
  return {
    Records: messages.map((msg, index) => ({
      messageId: `msg-${index}`,
      receiptHandle: `receipt-${index}`,
      body: JSON.stringify(msg),
      attributes: {
        ApproximateReceiveCount: '1',
        SentTimestamp: '1234567890',
        SenderId: 'sender-id',
        ApproximateFirstReceiveTimestamp: '1234567890',
      },
      messageAttributes: {},
      md5OfBody: 'md5',
      eventSource: 'aws:sqs',
      eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:eventforge-email-queue',
      awsRegion: 'us-east-1',
    })),
  };
}

const validMessage: EmailQueueMessage = {
  orderId: '01HX1234567890ABCDEF',
  userId: 'user-123',
  customerEmail: 'customer@example.com',
  orderTotal: 109.97,
  items: [
    { name: 'Widget', quantity: 2, price: 29.99 },
    { name: 'Gadget', quantity: 1, price: 49.99 },
  ],
  timestamp: '2024-01-15T10:30:00Z',
};

const mockContext: Context = {} as Context;
const mockCallback: Callback = () => {};

describe('Email Processor Lambda', () => {
  describe('handler', () => {
    it('should send a confirmation email for a valid SQS message', async () => {
      sesMock.on(SendEmailCommand).resolves({ MessageId: 'ses-msg-1' });

      const event = createSQSEvent([validMessage]);
      await handler(event, mockContext, mockCallback);

      const sendCalls = sesMock.commandCalls(SendEmailCommand);
      expect(sendCalls).toHaveLength(1);

      const input = sendCalls[0].args[0].input;
      expect(input.Destination?.ToAddresses).toEqual(['customer@example.com']);
      expect(input.Message?.Subject?.Data).toBe(
        'Order Confirmation - 01HX1234567890ABCDEF'
      );
    });

    it('should use the configured sender email', async () => {
      sesMock.on(SendEmailCommand).resolves({ MessageId: 'ses-msg-1' });

      const event = createSQSEvent([validMessage]);
      await handler(event, mockContext, mockCallback);

      const sendCalls = sesMock.commandCalls(SendEmailCommand);
      const input = sendCalls[0].args[0].input;
      expect(input.Source).toBe('noreply@eventforge.io');
    });

    it('should include order items in the email body', async () => {
      sesMock.on(SendEmailCommand).resolves({ MessageId: 'ses-msg-1' });

      const event = createSQSEvent([validMessage]);
      await handler(event, mockContext, mockCallback);

      const sendCalls = sesMock.commandCalls(SendEmailCommand);
      const htmlBody = sendCalls[0].args[0].input.Message?.Body?.Html?.Data;
      expect(htmlBody).toContain('Widget');
      expect(htmlBody).toContain('Gadget');
      expect(htmlBody).toContain('$109.97');
    });

    it('should throw error on transient SES failure to allow SQS retry', async () => {
      const throttleError = new Error('Rate exceeded');
      throttleError.name = 'Throttling';
      sesMock.on(SendEmailCommand).rejects(throttleError);

      const event = createSQSEvent([validMessage]);
      await expect(handler(event, mockContext, mockCallback)).rejects.toThrow(
        'Rate exceeded'
      );
    });

    it('should throw error on non-transient SES failure to allow retry up to maxReceiveCount', async () => {
      const permanentError = new Error('Email address is not verified');
      permanentError.name = 'MessageRejected';
      sesMock.on(SendEmailCommand).rejects(permanentError);

      const event = createSQSEvent([validMessage]);
      await expect(handler(event, mockContext, mockCallback)).rejects.toThrow(
        'Email address is not verified'
      );
    });

    it('should process a single record from the SQS batch', async () => {
      sesMock.on(SendEmailCommand).resolves({ MessageId: 'ses-msg-1' });

      const event = createSQSEvent([validMessage]);
      await handler(event, mockContext, mockCallback);

      const sendCalls = sesMock.commandCalls(SendEmailCommand);
      expect(sendCalls).toHaveLength(1);
    });

    it('should parse order details from SQS message body', async () => {
      sesMock.on(SendEmailCommand).resolves({ MessageId: 'ses-msg-1' });

      const customMessage: EmailQueueMessage = {
        orderId: 'order-abc-123',
        userId: 'user-456',
        customerEmail: 'test@test.com',
        orderTotal: 50.0,
        items: [{ name: 'Book', quantity: 1, price: 50.0 }],
        timestamp: '2024-06-01T08:00:00Z',
      };

      const event = createSQSEvent([customMessage]);
      await handler(event, mockContext, mockCallback);

      const sendCalls = sesMock.commandCalls(SendEmailCommand);
      const input = sendCalls[0].args[0].input;
      expect(input.Destination?.ToAddresses).toEqual(['test@test.com']);
      expect(input.Message?.Subject?.Data).toContain('order-abc-123');
    });

    it('should throw on ServiceUnavailableException to allow SQS retry', async () => {
      const serviceError = new Error('Service unavailable');
      serviceError.name = 'ServiceUnavailableException';
      sesMock.on(SendEmailCommand).rejects(serviceError);

      const event = createSQSEvent([validMessage]);
      await expect(handler(event, mockContext, mockCallback)).rejects.toThrow(
        'Service unavailable'
      );
    });
  });

  describe('buildEmailBody', () => {
    it('should include order ID in the email body', () => {
      const body = buildEmailBody(validMessage);
      expect(body).toContain('01HX1234567890ABCDEF');
    });

    it('should include all item names', () => {
      const body = buildEmailBody(validMessage);
      expect(body).toContain('Widget');
      expect(body).toContain('Gadget');
    });

    it('should include item quantities', () => {
      const body = buildEmailBody(validMessage);
      expect(body).toContain('<td>2</td>');
      expect(body).toContain('<td>1</td>');
    });

    it('should include formatted prices', () => {
      const body = buildEmailBody(validMessage);
      expect(body).toContain('$29.99');
      expect(body).toContain('$49.99');
    });

    it('should include formatted total', () => {
      const body = buildEmailBody(validMessage);
      expect(body).toContain('$109.97');
    });

    it('should include the timestamp', () => {
      const body = buildEmailBody(validMessage);
      expect(body).toContain('2024-01-15T10:30:00Z');
    });

    it('should produce valid HTML structure', () => {
      const body = buildEmailBody(validMessage);
      expect(body).toContain('<html>');
      expect(body).toContain('</html>');
      expect(body).toContain('<table');
      expect(body).toContain('Order Confirmation');
    });
  });

  describe('isTransientError', () => {
    it('should return true for Throttling errors', () => {
      const error = new Error('Rate exceeded');
      error.name = 'Throttling';
      expect(isTransientError(error)).toBe(true);
    });

    it('should return true for ThrottlingException', () => {
      const error = new Error('Too many requests');
      error.name = 'ThrottlingException';
      expect(isTransientError(error)).toBe(true);
    });

    it('should return true for ServiceUnavailableException', () => {
      const error = new Error('Service unavailable');
      error.name = 'ServiceUnavailableException';
      expect(isTransientError(error)).toBe(true);
    });

    it('should return true for ETIMEDOUT errors', () => {
      const error = new Error('connect ETIMEDOUT 1.2.3.4:443');
      error.name = 'Error';
      expect(isTransientError(error)).toBe(true);
    });

    it('should return true for ECONNRESET errors', () => {
      const error = new Error('read ECONNRESET');
      error.name = 'Error';
      expect(isTransientError(error)).toBe(true);
    });

    it('should return false for MessageRejected errors', () => {
      const error = new Error('Email address is not verified');
      error.name = 'MessageRejected';
      expect(isTransientError(error)).toBe(false);
    });

    it('should return false for non-Error values', () => {
      expect(isTransientError('string error')).toBe(false);
      expect(isTransientError(null)).toBe(false);
      expect(isTransientError(undefined)).toBe(false);
    });

    it('should return true for InternalServiceError', () => {
      const error = new Error('Internal error');
      error.name = 'InternalServiceError';
      expect(isTransientError(error)).toBe(true);
    });
  });
});
