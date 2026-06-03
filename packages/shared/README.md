# @eventforge/shared

Shared data layer, types, and utilities used across the API service and Lambda functions.

## What's in Here

### DynamoDB Key Construction (`dynamo-keys.ts`)

Utility functions for building partition/sort keys following the single-table design:

```typescript
orderKey("abc123")        // → "ORDER#abc123"
orderMetadataSK()         // → "METADATA"
orderEventSK(ts, id)     // → "EVENT#{timestamp}#{eventId}"
userKey("user1")          // → "USER#user1"
userOrderSK("abc123")    // → "ORDER#abc123"
idempotencyKey("key1")   // → "IDEMPOTENCY#key1"
idempotencyLockSK()      // → "LOCK"
```

### Order Repository (`order-repository.ts`)

CRUD operations for orders with idempotency protection:

- `createOrder(client, order, idempotencyKey)` — Transactional write (order + user-order + idempotency lock)
- `getOrder(client, orderId)` — Get order metadata
- `getOrderWithEvents(client, orderId)` — Order + all events in one query
- `getUserOrders(client, userId, limit)` — GSI2 query, sorted desc, max 50
- `updateOrderStatus(client, orderId, status)` — Update with GSI1PK refresh

### Event Repository (`event-repository.ts`)

Store and query order events:

- `storeEvent(orderId, event)` — Write event with timestamp-based sort key
- `getRecentEvents(limit)` — Scan for recent events, sorted desc, max 100
- `getOrderEvents(orderId)` — Query all events for an order

## DynamoDB Table Design

Single table: `eventforge-events` (on-demand billing)

| Entity | PK | SK |
|--------|----|----|
| Order | ORDER#{orderId} | METADATA |
| Event | ORDER#{orderId} | EVENT#{timestamp}#{eventId} |
| User-Order | USER#{userId} | ORDER#{orderId} |
| Idempotency | IDEMPOTENCY#{key} | LOCK (TTL: 24h) |

**GSI1**: status → createdAt (orders by status)
**GSI2**: userId → createdAt (user's order history)

## Tests

```bash
npm test -- --testPathPattern="packages/shared"
```

Property-based tests verify key construction patterns and idempotency round-trips across random inputs.
