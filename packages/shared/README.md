# @crosstown/shared

Shared ILP types and OER codec for Connector.

## Install

```bash
npm install @crosstown/shared
```

## Usage

```typescript
import {
  ILPPreparePacket,
  ILPFulfillPacket,
  PacketType,
  serializePacket,
  deserializePacket,
} from '@crosstown/shared';

// Create an ILP Prepare packet
const prepare: ILPPreparePacket = {
  type: PacketType.Prepare,
  amount: BigInt(1000),
  expiresAt: new Date(Date.now() + 30000),
  executionCondition: Buffer.alloc(32),
  destination: 'g.example.receiver',
  data: Buffer.alloc(0),
};

// Serialize to binary (OER encoding per RFC-0030)
const encoded: Buffer = serializePacket(prepare);

// Deserialize back
const decoded = deserializePacket(encoded);
```

## Exported Types

- **ILP Packets**: `ILPPreparePacket`, `ILPFulfillPacket`, `ILPRejectPacket`, `ILPPacket`, `PacketType`, `ILPErrorCode`
- **BTP Types**: BTP message and frame types for bilateral transfer protocol
- **Routing Types**: `RoutingTableEntry` and routing table structures
- **Telemetry Types**: `TelemetryEvent`, settlement events, payment channel events
- **Payment Channel Types**: `ChannelState`, `ChannelStatus`, `BalanceProof`
- **Validation**: `isValidILPAddress`, `isPreparePacket`, `isFulfillPacket`, `isRejectPacket`
- **OER Encoding**: `serializePacket`, `deserializePacket`, OER primitives

## Monorepo

This package is part of the [connector](https://github.com/ALLiDoizCode/connector) monorepo.

## License

MIT
