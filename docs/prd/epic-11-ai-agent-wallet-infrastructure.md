# Epic 11: AI Agent Wallet Infrastructure

**Epic Number:** 11

**Goal:** Deliver comprehensive wallet infrastructure for AI agents in the M2M economy, enabling programmatic wallet creation, hierarchical deterministic (HD) wallet derivation for scalable agent provisioning, per-agent wallet isolation with automated lifecycle management, and complete wallet monitoring and recovery capabilities. This epic transforms the platform from connector-operator-focused to AI-agent-native, allowing autonomous agents to seamlessly manage their own cryptocurrency wallets across multiple blockchains (Base L2, XRP Ledger) without human intervention. The infrastructure supports thousands of concurrent agent wallets with balance tracking, transaction history, automated funding, and backup/recovery procedures.

**Foundation:** This epic builds on Epic 8 (EVM Payment Channels) and Epic 9 (XRP Payment Channels) to provide agents with the wallet infrastructure needed to participate in payment channels, execute settlements, and manage cryptocurrency balances autonomously.

**Important:** This epic focuses on **end-user AI agent wallets**, not connector operator wallets. Connector operators use Epic 12 Story 12.2 (HSM/KMS) for infrastructure key management. AI agents need lightweight, programmatically-managed wallets optimized for high-volume, low-value micropayments.

---

## Story 11.1: HD Wallet Master Seed Management

As a platform operator,
I want secure hierarchical deterministic (HD) wallet seed generation and storage,
so that I can derive thousands of agent wallets from a single master seed with proper backup procedures.

### Acceptance Criteria

1. `WalletSeedManager` class implemented in `packages/connector/src/wallet/wallet-seed-manager.ts`
2. Seed manager generates BIP-39 mnemonic phrases (12/24 words) for master seed creation
3. Seed manager supports multiple derivation paths: BIP-44 (Ethereum), BIP-44 (XRP)
4. Seed manager implements secure seed storage: encrypted at rest using AES-256-GCM
5. Seed manager integrates with Epic 12's KeyManager for optional HSM/KMS seed storage
6. Seed manager supports seed import from existing mnemonic for migration scenarios
7. Seed manager implements seed backup export (encrypted file + paper wallet format)
8. Seed manager validates mnemonic checksums on import
9. Unit tests verify seed generation, encryption, derivation, and backup/restore
10. Integration test creates master seed, derives 1000 wallets, verifies uniqueness

### Technical Specification

**BIP-39 Mnemonic Generation:**

```typescript
// packages/connector/src/wallet/wallet-seed-manager.ts

import * as bip39 from 'bip39';
import { HDKey } from 'ethereum-cryptography/hdkey';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

interface MasterSeed {
  mnemonic: string; // BIP-39 mnemonic phrase
  seed: Buffer; // 512-bit seed from mnemonic
  createdAt: number;
  encryptionKey?: Buffer; // AES-256 key for encrypted storage
}

class WalletSeedManager {
  constructor(
    private keyManager?: KeyManager, // Optional HSM/KMS integration
    private config: SeedConfig
  ) {}

  // Generate new master seed
  async generateMasterSeed(strength: 128 | 256 = 256): Promise<MasterSeed> {
    // Generate 24-word mnemonic (256-bit entropy)
    const mnemonic = bip39.generateMnemonic(strength);
    const seed = await bip39.mnemonicToSeed(mnemonic);

    return {
      mnemonic,
      seed,
      createdAt: Date.now(),
    };
  }

  // Import existing mnemonic
  async importMasterSeed(mnemonic: string): Promise<MasterSeed> {
    if (!bip39.validateMnemonic(mnemonic)) {
      throw new Error('Invalid mnemonic checksum');
    }

    const seed = await bip39.mnemonicToSeed(mnemonic);

    return {
      mnemonic,
      seed,
      createdAt: Date.now(),
    };
  }

  // Encrypt and store master seed
  async encryptAndStore(masterSeed: MasterSeed, password: string): Promise<string> {
    const encryptionKey = this.deriveEncryptionKey(password);
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);

    const encrypted = Buffer.concat([cipher.update(masterSeed.mnemonic, 'utf8'), cipher.final()]);

    const authTag = cipher.getAuthTag();

    // Store: IV (16) + AuthTag (16) + Encrypted mnemonic
    const encryptedSeed = Buffer.concat([iv, authTag, encrypted]);

    await this.storage.set('master-seed', encryptedSeed.toString('base64'));

    return encryptedSeed.toString('base64');
  }

  // Decrypt and load master seed
  async decryptAndLoad(password: string): Promise<MasterSeed> {
    const encryptedData = await this.storage.get('master-seed');
    const encryptedBuffer = Buffer.from(encryptedData, 'base64');

    const iv = encryptedBuffer.slice(0, 16);
    const authTag = encryptedBuffer.slice(16, 32);
    const encrypted = encryptedBuffer.slice(32);

    const encryptionKey = this.deriveEncryptionKey(password);
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey, iv);
    decipher.setAuthTag(authTag);

    const mnemonic = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');

    return this.importMasterSeed(mnemonic);
  }

  // Export encrypted backup
  async exportBackup(masterSeed: MasterSeed, password: string): Promise<BackupData> {
    const encryptedSeed = await this.encryptAndStore(masterSeed, password);

    return {
      version: '1.0',
      createdAt: masterSeed.createdAt,
      encryptedSeed,
      backupDate: Date.now(),
      checksum: this.calculateChecksum(encryptedSeed),
    };
  }

  private deriveEncryptionKey(password: string): Buffer {
    // Use PBKDF2 to derive encryption key from password
    const crypto = require('crypto');
    return crypto.pbkdf2Sync(password, 'salt', 100000, 32, 'sha256');
  }
}
```

### Derivation Paths

**Ethereum (Base L2):**

- Standard: `m/44'/60'/0'/0/{index}`
- Agent wallets: `m/44'/60'/1'/0/{agentIndex}`

**XRP Ledger:**

- Standard: `m/44'/144'/0'/0/{index}`
- Agent wallets: `m/44'/144'/1'/0/{agentIndex}`

### Security Considerations

