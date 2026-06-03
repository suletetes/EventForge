# @eventforge/lambdas

All the Lambda functions. Workflow steps, background processors, and the webhook ingestion handler.

## Workflow steps

These get called by Step Functions in sequence. Each one receives the full order context (orderId, userId, items, total) and passes it along.

| Function | What it does |
|----------|-------------|
| validate-order | Checks order exists in DynamoDB, validates structure |
| reserve-inventory | Conditional write to mark items as reserved |
| charge-payment | Simulates payment. Fails if total > 500K (triggers compensation) |
| confirm-order | Sets status to completed, publishes order.completed event |
| release-inventory | Compensation step. Undoes the reservation on failure |
| order-failed | Persists status = failed in DynamoDB |

If charge or confirm fails after inventory is reserved, the state machine routes to release-inventory first. That's the saga pattern.

## Background processors

Triggered by SQS. Each processes one message at a time (batch size 1).

| Function | Queue | Timeout | Memory | Retries before DLQ |
|----------|-------|---------|--------|-------------------|
| email-processor | email-queue | 30s | 128 MB | 3 |
| pdf-processor | pdf-queue | 60s | 512 MB | 3 |
| webhook-processor | webhook-queue | 30s | 128 MB | 5 |

The webhook processor has a specific rule: if any registered URL fails delivery, it throws so the entire message retries on all URLs. No partial delivery.

## Ingestion

`webhook-ingest` handles POST /webhooks/ingest via API Gateway. Validates the payload (must have source, detail-type, detail fields, under 256 KB), publishes to EventBridge, returns 202.

## Structure

```
src/
├── workflow/           Step Functions handlers
├── processors/         SQS-triggered handlers
└── ingestion/          API Gateway handler
```

## Tests

```bash
npm test -- --testPathPattern="packages/lambdas"
```

Includes property tests for saga compensation, context preservation, and the webhook retry behavior.
