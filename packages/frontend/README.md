# @eventforge/frontend

React dashboard for visualizing the EventForge event flow and order processing status in real time.

## Features

- Cognito-based authentication (redirect to login if unauthenticated)
- Polls `/api/events` every 10 seconds for live event updates
- Displays the 50 most recent events (type, source, timestamp)
- Shows order status and current workflow step (ValidateOrder, ReserveInventory, ChargePayment, ConfirmOrder, Failed)
- Error handling with retry on next poll cycle
- Hosted on S3 + CloudFront (HTTPS)

## Components

| Component | File | Purpose |
|-----------|------|---------|
| App | `src/App.tsx` | Auth check, renders Dashboard when authenticated |
| Dashboard | `src/components/Dashboard.tsx` | Polling logic, data fetching, error state |
| EventList | `src/components/EventList.tsx` | Table of recent events |
| OrderStatus | `src/components/OrderStatus.tsx` | Order table with workflow step mapping |

## Auth Flow

1. App checks `isAuthenticated()` on mount
2. If not authenticated → redirect to Cognito hosted UI
3. On successful auth → store JWT token
4. All API requests include `Authorization: Bearer <token>`
5. On 401 response → redirect back to login

## Environment Variables

```env
REACT_APP_API_BASE_URL=/api
REACT_APP_COGNITO_USER_POOL_ID=us-east-1_xxxxx
REACT_APP_COGNITO_CLIENT_ID=xxxxxxx
REACT_APP_COGNITO_DOMAIN=eventforge-dev.auth.us-east-1.amazoncognito.com
REACT_APP_REDIRECT_SIGN_IN=https://your-cloudfront-domain.com
REACT_APP_REDIRECT_SIGN_OUT=https://your-cloudfront-domain.com
```

## Development

```bash
cd packages/frontend
npm install
npm run dev    # TypeScript watch mode
```

## Deployment

Built static files are uploaded to the S3 dashboard bucket. CloudFront serves them with HTTPS and SPA routing (404/403 → index.html).

```bash
npm run build
aws s3 sync dist/ s3://${DASHBOARD_BUCKET}/ --delete
aws cloudfront create-invalidation --distribution-id ${CF_DIST_ID} --paths "/*"
```
