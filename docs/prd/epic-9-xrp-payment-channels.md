# Epic 9: XRP Payment Channels

**Epic Number:** 9

**Goal:** Integrate XRP Ledger payment channels (PayChan) for settlement, enabling dual-settlement support where connectors can settle using both EVM payment channels (Epic 8) and XRP payment channels depending on peer preference and token availability. Build complete XRP payment channel infrastructure including rippled client integration, PayChan channel lifecycle management SDK, claim verification and submission, integration with Epic 6's TigerBeetle accounting for automatic settlement triggers, and unified settlement API that abstracts EVM vs XRP settlement details. This epic delivers multi-chain settlement capability, allowing the M2M economy to support both Ethereum-based tokens and XRP native payments.

**Foundation:** This epic builds on the XRP Ledger payment channels specification and the local rippled infrastructure from Epic 7, enabling production XRP settlement via public XRPL mainnet while developing/testing against local rippled standalone mode.

**Important:** This epic focuses on **XRP Ledger native payment channels** (PayChan transaction type). Connectors will connect to XRP Ledger mainnet via public RPC endpoints (e.g., `wss://xrplcluster.com`) for production, but use local rippled (from Epic 7) for development and testing. XRP payment channels are fundamentally different from EVM channels: they use native XRP (not tokens), have different claim/signature mechanics, and settle on-ledger with different finality guarantees.

---

## Story 9.1: rippled Client Integration and Development Environment

As a connector developer,
I want a TypeScript client for interacting with XRP Ledger and local rippled,
so that I can create payment channels, submit claims, and query channel states.

**Prerequisites:** Epic 7 "Local Blockchain Development Infrastructure" completed - rippled standalone mode running via `docker-compose-dev.yml`

### Acceptance Criteria

1. `xrpl.js` library added as dependency to `packages/connector/package.json`
2. `XRPLClient` class implemented in `packages/connector/src/settlement/xrpl-client.ts` wrapping xrpl.js
3. Client initialization accepts rippled WebSocket URL from environment variables (`XRPL_WSS_URL`)
4. Client configured for both local rippled (`ws://localhost:6006`) and mainnet (`wss://xrplcluster.com`)
5. Client implements connection pooling and automatic reconnection on WebSocket failures
6. Client exposes methods for: account info, transaction submission, ledger queries, channel lookups
7. Client gracefully handles rippled errors and maps them to application-level error types
8. Client logs all XRPL operations (channel creation, claims, closes) with structured logging
9. Environment variables support: `XRPL_WSS_URL`, `XRPL_ACCOUNT_SECRET`, `XRPL_ACCOUNT_ADDRESS`
10. Integration test connects to local rippled (from Epic 7) and performs basic operations (fund account, query balance)

### Technical Notes

**Development Stack:**

- **xrpl.js:** Official XRP Ledger JavaScript library
- **Local rippled:** Provided by Epic 7 at `ws://localhost:6006` (standalone mode)
- **XRPL Testnet:** `wss://s.altnet.rippletest.net:51233` (optional for testnet testing)
- **XRPL Mainnet:** `wss://xrplcluster.com` or `wss://s1.ripple.com` (production)

**Development Workflow:**

```
1. Develop locally: Connect to local rippled (instant, free XRP faucet, offline)
   ↓
2. Test on testnet: Connect to XRPL Testnet (public testnet, faucet available)
   ↓
3. Deploy to mainnet: Connect to XRPL Mainnet (production, real XRP)
```

**Configuration:**

```typescript
// Environment variables
XRPL_WSS_URL=ws://localhost:6006  // Local rippled (dev)
XRPL_WSS_URL=wss://xrplcluster.com  // Mainnet (production)

// Client initialization
const client = new XRPLClient({
  server: process.env.XRPL_WSS_URL,
  secret: process.env.XRPL_ACCOUNT_SECRET,
  address: process.env.XRPL_ACCOUNT_ADDRESS
});
```

**Local rippled Faucet:**

- Local rippled in standalone mode starts with genesis account pre-funded
- Use `xrpl.Wallet.fromSeed()` with known test seed
- Fund connector accounts from genesis account

---

## Story 9.2: XRP Payment Channel Creation and Funding

As a settlement engine,
I want to create and fund XRP payment channels using PayChan transactions,
so that I can establish bidirectional payment channels with peers for XRP settlement.

### Acceptance Criteria

