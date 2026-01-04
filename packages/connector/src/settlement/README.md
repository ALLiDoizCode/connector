# Settlement Layer

**Purpose:** TigerBeetle integration for double-entry accounting and peer balance tracking

This module provides the foundation for settlement operations in the M2M connector, integrating with TigerBeetle's high-performance accounting database for tracking peer balances and transfer operations.

## Architecture Context

The settlement layer implements Epic 6 (Settlement Foundation & Accounting) requirements:

- **Story 6.1 (completed)**: TigerBeetle deployment foundation
- **Story 6.2**: TigerBeetle client library integration (this module)
- Story 6.3: Account management for peer settlement
- Story 6.4: Packet handler integration for recording transfers
- Story 6.5: Credit limit enforcement
- Story 6.6: Settlement threshold detection
- Story 6.7: Settlement API stub
- Story 6.8: Dashboard visualization for settlement

## Components

### TigerBeetleClient (Story 6.2)

TypeScript wrapper for the official `tigerbeetle-node` client library, providing:

- Type-safe APIs for account creation, transfer creation, and balance queries
- Error handling and mapping to application-level error types
- Structured logging for all operations
- Timeout handling and connection management
- Batch operation support

### Future Components

- **AccountManager** (Story 6.3): Peer account mapping and lifecycle management
- **SettlementMonitor** (Story 6.4): Integration with packet handler for transfer recording
- **SettlementAPI** (Story 6.7): Settlement initiation and webhook notifications

## Usage

```typescript
import { TigerBeetleClient } from './settlement/tigerbeetle-client';

// Initialize client
const client = new TigerBeetleClient(
  {
    clusterId: 0,
    replicaAddresses: ['tigerbeetle:3000'],
    operationTimeout: 5000,
  },
  logger
);

await client.initialize();

// Create accounts
await client.createAccount(123n, 1, 100);

// Create transfer
await client.createTransfer(456n, 123n, 789n, 1000n, 1, 100);

// Query balance
const balance = await client.getAccountBalance(123n);
console.log(`Balance: ${balance.balance}`);
```

## Technical Details

- **Database:** TigerBeetle (high-performance accounting database)
- **Protocol:** Binary protocol over TCP (port 3000)
- **Data Model:** Double-entry accounting with accounts and transfers
- **Client Library:** `tigerbeetle-node` (official Node.js client with TypeScript types)

## References

- [Epic 6: Settlement Foundation & Accounting](../../docs/prd/epic-6-settlement-foundation.md)
- [Story 6.1: TigerBeetle Deployment](../../docs/stories/6.1.story.md)
- [Story 6.2: TigerBeetle Client Library Integration](../../docs/stories/6.2.story.md)
- [TigerBeetle Documentation](https://docs.tigerbeetle.com/)
