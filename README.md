# EventForge

I built this to answer the question every AWS interview asks: when do you use containers, and when do you use serverless?

The answer is "both, in the same system." The API runs on ECS Fargate because it needs consistent sub-200ms responses with no cold starts. Background processing runs on Lambda because those tasks are bursty and benefit from scale-to-zero. This project puts them together in a realistic e-commerce order processing platform.

## Architecture

I split the architecture into three diagrams because one giant diagram is unreadable.

### Request flow

How a user's request gets from the browser to the database and back. The API publishes every state change to EventBridge, which decouples everything downstream.

![Request Flow](docs/eventforge-1-request-flow.png)

### Order processing workflow

The interesting part. Step Functions runs a saga: Validate, Reserve Inventory, Charge Payment, Confirm. If payment fails after inventory is reserved, the workflow compensates by releasing the reservation before marking the order as failed.

![Order Workflow](docs/eventforge-2-order-workflow.png)

### Background processing and observability

After an order completes, EventBridge fans out to three SQS queues. Lambda processors handle email, PDF receipts, and webhook delivery. Each queue has a dead letter queue with CloudWatch alarms. X-Ray traces everything.

![Background Processing](docs/eventforge-3-background-processing.png)

## Why both containers and serverless

| | ECS Fargate | Lambda |
|--|-------------|--------|
| API responses | Consistent sub-200ms, no cold starts | Cold starts add 500ms-3s |
| Sustained traffic | Predictable cost | Expensive at high RPS |
| Background tasks | Paying for idle time | Scale to zero, pay per invocation |
| Burst scaling | Takes minutes | Takes milliseconds |

Fargate for the API. Lambda for the background work. That's the whole insight.

## What's in here

| Layer | What |
|-------|------|
| API | TypeScript, Express, ECS Fargate |
| Event processors | TypeScript Lambda functions |
| Workflow | Step Functions (saga pattern with compensation) |
| Event bus | EventBridge custom bus |
| Queues | SQS with dead letter queues |
| Database | DynamoDB single table design, on-demand |
| Auth | Cognito JWT tokens |
| Frontend | React on S3/CloudFront |
| Observability | X-Ray tracing, CloudWatch alarms |
| Infrastructure | AWS SAM / CloudFormation, nested stacks |

## Project structure

```
EventForge/
├── packages/
│   ├── api/          Express REST API (runs on ECS Fargate)
│   ├── lambdas/      All Lambda functions
│   ├── shared/       DynamoDB data layer, types, utilities
│   ├── frontend/     React dashboard
│   └── infra/        SAM/CloudFormation templates
├── docs/             Architecture diagrams (code + images)
├── template.yaml     Root SAM template (deploys everything)
├── jest.config.js    Test config
└── tsconfig.json     TypeScript project references
```

## Getting started

You need Node.js 20+, AWS CLI, AWS SAM CLI, and Docker.

```bash
npm install
npm run build
npm test          # 343 tests, including property-based tests
sam deploy --guided
```

The root `template.yaml` deploys all infrastructure in dependency order via nested stacks. One command.

## API

| Method | Path | What it does |
|--------|------|-------------|
| POST | /api/orders | Create an order, publishes order.created event |
| GET | /api/orders | Your orders, sorted by date, max 50 |
| GET | /api/orders/:id | Order details with full event history |
| GET | /api/orders/:id/receipt | Presigned URL for the PDF receipt |
| POST | /api/webhooks | Register a URL to receive events |
| GET | /api/events | Recent events for the dashboard, max 100 |
| GET | /health | Health check, no auth needed |
| POST | /webhooks/ingest | External event ingestion (via API Gateway) |

All endpoints except /health and /webhooks/ingest require a Cognito JWT.

## What it costs

About $35/month in dev with two Fargate tasks running. Most of that is the ALB ($16) and Fargate ($18). Everything else falls under free tier at low traffic. Tear down ECS and the ALB when you're not using it to stay under $5.

## Tests

343 tests across 35 suites. 19 of those are property-based tests using fast-check with 100 random inputs each. They verify things like "for any valid order, the system always produces a pending record and an event" and "if any webhook URL fails, the processor retries all of them."

```bash
npm test
```

## License

MIT