1. `PaymentChannelManager` class implemented in `packages/connector/src/settlement/xrp-channel-manager.ts`
2. Channel manager implements `createChannel(destination, amount, settleDelay)` method using PayChan transaction
3. PayChan transaction includes: `Destination` (peer address), `Amount` (XRP drops), `SettleDelay` (seconds), `PublicKey` (for claim verification)
4. Channel manager generates unique channel ID from transaction hash
5. Channel manager tracks channel state: channel ID, source, destination, amount, balance, settle delay, expiration
6. Channel manager implements `fundChannel(channelId, additionalAmount)` to add more XRP to existing channel
7. Channel manager validates channel creation success by querying ledger for channel entry
8. Channel manager stores channel metadata in local database (channel ID, peer ID, token type=XRP)
9. Unit tests verify channel creation with various amounts and settle delays
10. Integration test creates channel on local rippled and verifies channel exists on-ledger

### PayChan Transaction Structure

```typescript
// XRP Payment Channel Creation
const createChannelTx = {
  TransactionType: 'PaymentChannelCreate',
  Account: myAddress, // Source account (connector)
  Destination: peerAddress, // Destination account (peer)
  Amount: '1000000000', // 1000 XRP in drops (1 XRP = 1,000,000 drops)
  SettleDelay: 86400, // 24 hours settlement delay
  PublicKey: myPublicKey, // Public key for claim signature verification
  CancelAfter: cancelTimestamp, // Optional: auto-close channel after timestamp
};

// Submit transaction
const result = await client.submitAndWait(createChannelTx);
const channelId = result.result.hash; // Transaction hash becomes channel ID
```

### Channel State Tracking

```typescript
interface XRPChannelState {
  channelId: string; // Transaction hash
  account: string; // Source (us)
  destination: string; // Destination (peer)
  amount: string; // Total XRP in channel (drops)
  balance: string; // XRP already paid out (drops)
  settleDelay: number; // Settlement delay in seconds
  publicKey: string; // Our public key
  cancelAfter?: number; // Optional expiration timestamp
  expiration?: number; // Close request timestamp
  status: 'open' | 'closing' | 'closed';
}
```

### Security Considerations

1. **Private Key Security:** Store account secret in environment variable, never in code
2. **Amount Validation:** Verify sufficient XRP balance before channel creation
3. **Settle Delay:** Minimum 1 hour for production (prevents instant-close griefing)
4. **Public Key Management:** Use ed25519 keypair for claim signing (separate from account keypair)

---

## Story 9.3: XRP Payment Channel Claim Signing and Verification

As a connector,
I want to sign and verify XRP payment channel claims off-chain,
so that I can authorize XRP transfers to peers without on-ledger transactions.

### Acceptance Criteria

1. `ClaimSigner` class implemented in `packages/connector/src/settlement/xrp-claim-signer.ts`
2. Claim signer generates ed25519 keypair for signing (separate from account keypair)
3. Claim signer implements `signClaim(channelId, amount)` method producing signature
4. Claim signature format follows XRP Ledger specification: `SIGN(channelId + amount + drops)`
5. Claim signer implements `verifyClaim(channelId, amount, signature, publicKey)` method
6. Claim verification checks signature validity and amount doesn't exceed channel balance
7. Claim signer maintains nonce/amount tracking to prevent double-spending
8. Claim signer stores latest signed claim for each channel (for dispute resolution)
9. Unit tests verify claim signing and verification with various amounts
10. Integration test signs claim, submits to local rippled, and verifies claim redemption

### Claim Signature Specification

```typescript
// XRP Payment Channel Claim Structure
interface PaymentChannelClaim {
  channelId: string; // Channel ID (transaction hash)
  amount: string; // Cumulative amount in drops
  signature: string; // ed25519 signature
  publicKey: string; // Public key for verification
}

// Claim signing (off-chain)
function signClaim(channelId: string, amount: string, privateKey: string): string {
  // Construct claim message
  const message = Buffer.concat([
    Buffer.from('CLM\0'), // Payment channel claim prefix
    Buffer.from(channelId, 'hex'),
    encodeAmount(amount), // XRP drops as big-endian uint64
  ]);

  // Sign with ed25519 private key
  const signature = ed25519.sign(message, privateKey);
  return signature.toString('hex').toUpperCase();
}

// Claim verification
function verifyClaim(
  channelId: string,
  amount: string,
  signature: string,
  publicKey: string
): boolean {
  const message = Buffer.concat([
    Buffer.from('CLM\0'),
    Buffer.from(channelId, 'hex'),
    encodeAmount(amount),
  ]);

  return ed25519.verify(Buffer.from(signature, 'hex'), message, Buffer.from(publicKey, 'hex'));
}
```

### Security Requirements

1. **Signature Verification:** Always verify claim signature matches channel's public key
2. **Amount Validation:** Ensure claim amount doesn't exceed channel amount
3. **Replay Protection:** Track highest claim amount, reject lower amounts
4. **Key Separation:** Use separate ed25519 keypair for claims (not account keypair)

---

## Story 9.4: XRP Payment Channel Claim Submission and Settlement

As a peer receiving XRP claims,
I want to submit claims to the XRP Ledger to redeem XRP from payment channels,
so that I can finalize settlement and receive funds on-ledger.