1. **Seed Storage:** Master seed NEVER stored in plaintext, always encrypted at rest
2. **Password Policy:** Minimum 16 characters, enforce complexity requirements
3. **Backup Security:** Encrypted backup files include checksum validation
4. **Paper Wallets:** Support QR code generation for offline backup
5. **HSM Integration:** Optional HSM storage for enterprise deployments (via Epic 12's KeyManager)

---

## Story 11.2: Agent Wallet Derivation and Address Generation

As an AI agent provisioning system,
I want to derive unique EVM and XRP wallets for each agent from the master seed,
so that agents have isolated cryptocurrency addresses without managing individual private keys.

### Acceptance Criteria

1. `AgentWalletDerivation` class implemented in `packages/connector/src/wallet/agent-wallet-derivation.ts`
2. Wallet derivation uses BIP-44 standard paths for deterministic address generation
3. Derivation generates both EVM address (Base L2) and XRP address from same agent index
4. Derivation supports up to 2^31 agent wallets (2.1 billion agents)
5. Derived wallets cached in memory for fast lookup (agent ID → addresses)
6. Derivation validates agent index bounds and prevents collisions
7. Public address exposure without private key access (security isolation)
8. Wallet metadata includes: agent ID, derivation index, creation timestamp, blockchain addresses
9. Unit tests verify deterministic derivation (same seed + index = same address)
10. Integration test derives 10,000 agent wallets and verifies address uniqueness

### Wallet Derivation Implementation

```typescript
// packages/connector/src/wallet/agent-wallet-derivation.ts

import { HDKey } from 'ethereum-cryptography/hdkey';
import { Wallet } from 'ethers';
import { Wallet as XRPLWallet } from 'xrpl';

interface AgentWallet {
  agentId: string;
  derivationIndex: number;
  evmAddress: string;
  xrpAddress: string;
  createdAt: number;
  metadata?: Record<string, any>;
}

class AgentWalletDerivation {
  private walletCache = new Map<string, AgentWallet>();
  private indexToAgentId = new Map<number, string>();

  constructor(private seedManager: WalletSeedManager) {}

  // Derive wallet for new agent
  async deriveAgentWallet(agentId: string): Promise<AgentWallet> {
    // Check if wallet already exists
    if (this.walletCache.has(agentId)) {
      return this.walletCache.get(agentId)!;
    }

    // Get next available derivation index
    const derivationIndex = this.getNextIndex();

    // Load master seed (requires password/auth)
    const masterSeed = await this.seedManager.decryptAndLoad(this.password);

    // Derive EVM wallet (Ethereum/Base L2)
    const evmPath = `m/44'/60'/1'/0/${derivationIndex}`;
    const evmHDKey = HDKey.fromMasterSeed(masterSeed.seed).derive(evmPath);
    const evmWallet = new Wallet(evmHDKey.privateKey!);

    // Derive XRP wallet
    const xrpPath = `m/44'/144'/1'/0/${derivationIndex}`;
    const xrpHDKey = HDKey.fromMasterSeed(masterSeed.seed).derive(xrpPath);
    const xrpWallet = XRPLWallet.fromSeed(xrpHDKey.privateKey!.toString('hex'));

    const agentWallet: AgentWallet = {
      agentId,
      derivationIndex,
      evmAddress: evmWallet.address,
      xrpAddress: xrpWallet.address,
      createdAt: Date.now(),
    };

    // Cache and persist
    this.walletCache.set(agentId, agentWallet);
    this.indexToAgentId.set(derivationIndex, agentId);
    await this.persistWalletMetadata(agentWallet);

    return agentWallet;
  }

  // Get wallet for existing agent
  async getAgentWallet(agentId: string): Promise<AgentWallet | null> {
    // Check cache first
    if (this.walletCache.has(agentId)) {
      return this.walletCache.get(agentId)!;
    }

    // Load from persistent storage
    return await this.loadWalletMetadata(agentId);
  }

  // Get signer for agent (for transactions)
  async getAgentSigner(agentId: string, chain: 'evm' | 'xrp'): Promise<any> {
    const wallet = await this.getAgentWallet(agentId);
    if (!wallet) {
      throw new Error(`No wallet found for agent ${agentId}`);
    }

    const masterSeed = await this.seedManager.decryptAndLoad(this.password);

    if (chain === 'evm') {
      const path = `m/44'/60'/1'/0/${wallet.derivationIndex}`;
      const hdKey = HDKey.fromMasterSeed(masterSeed.seed).derive(path);
      return new Wallet(hdKey.privateKey!);
    } else {
      const path = `m/44'/144'/1'/0/${wallet.derivationIndex}`;
      const hdKey = HDKey.fromMasterSeed(masterSeed.seed).derive(path);
      return XRPLWallet.fromSeed(hdKey.privateKey!.toString('hex'));
    }
  }

  // Batch derive wallets for multiple agents
  async batchDeriveWallets(agentIds: string[]): Promise<AgentWallet[]> {
    const wallets = await Promise.all(agentIds.map((id) => this.deriveAgentWallet(id)));
    return wallets;
  }

  private getNextIndex(): number {
    // Get highest used index and increment
    const maxIndex = Math.max(-1, ...this.indexToAgentId.keys());
    return maxIndex + 1;
  }

  private async persistWalletMetadata(wallet: AgentWallet): Promise<void> {
    await this.db.wallets.insert({
      agentId: wallet.agentId,
      derivationIndex: wallet.derivationIndex,
      evmAddress: wallet.evmAddress,
      xrpAddress: wallet.xrpAddress,
      createdAt: wallet.createdAt,
    });
  }

  private async loadWalletMetadata(agentId: string): Promise<AgentWallet | null> {
    const record = await this.db.wallets.findOne({ agentId });
    if (!record) return null;

    const wallet = {
      agentId: record.agentId,
      derivationIndex: record.derivationIndex,
      evmAddress: record.evmAddress,
      xrpAddress: record.xrpAddress,
      createdAt: record.createdAt,
    };

    // Update cache
    this.walletCache.set(agentId, wallet);
    return wallet;
  }
}
```

### Wallet Metadata Storage

**Database Schema:**

```sql
CREATE TABLE agent_wallets (
  agent_id VARCHAR(255) PRIMARY KEY,
  derivation_index INTEGER UNIQUE NOT NULL,
  evm_address VARCHAR(42) NOT NULL,
  xrp_address VARCHAR(35) NOT NULL,
  created_at BIGINT NOT NULL,
  metadata JSONB
);

CREATE INDEX idx_derivation_index ON agent_wallets(derivation_index);
CREATE INDEX idx_evm_address ON agent_wallets(evm_address);
CREATE INDEX idx_xrp_address ON agent_wallets(xrp_address);
```

---

## Story 11.3: Agent Wallet Balance Tracking and Monitoring

As a platform operator,
I want real-time balance tracking for all agent wallets across multiple blockchains,
so that I can monitor agent financial activity and ensure sufficient funds for operations.

### Acceptance Criteria

1. `AgentBalanceTracker` class implemented in `packages/connector/src/wallet/agent-balance-tracker.ts`
2. Balance tracker monitors EVM balances (ETH for gas, ERC20 tokens)
3. Balance tracker monitors XRP balances (native XRP)
4. Balance tracker polls blockchain RPCs every 30 seconds for balance updates
5. Balance tracker caches balances in memory and persists to database
6. Balance tracker emits events on balance changes (increase/decrease)
7. Balance tracker integrates with TigerBeetle for off-chain balance reconciliation
8. Balance tracker exposes API: `getBalance(agentId, chain, token)`, `getAllBalances(agentId)`
9. Unit tests verify balance queries and change detection
10. Integration test tracks balances for 100 agents, verifies accuracy after transactions

### Balance Tracking Implementation

```typescript
// packages/connector/src/wallet/agent-balance-tracker.ts

