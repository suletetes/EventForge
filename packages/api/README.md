# @eventforge/api

The REST API. Runs on ECS Fargate behind an ALB. Handles orders, events, webhooks, and talks to DynamoDB and EventBridge.

## How it works

Express app, TypeScript, Node 20. Runs in a Docker container on Fargate with 0.25 vCPU and 512 MB memory. Autoscales between 1 and 4 tasks based on CPU (target 70%).

The middleware stack, in order:
1. CORS
2. JSON body parser (256 KB limit)
3. Request ID generation (ULID)
4. X-Ray tracing (skips /health)
5. JWT auth via Cognito (skips /health)
6. Routes
7. Error handler (structured JSON responses)

## Endpoints

| Method | Path | Auth | What |
|--------|------|------|------|
| GET | /health | No | Health check for the ALB |
| POST | /api/orders | Yes | Create order |
| GET | /api/orders | Yes | List your orders |
| GET | /api/orders/:id | Yes | Order details with events |
| GET | /api/orders/:id/receipt | Yes | Presigned URL for PDF |
| POST | /api/webhooks | Yes | Register webhook URL |
| GET | /api/events | Yes | Recent events feed |

## Running locally

```bash
cd packages/api
npm install
npm run build
node dist/server.js
```

Env vars you'll need:
- `PORT` (default 3000)
- `DYNAMODB_TABLE`
- `EVENT_BUS_NAME`
- `COGNITO_USER_POOL_ID`
- `COGNITO_REGION`
- `RECEIPTS_BUCKET`
- `AWS_XRAY_DAEMON_ADDRESS` (set this to enable tracing)

## Docker

```bash
docker build -t eventforge-api .
docker run -p 3000:3000 eventforge-api
```

Two-stage build. Final image has only production deps and runs as the `node` user.

## Tests

```bash
npm test -- --testPathPattern="packages/api"
```