### Acceptance Criteria

1. `PaymentChannelClaim` transaction support implemented in `XRPLClient`
2. Client implements `submitClaim(channelId, amount, signature, publicKey)` method
3. Claim submission validates signature before submitting to ledger
4. Claim submission handles partial claims (redeem less than full channel amount)
5. Claim submission handles final claims (close channel and redeem all remaining XRP)
6. Client implements `closeChannel(channelId)` for cooperative channel closure
7. Client handles settlement delay: channel enters "closing" state, finalizes after `SettleDelay` seconds
8. Client implements `cancelChannelClose()` to abort closure during delay period
9. Unit tests verify claim submission with various amounts and scenarios
10. Integration test creates channel, signs claim, submits claim, and verifies XRP transfer on local rippled

### Claim Submission Transaction

```typescript
// Submit claim to redeem XRP (partial or final)
const claimTx = {
  TransactionType: 'PaymentChannelClaim',
  Account: destinationAddress, // Peer redeeming XRP
  Channel: channelId, // Channel ID
  Amount: claimAmount, // XRP to redeem (drops)
  Signature: claimSignature, // Signature from source
  PublicKey: sourcePublicKey, // Source's public key
};

const result = await client.submitAndWait(claimTx);

// Close channel (source or destination can initiate)
const closeTx = {
  TransactionType: 'PaymentChannelClaim',
  Account: myAddress,
  Channel: channelId,
  Flags: 0x00010000, // tfClose flag
};

const closeResult = await client.submitAndWait(closeTx);
```

### Channel Closure States

```
┌──────────┐
│   Open   │ ◄──→ signClaim() off-chain (cooperative settlement)
└────┬─────┘
     │ closeChannel() or claim with tfClose
     ▼
┌──────────┐
│ Closing  │ ──→ Settlement delay period (e.g., 24 hours)
└────┬─────┘      cancelClose() can abort during this period
     │ SettleDelay elapsed
     ▼
┌──────────┐
│  Closed  │ ──→ Channel removed from ledger, final balances distributed
└──────────┘
```

### Security Considerations

1. **Settlement Delay Protection:** Prevents instant closure, allows dispute resolution
2. **Claim Validation:** Ledger verifies signature before processing claim
3. **Amount Bounds:** Cannot claim more than channel amount
4. **Expiration Handling:** Channels auto-close after `CancelAfter` timestamp if set

---

## Story 9.5: Dual-Settlement Support (EVM + XRP)

As a settlement executor,
I want to choose between EVM payment channels and XRP payment channels based on peer configuration,
so that the network supports multi-chain settlement with peer preference.

### Acceptance Criteria

1. Peer configuration extended to include `settlementPreference: 'evm' | 'xrp' | 'both'`
2. Peer configuration includes token preference: `settlementTokens: ['USDC', 'XRP', 'DAI']`
3. `UnifiedSettlementExecutor` class implemented in `packages/connector/src/settlement/unified-settlement-executor.ts`
4. Unified executor selects settlement method based on peer preference and token availability
5. Unified executor routes EVM settlements to `PaymentChannelSDK` (Epic 8)
6. Unified executor routes XRP settlements to `PaymentChannelManager` (Epic 9)
7. Unified executor handles dual-channel scenarios: same peer with both EVM and XRP channels
8. Unified executor updates TigerBeetle accounts regardless of settlement method (abstraction layer)
9. Unit tests verify settlement routing logic for various peer configurations
10. Integration test demonstrates settlement via both EVM and XRP for different peers in same network

### Unified Settlement Architecture

```typescript
// Peer configuration with settlement preferences
interface PeerConfig {
  peerId: string;
  address: string;
  settlementPreference: 'evm' | 'xrp' | 'both';
  settlementTokens: string[]; // ['USDC', 'XRP', 'DAI', etc.]
  evmAddress?: string; // Ethereum address (if EVM settlement)
  xrpAddress?: string; // XRP Ledger address (if XRP settlement)
}

// Unified settlement executor
class UnifiedSettlementExecutor {
  constructor(
    private evmChannelSDK: PaymentChannelSDK, // Epic 8
    private xrpChannelManager: PaymentChannelManager, // Epic 9
    private accountManager: AccountManager, // Epic 6
    private settlementMonitor: SettlementMonitor // Epic 6
  ) {
    settlementMonitor.on('SETTLEMENT_REQUIRED', this.handleSettlement.bind(this));
  }

  private async handleSettlement(event: SettlementRequiredEvent) {
    const { peerId, balance, tokenId } = event;
    const peerConfig = await this.getPeerConfig(peerId);

    // Route to appropriate settlement method
    if (tokenId === 'XRP' && peerConfig.settlementPreference !== 'evm') {
      await this.settleViaXRP(peerId, balance, peerConfig);
    } else if (peerConfig.settlementPreference !== 'xrp') {
      await this.settleViaEVM(peerId, balance, tokenId, peerConfig);
    } else {
      throw new Error(`No compatible settlement method for peer ${peerId}`);
    }

    // Update TigerBeetle (unified accounting)
    await this.accountManager.recordSettlement(peerId, balance, tokenId);
  }

  private async settleViaEVM(
    peerId: string,
    amount: bigint,
    tokenAddress: string,
    config: PeerConfig
  ) {
    // Use Epic 8 EVM payment channels
    const channelId = await this.evmChannelSDK.findOrCreateChannel(config.evmAddress, tokenAddress);
    await this.evmChannelSDK.signAndSubmitBalanceProof(channelId, amount);
  }

  private async settleViaXRP(peerId: string, amount: bigint, config: PeerConfig) {
    // Use Epic 9 XRP payment channels
    const channelId = await this.xrpChannelManager.findOrCreateChannel(config.xrpAddress, amount);
    const claim = await this.xrpChannelManager.signClaim(channelId, amount);
    // Send claim to peer off-chain (peer submits to ledger)
  }
}
```

