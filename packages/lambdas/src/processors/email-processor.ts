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
    const message: EmailQueueMessage = JSON.parse(record.body);

    console.log(
      `Processing email for order ${message.orderId} to ${message.customerEmail}`
    );

    const htmlBody = buildEmailBody(message);

    const sendEmailCommand = new SendEmailCommand({
      Source: SENDER_EMAIL,
      Destination: {
        ToAddresses: [message.customerEmail],
      },
      Message: {
        Subject: {
          Data: `Order Confirmation - ${message.orderId}`,
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
        `Successfully sent confirmation email for order ${message.orderId}`
      );
    } catch (error: unknown) {
      if (isTransientError(error)) {
        console.error(
          `Transient error sending email for order ${message.orderId}, will retry:`,
          error
        );
        // Throw to let SQS retry after visibility timeout
        throw error;
      }

      // For non-transient errors, also throw to allow retry up to maxReceiveCount
      // After max receives, message goes to DLQ
      console.error(
        `Error sending email for order ${message.orderId}:`,
        error
      );
      throw error;
    }
  }
};