import { ethers } from 'ethers';
import { Client as XRPLClient } from 'xrpl';

interface AgentBalance {
  agentId: string;
  chain: 'evm' | 'xrp';
  token: string; // 'ETH', 'USDC', 'XRP', etc.
  balance: bigint;
  lastUpdated: number;
}

class AgentBalanceTracker {
  private balanceCache = new Map<string, AgentBalance>();
  private pollingInterval = 30000; // 30 seconds

  constructor(
    private walletDerivation: AgentWalletDerivation,
    private evmProvider: ethers.Provider,
    private xrplClient: XRPLClient
  ) {
    // Start periodic balance polling
    setInterval(() => this.pollAllBalances(), this.pollingInterval);
  }

  // Get balance for specific agent/chain/token
  async getBalance(agentId: string, chain: 'evm' | 'xrp', token: string): Promise<bigint> {
    const cacheKey = `${agentId}-${chain}-${token}`;

    // Check cache first (if recent)
    const cached = this.balanceCache.get(cacheKey);
    if (cached && Date.now() - cached.lastUpdated < this.pollingInterval) {
      return cached.balance;
    }

    // Fetch fresh balance
    const balance = await this.fetchBalance(agentId, chain, token);

    // Update cache
    this.balanceCache.set(cacheKey, {
      agentId,
      chain,
      token,
      balance,
      lastUpdated: Date.now(),
    });

    return balance;
  }

  // Get all balances for agent
  async getAllBalances(agentId: string): Promise<AgentBalance[]> {
    const wallet = await this.walletDerivation.getAgentWallet(agentId);
    if (!wallet) return [];

    const balances: AgentBalance[] = [];

    // EVM balances
    const ethBalance = await this.getBalance(agentId, 'evm', 'ETH');
    balances.push({
      agentId,
      chain: 'evm',
      token: 'ETH',
      balance: ethBalance,
      lastUpdated: Date.now(),
    });

    // ERC20 token balances (USDC, DAI, etc.)
    for (const tokenAddress of this.config.erc20Tokens) {
      const tokenBalance = await this.getBalance(agentId, 'evm', tokenAddress);
      balances.push({
        agentId,
        chain: 'evm',
        token: tokenAddress,
        balance: tokenBalance,
        lastUpdated: Date.now(),
      });
    }

    // XRP balance
    const xrpBalance = await this.getBalance(agentId, 'xrp', 'XRP');
    balances.push({
      agentId,
      chain: 'xrp',
      token: 'XRP',
      balance: xrpBalance,
      lastUpdated: Date.now(),
    });

    return balances;
  }

  private async fetchBalance(
    agentId: string,
    chain: 'evm' | 'xrp',
    token: string
  ): Promise<bigint> {
    const wallet = await this.walletDerivation.getAgentWallet(agentId);
    if (!wallet) throw new Error(`No wallet for agent ${agentId}`);

    if (chain === 'evm') {
      if (token === 'ETH') {
        // Native ETH balance
        const balance = await this.evmProvider.getBalance(wallet.evmAddress);
        return balance;
      } else {
        // ERC20 token balance
        const tokenContract = new ethers.Contract(
          token,
          ['function balanceOf(address) view returns (uint256)'],
          this.evmProvider
        );
        const balance = await tokenContract.balanceOf(wallet.evmAddress);
        return balance;
      }
    } else {
      // XRP balance
      const accountInfo = await this.xrplClient.request({
        command: 'account_info',
        account: wallet.xrpAddress,
      });

      const drops = accountInfo.result.account_data.Balance;
      return BigInt(drops);
    }
  }

  // Poll all agent balances periodically
  private async pollAllBalances(): Promise<void> {
    const allWallets = await this.walletDerivation.getAllWallets();

    for (const wallet of allWallets) {
      try {
        await this.getAllBalances(wallet.agentId);
      } catch (error) {
        this.logger.error('Balance polling failed', { agentId: wallet.agentId, error });
      }
    }
  }

  // Emit telemetry event on balance change
  private emitBalanceChange(
    agentId: string,
    chain: string,
    token: string,
    oldBalance: bigint,
    newBalance: bigint
  ) {
    this.telemetryEmitter.emit('AGENT_BALANCE_CHANGED', {
      agentId,
      chain,
      token,
      oldBalance: oldBalance.toString(),
      newBalance: newBalance.toString(),
      change: (newBalance - oldBalance).toString(),
      timestamp: Date.now(),
    });
  }
}
```

---

## Story 11.4: Automated Agent Wallet Funding

As a platform operator,
I want automated wallet funding for new agents,
so that agents can begin transacting immediately without manual funding intervention.

### Acceptance Criteria

1. `AgentWalletFunder` class implemented in `packages/connector/src/wallet/agent-wallet-funder.ts`
2. Funder automatically sends initial ETH for gas when new EVM wallet created
3. Funder automatically sends initial XRP (15 XRP minimum reserve) when new XRP wallet created
4. Funder supports multiple funding strategies: fixed amount, proportional to expected activity
5. Funder integrates with platform treasury wallet for funding source
6. Funder implements rate limiting to prevent funding abuse
7. Funder tracks funding transactions and reconciles with on-chain confirmations
8. Funder emits telemetry events for all funding operations
9. Unit tests verify funding logic and rate limiting
10. Integration test creates 100 agents, verifies all receive initial funding

### Automated Funding Implementation

```typescript
// packages/connector/src/wallet/agent-wallet-funder.ts

interface FundingConfig {
  evm: {
    initialETH: bigint; // e.g., 0.01 ETH for gas
    initialTokens: {
      [tokenAddress: string]: bigint; // e.g., 100 USDC
    };
  };
  xrp: {
    initialXRP: bigint; // e.g., 15 XRP (minimum reserve + buffer)
  };
  rateLimits: {
    maxFundingsPerHour: number;
    maxFundingsPerAgent: number;
  };
}

class AgentWalletFunder {
  private fundingHistory = new Map<string, FundingRecord[]>();

  constructor(
    private config: FundingConfig,
    private walletDerivation: AgentWalletDerivation,
    private treasuryWallet: TreasuryWallet
  ) {}

  // Fund new agent wallet
  async fundAgentWallet(agentId: string): Promise<FundingResult> {
    // Check rate limits
    if (!this.checkRateLimit(agentId)) {
      throw new Error('Funding rate limit exceeded');
    }

    const wallet = await this.walletDerivation.getAgentWallet(agentId);
    if (!wallet) {
      throw new Error(`No wallet for agent ${agentId}`);
    }

    const results: FundingResult = {
      agentId,
      transactions: [],
      timestamp: Date.now(),
    };

    // Fund EVM wallet (ETH for gas)
    const ethTx = await this.fundEVMWallet(wallet.evmAddress, this.config.evm.initialETH);
    results.transactions.push(ethTx);

    // Fund EVM wallet (ERC20 tokens)
    for (const [tokenAddress, amount] of Object.entries(this.config.evm.initialTokens)) {
      const tokenTx = await this.fundERC20Token(wallet.evmAddress, tokenAddress, amount);
      results.transactions.push(tokenTx);
    }

    // Fund XRP wallet
    const xrpTx = await this.fundXRPWallet(wallet.xrpAddress, this.config.xrp.initialXRP);
    results.transactions.push(xrpTx);

    // Record funding
    this.recordFunding(agentId, results);

    // Emit telemetry
    this.telemetryEmitter.emit('AGENT_WALLET_FUNDED', {
      agentId,
      evmAddress: wallet.evmAddress,
      xrpAddress: wallet.xrpAddress,
      transactions: results.transactions,
      timestamp: Date.now(),
    });

    return results;
  }