### Settlement Decision Matrix

| Peer Preference | Token | Settlement Method       |
| --------------- | ----- | ----------------------- |
| `evm`           | USDC  | EVM Payment Channel     |
| `evm`           | XRP   | ❌ Error (incompatible) |
| `xrp`           | XRP   | XRP Payment Channel     |
| `xrp`           | USDC  | ❌ Error (incompatible) |
| `both`          | USDC  | EVM Payment Channel     |
| `both`          | XRP   | XRP Payment Channel     |
| `both`          | DAI   | EVM Payment Channel     |

### Configuration Example

```yaml
# Connector peer configuration
peers:
  - peerId: peer-alice
    settlementPreference: evm
    settlementTokens: [USDC, DAI]
    evmAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb'

  - peerId: peer-bob
    settlementPreference: xrp
    settlementTokens: [XRP]
    xrpAddress: 'rN7n7otQDd6FczFgLdlqtyMVrn3HMfXEEW'

  - peerId: peer-charlie
    settlementPreference: both
    settlementTokens: [USDC, XRP]
    evmAddress: '0x8ba1f109551bD432803012645Ac136ddd64DBA72'
    xrpAddress: 'rLHzPsX6oXkzU9rFkRaYT8yBqJcQwPgHWN'
```

---

## Story 9.6: XRP Payment Channel SDK and State Management

As a connector developer,
I want a high-level SDK for XRP payment channel lifecycle management,
so that I can easily open, manage, and close XRP channels without handling low-level details.

### Acceptance Criteria

1. `XRPChannelSDK` class implemented in `packages/connector/src/settlement/xrp-channel-sdk.ts`
2. SDK exposes `openChannel(destination, amount, settleDelay)` method
3. SDK exposes `signClaim(channelId, amount)` for off-chain claim generation
4. SDK exposes `submitClaim(channelId, claim)` for on-ledger claim redemption
5. SDK exposes `closeChannel(channelId)` for cooperative closure
6. SDK maintains local channel state cache (channel IDs, balances, claims)
7. SDK implements event listeners for on-ledger channel events (created, claimed, closed)
8. SDK exposes `getChannelState(channelId)` method querying ledger state
9. SDK implements automatic channel refresh (poll ledger for state changes every 30s)
10. Unit tests verify SDK methods using mocked XRPL client

### SDK Interface

