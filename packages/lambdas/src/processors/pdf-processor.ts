/**
 * PDF Processor Lambda function
 *
 * Triggered by SQS messages from the PDF queue. For each message:
 * 1. Parses the SQS record body for order details (PDFQueueMessage)
 * 2. Generates a PDF receipt with order items, totals, and timestamp
 * 3. Uploads the PDF to S3 with key `receipts/{orderId}.pdf`
 *
 * Configuration: timeout 60s, memory 512MB, batch size 1
 * On transient S3 errors, throws to allow SQS retry.
 *
 * Requirements: 5.2, 5.5, 5.8
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import type { SQSEvent, SQSHandler } from 'aws-lambda';

function getReceiptsBucket(): string {
  return process.env.RECEIPTS_BUCKET || 'eventforge-receipts';
}

export interface PDFQueueMessage {
  orderId: string;
  userId: string;
  items: Array<{ name: string; quantity: number; price: number }>;
  total: number;
  timestamp: string;
  s3Key: string;
}

const s3Client = new S3Client({});

/**
 * Generates a simple PDF buffer for the receipt.
 * Uses a minimal PDF structure with order details rendered as text.
 */
export function generatePDFBuffer(message: PDFQueueMessage): Buffer {
  const lines: string[] = [];

  lines.push('RECEIPT');
  lines.push('==============================');
  lines.push(`Order ID: ${message.orderId}`);
  lines.push(`Date: ${message.timestamp}`);
  lines.push(`Customer: ${message.userId}`);
  lines.push('');
  lines.push('Items:');
  lines.push('------------------------------');

  for (const item of message.items) {
    const lineTotal = (item.quantity * item.price).toFixed(2);
    lines.push(`  ${item.name} x${item.quantity} @ $${item.price.toFixed(2)} = $${lineTotal}`);
  }

  lines.push('------------------------------');
  lines.push(`TOTAL: $${message.total.toFixed(2)}`);
  lines.push('==============================');
  lines.push('Thank you for your order!');

  const content = lines.join('\n');

  // Generate a minimal valid PDF with the receipt content
  return createMinimalPDF(content);
}

/**
 * Creates a minimal valid PDF document containing the given text content.
 */
function createMinimalPDF(text: string): Buffer {
  const escapedText = text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const textLines = escapedText.split('\n');

  // Build PDF text content with line positioning
  let streamContent = 'BT\n/F1 10 Tf\n';
  let yPosition = 750;
  for (const line of textLines) {
    streamContent += `1 0 0 1 50 ${yPosition} Tm\n(${line}) Tj\n`;
    yPosition -= 14;
  }
  streamContent += 'ET\n';

  const streamBytes = Buffer.from(streamContent, 'ascii');

  const objects: string[] = [];

  // Object 1: Catalog
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  // Object 2: Pages
  objects.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');

  // Object 3: Page
  objects.push(
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n'
  );

  // Object 4: Content stream
  objects.push(
    `4 0 obj\n<< /Length ${streamBytes.length} >>\nstream\n${streamContent}endstream\nendobj\n`
  );

  // Object 5: Font
  objects.push(
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj\n'
  );

  // Build the PDF
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];

  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'ascii'));
    pdf += obj;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'ascii');
  pdf += 'xref\n';
  pdf += `0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (const offset of offsets) {
    pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  }

  pdf += 'trailer\n';
  pdf += `<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += 'startxref\n';
  pdf += `${xrefOffset}\n`;
  pdf += '%%EOF\n';

  return Buffer.from(pdf, 'ascii');
}

export const handler: SQSHandler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    const message: PDFQueueMessage = JSON.parse(record.body);

    console.log(`Processing PDF receipt for order ${message.orderId}`);

    // Generate PDF receipt
    const pdfBuffer = generatePDFBuffer(message);

    const s3Key = `receipts/${message.orderId}.pdf`;
    const bucket = getReceiptsBucket();

    // Upload to S3 - throw on transient errors to allow SQS retry
    try {
      await s3Client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: s3Key,
          Body: pdfBuffer,
          ContentType: 'application/pdf',
        })
      );

      console.log(`PDF receipt uploaded to s3://${bucket}/${s3Key}`);
    } catch (error: unknown) {
      const err = error as Error;
      console.error(`Failed to upload PDF for order ${message.orderId}: ${err.message}`);
      // Throw to allow SQS retry on transient failures
      throw error;
    }
  }
};