  private async fundEVMWallet(address: string, amount: bigint): Promise<FundingTransaction> {
    const tx = await this.treasuryWallet.sendETH(address, amount);

    return {
      chain: 'evm',
      token: 'ETH',
      to: address,
      amount: amount.toString(),
      txHash: tx.hash,
      status: 'pending',
    };
  }

  private async fundERC20Token(
    address: string,
    tokenAddress: string,
    amount: bigint
  ): Promise<FundingTransaction> {
    const tx = await this.treasuryWallet.sendERC20(address, tokenAddress, amount);

    return {
      chain: 'evm',
      token: tokenAddress,
      to: address,
      amount: amount.toString(),
      txHash: tx.hash,
      status: 'pending',
    };
  }

  private async fundXRPWallet(address: string, amount: bigint): Promise<FundingTransaction> {
    const tx = await this.treasuryWallet.sendXRP(address, amount);

    return {
      chain: 'xrp',
      token: 'XRP',
      to: address,
      amount: amount.toString(),
      txHash: tx.id,
      status: 'pending',
    };
  }

  private checkRateLimit(agentId: string): boolean {
    const history = this.fundingHistory.get(agentId) || [];

    // Check total fundings for this agent
    if (history.length >= this.config.rateLimits.maxFundingsPerAgent) {
      return false;
    }

    // Check fundings in last hour
    const oneHourAgo = Date.now() - 3600000;
    const recentFundings = history.filter((f) => f.timestamp > oneHourAgo);

    if (recentFundings.length >= this.config.rateLimits.maxFundingsPerHour) {
      return false;
    }

    return true;
  }

  private recordFunding(agentId: string, result: FundingResult): void {
    const history = this.fundingHistory.get(agentId) || [];
    history.push({
      timestamp: result.timestamp,
      transactions: result.transactions,
    });
    this.fundingHistory.set(agentId, history);
  }
}
```

---

## Story 11.5: Agent Wallet Lifecycle Management

As a platform operator,
I want automated wallet lifecycle management (create, activate, suspend, archive),
so that agent wallets are efficiently managed throughout their operational lifetime.

### Acceptance Criteria

1. `AgentWalletLifecycle` class implemented in `packages/connector/src/wallet/agent-wallet-lifecycle.ts`
2. Lifecycle states: `pending`, `active`, `suspended`, `archived`
3. Lifecycle manager handles wallet creation → funding → activation flow
4. Lifecycle manager supports wallet suspension (temporarily disable transactions)
5. Lifecycle manager supports wallet archival (export final state, remove from active tracking)
6. Lifecycle manager tracks wallet activity: last transaction, total volume, transaction count
7. Lifecycle manager implements auto-archive policy: archive wallets inactive for X days
8. Lifecycle manager emits telemetry events for all state transitions
9. Unit tests verify state machine transitions
10. Integration test demonstrates full lifecycle: create → fund → transact → suspend → archive

### Lifecycle State Machine

```
┌─────────────┐
│   Pending   │ ──→ Wallet created, awaiting funding
└──────┬──────┘
       │ Funding transactions confirmed
       ▼
┌─────────────┐
│   Active    │ ──→ Wallet funded, can transact
│             │ ◄──→ Normal operations
└──────┬──────┘
       │ Suspicious activity / manual intervention
       ▼
┌─────────────┐
│  Suspended  │ ──→ Transactions blocked, under review
└──────┬──────┘
       │ Review complete / inactivity timeout
       ▼
┌─────────────┐
│  Archived   │ ──→ Final state, exported and removed
└─────────────┘
```

### Lifecycle Management Implementation

```typescript
// packages/connector/src/wallet/agent-wallet-lifecycle.ts

enum WalletState {
  PENDING = 'pending',
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  ARCHIVED = 'archived',
}

interface WalletLifecycleRecord {
  agentId: string;
  state: WalletState;
  createdAt: number;
  activatedAt?: number;
  suspendedAt?: number;
  archivedAt?: number;
  lastActivity?: number;
  totalTransactions: number;
  totalVolume: Record<string, bigint>; // token → volume
  suspensionReason?: string;
}

class AgentWalletLifecycle {
  private lifecycleRecords = new Map<string, WalletLifecycleRecord>();

  constructor(
    private walletDerivation: AgentWalletDerivation,
    private walletFunder: AgentWalletFunder,
    private config: LifecycleConfig
  ) {
    // Periodic cleanup: archive inactive wallets
    setInterval(() => this.archiveInactiveWallets(), 86400000); // Daily
  }

  // Create new agent wallet (pending state)
  async createAgentWallet(agentId: string): Promise<WalletLifecycleRecord> {
    // Derive wallet addresses
    const wallet = await this.walletDerivation.deriveAgentWallet(agentId);

    // Initialize lifecycle record
    const record: WalletLifecycleRecord = {
      agentId,
      state: WalletState.PENDING,
      createdAt: Date.now(),
      totalTransactions: 0,
      totalVolume: {},
    };

    this.lifecycleRecords.set(agentId, record);
    await this.persistLifecycleRecord(record);

    // Emit telemetry
    this.emitStateChange(agentId, null, WalletState.PENDING);

    // Auto-fund wallet
    await this.fundAndActivate(agentId);

    return record;
  }

  // Fund and activate wallet
  private async fundAndActivate(agentId: string): Promise<void> {
    const record = this.lifecycleRecords.get(agentId);
    if (!record || record.state !== WalletState.PENDING) return;

    try {
      // Fund wallet
      await this.walletFunder.fundAgentWallet(agentId);

      // Wait for funding confirmations
      await this.waitForFundingConfirmations(agentId);

      // Transition to active
      await this.transitionState(agentId, WalletState.ACTIVE);
      record.activatedAt = Date.now();

      this.logger.info('Agent wallet activated', { agentId });
    } catch (error) {
      this.logger.error('Wallet funding failed', { agentId, error });
    }
  }

  // Suspend wallet (manual or automated)
  async suspendWallet(agentId: string, reason: string): Promise<void> {
    const record = this.lifecycleRecords.get(agentId);
    if (!record || record.state !== WalletState.ACTIVE) {
      throw new Error(`Cannot suspend wallet in state ${record?.state}`);
    }

    await this.transitionState(agentId, WalletState.SUSPENDED);
    record.suspendedAt = Date.now();
    record.suspensionReason = reason;

    this.logger.warn('Agent wallet suspended', { agentId, reason });
  }

