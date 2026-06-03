# @eventforge/frontend

React dashboard. Shows events flowing through the system in near-real-time.

## What it does

- Authenticates via Cognito (redirects to login if you're not signed in)
- Polls /api/events every 10 seconds
- Shows the 50 most recent events in a table
- Shows order status with the current workflow step (Validate, Reserve, Charge, Confirm, or Failed)
- If a request fails, it shows an error but keeps the previous data and retries next cycle

## Components

- `App.tsx` - auth check, renders the dashboard when signed in
- `components/Dashboard.tsx` - polling logic, data fetching, error state
- `components/EventList.tsx` - event table
- `components/OrderStatus.tsx` - order table with workflow step mapping

## Auth flow

1. App loads, checks if there's a valid Cognito session
2. If not, redirects to Cognito hosted UI
3. On success, stores the token
4. Every API request includes `Authorization: Bearer <token>`
5. If the API returns 401, redirects back to login

## Env vars

```
REACT_APP_API_BASE_URL=/api
REACT_APP_COGNITO_USER_POOL_ID=us-east-1_xxxxx
REACT_APP_COGNITO_CLIENT_ID=xxxxxxx
REACT_APP_COGNITO_DOMAIN=eventforge-dev.auth.us-east-1.amazoncognito.com
REACT_APP_REDIRECT_SIGN_IN=https://your-domain.com
REACT_APP_REDIRECT_SIGN_OUT=https://your-domain.com
```

## Deploying

Build the static files, upload to S3, invalidate CloudFront:

```bash
npm run build
aws s3 sync dist/ s3://$BUCKET/ --delete
aws cloudfront create-invalidation --distribution-id $DIST_ID --paths "/*"
```
