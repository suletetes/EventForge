# @eventforge/shared

The data layer. Key construction utilities, order repository, event repository. Used by both the API and the Lambda functions.

## DynamoDB table design

Single table called `eventforge-events`. On-demand billing. Everything goes in here:

| What | PK | SK |
|------|----|----|
| Order | ORDER#{orderId} | METADATA |
| Order event | ORDER#{orderId} | EVENT#{timestamp}#{eventId} |
| User's orders | USER#{userId} | ORDER#{orderId} |
| Idempotency lock | IDEMPOTENCY#{key} | LOCK (TTL: 24h) |

Two GSIs:
- GSI1: status + createdAt (find orders by status)
- GSI2: userId + createdAt (user's order history, sorted)

## What's exported

### Key utilities (`dynamo-keys.ts`)

```typescript
orderKey("abc")           // "ORDER#abc"
orderMetadataSK()         // "METADATA"
orderEventSK(ts, id)     // "EVENT#{ts}#{id}"
userKey("user1")          // "USER#user1"
userOrderSK("abc")       // "ORDER#abc"
idempotencyKey("k")      // "IDEMPOTENCY#k"
idempotencyLockSK()      // "LOCK"
```

### Order repository (`order-repository.ts`)

- `createOrder(client, order, idempotencyKey)` - transactional write with idempotency protection
- `getOrder(client, orderId)` - get order metadata
- `getOrderWithEvents(client, orderId)` - order + events in one query
- `getUserOrders(client, userId, limit)` - user's orders, sorted desc, max 50
- `updateOrderStatus(client, orderId, status)` - update status and GSI1

### Event repository (`event-repository.ts`)

- `storeEvent(orderId, event)` - write event with timestamp sort key
- `getRecentEvents(limit)` - recent events across all orders, max 100
- `getOrderEvents(orderId)` - all events for one order

## Tests

```bash
npm test -- --testPathPattern="packages/shared"
```

Property tests verify key construction patterns and idempotency behavior across random inputs.