  // Reactivate suspended wallet
  async reactivateWallet(agentId: string): Promise<void> {
    const record = this.lifecycleRecords.get(agentId);
    if (!record || record.state !== WalletState.SUSPENDED) {
      throw new Error(`Cannot reactivate wallet in state ${record?.state}`);
    }

    await this.transitionState(agentId, WalletState.ACTIVE);
    record.suspendedAt = undefined;
    record.suspensionReason = undefined;

    this.logger.info('Agent wallet reactivated', { agentId });
  }

  // Archive wallet (final state)
  async archiveWallet(agentId: string): Promise<WalletArchive> {
    const record = this.lifecycleRecords.get(agentId);
    if (!record) throw new Error(`No wallet for agent ${agentId}`);

    // Export final state
    const wallet = await this.walletDerivation.getAgentWallet(agentId);
    const balances = await this.balanceTracker.getAllBalances(agentId);

    const archive: WalletArchive = {
      agentId,
      wallet,
      balances,
      lifecycleRecord: record,
      archivedAt: Date.now(),
    };

    // Transition to archived
    await this.transitionState(agentId, WalletState.ARCHIVED);
    record.archivedAt = Date.now();

    // Remove from active tracking
    this.lifecycleRecords.delete(agentId);

    // Persist archive
    await this.persistArchive(archive);

    this.logger.info('Agent wallet archived', { agentId });

    return archive;
  }

  // Auto-archive inactive wallets
  private async archiveInactiveWallets(): Promise<void> {
    const inactivityThreshold = this.config.inactivityDays * 86400000; // Convert to ms
    const now = Date.now();

    for (const [agentId, record] of this.lifecycleRecords) {
      if (record.state !== WalletState.ACTIVE) continue;

      const lastActivity = record.lastActivity || record.activatedAt || record.createdAt;
      const inactiveDuration = now - lastActivity;

      if (inactiveDuration > inactivityThreshold) {
        this.logger.info('Auto-archiving inactive wallet', {
          agentId,
          inactiveDays: inactiveDuration / 86400000,
        });
        await this.archiveWallet(agentId);
      }
    }
  }

  // Record transaction activity
  async recordTransaction(agentId: string, token: string, amount: bigint): Promise<void> {
    const record = this.lifecycleRecords.get(agentId);
    if (!record) return;

    record.lastActivity = Date.now();
    record.totalTransactions++;
    record.totalVolume[token] = (record.totalVolume[token] || 0n) + amount;

    await this.persistLifecycleRecord(record);
  }

  private async transitionState(agentId: string, newState: WalletState): Promise<void> {
    const record = this.lifecycleRecords.get(agentId);
    if (!record) return;

    const oldState = record.state;
    record.state = newState;

    await this.persistLifecycleRecord(record);
    this.emitStateChange(agentId, oldState, newState);
  }

  private emitStateChange(
    agentId: string,
    oldState: WalletState | null,
    newState: WalletState
  ): void {
    this.telemetryEmitter.emit('AGENT_WALLET_STATE_CHANGED', {
      agentId,
      oldState,
      newState,
      timestamp: Date.now(),
    });
  }

  private async persistLifecycleRecord(record: WalletLifecycleRecord): Promise<void> {
    await this.db.walletLifecycle.upsert({ agentId: record.agentId }, record);
  }

  private async persistArchive(archive: WalletArchive): Promise<void> {
    await this.db.walletArchives.insert(archive);
  }
}
```

---

## Story 11.6: Payment Channel Integration for Agent Wallets

As an AI agent,
I want to open and manage payment channels using my wallet,
so that I can execute micropayments with low fees and high speed.

### Acceptance Criteria

1. `AgentChannelManager` class implemented in `packages/connector/src/wallet/agent-channel-manager.ts`
2. Channel manager integrates with Epic 8's `PaymentChannelSDK` for EVM channels
3. Channel manager integrates with Epic 9's `XRPChannelSDK` for XRP channels
4. Channel manager opens channels on behalf of agents (using derived wallets)
5. Channel manager tracks all active channels per agent
6. Channel manager handles channel deposits, balance proof signing, and closures
7. Channel manager implements channel rebalancing: close depleted channels, open new ones
8. Channel manager exposes agent API: `openChannel()`, `sendPayment()`, `closeChannel()`
9. Unit tests verify channel operations with agent wallets
10. Integration test demonstrates agent opening channel, sending payments, closing channel

### Agent Channel Management

```typescript
// packages/connector/src/wallet/agent-channel-manager.ts

class AgentChannelManager {
  constructor(
    private walletDerivation: AgentWalletDerivation,
    private evmChannelSDK: PaymentChannelSDK, // Epic 8
    private xrpChannelSDK: XRPChannelSDK, // Epic 9
    private lifecycleManager: AgentWalletLifecycle
  ) {}

  // Open payment channel for agent
  async openChannel(
    agentId: string,
    peerId: string,
    chain: 'evm' | 'xrp',
    token: string,
    amount: bigint
  ): Promise<string> {
    // Verify agent wallet is active
    const lifecycle = await this.lifecycleManager.getLifecycleRecord(agentId);
    if (lifecycle.state !== WalletState.ACTIVE) {
      throw new Error(`Agent wallet not active: ${lifecycle.state}`);
    }

    // Get agent signer
    const signer = await this.walletDerivation.getAgentSigner(agentId, chain);

    let channelId: string;

    if (chain === 'evm') {
      // Open EVM payment channel (Epic 8)
      const peerWallet = await this.getPeerWallet(peerId);
      channelId = await this.evmChannelSDK.openChannel(
        peerWallet.evmAddress,
        token,
        3600, // Settlement timeout: 1 hour
        amount
      );
    } else {
      // Open XRP payment channel (Epic 9)
      const peerWallet = await this.getPeerWallet(peerId);
      channelId = await this.xrpChannelSDK.openChannel(
        peerWallet.xrpAddress,
        amount.toString(), // XRP drops
        3600 // Settlement delay: 1 hour
      );
    }

    // Track channel
    await this.trackAgentChannel(agentId, channelId, chain, peerId);

    // Emit telemetry
    this.telemetryEmitter.emit('AGENT_CHANNEL_OPENED', {
      agentId,
      channelId,
      chain,
      peerId,
      amount: amount.toString(),
      timestamp: Date.now(),
    });

    return channelId;
  }

