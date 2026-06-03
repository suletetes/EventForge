# @eventforge/api

The REST API service running on ECS Fargate. Handles order management, event publishing, webhook registration, and serves the real-time event feed for the dashboard.

## Architecture

- **Runtime**: Node.js 20, Express, TypeScript
- **Deployment**: ECS Fargate (0.25 vCPU, 512 MB)
- **Autoscaling**: 1–4 tasks, CPU target 70%
- **Load Balancer**: ALB with /health checks (30s interval)
- **Security**: Private subnets, ALB SG → ECS SG on port 3000

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /health | No | Health check |
| POST | /api/orders | JWT | Create order |
| GET | /api/orders | JWT | List user orders |
| GET | /api/orders/:id | JWT | Order details + events |
| GET | /api/orders/:id/receipt | JWT | Presigned PDF URL |
| POST | /api/webhooks | JWT | Register webhook URL |
| GET | /api/events | JWT | Recent events feed |

## Middleware Stack

1. CORS
2. JSON body parser (256 KB limit)
3. Request ID generation (ULID)
4. X-Ray tracing (skip /health)
5. JWT authentication (skip /health)
6. Route handlers
7. Error handling (structured JSON responses)

## Local Development

```bash
cd packages/api
npm install
npm run build
node dist/server.js
```

Environment variables:
- `PORT` — Server port (default: 3000)
- `DYNAMODB_TABLE` — DynamoDB table name
- `EVENT_BUS_NAME` — EventBridge bus name
- `COGNITO_USER_POOL_ID` — Cognito user pool ID
- `COGNITO_REGION` — AWS region for Cognito
- `RECEIPTS_BUCKET` — S3 bucket for PDF receipts
- `AWS_XRAY_DAEMON_ADDRESS` — X-Ray daemon (enables tracing)

## Docker

```bash
docker build -t eventforge-api .
docker run -p 3000:3000 eventforge-api
```

Multi-stage build: Node 20 Alpine, production deps only, runs as non-root `node` user.

## Tests

```bash
# From repo root
npm test -- --testPathPattern="packages/api"
```

Covers: JWT validation, authorization, order validation, event publishing, route handlers, X-Ray middleware.