```typescript
// packages/connector/src/settlement/xrp-channel-sdk.ts

interface XRPChannelState {
  channelId: string;
  account: string;
  destination: string;
  amount: string; // Total XRP in channel (drops)
  balance: string; // XRP already claimed (drops)
  settleDelay: number;
  publicKey: string;
  expiration?: number;
  status: 'open' | 'closing' | 'closed';
}

interface XRPClaim {
  channelId: string;
  amount: string;
  signature: string;
  publicKey: string;
}

class XRPChannelSDK {
  constructor(
    private xrplClient: XRPLClient,
    private claimSigner: ClaimSigner
  ) {}

  // Channel lifecycle
  async openChannel(
    destination: string,
    amount: string, // XRP drops
    settleDelay: number // Seconds
  ): Promise<string> {
    // Returns channelId
    const tx = {
      TransactionType: 'PaymentChannelCreate',
      Account: this.xrplClient.address,
      Destination: destination,
      Amount: amount,
      SettleDelay: settleDelay,
      PublicKey: this.claimSigner.publicKey,
    };

    const result = await this.xrplClient.submitAndWait(tx);
    return result.result.hash;
  }

  async fundChannel(channelId: string, additionalAmount: string): Promise<void> {
    const tx = {
      TransactionType: 'PaymentChannelFund',
      Account: this.xrplClient.address,
      Channel: channelId,
      Amount: additionalAmount,
    };

    await this.xrplClient.submitAndWait(tx);
  }

  // Off-chain operations
  signClaim(channelId: string, amount: string): XRPClaim {
    const signature = this.claimSigner.signClaim(channelId, amount);
    return {
      channelId,
      amount,
      signature,
      publicKey: this.claimSigner.publicKey,
    };
  }

  verifyClaim(claim: XRPClaim): boolean {
    return this.claimSigner.verifyClaim(
      claim.channelId,
      claim.amount,
      claim.signature,
      claim.publicKey
    );
  }

  // On-chain settlement
  async submitClaim(claim: XRPClaim): Promise<void> {
    const tx = {
      TransactionType: 'PaymentChannelClaim',
      Account: this.xrplClient.address,
      Channel: claim.channelId,
      Amount: claim.amount,
      Signature: claim.signature,
      PublicKey: claim.publicKey,
    };

    await this.xrplClient.submitAndWait(tx);
  }

  async closeChannel(channelId: string): Promise<void> {
    const tx = {
      TransactionType: 'PaymentChannelClaim',
      Account: this.xrplClient.address,
      Channel: channelId,
      Flags: 0x00010000, // tfClose
    };

    await this.xrplClient.submitAndWait(tx);
  }

  // State queries
  async getChannelState(channelId: string): Promise<XRPChannelState> {
    const ledgerEntry = await this.xrplClient.request({
      command: 'ledger_entry',
      payment_channel: channelId,
    });

    return this.parseChannelState(ledgerEntry.result.node);
  }

  async getMyChannels(): Promise<string[]> {
    const accountChannels = await this.xrplClient.request({
      command: 'account_channels',
      account: this.xrplClient.address,
    });

    return accountChannels.result.channels.map((c) => c.channel_id);
  }
}
```

---

## Story 9.7: Dashboard XRP Payment Channel Visualization

As a dashboard user,
I want to see both EVM and XRP payment channels in the network visualization,
so that I can monitor all settlement methods across the network.

### Acceptance Criteria

1. `XRP_CHANNEL_OPENED` telemetry event added to shared types
2. `XRP_CHANNEL_CLAIMED` telemetry event added to shared types
3. `XRP_CHANNEL_CLOSED` telemetry event added to shared types
4. XRP channel telemetry includes: channel ID, account, destination, amount, balance, settle delay
5. Dashboard backend stores XRP channel state alongside EVM channel state
6. Dashboard frontend displays channel indicator showing settlement method (EVM badge vs XRP badge)
7. Channel tooltip shows XRP-specific details: drops, settle delay, expiration timestamp
8. Dashboard timeline view shows XRP channel events (opened, claimed, closed)
9. Dashboard "Payment Channels" panel filters by settlement type (EVM, XRP, All)
10. Integration test verifies XRP channel events flow from connector to dashboard UI

### Telemetry Schema

```typescript
// packages/shared/src/types/telemetry.ts

interface XRPChannelOpenedEvent {
  type: 'XRP_CHANNEL_OPENED';
  timestamp: number;
  nodeId: string;
  channelId: string;
  account: string; // Source (us)
  destination: string; // Destination (peer)
  amount: string; // Total XRP in drops
  settleDelay: number; // Settlement delay in seconds
  publicKey: string;
}

interface XRPChannelClaimedEvent {
  type: 'XRP_CHANNEL_CLAIMED';
  timestamp: number;
  nodeId: string;
  channelId: string;
  claimAmount: string; // XRP claimed (drops)
  remainingBalance: string; // XRP remaining in channel
}

interface XRPChannelClosedEvent {
  type: 'XRP_CHANNEL_CLOSED';
  timestamp: number;
  nodeId: string;
  channelId: string;
  finalBalance: string; // Final XRP distributed
  closeType: 'cooperative' | 'expiration' | 'unilateral';
}
```

### Dashboard UI Enhancement

**Network Graph:**

- EVM channels: Blue badge (🔗 EVM)
- XRP channels: Orange badge (🔗 XRP)
- Hover shows channel-specific details

**Payment Channels Panel:**

```
┌─ Payment Channels (Filter: All ▼) ────────┐
│ [EVM] Peer: Alice | Token: USDC           │
│ Channel: 0xabc... | Deposit: 1000 USDC    │
├───────────────────────────────────────────┤
│ [XRP] Peer: Bob | Token: XRP              │
│ Channel: E3D4... | Amount: 5000 XRP       │
│ Balance: 1250 XRP claimed                 │
│ Settle Delay: 23.5 hours remaining        │
└───────────────────────────────────────────┘
```

---

## Story 9.8: Automated XRP Channel Lifecycle Management