  // Send payment through channel
  async sendPayment(agentId: string, channelId: string, amount: bigint): Promise<void> {
    const channel = await this.getAgentChannel(agentId, channelId);
    if (!channel) throw new Error('Channel not found');

    const signer = await this.walletDerivation.getAgentSigner(agentId, channel.chain);

    if (channel.chain === 'evm') {
      // Sign EVM balance proof
      const currentState = await this.evmChannelSDK.getChannelState(channelId);
      const newNonce = currentState.myNonce + 1;
      const newTransferred = currentState.myTransferred + amount;

      const signature = await this.evmChannelSDK.signBalanceProof(
        channelId,
        newNonce,
        newTransferred
      );

      // Send balance proof to peer off-chain
      await this.sendBalanceProofToPeer(channel.peerId, {
        channelId,
        nonce: newNonce,
        transferredAmount: newTransferred,
        signature,
      });
    } else {
      // Sign XRP claim
      const currentState = await this.xrpChannelSDK.getChannelState(channelId);
      const newAmount = BigInt(currentState.balance) + amount;

      const claim = this.xrpChannelSDK.signClaim(channelId, newAmount.toString());

      // Send claim to peer off-chain
      await this.sendClaimToPeer(channel.peerId, claim);
    }

    // Record transaction
    await this.lifecycleManager.recordTransaction(agentId, channel.token, amount);
  }

  // Close payment channel
  async closeChannel(agentId: string, channelId: string): Promise<void> {
    const channel = await this.getAgentChannel(agentId, channelId);
    if (!channel) throw new Error('Channel not found');

    const signer = await this.walletDerivation.getAgentSigner(agentId, channel.chain);

    if (channel.chain === 'evm') {
      await this.evmChannelSDK.closeChannel(channelId);
    } else {
      await this.xrpChannelSDK.closeChannel(channelId);
    }

    // Remove from tracking
    await this.untrackAgentChannel(agentId, channelId);

    // Emit telemetry
    this.telemetryEmitter.emit('AGENT_CHANNEL_CLOSED', {
      agentId,
      channelId,
      chain: channel.chain,
      timestamp: Date.now(),
    });
  }

  // Get all channels for agent
  async getAgentChannels(agentId: string): Promise<AgentChannel[]> {
    return await this.db.agentChannels.find({ agentId });
  }

  private async trackAgentChannel(
    agentId: string,
    channelId: string,
    chain: 'evm' | 'xrp',
    peerId: string
  ): Promise<void> {
    await this.db.agentChannels.insert({
      agentId,
      channelId,
      chain,
      peerId,
      openedAt: Date.now(),
    });
  }

  private async untrackAgentChannel(agentId: string, channelId: string): Promise<void> {
    await this.db.agentChannels.delete({ agentId, channelId });
  }

  private async getAgentChannel(agentId: string, channelId: string): Promise<AgentChannel | null> {
    return await this.db.agentChannels.findOne({ agentId, channelId });
  }
}
```

---

## Story 11.7: Dashboard Agent Wallet Visualization

As a platform operator,
I want to visualize all agent wallets in the dashboard with balances and activity,
so that I can monitor the financial health of the agent ecosystem.

### Acceptance Criteria

1. `AGENT_WALLET_CREATED` telemetry event added to shared types
2. `AGENT_WALLET_STATE_CHANGED` telemetry event for lifecycle transitions
3. `AGENT_BALANCE_CHANGED` telemetry event for balance updates
4. Dashboard backend stores agent wallet state and balances
5. Dashboard frontend displays "Agent Wallets" panel with list of all agents
6. Agent wallet panel shows: agent ID, EVM address, XRP address, balances, state, last activity
7. Dashboard includes agent wallet details view: full balance breakdown, transaction history, channels
8. Dashboard visualizes agent activity timeline: funding, transactions, channel operations
9. Dashboard includes search/filter: by agent ID, state, balance range
10. Integration test verifies agent wallet telemetry flows to dashboard UI

### Telemetry Schema

```typescript
// packages/shared/src/types/telemetry.ts

interface AgentWalletCreatedEvent {
  type: 'AGENT_WALLET_CREATED';
  timestamp: number;
  nodeId: string;
  agentId: string;
  derivationIndex: number;
  evmAddress: string;
  xrpAddress: string;
}

interface AgentWalletStateChangedEvent {
  type: 'AGENT_WALLET_STATE_CHANGED';
  timestamp: number;
  nodeId: string;
  agentId: string;
  oldState: 'pending' | 'active' | 'suspended' | 'archived' | null;
  newState: 'pending' | 'active' | 'suspended' | 'archived';
}

interface AgentBalanceChangedEvent {
  type: 'AGENT_BALANCE_CHANGED';
  timestamp: number;
  nodeId: string;
  agentId: string;
  chain: 'evm' | 'xrp';
  token: string;
  oldBalance: string; // bigint as string
  newBalance: string;
  change: string;
}

interface AgentChannelOpenedEvent {
  type: 'AGENT_CHANNEL_OPENED';
  timestamp: number;
  nodeId: string;
  agentId: string;
  channelId: string;
  chain: 'evm' | 'xrp';
  peerId: string;
  amount: string;
}
```

### Dashboard UI Components

**Agent Wallets Panel:**

```
┌─ Agent Wallets (Filter: Active ▼) ────────────┐
│ Agent: agent-001 | State: ✅ Active             │
│ EVM: 0x742d...bEb | Balance: 0.05 ETH, 100 USDC│
│ XRP: rN7n7...XEEw | Balance: 25 XRP             │
│ Last Activity: 2 minutes ago                   │
├────────────────────────────────────────────────┤
│ Agent: agent-002 | State: ⏸️  Suspended         │
│ EVM: 0x8ba1...A72 | Balance: 0.01 ETH, 50 DAI  │
│ XRP: rLHzP...HWN  | Balance: 15 XRP             │
│ Last Activity: 3 days ago                      │
└────────────────────────────────────────────────┘
```

**Agent Wallet Details View:**

```
┌─ Agent Wallet Details: agent-001 ─────────────┐
│ Derivation Index: 42                          │
│ Created: 2026-01-01 10:00:00                  │
│ State: Active (activated 2026-01-01 10:05:00) │
│                                                │
│ ┌─ Balances ────────────────────┐             │
│ │ ETH:  0.05 ETH  ($125.00)     │             │
│ │ USDC: 100 USDC ($100.00)      │             │
│ │ XRP:  25 XRP   ($50.00)       │             │
│ └───────────────────────────────┘             │
│                                                │
│ ┌─ Active Channels ─────────────┐             │
│ │ EVM → agent-002 | 50 USDC     │             │
│ │ XRP → agent-003 | 10 XRP      │             │
│ └───────────────────────────────┘             │
│                                                │
│ ┌─ Recent Activity ─────────────┐             │
│ │ 10:15 Channel payment 5 USDC  │             │
│ │ 10:10 Received 100 USDC       │             │
│ │ 10:05 Wallet funded           │             │
│ └───────────────────────────────┘             │
└────────────────────────────────────────────────┘
```

---

## Story 11.8: Wallet Backup and Recovery Procedures

As a platform operator,
I want documented backup and recovery procedures for agent wallets,
so that I can restore agent financial state in disaster scenarios.

### Acceptance Criteria

1. `WalletBackupManager` class implemented in `packages/connector/src/wallet/wallet-backup-manager.ts`
2. Backup manager exports encrypted master seed (from Story 11.1)
3. Backup manager exports all agent wallet metadata (addresses, derivation indices)
4. Backup manager exports lifecycle records and balance snapshots
5. Backup manager implements incremental backups (daily) and full backups (weekly)
6. Backup manager supports backup to: local filesystem, S3, encrypted cloud storage
7. Recovery manager validates backup integrity before restore
8. Recovery manager restores master seed, derives wallets, and reconciles on-chain balances
9. Documentation includes step-by-step recovery procedures
10. Disaster recovery test demonstrates full platform restore from backup

### Backup and Recovery

```typescript
// packages/connector/src/wallet/wallet-backup-manager.ts

