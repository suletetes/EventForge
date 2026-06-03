# @eventforge/lambdas

All Lambda functions for the EventForge platform: workflow steps, background processors, and webhook ingestion.

## Functions

### Workflow Steps (Step Functions)

Invoked by the Order Workflow state machine in sequence. Each receives and passes through the full order context.

| Function | Timeout | Memory | Purpose |
|----------|---------|--------|---------|
| validate-order | 10s | 128 MB | Validate order exists and has valid structure |
| reserve-inventory | 10s | 128 MB | DynamoDB conditional write to reserve items |
| charge-payment | 30s | 256 MB | Simulate payment gateway (fails if total > 500K) |
| confirm-order | 10s | 128 MB | Update status to completed, emit order.completed |
| release-inventory | 10s | 128 MB | Compensation: release reserved items on failure |
| order-failed | 10s | 128 MB | Persist failure status in DynamoDB |

### Background Processors (SQS-triggered)

| Function | Queue | Timeout | Memory | Max Receives | Behavior on Failure |
|----------|-------|---------|--------|--------------|---------------------|
| email-processor | email-queue | 30s | 128 MB | 3 | Throw → SQS retry → DLQ |
| pdf-processor | pdf-queue | 60s | 512 MB | 3 | Throw → SQS retry → DLQ |
| webhook-processor | webhook-queue | 30s | 128 MB | 5 | Any URL fails → throw → full retry |

### Ingestion

| Function | Trigger | Purpose |
|----------|---------|---------|
| webhook-ingest | API Gateway HTTP API | Validate & publish external events to EventBridge |

## Project Structure

```
packages/lambdas/src/
├── workflow/
│   ├── validate-order.ts
│   ├── reserve-inventory.ts
│   ├── charge-payment.ts
│   ├── confirm-order.ts
│   ├── release-inventory.ts
│   └── order-failed.ts
├── processors/
│   ├── email-processor.ts
│   ├── pdf-processor.ts
│   └── webhook-processor.ts
└── ingestion/
    └── webhook-ingest.ts
```

## Error Handling

- **Workflow steps**: Throw errors that Step Functions catches. Retry and compensation configured in the ASL definition.
- **SQS processors**: Throw on any failure. SQS handles retry via visibility timeout. After max receives, messages go to DLQ.
- **Webhook processor**: If ANY registered URL fails delivery, throws to retry the entire message on ALL URLs.

## Tests

```bash
npm test -- --testPathPattern="packages/lambdas"
```

Includes property-based tests for saga compensation, context preservation, and webhook retry behavior.
