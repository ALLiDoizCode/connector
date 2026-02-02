# Epic 13: Aptos Payment Channels (Move Modules)

**Epic Number:** 13

**Goal:** Integrate Aptos blockchain payment channels for settlement, enabling tri-chain settlement support where connectors can settle using EVM payment channels (Epic 8), XRP payment channels (Epic 9), and Aptos Move-based payment channels depending on peer preference and token availability. Build minimal Aptos payment channel infrastructure including Move smart contract modules, TypeScript SDK integration via `@aptos-labs/ts-sdk`, integration with the existing `UnifiedSettlementExecutor` for automatic settlement triggers, and basic telemetry for monitoring. This epic delivers Aptos as a third settlement option, leveraging its high throughput and low transaction costs for AI agent micropayments.

**Foundation:** This epic builds on the Aptos blockchain platform using Move smart contracts. Unlike XRP Ledger which has native payment channels (PayChan), Aptos requires custom Move modules to implement payment channel functionality. The approach follows the proven Raiden-style payment channel pattern from Epic 8, adapted to Move's resource-oriented programming model.

**Important:** This epic focuses on **Move smart contract development** for payment channels on Aptos. Move is a resource-oriented language fundamentally different from Solidity (EVM) or the native XRPL transaction types. Connectors will connect to Aptos mainnet via public RPC endpoints. Aptos uses the APT native token by default, with potential future support for Fungible Assets (FA) tokens.