interface WalletBackup {
  version: string;
  timestamp: number;
  type: 'full' | 'incremental';
  encryptedMasterSeed: string;
  wallets: AgentWallet[];
  lifecycleRecords: WalletLifecycleRecord[];
  balanceSnapshots: Record<string, AgentBalance[]>;
  checksum: string;
}

class WalletBackupManager {
  constructor(
    private seedManager: WalletSeedManager,
    private walletDerivation: AgentWalletDerivation,
    private lifecycleManager: AgentWalletLifecycle,
    private balanceTracker: AgentBalanceTracker
  ) {
    // Schedule automatic backups
    this.scheduleBackups();
  }

  // Create full backup
  async createFullBackup(password: string): Promise<WalletBackup> {
    this.logger.info('Creating full wallet backup');

    // Export master seed (encrypted)
    const masterSeed = await this.seedManager.decryptAndLoad(password);
    const encryptedSeed = await this.seedManager.exportBackup(masterSeed, password);

    // Export all wallets
    const wallets = await this.walletDerivation.getAllWallets();

    // Export lifecycle records
    const lifecycleRecords = await this.lifecycleManager.getAllRecords();

    // Export balance snapshots
    const balanceSnapshots: Record<string, AgentBalance[]> = {};
    for (const wallet of wallets) {
      balanceSnapshots[wallet.agentId] = await this.balanceTracker.getAllBalances(wallet.agentId);
    }

    const backup: WalletBackup = {
      version: '1.0',
      timestamp: Date.now(),
      type: 'full',
      encryptedMasterSeed: encryptedSeed.encryptedSeed,
      wallets,
      lifecycleRecords,
      balanceSnapshots,
      checksum: '', // Calculated below
    };

    // Calculate checksum
    backup.checksum = this.calculateChecksum(backup);

    // Save backup
    await this.saveBackup(backup);

    this.logger.info('Full wallet backup created', {
      walletCount: wallets.length,
      timestamp: backup.timestamp,
    });

    return backup;
  }

  // Restore from backup
  async restoreFromBackup(backupData: WalletBackup, password: string): Promise<void> {
    this.logger.warn('Starting wallet restore from backup', {
      timestamp: backupData.timestamp,
      walletCount: backupData.wallets.length,
    });

    // Validate backup integrity
    if (!this.validateBackup(backupData)) {
      throw new Error('Backup checksum validation failed');
    }

    // Restore master seed
    const masterSeed = await this.seedManager.importMasterSeed(
      await this.decryptSeedFromBackup(backupData.encryptedMasterSeed, password)
    );

    // Restore wallet metadata
    for (const wallet of backupData.wallets) {
      await this.walletDerivation.importWallet(wallet);
    }

    // Restore lifecycle records
    for (const record of backupData.lifecycleRecords) {
      await this.lifecycleManager.importLifecycleRecord(record);
    }

    // Reconcile on-chain balances (verify backup matches reality)
    await this.reconcileBalances(backupData.balanceSnapshots);

    this.logger.info('Wallet restore completed successfully');
  }

  private async reconcileBalances(snapshots: Record<string, AgentBalance[]>): Promise<void> {
    for (const [agentId, expectedBalances] of Object.entries(snapshots)) {
      const actualBalances = await this.balanceTracker.getAllBalances(agentId);

      for (const expected of expectedBalances) {
        const actual = actualBalances.find(
          (b) => b.chain === expected.chain && b.token === expected.token
        );

        if (!actual || actual.balance !== expected.balance) {
          this.logger.warn('Balance mismatch detected', {
            agentId,
            chain: expected.chain,
            token: expected.token,
            expected: expected.balance.toString(),
            actual: actual?.balance.toString(),
          });
        }
      }
    }
  }

  private scheduleBackups(): void {
    // Full backup weekly (Sunday midnight)
    cron.schedule('0 0 * * 0', () => this.createFullBackup(this.config.backupPassword));

    // Incremental backup daily (midnight)
    cron.schedule('0 0 * * *', () => this.createIncrementalBackup(this.config.backupPassword));
  }

  private calculateChecksum(backup: WalletBackup): string {
    const data = JSON.stringify({
      ...backup,
      checksum: '', // Exclude checksum itself
    });
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  private validateBackup(backup: WalletBackup): boolean {
    const expectedChecksum = this.calculateChecksum(backup);
    return backup.checksum === expectedChecksum;
  }

  private async saveBackup(backup: WalletBackup): Promise<void> {
    const filename = `wallet-backup-${backup.timestamp}.json`;

    // Save to multiple locations for redundancy
    await fs.writeFile(`./backups/${filename}`, JSON.stringify(backup, null, 2));

    // Optional: Upload to S3
    if (this.config.s3Backup) {
      await this.uploadToS3(filename, backup);
    }
  }
}
```

---

## Story 11.9: Security Hardening for Agent Wallets

As a security engineer,
I want comprehensive security protections for agent wallets,
so that agent funds are protected against theft, fraud, and unauthorized access.

### Acceptance Criteria

1. Wallet private keys NEVER exposed in logs, telemetry, or API responses
2. Wallet derivation requires authentication (password, 2FA, or HSM access)
3. Rate limiting on wallet operations (max 100 wallet creations/hour)
4. Wallet spending limits configurable per agent (max transaction size, daily limits)
5. Suspicious activity detection: rapid funding requests, unusual transaction patterns
6. Wallet encryption at rest using AES-256-GCM
7. Audit trail for all wallet operations (create, fund, transact, suspend)
8. Integration with Epic 12's fraud detection for agent wallet monitoring
9. Security documentation with threat model and mitigation strategies
10. Penetration test validates wallet security against common attack vectors

### Security Controls

```typescript
// packages/connector/src/wallet/wallet-security.ts

interface SpendingLimits {
  maxTransactionSize: bigint;
  dailyLimit: bigint;
  monthlyLimit: bigint;
}

class WalletSecurityManager {
  private spendingHistory = new Map<string, TransactionHistory>();

  constructor(
    private config: SecurityConfig,
    private fraudDetector: FraudDetector // Epic 12
  ) {}