As a connector operator,
I want automatic XRP payment channel lifecycle management (open when needed, close when idle),
so that XRP channels are efficiently managed alongside EVM channels without manual intervention.

### Acceptance Criteria

1. `XRPChannelLifecycleManager` class implemented in `packages/connector/src/settlement/xrp-channel-lifecycle.ts`
2. Lifecycle manager tracks all active XRP channels per peer
3. Lifecycle manager automatically opens XRP channel when first XRP settlement needed for peer
4. Lifecycle manager configures initial channel amount based on expected settlement frequency
5. Lifecycle manager monitors channel balance and funds channel when running low
6. Lifecycle manager detects idle XRP channels (no claims for X hours, configurable)
7. Lifecycle manager automatically closes idle channels cooperatively
8. Lifecycle manager handles expiration-based closures (channels with `CancelAfter` set)
9. Unit tests verify XRP channel opening, funding, and closure logic
10. Integration test verifies XRP channel lifecycle across multiple peers

### XRP Channel Lifecycle State Machine

```
┌─────────────┐
│ No Channel  │
└──────┬──────┘
       │ XRP settlement needed
       ▼
┌─────────────┐
│   Opening   │ ──→ PaymentChannelCreate transaction
└──────┬──────┘
       │ Channel created (validated on ledger)
       ▼
┌─────────────┐
│   Active    │ ◄──→ signClaim() off-chain (cooperative settlement)
│             │      Peer submits claims to ledger periodically
└──────┬──────┘
       │ Idle detected OR CancelAfter reached
       ▼
┌─────────────┐
│   Closing   │ ──→ PaymentChannelClaim with tfClose flag
└──────┬──────┘
       │ SettleDelay elapsed
       ▼
┌─────────────┐
│  Closed     │ ──→ Channel removed from ledger
└─────────────┘
```

### Configuration

```yaml
# Connector XRP channel configuration
paymentChannels:
  xrp:
    enabled: true
    wssUrl: wss://xrplcluster.com # Mainnet
    accountSecret: ${XRPL_ACCOUNT_SECRET}
    defaultSettleDelay: 86400 # 24 hours
    initialChannelAmount: '10000000000' # 10,000 XRP in drops
    idleChannelThreshold: 86400 # Close after 24h idle
    minBalanceThreshold: 0.3 # Fund when below 30% remaining
    cancelAfter: 2592000 # Auto-expire after 30 days
```

---

## Story 9.9: XRP Settlement Integration Testing and QA

As a QA engineer,
I want comprehensive integration tests for XRP payment channels across the full settlement flow,
so that XRP settlement is production-ready and reliable.

### Acceptance Criteria

1. Integration test suite created in `packages/connector/test/integration/xrp-settlement.test.ts`
2. Test verifies XRP channel creation on local rippled (from Epic 7)
3. Test verifies off-chain claim signing and verification
4. Test verifies on-ledger claim submission and XRP transfer
5. Test verifies cooperative channel closure
6. Test verifies unilateral channel closure with settlement delay
7. Test verifies dual-settlement: same network with both EVM and XRP channels
8. Test verifies TigerBeetle balance updates after XRP settlement
9. Test verifies dashboard telemetry for XRP channel events
10. Test verifies error handling: insufficient XRP, invalid claims, network failures

### Test Scenarios

**Scenario 1: Happy Path XRP Settlement**

