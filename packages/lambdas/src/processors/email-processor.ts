/**
 * Email Processor Lambda function
 *
 * Triggered by the email SQS queue to send order confirmation emails.
 * Parses the SQS message body for order details and sends a confirmation
 * email via SES.
 *
 * Configuration: timeout 30s, memory 128MB, batch size 1
 *
 * Requirements: 5.1, 5.4, 5.8
 */

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import type { SQSEvent, SQSHandler } from 'aws-lambda';

const SENDER_EMAIL = process.env.SENDER_EMAIL || 'noreply@eventforge.io';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

export interface EmailQueueMessage {
  orderId: string;
  userId: string;
  customerEmail: string;
  orderTotal: number;
  items: Array<{ name: string; quantity: number; price: number }>;
  timestamp: string;
}

const sesClient = new SESClient({ region: AWS_REGION });

/**
 * Extracts the domain message from an SQS record body.
 *
 * EventBridge delivers events to SQS wrapped in an envelope
 * ({ version, id, "detail-type", source, detail: {...} }). When the
 * parsed body looks like an EventBridge envelope, the inner `detail`
 * is returned. Otherwise the parsed body is treated as the domain
 * message directly (supports direct SQS sends and unit tests).
 *
 * Field aliases are normalized: `total` -> `orderTotal`.
 */
export function extractEmailMessage(body: string): Partial<EmailQueueMessage> {
  const parsed = JSON.parse(body) as Record<string, unknown>;

  const isEnvelope =
    parsed && typeof parsed === 'object' &&
    typeof parsed['detail'] === 'object' && parsed['detail'] !== null &&
    'detail-type' in parsed;

  const detail = (isEnvelope ? parsed['detail'] : parsed) as Record<string, unknown>;

  return {
    orderId: detail['orderId'] as string,
    userId: detail['userId'] as string,
    customerEmail: (detail['customerEmail'] as string) ?? (detail['email'] as string),
    orderTotal: (detail['orderTotal'] as number) ?? (detail['total'] as number),
    items: (detail['items'] as EmailQueueMessage['items']) ?? [],
    timestamp: detail['timestamp'] as string,
  };
}

/**
 * Builds the HTML email body for an order confirmation.
 */
export function buildEmailBody(message: EmailQueueMessage): string {
  const itemRows = message.items
    .map(
      (item) =>
        `<tr><td>${item.name}</td><td>${item.quantity}</td><td>$${item.price.toFixed(2)}</td></tr>`
    )
    .join('');

  return `
    <html>
      <body>
        <h1>Order Confirmation</h1>
        <p>Thank you for your order!</p>
        <p><strong>Order ID:</strong> ${message.orderId}</p>
        <p><strong>Date:</strong> ${message.timestamp}</p>
        <table border="1" cellpadding="5" cellspacing="0">
          <thead>
            <tr><th>Item</th><th>Quantity</th><th>Price</th></tr>
          </thead>
          <tbody>
            ${itemRows}
          </tbody>
        </table>
        <p><strong>Total: $${message.orderTotal.toFixed(2)}</strong></p>
      </body>
    </html>
  `.trim();
}

/**
 * Determines if an SES error is transient and should be retried via SQS.
 */
export function isTransientError(error: unknown): boolean {
  if (error instanceof Error) {
    const transientNames = [
      'Throttling',
      'ThrottlingException',
      'ServiceUnavailableException',
      'InternalServiceError',
      'RequestTimeout',
      'RequestTimeoutException',
    ];
    if (transientNames.includes(error.name)) {
      return true;
    }
    // Check for generic network/timeout errors
    if (error.message.includes('ETIMEDOUT') || error.message.includes('ECONNRESET')) {
      return true;
    }
  }
  return false;
}

/**
 * SQS event handler for the email processor.
 * Processes each record by parsing the message body and sending a confirmation email.
 * Throws on transient failures to allow SQS retry.
 */
export const handler: SQSHandler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    const message = extractEmailMessage(record.body);

    // Without a recipient email we cannot send. Skip gracefully rather than
    // crashing (which would poison the queue and fill the DLQ).
    if (!message.customerEmail) {
      console.warn(
        `Skipping email for order ${message.orderId ?? 'unknown'}: no customerEmail in event payload`
      );
      continue;
    }

    const fullMessage: EmailQueueMessage = {
      orderId: message.orderId ?? 'unknown',
      userId: message.userId ?? 'unknown',
      customerEmail: message.customerEmail,
      orderTotal: message.orderTotal ?? 0,
      items: message.items ?? [],
      timestamp: message.timestamp ?? new Date().toISOString(),
    };

    console.log(
      `Processing email for order ${fullMessage.orderId} to ${fullMessage.customerEmail}`
    );

    const htmlBody = buildEmailBody(fullMessage);

    const sendEmailCommand = new SendEmailCommand({
      Source: SENDER_EMAIL,
      Destination: {
        ToAddresses: [fullMessage.customerEmail],
      },
      Message: {
        Subject: {
          Data: `Order Confirmation - ${fullMessage.orderId}`,
          Charset: 'UTF-8',
        },
        Body: {
          Html: {
            Data: htmlBody,
            Charset: 'UTF-8',
          },
        },
      },
    });

    try {
      await sesClient.send(sendEmailCommand);
      console.log(
        `Successfully sent confirmation email for order ${fullMessage.orderId}`
      );
    } catch (error: unknown) {
      if (isTransientError(error)) {
        console.error(
          `Transient error sending email for order ${fullMessage.orderId}, will retry:`,
          error
        );
        // Throw to let SQS retry after visibility timeout
        throw error;
      }

      // For non-transient errors, also throw to allow retry up to maxReceiveCount
      // After max receives, message goes to DLQ
      console.error(
        `Error sending email for order ${fullMessage.orderId}:`,
        error
      );
      throw error;
    }
  }
};