  // Validate transaction against spending limits
  async validateTransaction(agentId: string, amount: bigint, token: string): Promise<boolean> {
    const limits = await this.getSpendingLimits(agentId);

    // Check transaction size limit
    if (amount > limits.maxTransactionSize) {
      this.logger.warn('Transaction exceeds size limit', {
        agentId,
        amount,
        limit: limits.maxTransactionSize,
      });
      return false;
    }

    // Check daily limit
    const dailySpent = await this.getDailySpending(agentId, token);
    if (dailySpent + amount > limits.dailyLimit) {
      this.logger.warn('Transaction exceeds daily limit', {
        agentId,
        amount,
        dailySpent,
        limit: limits.dailyLimit,
      });
      return false;
    }

    // Check monthly limit
    const monthlySpent = await this.getMonthlySpending(agentId, token);
    if (monthlySpent + amount > limits.monthlyLimit) {
      this.logger.warn('Transaction exceeds monthly limit', {
        agentId,
        amount,
        monthlySpent,
        limit: limits.monthlyLimit,
      });
      return false;
    }

    // Check for fraud
    const fraudCheck = await this.fraudDetector.analyzeTransaction({
      agentId,
      amount,
      token,
      timestamp: Date.now(),
    });

    if (fraudCheck.detected) {
      this.logger.error('Fraudulent transaction detected', { agentId, ...fraudCheck });
      return false;
    }

    return true;
  }

  // Audit log for wallet operations
  async auditLog(operation: string, agentId: string, details: Record<string, any>): Promise<void> {
    const auditEntry = {
      timestamp: Date.now(),
      operation,
      agentId,
      details,
      ip: this.getRequestIP(),
      userAgent: this.getRequestUserAgent(),
    };

    await this.db.auditLog.insert(auditEntry);

    this.logger.info('Wallet audit log', auditEntry);
  }

  // Sanitize wallet data (remove private keys)
  sanitizeWalletData(wallet: any): any {
    return {
      ...wallet,
      privateKey: undefined,
      mnemonic: undefined,
      seed: undefined,
    };
  }
}
```

---

## Story 11.10: Documentation and Agent Onboarding

As an AI agent developer,
I want comprehensive documentation for agent wallet integration,
so that I can easily provision wallets for my agents and enable micropayments.

### Acceptance Criteria

1. Documentation created in `docs/guides/agent-wallet-integration.md`
2. Documentation covers: wallet creation, funding, balance queries, payment channel usage
3. API reference documentation for all agent wallet endpoints
4. Code examples in multiple languages: TypeScript, Python, JavaScript
5. Quickstart tutorial: "Your First Agent Wallet in 5 Minutes"
6. Security best practices for agent wallet management
7. Troubleshooting guide for common issues
8. FAQ covering wallet lifecycle, backup/recovery, multi-chain support
9. Agent onboarding wizard (CLI tool) guides developers through integration
10. Production readiness checklist for agent wallet deployments

### Documentation Deliverables

**`docs/guides/agent-wallet-integration.md`:**

````markdown
# Agent Wallet Integration Guide

## Quick Start (5 minutes)

### 1. Create Agent Wallet

```typescript
const agentWallet = await walletLifecycle.createAgentWallet('my-agent-001');

console.log('EVM Address:', agentWallet.evmAddress);
console.log('XRP Address:', agentWallet.xrpAddress);
```
````

### 2. Check Balance

```typescript
const balance = await balanceTracker.getBalance('my-agent-001', 'evm', 'USDC');
console.log('USDC Balance:', ethers.formatUnits(balance, 6));
```

### 3. Open Payment Channel

```typescript
const channelId = await agentChannelManager.openChannel(
  'my-agent-001',
  'peer-agent-002',
  'evm',
  'USDC',
  ethers.parseUnits('100', 6) // 100 USDC
);
```

### 4. Send Payment

```typescript
await agentChannelManager.sendPayment(
  'my-agent-001',
  channelId,
  ethers.parseUnits('5', 6) // 5 USDC
);
```

## API Reference

### WalletLifecycle

- `createAgentWallet(agentId)` - Create new agent wallet
- `getAgentWallet(agentId)` - Get existing wallet
- `suspendWallet(agentId, reason)` - Suspend wallet
- `archiveWallet(agentId)` - Archive inactive wallet

[Full API documentation...]

```

---

## Epic Completion Criteria

- [ ] HD wallet master seed management operational with encrypted storage
- [ ] Agent wallet derivation functional (10,000+ wallets from single seed)
- [ ] Real-time balance tracking across EVM and XRP chains
- [ ] Automated wallet funding for new agents
- [ ] Wallet lifecycle management (create, activate, suspend, archive)
- [ ] Payment channel integration with Epic 8 (EVM) and Epic 9 (XRP)
- [ ] Dashboard visualization of agent wallets and activity
- [ ] Backup and recovery procedures documented and tested
- [ ] Security hardening (spending limits, fraud detection, audit logging)
- [ ] Comprehensive agent developer documentation

---

## Dependencies and Integration Points

**Depends On:**
- **Epic 6:** TigerBeetle for off-chain balance reconciliation
- **Epic 8:** EVM Payment Channels (agents use payment channel SDK)
- **Epic 9:** XRP Payment Channels (agents use XRP channel SDK)

**Integrates With:**
- `PaymentChannelSDK` (Epic 8) - EVM channel operations
- `XRPChannelSDK` (Epic 9) - XRP channel operations
- `TelemetryEmitter` (Epic 3) - Agent wallet events to dashboard
- `AccountManager` (Epic 6) - Off-chain balance tracking
- `FraudDetector` (Epic 12) - Security monitoring

**Enables:**
- **Epic 12:** Production hardening includes agent wallet security and monitoring

---

## Success Metrics

- **Wallet Creation:** 10,000+ agent wallets derived from single master seed
- **Funding Success:** >99% automatic funding success rate
- **Balance Accuracy:** 100% on-chain balance reconciliation
- **Channel Integration:** Agents can open channels and transact within 1 minute
- **Dashboard Latency:** <1 second agent wallet state updates
- **Security:** Zero private key leaks, zero unauthorized access
- **Recovery:** <1 hour full platform restore from backup

---

## Timeline Estimate

**Total Duration:** 6-8 weeks

- **Week 1:** HD wallet seed management and derivation (Stories 11.1-11.2)
- **Weeks 2-3:** Balance tracking and automated funding (Stories 11.3-11.4)
- **Week 4:** Wallet lifecycle management (Story 11.5)
- **Week 5:** Payment channel integration (Story 11.6)
- **Week 6:** Dashboard visualization (Story 11.7)
- **Week 7:** Backup/recovery and security hardening (Stories 11.8-11.9)
- **Week 8:** Documentation and testing (Story 11.10)

**Can be parallelized:** Balance tracking (Story 11.3) and automated funding (Story 11.4) can develop concurrently

---

## Documentation Deliverables

1. `docs/guides/agent-wallet-integration.md` - Developer integration guide
2. `docs/api/agent-wallet-api.md` - API reference documentation
3. `docs/architecture/agent-wallet-architecture.md` - Technical architecture
4. `docs/security/agent-wallet-security.md` - Security threat model and mitigations
5. `docs/operators/agent-wallet-backup-recovery.md` - Backup and disaster recovery procedures

---

**This epic delivers the wallet infrastructure foundation for AI agents to autonomously participate in the M2M economy with cryptocurrency micropayments across multiple blockchains.**
```