1. Configure peer with `settlementPreference: 'xrp'`
2. Forward 100 ILP packets (XRP token)
3. TigerBeetle balance reaches threshold
4. Settlement monitor triggers XRP settlement
5. XRP channel opened (if doesn't exist)
6. Claim signed and sent to peer
7. Peer submits claim to rippled
8. XRP transferred on-ledger
9. TigerBeetle balance updated

**Scenario 2: Dual-Settlement Network**

1. Network with 3 connectors:
   - Alice: EVM preference (USDC)
   - Bob: XRP preference (XRP)
   - Charlie: Both (USDC + XRP)
2. Packets flow between all pairs
3. Alice-Charlie settles via EVM (USDC)
4. Bob-Charlie settles via XRP
5. Both settlement types visible in dashboard

**Scenario 3: XRP Channel Dispute**

1. Alice opens channel to Bob (10,000 XRP)
2. Alice sends claim for 5,000 XRP (off-chain)
3. Bob doesn't respond
4. Alice initiates unilateral close
5. Settlement delay period starts (24 hours)
6. Bob can submit newer claim during delay
7. After delay, channel settles with final balance

### Performance Requirements

- XRP claim signing: <10ms
- XRP claim verification: <5ms
- XRP channel creation: <5 seconds (including ledger confirmation)
- XRP claim submission: <5 seconds (including ledger confirmation)
- Dual-settlement routing decision: <1ms

---

## Story 9.10: XRP Payment Channel Documentation and Production Deployment

As a connector operator,
I want comprehensive documentation for XRP payment channel setup and deployment,
so that I can configure XRP settlement for production use.

### Acceptance Criteria

1. Documentation created in `docs/guides/xrp-payment-channels-setup.md`
2. Documentation covers: XRP Ledger account creation, funding, channel configuration
3. Documentation explains claim signing, verification, and submission workflows
4. Documentation includes security best practices: secret management, channel monitoring
5. Documentation covers dual-settlement configuration (EVM + XRP)
6. Documentation includes troubleshooting guide for common XRP issues
7. API reference documentation for `XRPChannelSDK` and `UnifiedSettlementExecutor`
8. Architecture documentation updated with XRP settlement flow diagrams
9. README updated with XRP settlement capabilities and configuration examples
10. Production deployment checklist created with pre-flight validation steps

### Documentation Outline

**`docs/guides/xrp-payment-channels-setup.md`:**

1. XRP Ledger Account Setup
   - Create account with wallet
   - Fund account (minimum 10 XRP reserve)
   - Configure environment variables
2. Local Development
   - Connect to local rippled (Epic 7)
   - Use test accounts from genesis
   - Development workflow
3. Testnet Deployment
   - Connect to XRPL Testnet
   - Use testnet faucet
   - Integration testing
4. Mainnet Production
   - Connect to XRPL Mainnet
   - Production security considerations
   - Monitoring and alerting
5. Dual-Settlement Configuration
   - Configure peers with both EVM and XRP
   - Settlement routing logic
   - Multi-chain monitoring

**Security Checklist:**

- [ ] XRP account secret stored in environment variable (not code)
- [ ] Claim signing keypair separate from account keypair
- [ ] Channel settle delay configured (minimum 1 hour production)
- [ ] Channel amounts limited (max exposure per peer)
- [ ] Claim verification enforced before submission
- [ ] Channel state monitoring enabled
- [ ] Backup and recovery procedures documented

---

## Epic Completion Criteria

- [ ] rippled client integration functional with local rippled (Epic 7) and XRPL mainnet
- [ ] XRP payment channels can be created, funded, and closed on-ledger
- [ ] XRP claims can be signed off-chain and verified
- [ ] XRP claims can be submitted to ledger and redeem XRP
- [ ] Dual-settlement support functional (EVM + XRP routing)
- [ ] Unified settlement executor abstracts settlement method from accounting layer
- [ ] XRP channel lifecycle manager opens/closes channels automatically
- [ ] Dashboard displays both EVM and XRP channels with real-time updates
- [ ] Integration tests verify end-to-end XRP settlement flow
- [ ] Documentation complete for XRP channel setup and production deployment
- [ ] XRP settlement tested on local rippled, testnet, and mainnet

---

## Dependencies and Integration Points

**Depends On:**

- **Epic 7: Local Blockchain Development Infrastructure** - Local rippled for development (REQUIRED)
- **Epic 8: EVM Payment Channels** - EVM settlement infrastructure for dual-settlement
- Epic 6: TigerBeetle accounting and settlement thresholds
- Epic 2: BTP protocol for peer connections
- Epic 3: Dashboard telemetry infrastructure

**Integrates With:**

- `AccountManager` (Epic 6) - TigerBeetle balance tracking
- `SettlementMonitor` (Epic 6) - Settlement trigger events
- `PaymentChannelSDK` (Epic 8) - EVM settlement for dual-settlement
- `XRPChannelSDK` (Epic 9) - XRP settlement
- `UnifiedSettlementExecutor` (Epic 9) - Multi-chain settlement routing
- `TelemetryEmitter` - Channel event reporting

**Enables:**

- Epic 10: Multi-chain settlement coordination and production hardening

---

## Technical Architecture Notes

### XRP Payment Channels vs. EVM Payment Channels

| Feature                  | XRP Payment Channels         | EVM Payment Channels   |
| ------------------------ | ---------------------------- | ---------------------- |
| **Blockchain**           | XRP Ledger                   | Base L2 (EVM)          |
| **Token Support**        | XRP only (native)            | Any ERC20 token        |
| **Signature Scheme**     | ed25519                      | ECDSA (secp256k1)      |
| **Claim Structure**      | `CLM\0` + channelId + amount | EIP-712 typed data     |
| **Settlement Delay**     | Configurable (seconds)       | Configurable (seconds) |
| **On-Chain Transaction** | PaymentChannelCreate/Claim   | Smart contract calls   |
| **Gas Costs**            | ~0.00001 XRP per tx          | ~$0.001-0.01 per tx    |
| **Finality**             | 3-5 seconds                  | 2 seconds (Base L2)    |
| **Channel State**        | On-ledger (native)           | Smart contract storage |

### Why Support Both EVM and XRP?

1. **Token Diversity:** EVM supports any ERC20 token (USDC, DAI, etc.), XRP only supports XRP
2. **Ecosystem Reach:** Some peers may prefer XRP native settlement, others prefer EVM tokens
3. **Cost Optimization:** XRP transactions are cheaper (~$0.00001) vs EVM (~$0.001)
4. **Decentralization:** Multi-chain support reduces dependency on single blockchain
5. **Future-Proofing:** Enables additional chains in Epic 10 (Polygon, Arbitrum, etc.)

### Settlement Flow Comparison

**EVM Settlement (Epic 8):**

```
Packets → TigerBeetle → Threshold → EVM Channel → Balance Proof → Smart Contract → ERC20 Transfer
```

**XRP Settlement (Epic 9):**

```
Packets → TigerBeetle → Threshold → XRP Channel → Claim Signature → PaymentChannelClaim → XRP Transfer
```

**Dual Settlement (Epic 9):**

```
Packets → TigerBeetle → Threshold → UnifiedSettlementExecutor
                                            ↓
                                    ┌───────┴───────┐
                                    ▼               ▼
                                EVM Channel    XRP Channel
                                (if USDC)      (if XRP)
```

---

## Testing Strategy

**Unit Tests:**

- XRPL client connection and error handling
- Claim signing and verification
- Settlement routing logic (EVM vs XRP)
- Channel state tracking

**Integration Tests:**

- End-to-end XRP settlement on local rippled
- Dual-settlement with both EVM and XRP
- Channel lifecycle (open, fund, close)
- Claim submission and redemption

**Performance Tests:**

- 1000 claims/second signing throughput
- Claim verification latency (<5ms)
- Channel creation latency (<5 seconds)

---

## Security Considerations

### XRP-Specific Security

1. **Account Security:** XRP account secret stored in environment variable, encrypted at rest
2. **Claim Signing Key:** Separate ed25519 keypair for claims (not account keypair)
3. **Settlement Delay:** Minimum 1 hour for production (prevents instant-close attacks)
4. **Channel Amount Limits:** Maximum XRP per channel to limit exposure
5. **Claim Verification:** Always verify claim signature before submission
6. **Replay Protection:** Track highest claim amount, reject lower amounts
7. **Reserve Requirements:** Maintain minimum 10 XRP reserve in account (XRPL requirement)

### Multi-Chain Security

1. **Key Isolation:** Separate keypairs for EVM and XRP (no key reuse)
2. **Network Isolation:** Separate RPC endpoints for local/testnet/mainnet
3. **Settlement Routing Validation:** Verify peer supports requested settlement method
4. **Atomic Accounting:** TigerBeetle updates atomic across both EVM and XRP settlements

---

## Performance Requirements

- XRP claim signing: <10ms per claim
- XRP claim verification: <5ms per verification
- XRP channel creation: <5 seconds (including ledger confirmation)
- XRP claim submission: <5 seconds (including ledger confirmation)
- Settlement routing decision: <1ms (EVM vs XRP)
- Dashboard XRP channel update latency: <1 second from on-ledger event

---

## Documentation Deliverables

1. `docs/guides/xrp-payment-channels-setup.md` - XRP channel setup and configuration
2. `docs/guides/dual-settlement-configuration.md` - EVM + XRP multi-chain setup
3. `docs/architecture/xrp-settlement-architecture.md` - XRP settlement technical architecture
4. `docs/api/xrp-channel-sdk.md` - XRP Channel SDK API reference
5. `docs/api/unified-settlement-executor.md` - Unified settlement API documentation
6. Security best practices for XRP account and claim management
7. Troubleshooting guide for XRP-specific issues

---

## Success Metrics

- XRP channel creation success rate: 100%
- XRP claim verification accuracy: 100%
- XRP settlement execution success rate: >99%
- Average XRP settlement latency: <5 seconds
- XRP transaction cost: <$0.0001 per settlement
- Dual-settlement routing accuracy: 100%
- Dashboard XRP channel visualization latency: <1 second
- Zero security vulnerabilities in claim signing/verification

---

## Timeline Estimate

**Total Duration:** 8-10 weeks

- **Week 1:** rippled client integration and development environment (Story 9.1)
- **Weeks 2-3:** XRP channel creation, funding, and state management (Story 9.2)
- **Weeks 4-5:** Claim signing, verification, and submission (Stories 9.3-9.4)
- **Week 6:** Dual-settlement support and unified executor (Story 9.5)
- **Week 7:** XRP Channel SDK and lifecycle management (Stories 9.6, 9.8)
- **Week 8:** Dashboard visualization (Story 9.7)
- **Weeks 9-10:** Integration testing, documentation, and QA (Stories 9.9-9.10)

**Critical Path:** XRP claim signing/verification (Weeks 4-5) is the most complex component

**Note:** Timeline assumes Epic 7 (local rippled) and Epic 8 (EVM channels) are complete