**Reference:** [Aptos Developer Documentation](https://aptos.dev/build/get-started)

---

## Story 27.1: Aptos SDK Integration and Development Environment

As a connector developer,
I want a TypeScript client for interacting with Aptos blockchain,
so that I can deploy Move modules, submit transactions, and query on-chain state.

**Prerequisites:** None (Aptos provides public RPC and testnet faucet)

### Acceptance Criteria

1. `@aptos-labs/ts-sdk` library added as dependency to `packages/connector/package.json`
2. `AptosClient` wrapper class implemented in `packages/connector/src/settlement/aptos-client.ts`
3. Client initialization accepts Aptos RPC URL from environment variables (`APTOS_NODE_URL`)
4. Client configured for both testnet (`https://fullnode.testnet.aptoslabs.com/v1`) and mainnet
5. Client implements connection handling with automatic retry on network failures
6. Client exposes methods for: account info, transaction submission, module queries, view functions
7. Client gracefully handles Aptos errors and maps them to application-level error types
8. Client logs all Aptos operations with structured logging (Pino)
9. Environment variables support: `APTOS_NODE_URL`, `APTOS_PRIVATE_KEY`, `APTOS_ACCOUNT_ADDRESS`
10. Integration test connects to Aptos testnet, funds account via faucet, and queries balance

### Technical Notes

**Development Stack:**

- **@aptos-labs/ts-sdk:** Official Aptos TypeScript SDK (^1.0.0)
- **Aptos Testnet:** `https://fullnode.testnet.aptoslabs.com/v1` (free, faucet available)
- **Aptos Mainnet:** `https://fullnode.mainnet.aptoslabs.com/v1` (production)

**Development Workflow:**

```
1. Develop on testnet: Deploy to Aptos testnet (free APT via faucet)
   ↓
2. Test on testnet: Integration testing with testnet
   ↓
3. Deploy to mainnet: Production deployment (real APT)
```

**Note:** Unlike EVM (Anvil) and XRP (rippled standalone), Aptos does not have a simple local node option. All development uses testnet, which provides free APT via faucet and instant transaction confirmation. This is acceptable because testnet is highly reliable and cost-free.

**Configuration:**

```typescript
// Environment variables
APTOS_NODE_URL=https://fullnode.testnet.aptoslabs.com/v1  // Testnet
APTOS_NODE_URL=https://fullnode.mainnet.aptoslabs.com/v1  // Mainnet
APTOS_FALLBACK_NODE_URL=https://aptos-testnet.nodereal.io/v1  // Fallback RPC

// Client initialization
const client = new AptosClient({
  nodeUrl: process.env.APTOS_NODE_URL,
  fallbackNodeUrl: process.env.APTOS_FALLBACK_NODE_URL,  // Optional fallback
  privateKey: process.env.APTOS_PRIVATE_KEY,
  address: process.env.APTOS_ACCOUNT_ADDRESS
});
```

**Rate Limiting & Reliability:**

- Aptos public RPC endpoints have rate limits (~100 req/s for testnet, varies for mainnet)
- For production, consider paid RPC providers: Alchemy, QuickNode, or NodeReal
- Client implements exponential backoff retry (3 attempts, 1s/2s/4s delays)
- Fallback RPC URL used when primary fails after retries
- Connection health check every 30 seconds with automatic failover

---

## Story 27.2: Move Payment Channel Module Development

As a smart contract developer,
I want Move modules implementing payment channel logic (open, deposit, claim, close),
so that two parties can establish channels and exchange off-chain signed balance updates.

### Acceptance Criteria

1. `packages/contracts-aptos/` directory created with Move project structure
2. `sources/payment_channel.move` module implements channel state management
3. Module uses Move's resource model for channel state (`struct Channel has key, store`)
4. Module implements `open_channel(destination, amount, settle_delay)` entry function
5. Module implements `deposit(channel_id, amount)` entry function for adding funds
6. Module implements `close_channel(channel_id, signature, amount)` for settlement
7. Channel state tracks: owner, destination, deposited amount, claimed amount, nonce, settle_delay
8. Module uses ed25519 signature verification for balance proof authentication
9. Move Prover annotations added for critical safety properties
10. Unit tests verify channel lifecycle using `aptos move test`

### Move Module Structure

```move
module payment_channel::channel {
    use std::signer;
    use aptos_std::ed25519;
    use aptos_framework::coin;
    use aptos_framework::aptos_coin::AptosCoin;
    use aptos_framework::timestamp;

    /// Error codes
    const E_CHANNEL_EXISTS: u64 = 1;
    const E_CHANNEL_NOT_FOUND: u64 = 2;
    const E_INVALID_SIGNATURE: u64 = 3;
    const E_INSUFFICIENT_BALANCE: u64 = 4;
    const E_SETTLE_DELAY_NOT_ELAPSED: u64 = 5;

    /// Payment channel state stored under owner's account
    struct Channel has key, store {
        destination: address,
        deposited: u64,
        claimed: u64,
        nonce: u64,
        settle_delay: u64,        // seconds
        close_requested_at: u64,  // timestamp, 0 if not closing
        destination_pubkey: vector<u8>,  // ed25519 public key
    }

    /// Open a new payment channel
    public entry fun open_channel(
        owner: &signer,
        destination: address,
        destination_pubkey: vector<u8>,
        amount: u64,
        settle_delay: u64,
    ) {
        // Transfer APT to module, create Channel resource
    }

    /// Add funds to existing channel
    public entry fun deposit(
        owner: &signer,
        amount: u64,
    ) {
        // Increase deposited amount
    }

    /// Submit claim with signature (cooperative settlement)
    public entry fun claim(
        destination: &signer,
        owner: address,
        amount: u64,
        nonce: u64,
        signature: vector<u8>,
    ) {
        // Verify signature, update claimed amount
    }

    /// Request channel closure (initiates settle delay)
    public entry fun request_close(
        requester: &signer,
        channel_owner: address,
    ) {
        // Set close_requested_at timestamp
    }

    /// Finalize channel closure after settle delay
    public entry fun finalize_close(
        requester: &signer,
        channel_owner: address,
    ) {
        // Distribute remaining funds, delete Channel resource
    }

    /// View function: get channel state
    #[view]
    public fun get_channel(owner: address): (address, u64, u64, u64, u64, u64) {
        // Return channel state tuple
    }
}
```

### Security Considerations

1. **Resource Safety:** Move's linear types prevent double-spending
2. **Signature Verification:** Use `aptos_std::ed25519` for claim signatures
3. **Settle Delay:** Minimum 1 hour for production (configurable)
4. **Amount Validation:** Ensure claims don't exceed deposited amount
5. **Nonce Tracking:** Monotonic nonces prevent replay attacks

### CI/CD Integration

The Move module must be integrated into the existing CI pipeline:

**GitHub Actions Workflow Addition:**

```yaml
# .github/workflows/ci.yml - Add to existing workflow
aptos-move-tests:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4

    - name: Install Aptos CLI
      run: |
        curl -fsSL "https://aptos.dev/scripts/install_cli.py" | python3
        echo "$HOME/.local/bin" >> $GITHUB_PATH

    - name: Run Move Tests
      working-directory: packages/contracts-aptos
      run: aptos move test

    - name: Run Move Prover (optional)
      working-directory: packages/contracts-aptos
      run: aptos move prove
      continue-on-error: true # Prover is advisory, not blocking
```

**Pre-commit Hook:**

Add to existing pre-commit configuration:

```bash
# Run Move tests before commit (if contracts-aptos changed)
if git diff --cached --name-only | grep -q "packages/contracts-aptos"; then
  cd packages/contracts-aptos && aptos move test
fi
```

---

## Story 27.3: Off-Chain Claim Signing and Verification

As a connector,
I want to sign and verify Aptos payment channel claims off-chain,
so that I can authorize APT transfers to peers without on-chain transactions.

### Acceptance Criteria

1. `AptosClaimSigner` class implemented in `packages/connector/src/settlement/aptos-claim-signer.ts`
2. Claim signer uses ed25519 keypair for signing (compatible with Aptos on-chain verification)
3. Claim signer implements `signClaim(channelOwner, amount, nonce)` method producing signature
4. Claim message format: `CLAIM_APTOS | channelOwner | amount | nonce` (canonical encoding)
5. Claim signer implements `verifyClaim(channelOwner, amount, nonce, signature, publicKey)` method
6. Claim verification checks signature validity and nonce is greater than previous
7. Claim signer maintains highest nonce per channel to prevent double-spending
8. Claim signer stores latest signed claim for dispute resolution
9. Unit tests verify claim signing and verification with various amounts and nonces
10. Integration test creates channel on testnet, signs claim, submits to chain, verifies APT transfer

### Claim Signature Specification

```typescript
// Aptos Payment Channel Claim Structure
interface AptosClaim {
  channelOwner: string; // Aptos address of channel owner
  amount: bigint; // Cumulative amount in octas (1 APT = 100,000,000 octas)
  nonce: number; // Monotonically increasing counter
  signature: string; // ed25519 signature (hex)
  publicKey: string; // ed25519 public key (hex)
}

// Claim signing (off-chain)
function signClaim(
  channelOwner: string,
  amount: bigint,
  nonce: number,
  privateKey: Uint8Array
): string {
  // Construct claim message (canonical BCS encoding for Aptos)
  const message = new Uint8Array([
    ...Buffer.from('CLAIM_APTOS'),
    ...bcsEncode(channelOwner),
    ...bcsEncode(amount),
    ...bcsEncode(nonce),
  ]);

  // Sign with ed25519 private key
  const signature = ed25519.sign(message, privateKey);
  return Buffer.from(signature).toString('hex');
}
```

### Security Requirements

1. **Signature Scheme:** Use ed25519 (same as Aptos account signatures)
2. **Message Canonicalization:** Use BCS encoding for deterministic serialization
3. **Nonce Validation:** Track highest nonce, reject lower nonces
4. **Key Separation:** Use dedicated signing keypair for claims

---

## Story 27.4: Aptos Payment Channel SDK

As a connector developer,
I want a high-level SDK for Aptos payment channel lifecycle management,
so that I can easily open, manage, and close Aptos channels without handling low-level details.

### Acceptance Criteria

1. `AptosChannelSDK` class implemented in `packages/connector/src/settlement/aptos-channel-sdk.ts`
2. SDK exposes `openChannel(destination, amount, settleDelay)` method
3. SDK exposes `deposit(additionalAmount)` method for adding funds
4. SDK exposes `signClaim(channelOwner, amount)` for off-chain claim generation
5. SDK exposes `submitClaim(claim)` for on-chain claim redemption
6. SDK exposes `closeChannel()` for cooperative/unilateral closure
7. SDK maintains local channel state cache (channel addresses, balances, claims)
8. SDK exposes `getChannelState(channelOwner)` method querying on-chain state via view function
9. SDK implements automatic channel refresh (poll chain for state changes every 30s)
10. Unit tests verify SDK methods using mocked Aptos client

### SDK Interface

```typescript
// packages/connector/src/settlement/aptos-channel-sdk.ts

interface AptosChannelState {
  channelOwner: string;
  destination: string;
  deposited: bigint; // Total APT in channel (octas)
  claimed: bigint; // APT already claimed (octas)
  nonce: number;
  settleDelay: number; // seconds
  closeRequestedAt: number; // timestamp, 0 if not closing
  status: 'open' | 'closing' | 'closed';
}

class AptosChannelSDK {
  constructor(
    private aptosClient: AptosClient,
    private claimSigner: AptosClaimSigner,
    private moduleAddress: string // Address where Move module is deployed
  ) {}

  // Channel lifecycle
  async openChannel(
    destination: string,
    destinationPubkey: string,
    amount: bigint, // APT in octas
    settleDelay: number // seconds
  ): Promise<string>; // Returns channel owner address (our address)

  async deposit(amount: bigint): Promise<void>;

  // Off-chain operations
  signClaim(channelOwner: string, amount: bigint): AptosClaim;
  verifyClaim(claim: AptosClaim): boolean;

  // On-chain settlement
  async submitClaim(claim: AptosClaim): Promise<void>;
  async requestClose(channelOwner: string): Promise<void>;
  async finalizeClose(channelOwner: string): Promise<void>;

  // State queries
  async getChannelState(channelOwner: string): Promise<AptosChannelState>;
  async getMyChannels(): Promise<string[]>;
}
```

---

## Story 27.5: Tri-Chain Settlement Integration (EVM + XRP + Aptos)

As a settlement executor,
I want to choose between EVM, XRP, and Aptos payment channels based on peer configuration,
so that the network supports tri-chain settlement with peer preference.

### Acceptance Criteria

1. Peer configuration extended to include `settlementPreference: 'evm' | 'xrp' | 'aptos' | 'any'`
2. Peer configuration includes Aptos address: `aptosAddress?: string`
3. `UnifiedSettlementExecutor` extended to route Aptos settlements to `AptosChannelSDK`
4. Settlement executor selects settlement method based on peer preference and token
5. Settlement executor handles tri-channel scenarios: same peer with EVM, XRP, and Aptos channels
6. Settlement executor updates TigerBeetle accounts regardless of settlement method
7. Telemetry events added for Aptos settlement operations
8. Unit tests verify settlement routing logic for Aptos peers
9. Integration test demonstrates settlement via Aptos alongside EVM and XRP
10. Configuration documentation updated with Aptos peer settings

### Updated Settlement Decision Matrix

| Peer Preference | Token | Settlement Method     |
| --------------- | ----- | --------------------- |
| `evm`           | USDC  | EVM Payment Channel   |
| `evm`           | APT   | Error (incompatible)  |
| `xrp`           | XRP   | XRP Payment Channel   |
| `xrp`           | APT   | Error (incompatible)  |
| `aptos`         | APT   | Aptos Payment Channel |
| `aptos`         | USDC  | Error (incompatible)  |
| `any`           | USDC  | EVM Payment Channel   |
| `any`           | XRP   | XRP Payment Channel   |
| `any`           | APT   | Aptos Payment Channel |

### Configuration Example

```yaml
# Connector peer configuration with Aptos support
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
    settlementPreference: aptos
    settlementTokens: [APT]
    aptosAddress: '0x1234...abcd'

  - peerId: peer-diana
    settlementPreference: any
    settlementTokens: [USDC, XRP, APT]
    evmAddress: '0x8ba1f109551bD432803012645Ac136ddd64DBA72'
    xrpAddress: 'rLHzPsX6oXkzU9rFkRaYT8yBqJcQwPgHWN'
    aptosAddress: '0x5678...efgh'
```

### Feature Flag & Rollback Strategy

**Feature Flag Implementation:**

Aptos settlement is controlled by a feature flag that can be disabled without code deployment:

```typescript
// Environment variable feature flag
APTOS_SETTLEMENT_ENABLED = true; // Enable Aptos settlement (default: true after deployment)
APTOS_SETTLEMENT_ENABLED = false; // Disable Aptos settlement (rollback)

// UnifiedSettlementExecutor checks flag before routing
class UnifiedSettlementExecutor {
  private isAptosEnabled(): boolean {
    return process.env.APTOS_SETTLEMENT_ENABLED !== 'false';
  }

  private async handleSettlement(event: SettlementRequiredEvent) {
    const { peerId, balance, tokenId } = event;
    const peerConfig = await this.getPeerConfig(peerId);

    // Check feature flag before Aptos routing
    if (tokenId === 'APT' && peerConfig.settlementPreference !== 'evm') {
      if (!this.isAptosEnabled()) {
        this.logger.warn({ peerId, tokenId }, 'Aptos settlement disabled, skipping');
        throw new SettlementDisabledError('Aptos settlement is currently disabled');
      }
      await this.settleViaAptos(peerId, balance, peerConfig);
    }
    // ... existing EVM/XRP logic unchanged
  }
}
```

**Rollback Procedure:**

1. **Immediate Disable:** Set `APTOS_SETTLEMENT_ENABLED=false` in environment
2. **Restart Connectors:** Rolling restart to pick up new environment variable
3. **Impact:** Peers with `settlementPreference: 'aptos'` will receive settlement errors
4. **No Impact:** EVM and XRP settlement paths remain fully functional
5. **Pending Channels:** Existing Aptos channels remain on-chain, can be closed manually

**Rollback Triggers:**

- Aptos RPC endpoint sustained failures (>5 min)
- Aptos settlement success rate drops below 95%
- Move module vulnerability discovered
- Aptos network congestion causing >10s settlement times

**Monitoring Alerts:**

```yaml
# Add to monitoring configuration
alerts:
  - name: aptos_settlement_failure_rate
    condition: aptos_settlement_failures / aptos_settlement_attempts > 0.05
    action: page_oncall

  - name: aptos_rpc_unavailable
    condition: aptos_rpc_health_check_failures > 10
    action: auto_disable_aptos_settlement # Optional: automatic rollback
```

---

## Story 27.6: Aptos Settlement Testing and Documentation

As a QA engineer,
I want integration tests for Aptos payment channels and documentation for setup,
so that Aptos settlement is reliable and operators can configure it.

### Acceptance Criteria

1. Integration test suite created in `packages/connector/test/integration/aptos-settlement.test.ts`
2. Test verifies Aptos channel creation on testnet
3. Test verifies off-chain claim signing and verification
4. Test verifies on-chain claim submission and APT transfer
5. Test verifies channel closure (cooperative and unilateral)
6. Test verifies tri-settlement: network with EVM, XRP, and Aptos channels
7. Documentation created in `docs/guides/aptos-payment-channels-setup.md`
8. Documentation covers: Aptos account creation, Move module deployment, configuration
9. Documentation includes security best practices for Aptos key management
10. Architecture documentation updated with Aptos settlement flow diagrams

### Test Scenarios

**Scenario 1: Happy Path Aptos Settlement**

1. Configure peer with `settlementPreference: 'aptos'`
2. Forward 100 ILP packets (APT token)
3. TigerBeetle balance reaches threshold
4. Settlement monitor triggers Aptos settlement
5. Aptos channel opened (if doesn't exist)
6. Claim signed and sent to peer
7. Peer submits claim to Aptos
8. APT transferred on-chain
9. TigerBeetle balance updated

**Scenario 2: Tri-Settlement Network**

1. Network with 4 connectors:
   - Alice: EVM preference (USDC)
   - Bob: XRP preference (XRP)
   - Charlie: Aptos preference (APT)
   - Diana: Any (all tokens)
2. Packets flow between all pairs
3. Each peer settles via their preferred chain
4. All settlement types complete successfully

### Documentation Outline

**`docs/guides/aptos-payment-channels-setup.md`:**

1. Prerequisites
   - Aptos CLI installation
   - Account creation and funding (testnet faucet)
2. Move Module Deployment
   - Clone and build payment channel modules
   - Deploy to testnet/mainnet
   - Verify deployment
3. Connector Configuration
   - Environment variables
   - Peer configuration with Aptos addresses
4. Testing
   - Testnet integration testing
   - Monitoring and troubleshooting
5. Production Deployment
   - Mainnet considerations
   - Security checklist

---

## Epic Completion Criteria

- [ ] Aptos SDK integration functional with testnet and mainnet
- [ ] Move payment channel module deployed and tested on testnet
- [ ] Off-chain claim signing and verification working
- [ ] On-chain claim submission and APT transfer verified
- [ ] Tri-chain settlement support (EVM + XRP + Aptos) functional
- [ ] `UnifiedSettlementExecutor` routes Aptos settlements correctly
- [ ] Feature flag (`APTOS_SETTLEMENT_ENABLED`) implemented and tested
- [ ] CI/CD pipeline includes Move module testing (`aptos move test`)
- [ ] Integration tests verify end-to-end Aptos settlement flow
- [ ] Rollback procedure documented and tested
- [ ] Documentation complete for Aptos setup and deployment
- [ ] Move module audited or reviewed before mainnet deployment

---

## Dependencies and Integration Points

**Depends On:**

- **Epic 8: EVM Payment Channels** - EVM settlement infrastructure for tri-settlement
- **Epic 9: XRP Payment Channels** - XRP settlement infrastructure, `UnifiedSettlementExecutor`
- Epic 6: TigerBeetle accounting and settlement thresholds
- Epic 2: BTP protocol for peer connections

**Integrates With:**

- `AccountManager` (Epic 6) - TigerBeetle balance tracking
- `SettlementMonitor` (Epic 6) - Settlement trigger events
- `PaymentChannelSDK` (Epic 8) - EVM settlement
- `XRPChannelSDK` (Epic 9) - XRP settlement
- `UnifiedSettlementExecutor` (Epic 9) - Multi-chain settlement routing
- `TelemetryEmitter` - Channel event reporting

---

## Risk Management

### Breaking Change Risks

| Risk                                 | Likelihood | Impact | Mitigation                                                  |
| ------------------------------------ | ---------- | ------ | ----------------------------------------------------------- |
| Aptos RPC endpoint failures          | Medium     | Low    | Fallback RPC, retry logic, feature flag disable             |
| Move module vulnerability            | Low        | High   | Move Prover, testnet-first deployment, audit before mainnet |
| UnifiedSettlementExecutor regression | Low        | Medium | Comprehensive unit tests, existing EVM/XRP tests unchanged  |
| TigerBeetle accounting errors        | Low        | High   | Same accounting pattern as EVM/XRP, atomic updates          |

### Rollback Strategy Summary

1. **Feature Flag:** `APTOS_SETTLEMENT_ENABLED=false` immediately disables Aptos routing
2. **No Code Deployment Required:** Environment variable change + restart
3. **Isolated Impact:** EVM and XRP settlement paths completely unaffected
4. **Existing Channels:** On-chain Aptos channels persist, can be closed manually via CLI
5. **Automatic Rollback (Optional):** Monitoring can auto-set feature flag on sustained failures

### Compatibility Guarantees

- **EVM Settlement (Epic 8):** No changes to existing code paths
- **XRP Settlement (Epic 9):** No changes to existing code paths
- **TigerBeetle (Epic 6):** Same accounting patterns, additive token support
- **Peer Configuration:** Backward compatible, existing peers continue working
- **API Stability:** `UnifiedSettlementExecutor` interface unchanged, only implementation extended

---

## Technical Architecture Notes

### Aptos vs. EVM vs. XRP Payment Channels

| Feature              | Aptos Payment Channels  | EVM Payment Channels | XRP Payment Channels |
| -------------------- | ----------------------- | -------------------- | -------------------- |
| **Blockchain**       | Aptos                   | Base L2 (EVM)        | XRP Ledger           |
| **Smart Contract**   | Move modules            | Solidity contracts   | Native PayChan       |
| **Token Support**    | APT (native), FA tokens | Any ERC20 token      | XRP only (native)    |
| **Signature Scheme** | ed25519                 | ECDSA (secp256k1)    | ed25519              |
| **Transaction Cost** | ~$0.0001-0.001          | ~$0.001-0.01         | ~$0.00001            |
| **Finality**         | <1 second               | 2 seconds            | 3-5 seconds          |
| **TPS Capacity**     | 160,000+                | ~1,000 (Base)        | ~1,500               |

### Why Add Aptos?

1. **High Throughput:** 160,000+ TPS ideal for AI agent micropayments
2. **Low Latency:** Sub-second finality for real-time settlements
3. **Move Safety:** Resource-oriented language prevents common vulnerabilities
4. **Growing Ecosystem:** Active development and AI/Web3 integration
5. **Cost Efficiency:** Very low transaction costs for micropayments

### Settlement Flow

```
Packets → TigerBeetle → Threshold → UnifiedSettlementExecutor
                                            ↓
                                ┌───────────┼───────────┐
                                ▼           ▼           ▼
                            EVM Channel  XRP Channel  Aptos Channel
                            (if USDC)    (if XRP)     (if APT)
```

---

## Security Considerations

### Aptos-Specific Security

1. **Private Key Security:** Aptos account private key stored in environment variable
2. **Claim Signing Key:** Dedicated ed25519 keypair for claims
3. **Settlement Delay:** Minimum 1 hour for production (configurable)
4. **Move Safety:** Leverage Move's resource model to prevent double-spending
5. **Module Verification:** Move Prover annotations for formal verification
6. **Signature Verification:** On-chain ed25519 verification via `aptos_std::ed25519`

### Multi-Chain Security

1. **Key Isolation:** Separate keypairs for each chain (no key reuse)
2. **Network Isolation:** Separate RPC endpoints for testnet/mainnet
3. **Settlement Routing Validation:** Verify peer supports requested settlement method
4. **Atomic Accounting:** TigerBeetle updates atomic across all settlement chains

---

## Performance Requirements

- Aptos claim signing: <10ms per claim
- Aptos claim verification: <5ms per verification
- Aptos channel creation: <2 seconds (including chain confirmation)
- Aptos claim submission: <2 seconds (including chain confirmation)
- Settlement routing decision: <1ms (EVM vs XRP vs Aptos)

---

## Success Metrics

- Aptos channel creation success rate: 100%
- Aptos claim verification accuracy: 100%
- Aptos settlement execution success rate: >99%
- Average Aptos settlement latency: <2 seconds
- Aptos transaction cost: <$0.001 per settlement
- Tri-chain routing accuracy: 100%
