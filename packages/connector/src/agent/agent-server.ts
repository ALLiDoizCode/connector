/**
 * Standalone Agent Server
 *
 * HTTP/WebSocket server that wraps AgentNode for Docker deployments.
 * Provides:
 * - BTP WebSocket endpoint for ILP communication
 * - HTTP API for configuration and management
 * - Health check endpoint
 * - Automatic balance proof exchange via claim events (CLAIM_EXCHANGE_ENABLED)
 *
 * Environment Variables:
 *   AGENT_HTTP_PORT - HTTP API port (default: 8080)
 *   AGENT_BTP_PORT - BTP WebSocket port (default: 3000)
 *   AGENT_PUBKEY - Nostr public key (required or auto-generated)
 *   AGENT_PRIVKEY - Nostr private key (required or auto-generated)
 *   AGENT_ID - Unique agent identifier (default: "agent-0")
 *   AGENT_DATABASE_PATH - Database path (default: ":memory:")
 *   LOG_LEVEL - Log level (default: "info")
 *   CLAIM_EXCHANGE_ENABLED - Enable balance proof claim exchange (default: true)
 *                            When enabled, outgoing BTP packets are wrapped with signed
 *                            balance proofs for all active payment channels. Incoming
 *                            claims are verified and stored for settlement. When disabled,
 *                            the system operates in backward-compatible mode without claims.
 */

import * as http from 'http';
import * as crypto from 'crypto';
import * as path from 'path';
import { getPublicKey } from 'nostr-tools';
import { WebSocketServer, WebSocket } from 'ws';
import pino, { Logger } from 'pino';
import { ethers } from 'ethers';
import {
  Client as XrplClient,
  Wallet as XrplWallet,
  signPaymentChannelClaim,
  dropsToXrp,
} from 'xrpl';
import { AgentNode, AgentNodeConfig } from './agent-node';
import { getDomainSeparator, getBalanceProofTypes } from '../settlement/eip712-helper';
import { AptosChannelSDK, IAptosChannelSDK } from '../settlement/aptos-channel-sdk';
import { IAptosClient, AptosClient, AptosClientConfig } from '../settlement/aptos-client';
import { AptosClaimSigner } from '../settlement/aptos-claim-signer';
import { Ed25519PrivateKey, Account } from '@aptos-labs/ts-sdk';
import { ToonCodec, NostrEvent } from './toon-codec';
import {
  PacketType,
  ILPPreparePacket,
  ILPFulfillPacket,
  ILPRejectPacket,
  ILPErrorCode,
} from '@m2m/shared';
import { EventStore } from '../explorer/event-store';
import { TelemetryEmitter } from '../telemetry/telemetry-emitter';
import { ExplorerServer } from '../explorer/explorer-server';
import { ClaimManager, WalletAddresses } from './claim-manager';
import { ClaimStore } from './claim-store';
import { ClaimEventParser } from './claim-event-parser';
import { ClaimEventBuilder } from './claim-event-builder';
import { SignedClaim, ClaimRequest } from '@m2m/shared';
import { PaymentChannelSDK } from '../settlement/payment-channel-sdk';
import { ClaimSigner } from '../settlement/xrp-claim-signer';
import { KeyManager } from '../security/key-manager';
import Database, { type Database as DatabaseType } from 'better-sqlite3';
// Private Messaging imports (Story 32.7)
import { GiftwrapWebSocketServer } from '../messaging/giftwrap-websocket-server';
import { MessagingGateway } from '../messaging/messaging-gateway';
import { GiftwrapRouter } from '../messaging/giftwrap-router';
import { BTPClient, Peer as BTPPeer } from '../btp/btp-client';
// BTP message parsing for proper protocol handling
import { parseBTPMessage, serializeBTPMessage } from '../btp/btp-message-parser';
import { BTPMessage, BTPMessageType, BTPData, isBTPData } from '../btp/btp-types';
import { deserializePacket } from '@m2m/shared';

// ============================================
// Types
// ============================================

interface AgentServerConfig {
  httpPort: number;
  btpPort: number;
  explorerPort: number;
  agentId: string;
  nostrPubkey: string;
  nostrPrivkey: string;
  databasePath: string;
  explorerDbPath: string;
  ilpAddress: string;
  // EVM Payment Channel Configuration
  evmPrivkey: string;
  evmAddress: string;
  anvilRpcUrl: string | null;
  tokenNetworkAddress: string | null;
  agentTokenAddress: string | null;
  // XRP Payment Channel Configuration
  xrpEnabled: boolean;
  xrpWssUrl: string | null;
  xrpNetwork: string;
  xrpAccountSecret: string | null;
  xrpAccountAddress: string | null;
  // Aptos Payment Channel Configuration
  aptosEnabled: boolean;
  aptosNodeUrl: string | null;
  aptosPrivateKey: string | null;
  aptosModuleAddress: string | null;
  aptosAccountAddress: string | null;
  aptosCoinType: string | null; // Coin type for payment channels (default: AptosCoin)
  // Settlement Threshold Configuration
  settlementThreshold: bigint | null; // Auto-settle when owed balance exceeds this (in base units)
  // Claim Exchange Configuration
  claimExchangeEnabled: boolean; // Feature flag for balance proof claim exchange (default: true)
  // Private Messaging Configuration (Story 32.7)
  enablePrivateMessaging: boolean; // Enable private messaging WebSocket and HTTP gateway
  messagingGatewayPort: number; // HTTP gateway port (default: 3002)
  messagingWebsocketPort: number; // WebSocket server port (default: 3003)
  messagingAddress: string; // ILP address for incoming messages (e.g., "g.agent.bob.private")
  firstHopBtpUrl: string | null; // BTP URL of first-hop connector for outbound messaging (e.g., "ws://connector1:3000")
}

// EVM Payment channel state tracking
interface PaymentChannel {
  channelId: string;
  peerAddress: string;
  deposit: bigint;
  status: 'opened' | 'closed' | 'settled';
  nonce: number;
  transferredAmount: bigint;
}

// XRP Payment channel state tracking
interface XRPPaymentChannel {
  channelId: string;
  destination: string;
  amount: string; // XRP drops
  balance: string; // XRP drops claimed
  status: 'open' | 'closing' | 'closed';
  settleDelay: number;
  publicKey: string;
}

// Aptos Payment channel state tracking
interface AptosPaymentChannel {
  channelOwner: string; // Channel identifier (owner address)
  destination: string; // Destination Aptos address
  destinationPubkey: string; // ed25519 public key for claim verification
  deposited: string; // Octas deposited (string for bigint serialization)
  claimed: string; // Octas claimed (string for bigint serialization)
  status: 'open' | 'closing' | 'closed';
  settleDelay: number; // Settlement delay in seconds
  nonce: number; // Highest nonce of submitted claims
}

interface PeerConnection {
  peerId: string;
  ilpAddress: string;
  btpUrl: string;
  evmAddress?: string; // For EVM payment channel lookup
  xrpAddress?: string; // For XRP payment channel lookup
  aptosAddress?: string; // For Aptos payment channel lookup
  ws?: WebSocket;
}

interface SendEventRequest {
  targetPeerId: string;
  kind: number;
  content: string;
  tags?: string[][];
}

interface AddFollowRequest {
  pubkey: string;
  evmAddress?: string;
  xrpAddress?: string;
  aptosAddress?: string;
  ilpAddress: string;
  petname?: string;
  btpUrl?: string;
}

// ============================================
// Agent Server Class
// ============================================

export class AgentServer {
  private readonly config: AgentServerConfig;
  private readonly logger: Logger;
  private readonly agentNode: AgentNode;
  private readonly toonCodec: ToonCodec;
  private readonly eventStore: EventStore;
  private readonly telemetryEmitter: TelemetryEmitter;
  private readonly explorerServer: ExplorerServer;
  private httpServer: http.Server | null = null;
  private btpServer: WebSocketServer | null = null;
  private peers: Map<string, PeerConnection> = new Map();
  private eventsSent = 0;
  private eventsReceived = 0;
  private isShutdown = false;
  // Track pending packets for response correlation
  private pendingPackets: Map<
    string,
    { peerId: string; destination: string; amount: string; timestamp: number; packetId: string }
  > = new Map();
  // EVM Payment Channel state
  private evmProvider: ethers.JsonRpcProvider | null = null;
  private evmWallet: ethers.Wallet | null = null;
  private paymentChannels: Map<string, PaymentChannel> = new Map(); // channelId -> PaymentChannel
  private tokenNetworkContract: ethers.Contract | null = null;
  private agentTokenContract: ethers.Contract | null = null;
  private paymentChannelSDK: PaymentChannelSDK | null = null; // EVM payment channel SDK for cooperative settlement
  // XRP Payment Channel state
  private xrplClient: XrplClient | null = null;
  private xrplWallet: XrplWallet | null = null;
  private xrpChannels: Map<string, XRPPaymentChannel> = new Map(); // channelId -> XRPPaymentChannel
  // Aptos Payment Channel state
  private aptosClient: IAptosClient | null = null;
  private aptosChannelSDK: IAptosChannelSDK | null = null;
  private aptosChannels: Map<string, AptosPaymentChannel> = new Map(); // channelOwner -> AptosPaymentChannel
  // Claim Exchange state
  private claimManager: ClaimManager | null = null;
  private claimStore: ClaimStore | null = null;
  private xrpClaimDb: DatabaseType | null = null; // XRP claim database for ClaimSigner
  // Private Messaging state (Story 32.7)
  private _giftwrapWebSocketServer: GiftwrapWebSocketServer | null = null;
  private _messagingGateway: MessagingGateway | null = null;
  private _giftwrapRouter: GiftwrapRouter | null = null;
  private _messagingBtpClient: BTPClient | null = null;

  constructor(config: Partial<AgentServerConfig> = {}) {
    // Generate keypair if not provided
    let privkey = config.nostrPrivkey;
    let pubkey = config.nostrPubkey;

    if (!privkey) {
      const seed = config.agentId || `agent-${Date.now()}`;
      privkey = crypto.createHash('sha256').update(seed).digest('hex');
    }

    if (!pubkey) {
      pubkey = getPublicKey(Buffer.from(privkey, 'hex'));
    }

    const agentId = config.agentId || `agent-${pubkey.slice(0, 8)}`;

    // Generate EVM private key from agent ID (deterministic for testing)
    const evmPrivkey =
      config.evmPrivkey || crypto.createHash('sha256').update(`evm-${agentId}`).digest('hex');
    const evmWallet = new ethers.Wallet(evmPrivkey);
    const evmAddress = evmWallet.address;

    this.config = {
      httpPort: config.httpPort ?? parseInt(process.env.AGENT_HTTP_PORT || '8080', 10),
      btpPort: config.btpPort ?? parseInt(process.env.AGENT_BTP_PORT || '3000', 10),
      explorerPort: config.explorerPort ?? parseInt(process.env.AGENT_EXPLORER_PORT || '9000', 10),
      agentId,
      nostrPubkey: pubkey,
      nostrPrivkey: privkey,
      databasePath: config.databasePath || process.env.AGENT_DATABASE_PATH || ':memory:',
      explorerDbPath: config.explorerDbPath || process.env.AGENT_EXPLORER_DB_PATH || ':memory:',
      ilpAddress: config.ilpAddress || `g.agent.${agentId}`,
      // EVM configuration
      evmPrivkey,
      evmAddress,
      anvilRpcUrl: config.anvilRpcUrl || process.env.ANVIL_RPC_URL || null,
      tokenNetworkAddress: config.tokenNetworkAddress || process.env.TOKEN_NETWORK_ADDRESS || null,
      agentTokenAddress: config.agentTokenAddress || process.env.AGENT_TOKEN_ADDRESS || null,
      // XRP configuration
      xrpEnabled: config.xrpEnabled ?? process.env.XRP_ENABLED === 'true',
      xrpWssUrl: config.xrpWssUrl || process.env.XRPL_WSS_URL || null,
      xrpNetwork: config.xrpNetwork || process.env.XRPL_NETWORK || 'standalone',
      xrpAccountSecret: config.xrpAccountSecret || process.env.XRPL_ACCOUNT_SECRET || null,
      xrpAccountAddress: config.xrpAccountAddress || process.env.XRPL_ACCOUNT_ADDRESS || null,
      // Aptos configuration
      aptosEnabled: config.aptosEnabled ?? process.env.APTOS_ENABLED === 'true',
      aptosNodeUrl: config.aptosNodeUrl || process.env.APTOS_NODE_URL || null,
      aptosPrivateKey: config.aptosPrivateKey || process.env.APTOS_PRIVATE_KEY || null,
      aptosModuleAddress: config.aptosModuleAddress || process.env.APTOS_MODULE_ADDRESS || null,
      aptosAccountAddress: config.aptosAccountAddress || null,
      aptosCoinType: config.aptosCoinType || process.env.APTOS_COIN_TYPE || null,
      // Settlement threshold configuration
      settlementThreshold:
        config.settlementThreshold ??
        (process.env.SETTLEMENT_THRESHOLD ? BigInt(process.env.SETTLEMENT_THRESHOLD) : null),
      // Claim exchange configuration
      claimExchangeEnabled:
        config.claimExchangeEnabled ?? process.env.CLAIM_EXCHANGE_ENABLED !== 'false',
      // Private messaging configuration (Story 32.7)
      enablePrivateMessaging:
        config.enablePrivateMessaging ?? process.env.ENABLE_PRIVATE_MESSAGING === 'true',
      messagingGatewayPort:
        config.messagingGatewayPort ?? parseInt(process.env.MESSAGING_GATEWAY_PORT || '3002', 10),
      messagingWebsocketPort:
        config.messagingWebsocketPort ??
        parseInt(process.env.MESSAGING_WEBSOCKET_PORT || '3003', 10),
      messagingAddress:
        config.messagingAddress || process.env.MESSAGING_ADDRESS || `g.agent.${agentId}.private`,
      firstHopBtpUrl: config.firstHopBtpUrl || process.env.FIRST_HOP_BTP_URL || null,
    };

    this.logger = pino({
      level: process.env.LOG_LEVEL || 'info',
      name: this.config.agentId,
    });

    // Validate messaging ports don't conflict with existing ports (Story 32.7)
    if (this.config.enablePrivateMessaging) {
      const usedPorts = [this.config.httpPort, this.config.btpPort, this.config.explorerPort];
      if (usedPorts.includes(this.config.messagingGatewayPort)) {
        throw new Error(
          `Messaging gateway port ${this.config.messagingGatewayPort} conflicts with existing port`
        );
      }
      if (usedPorts.includes(this.config.messagingWebsocketPort)) {
        throw new Error(
          `Messaging WebSocket port ${this.config.messagingWebsocketPort} conflicts with existing port`
        );
      }
      if (this.config.messagingGatewayPort === this.config.messagingWebsocketPort) {
        throw new Error('Messaging gateway port and WebSocket port cannot be the same');
      }
    }

    // Create EventStore for Explorer persistence
    this.eventStore = new EventStore({ path: this.config.explorerDbPath }, this.logger);

    // Create TelemetryEmitter (no dashboard URL needed, just for local event emission)
    this.telemetryEmitter = new TelemetryEmitter(
      '', // No dashboard URL - we're using local explorer only
      this.config.agentId,
      this.logger,
      this.eventStore
    );

    // Create ExplorerServer
    this.explorerServer = new ExplorerServer(
      {
        port: this.config.explorerPort,
        nodeId: this.config.agentId,
        staticPath: path.resolve(__dirname, '../../dist/explorer-ui'),
        balancesFetcher: () => this.getBalances(),
        peersFetcher: () => this.getPeers(),
        routesFetcher: () => this.getRoutes(),
      },
      this.eventStore,
      this.telemetryEmitter,
      this.logger
    );

    // Create AgentNode
    const nodeConfig: AgentNodeConfig = {
      agentPubkey: this.config.nostrPubkey,
      agentPrivkey: this.config.nostrPrivkey,
      databasePath: this.config.databasePath,
      pricing: {
        noteStorage: 100n,
        followUpdate: 50n,
        deletion: 10n,
        queryBase: 200n,
      },
      enableBuiltInHandlers: true,
    };

    this.agentNode = new AgentNode(nodeConfig, this.logger);
    this.toonCodec = new ToonCodec();
  }

  // ============================================
  // Server Lifecycle
  // ============================================

  async start(): Promise<void> {
    this.logger.info({ config: this.config }, 'Starting agent server');

    // Log claim exchange feature flag status
    this.logger.info(
      { claimExchangeEnabled: this.config.claimExchangeEnabled },
      'Claim exchange configuration'
    );

    // Initialize EventStore
    await this.eventStore.initialize();

    // Initialize AgentNode
    await this.agentNode.initialize();

    // Initialize ClaimStore if claim exchange enabled
    if (this.config.claimExchangeEnabled) {
      // Create ClaimStore with persistent database (initializes automatically in constructor)
      const claimStorePath = path.join(path.dirname(this.config.databasePath), 'claim-store.db');
      this.claimStore = new ClaimStore(claimStorePath, this.logger);
      this.logger.info({ claimStorePath }, 'ClaimStore initialized');
    }

    // Initialize EVM provider and contracts if configured
    await this.initializeEVM();

    // Initialize XRP client if configured
    await this.initializeXRP();

    // Initialize Aptos client if configured
    await this.initializeAptos();

    // Initialize ClaimManager if claim exchange enabled and ClaimStore exists
    if (this.config.claimExchangeEnabled && this.claimStore) {
      try {
        // Check if at least one payment channel type is configured
        if (!this.evmProvider || !this.evmWallet || !this.tokenNetworkContract) {
          this.logger.warn(
            'EVM provider/wallet/contract not initialized - ClaimManager initialization skipped'
          );
          // ClaimStore remains available even if ClaimManager can't be created
          this.claimManager = null;
        } else {
          // Create KeyManager with 'env' backend for claim signing
          const keyManager = new KeyManager(
            {
              backend: 'env',
              nodeId: this.config.agentId,
            },
            this.logger
          );

          // EVM PaymentChannelSDK requires KeyManager
          const evmKeyId = `evm-${this.config.agentId}`;
          this.paymentChannelSDK = new PaymentChannelSDK(
            this.evmProvider,
            keyManager,
            evmKeyId,
            this.tokenNetworkContract.target as string,
            this.logger
          );

          // Create database for XRP ClaimSigner (separate from agent database)
          const xrpClaimDbPath = path.join(path.dirname(this.config.databasePath), 'xrp-claims.db');
          this.xrpClaimDb = new Database(xrpClaimDbPath);

          // Initialize XRP ClaimSigner with KeyManager
          const xrpKeyId = `xrp-${this.config.agentId}`; // Key ID for KeyManager
          const xrpClaimSigner = new ClaimSigner(
            this.xrpClaimDb,
            this.logger,
            keyManager,
            xrpKeyId
          );

          // Create AptosClaimSigner with config object
          const aptosClaimSigner = new AptosClaimSigner(
            {
              privateKey: this.config.aptosPrivateKey || '',
            },
            this.logger
          );

          // Create ClaimEventBuilder (only takes privateKey) and ClaimEventParser
          const claimEventBuilder = new ClaimEventBuilder(this.config.nostrPrivkey);
          const claimEventParser = new ClaimEventParser(this.logger);

          // Create WalletAddresses
          const walletAddresses: WalletAddresses = {
            evm: this.config.evmAddress,
            xrp: this.config.xrpAccountAddress || undefined,
            aptos: this.config.aptosAccountAddress || undefined,
          };

          // Create ClaimManager
          this.claimManager = new ClaimManager(
            this.paymentChannelSDK,
            xrpClaimSigner,
            aptosClaimSigner,
            this.claimStore,
            claimEventBuilder,
            claimEventParser,
            walletAddresses,
            this.logger
          );

          this.logger.info({ walletAddresses }, 'ClaimManager initialized');
        }
      } catch (error) {
        this.logger.error({ error }, 'Failed to initialize ClaimManager');
        // ClaimStore remains available even if ClaimManager initialization fails
        this.claimManager = null;
      }
    }

    // Start HTTP server
    await this.startHttpServer();

    // Start BTP WebSocket server
    await this.startBtpServer();

    // Start Explorer server
    await this.explorerServer.start();

    // Initialize and start Private Messaging components (Story 32.7)
    if (this.config.enablePrivateMessaging) {
      await this.initializeMessaging();
    }

    this.logger.info(
      {
        httpPort: this.config.httpPort,
        btpPort: this.config.btpPort,
        explorerPort: this.config.explorerPort,
        agentId: this.config.agentId,
        ilpAddress: this.config.ilpAddress,
        pubkey: this.config.nostrPubkey,
        evmAddress: this.config.evmAddress,
        settlementThreshold: this.config.settlementThreshold?.toString() || 'disabled',
        privateMessaging: this.config.enablePrivateMessaging,
      },
      'Agent server started'
    );
  }

  private async initializeEVM(): Promise<void> {
    if (!this.config.anvilRpcUrl) {
      this.logger.debug('No ANVIL_RPC_URL configured, skipping EVM initialization');
      return;
    }

    try {
      this.evmProvider = new ethers.JsonRpcProvider(this.config.anvilRpcUrl);
      // Use fast polling for local chains (Anvil mines instantly)
      this.evmProvider.pollingInterval = 500;
      this.evmWallet = new ethers.Wallet(this.config.evmPrivkey, this.evmProvider);

      // Initialize TokenNetwork contract if address provided
      if (this.config.tokenNetworkAddress) {
        const TOKEN_NETWORK_ABI = [
          'function openChannel(address participant2, uint256 settlementTimeout) external returns (bytes32)',
          'function setTotalDeposit(bytes32 channelId, address participant, uint256 totalDeposit) external',
          'function channels(bytes32) external view returns (uint256 settlementTimeout, uint8 state, uint256 closedAt, uint256 openedAt, address participant1, address participant2)',
          'function participants(bytes32, address) external view returns (uint256 deposit, uint256 withdrawnAmount, bool isCloser, uint256 nonce, uint256 transferredAmount)',
          'function cooperativeSettle(bytes32 channelId, tuple(bytes32 channelId, uint256 nonce, uint256 transferredAmount, uint256 lockedAmount, bytes32 locksRoot) proof1, bytes signature1, tuple(bytes32 channelId, uint256 nonce, uint256 transferredAmount, uint256 lockedAmount, bytes32 locksRoot) proof2, bytes signature2) external',
          'event ChannelOpened(bytes32 indexed channelId, address indexed participant1, address indexed participant2, uint256 settlementTimeout)',
        ];
        this.tokenNetworkContract = new ethers.Contract(
          this.config.tokenNetworkAddress,
          TOKEN_NETWORK_ABI,
          this.evmWallet
        );
      }

      // Initialize AGENT token contract if address provided
      if (this.config.agentTokenAddress) {
        const ERC20_ABI = [
          'function balanceOf(address) view returns (uint256)',
          'function transfer(address to, uint256 value) returns (bool)',
          'function approve(address spender, uint256 value) returns (bool)',
        ];
        this.agentTokenContract = new ethers.Contract(
          this.config.agentTokenAddress,
          ERC20_ABI,
          this.evmWallet
        );
      }

      this.logger.info(
        {
          evmAddress: this.config.evmAddress,
          tokenNetworkAddress: this.config.tokenNetworkAddress,
          agentTokenAddress: this.config.agentTokenAddress,
        },
        'EVM initialized'
      );
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to initialize EVM');
    }
  }

  private async initializeXRP(): Promise<void> {
    if (!this.config.xrpEnabled || !this.config.xrpWssUrl) {
      this.logger.debug('XRP not enabled or no WSS URL configured, skipping XRP initialization');
      return;
    }

    // Only initialize if we have account credentials
    if (!this.config.xrpAccountSecret) {
      this.logger.debug('No XRP account secret configured, XRP will be configured at runtime');
      return;
    }

    try {
      this.xrplClient = new XrplClient(this.config.xrpWssUrl, {
        timeout: 10000,
      });

      // Initialize wallet from secret
      this.xrplWallet = XrplWallet.fromSeed(this.config.xrpAccountSecret);

      // Validate address matches derived wallet if provided
      if (
        this.config.xrpAccountAddress &&
        this.xrplWallet.address !== this.config.xrpAccountAddress
      ) {
        throw new Error(
          `XRP account address mismatch: expected ${this.config.xrpAccountAddress}, got ${this.xrplWallet.address}`
        );
      }

      this.config.xrpAccountAddress = this.xrplWallet.address;

      // Connect to rippled
      await this.xrplClient.connect();

      this.logger.info(
        {
          xrpAddress: this.config.xrpAccountAddress,
          xrpNetwork: this.config.xrpNetwork,
        },
        'XRP initialized'
      );
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to initialize XRP');
      // Don't throw - XRP is optional and can be configured at runtime
    }
  }

  private async initializeAptos(): Promise<void> {
    if (!this.config.aptosEnabled || !this.config.aptosNodeUrl) {
      this.logger.debug(
        'Aptos not enabled or no node URL configured, skipping Aptos initialization'
      );
      return;
    }

    if (!this.config.aptosPrivateKey || !this.config.aptosModuleAddress) {
      this.logger.debug(
        'No Aptos private key or module address configured, Aptos will be configured at runtime'
      );
      return;
    }

    try {
      // Derive account address from private key (AptosClient constructor validates this)
      const privateKey = new Ed25519PrivateKey(this.config.aptosPrivateKey);
      const account = Account.fromPrivateKey({ privateKey });
      const derivedAddress = account.accountAddress.toString();

      // Create Aptos client config from this.config values (not process.env)
      const aptosClientConfig: AptosClientConfig = {
        nodeUrl: this.config.aptosNodeUrl,
        privateKey: this.config.aptosPrivateKey,
        accountAddress: derivedAddress,
      };

      // Create Aptos client directly with config values
      const aptosClient = new AptosClient(aptosClientConfig, this.logger);

      // Create claim signer with the same private key
      const claimSigner = new AptosClaimSigner(
        { privateKey: this.config.aptosPrivateKey },
        this.logger
      );

      // Store client reference for balance queries
      this.aptosClient = aptosClient;

      // Connect to validate account exists and check balance
      try {
        await aptosClient.connect();
      } catch (error) {
        this.logger.warn(
          { err: error, address: derivedAddress },
          'Aptos account validation failed (account may not exist yet)'
        );
      }

      // Create AptosChannelSDK with optional coin type
      this.aptosChannelSDK = new AptosChannelSDK(
        aptosClient,
        claimSigner,
        {
          moduleAddress: this.config.aptosModuleAddress,
          coinType: this.config.aptosCoinType || undefined, // Uses AptosCoin if not specified
        },
        this.logger
      );

      // Update config with derived account address
      this.config.aptosAccountAddress = aptosClient.getAddress();

      // Log balance for debugging
      try {
        const balance = await aptosClient.getBalance(derivedAddress);
        this.logger.info(
          {
            aptosAddress: this.config.aptosAccountAddress,
            aptosModuleAddress: this.config.aptosModuleAddress,
            balanceOctas: balance.toString(),
            balanceAPT: (Number(balance) / 100_000_000).toFixed(4),
          },
          'Aptos initialized'
        );
      } catch (balanceError) {
        this.logger.info(
          {
            aptosAddress: this.config.aptosAccountAddress,
            aptosModuleAddress: this.config.aptosModuleAddress,
          },
          'Aptos initialized (balance check failed)'
        );
      }
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to initialize Aptos');
      // Don't throw - Aptos is optional and can be configured at runtime
    }
  }

  /**
   * Initialize Private Messaging components (Story 32.7)
   * Starts WebSocket server for client connections and HTTP gateway for routing
   */
  private async initializeMessaging(): Promise<void> {
    this.logger.info(
      {
        messagingGatewayPort: this.config.messagingGatewayPort,
        messagingWebsocketPort: this.config.messagingWebsocketPort,
        messagingAddress: this.config.messagingAddress,
      },
      'Initializing private messaging components'
    );

    try {
      // Create BTPClient for GiftwrapRouter - use config firstHopBtpUrl or fall back to first peer's BTP URL
      const firstPeer = this.peers.values().next().value;
      const btpUrl = this.config.firstHopBtpUrl || firstPeer?.btpUrl;

      if (btpUrl) {
        const btpPeer: BTPPeer = {
          id: `messaging-${this.config.agentId}`,
          url: btpUrl,
          authToken: 'messaging-auth', // Simple auth token for messaging BTP connection
          connected: false,
          lastSeen: new Date(),
        };
        this._messagingBtpClient = new BTPClient(btpPeer, this.config.agentId, this.logger);
        await this._messagingBtpClient.connect();

        // Create GiftwrapRouter with BTP client
        this._giftwrapRouter = new GiftwrapRouter(this._messagingBtpClient, this.logger);
        this.logger.info({ btpUrl }, 'GiftwrapRouter initialized with BTP client');
      } else {
        this.logger.warn(
          'No peer BTP URL available for GiftwrapRouter - outbound messaging disabled. ' +
            'Set FIRST_HOP_BTP_URL environment variable to enable outbound messaging.'
        );
      }

      // Initialize GiftwrapWebSocketServer (must start before Gateway)
      this._giftwrapWebSocketServer = new GiftwrapWebSocketServer(
        { wsPort: this.config.messagingWebsocketPort },
        this.logger
      );
      await this._giftwrapWebSocketServer.start();
      this.logger.info(
        { port: this.config.messagingWebsocketPort },
        'GiftwrapWebSocketServer started'
      );

      // Initialize MessagingGateway (requires GiftwrapRouter)
      if (this._giftwrapRouter && btpUrl) {
        this._messagingGateway = new MessagingGateway(
          {
            httpPort: this.config.messagingGatewayPort,
            wsPort: this.config.messagingWebsocketPort,
            btpConnectionUrl: btpUrl,
          },
          this._giftwrapRouter,
          this.logger
        );
        await this._messagingGateway.start();
        this.logger.info({ port: this.config.messagingGatewayPort }, 'MessagingGateway started');
      } else {
        this.logger.warn('MessagingGateway not started - no GiftwrapRouter available');
      }

      this.logger.info({ address: this.config.messagingAddress }, 'Private messaging enabled');
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to initialize messaging components');
      // Clean up partial initialization
      await this.shutdownMessaging();
    }
  }

  /**
   * Handle incoming ILP packet destined for private messaging address (Story 32.7)
   * Forwards giftwrap events to connected WebSocket clients
   * @returns ILP response if handled, null if should fall through to normal processing
   */
  private async handleMessagingPacket(
    _ws: WebSocket,
    packet: ILPPreparePacket
  ): Promise<ILPFulfillPacket | ILPRejectPacket | null> {
    // Check if WebSocket server is available
    if (!this._giftwrapWebSocketServer) {
      this.logger.warn('Messaging packet received but WebSocket server not initialized');
      return null; // Fall through to normal processing
    }

    // Extract client ID from packet destination (e.g., "g.agent.bob.private" → "bob")
    // For now, use the agent ID as the client ID
    const clientId = this.config.agentId;

    this.logger.info(
      {
        destination: packet.destination,
        clientId,
        amount: packet.amount.toString(),
      },
      'Handling messaging packet'
    );

    try {
      // Forward to WebSocket server for delivery to client
      this._giftwrapWebSocketServer.handleIncomingPacket(packet, clientId);

      // Return ILP Fulfill to confirm delivery
      // Generate fulfillment from the execution condition (sha256 preimage)
      // In production, this would be derived from the actual preimage
      const fulfillment = Buffer.alloc(32);
      crypto.randomFillSync(fulfillment);

      this.logger.info({ clientId }, 'Messaging packet delivered to WebSocket client');

      return {
        type: PacketType.FULFILL,
        fulfillment,
        data: Buffer.alloc(0),
      };
    } catch (error) {
      this.logger.error({ err: error, clientId }, 'Failed to deliver messaging packet');

      // Return ILP Reject with T01 (Peer Unreachable) if client not connected
      return {
        type: PacketType.REJECT,
        code: ILPErrorCode.T01_PEER_UNREACHABLE,
        message: 'Recipient not connected',
        triggeredBy: this.config.ilpAddress,
        data: Buffer.alloc(0),
      };
    }
  }

  /**
   * Shutdown Private Messaging components (Story 32.7)
   * Stops components in reverse order: Gateway, WebSocket, BTPClient
   */
  private async shutdownMessaging(): Promise<void> {
    // Stop MessagingGateway first (stops accepting new requests)
    if (this._messagingGateway) {
      await this._messagingGateway.stop();
      this.logger.info('MessagingGateway stopped');
      this._messagingGateway = null;
    }

    // Stop GiftwrapWebSocketServer (closes all WebSocket connections)
    if (this._giftwrapWebSocketServer) {
      await this._giftwrapWebSocketServer.stop();
      this.logger.info('GiftwrapWebSocketServer stopped');
      this._giftwrapWebSocketServer = null;
    }

    // Disconnect messaging BTP client
    if (this._messagingBtpClient) {
      await this._messagingBtpClient.disconnect();
      this.logger.info('Messaging BTP client disconnected');
      this._messagingBtpClient = null;
    }

    this._giftwrapRouter = null;
  }

  async shutdown(): Promise<void> {
    if (this.isShutdown) return;
    this.isShutdown = true;

    this.logger.info('Shutting down agent server...');

    // Stop Private Messaging components first (Story 32.7)
    // Must stop before BTP server since messaging depends on BTP
    await this.shutdownMessaging();

    // Close peer connections
    for (const peer of this.peers.values()) {
      if (peer.ws) {
        peer.ws.close();
      }
    }

    // Close BTP server
    if (this.btpServer) {
      this.btpServer.close();
    }

    // Close HTTP server
    if (this.httpServer) {
      this.httpServer.close();
    }

    // Stop Explorer server
    await this.explorerServer.stop();

    // Close EventStore
    await this.eventStore.close();

    // Disconnect TelemetryEmitter
    await this.telemetryEmitter.disconnect();

    // Disconnect XRP client
    if (this.xrplClient?.isConnected()) {
      await this.xrplClient.disconnect();
    }

    // Cleanup Aptos resources
    this.aptosChannels.clear();
    this.aptosChannelSDK = null;
    if (this.aptosClient?.isConnected()) {
      await this.aptosClient.disconnect();
    }
    this.aptosClient = null;

    // Close ClaimStore
    if (this.claimStore) {
      await this.claimStore.close();
    }

    // Close XRP claim database
    if (this.xrpClaimDb) {
      this.xrpClaimDb.close();
      this.xrpClaimDb = null;
    }

    // Shutdown AgentNode
    await this.agentNode.shutdown();

    this.logger.info('Agent server shutdown complete');
  }

  // ============================================
  // HTTP Server
  // ============================================

  private startHttpServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.httpServer = http.createServer((req, res) => {
        this.handleHttpRequest(req, res);
      });

      this.httpServer.on('error', reject);
      this.httpServer.listen(this.config.httpPort, () => {
        resolve();
      });
    });
  }

  private async handleHttpRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const url = new URL(req.url || '/', `http://localhost:${this.config.httpPort}`);

    res.setHeader('Content-Type', 'application/json');

    try {
      // Health check
      if (req.method === 'GET' && url.pathname === '/health') {
        res.writeHead(200);
        res.end(
          JSON.stringify({
            status: 'ok',
            initialized: this.agentNode.isInitialized,
            agentId: this.config.agentId,
            pubkey: this.config.nostrPubkey,
          })
        );
        return;
      }

      // Status endpoint
      if (req.method === 'GET' && url.pathname === '/status') {
        const events = await this.agentNode.database.queryEvents({ kinds: [1] });
        res.writeHead(200);
        res.end(
          JSON.stringify({
            agentId: this.config.agentId,
            ilpAddress: this.config.ilpAddress,
            pubkey: this.config.nostrPubkey,
            evmAddress: this.config.evmAddress,
            xrpAddress: this.config.xrpAccountAddress,
            xrpEnabled: this.config.xrpEnabled,
            aptosAddress: this.config.aptosAccountAddress,
            aptosEnabled: this.config.aptosEnabled,
            initialized: this.agentNode.isInitialized,
            followCount: this.agentNode.followGraphRouter.getFollowCount(),
            peerCount: this.peers.size,
            storedEventCount: events.length,
            eventsSent: this.eventsSent,
            eventsReceived: this.eventsReceived,
            channelCount: this.paymentChannels.size,
            xrpChannelCount: this.xrpChannels.size,
            aptosChannelCount: this.aptosChannels.size,
            claimExchange: this.config.claimExchangeEnabled
              ? {
                  enabled: true,
                  storedClaimCount: this.claimStore?.getClaimCount() || 0,
                  lastClaimReceived: this.claimStore?.getLastClaimTimestamp() || null,
                }
              : { enabled: false },
            ai: this.agentNode.aiDispatcher
              ? {
                  enabled: this.agentNode.aiDispatcher.isEnabled,
                  budget: this.agentNode.aiDispatcher.getBudgetStatus(),
                }
              : { enabled: false },
          })
        );
        return;
      }

      // Balances endpoint - returns EVM token + ETH + XRP + Aptos balances
      if (req.method === 'GET' && url.pathname === '/balances') {
        const balances = await this.getBalances();
        res.writeHead(200);
        res.end(JSON.stringify(balances));
        return;
      }

      // Add follow
      if (req.method === 'POST' && url.pathname === '/follows') {
        const body = await this.readRequestBody(req);
        const data = JSON.parse(body) as AddFollowRequest;

        this.agentNode.followGraphRouter.addFollow({
          pubkey: data.pubkey,
          ilpAddress: data.ilpAddress,
          petname: data.petname,
        });

        // Store peer connection info if BTP URL provided
        if (data.btpUrl) {
          this.peers.set(data.petname || data.pubkey, {
            peerId: data.petname || data.pubkey,
            ilpAddress: data.ilpAddress,
            btpUrl: data.btpUrl,
            evmAddress: data.evmAddress,
            xrpAddress: data.xrpAddress,
            aptosAddress: data.aptosAddress,
          });
        }

        res.writeHead(200);
        res.end(
          JSON.stringify({
            success: true,
            followCount: this.agentNode.followGraphRouter.getFollowCount(),
          })
        );
        return;
      }

      // List follows
      if (req.method === 'GET' && url.pathname === '/follows') {
        const follows = this.agentNode.followGraphRouter.getAllFollows();
        res.writeHead(200);
        res.end(JSON.stringify({ follows }));
        return;
      }

      // Send event to a specific peer
      if (req.method === 'POST' && url.pathname === '/send-event') {
        const body = await this.readRequestBody(req);
        const data = JSON.parse(body) as SendEventRequest;
        const result = await this.sendEventToPeer(data);
        res.writeHead(result.success ? 200 : 400);
        res.end(JSON.stringify(result));
        return;
      }

      // Send events to all follows
      if (req.method === 'POST' && url.pathname === '/broadcast') {
        const body = await this.readRequestBody(req);
        const data = JSON.parse(body) as Omit<SendEventRequest, 'targetPeerId'>;
        const result = await this.broadcastToFollows(data);
        res.writeHead(200);
        res.end(JSON.stringify(result));
        return;
      }

      // Query stored events
      if (req.method === 'GET' && url.pathname === '/events') {
        const kinds = url.searchParams.get('kinds')?.split(',').map(Number) || [1];
        const limit = parseInt(url.searchParams.get('limit') || '100', 10);
        const events = await this.agentNode.database.queryEvents({ kinds, limit });
        res.writeHead(200);
        res.end(JSON.stringify({ events }));
        return;
      }

      // Connect to peer (establish BTP connection)
      if (req.method === 'POST' && url.pathname === '/connect') {
        const body = await this.readRequestBody(req);
        const data = JSON.parse(body) as { peerId: string; btpUrl: string };
        await this.connectToPeer(data.peerId, data.btpUrl);
        res.writeHead(200);
        res.end(JSON.stringify({ success: true }));
        return;
      }

      // Get payment channels
      if (req.method === 'GET' && url.pathname === '/channels') {
        const channels = Array.from(this.paymentChannels.values()).map((ch) => ({
          channelId: ch.channelId,
          peerAddress: ch.peerAddress,
          deposit: ch.deposit.toString(),
          status: ch.status,
          nonce: ch.nonce,
          transferredAmount: ch.transferredAmount.toString(),
        }));
        res.writeHead(200);
        res.end(JSON.stringify({ channels }));
        return;
      }

      // Open payment channel
      if (req.method === 'POST' && url.pathname === '/channels/open') {
        const body = await this.readRequestBody(req);
        const data = JSON.parse(body) as { peerEvmAddress: string; depositAmount: string };
        const result = await this.openPaymentChannel(
          data.peerEvmAddress,
          BigInt(data.depositAmount)
        );
        res.writeHead(200);
        res.end(JSON.stringify(result));
        return;
      }

      // Configure EVM contracts (called by test runner)
      if (req.method === 'POST' && url.pathname === '/configure-evm') {
        const body = await this.readRequestBody(req);
        const data = JSON.parse(body) as {
          anvilRpcUrl: string;
          tokenNetworkAddress: string;
          agentTokenAddress: string;
        };

        // Update config
        this.config.anvilRpcUrl = data.anvilRpcUrl;
        this.config.tokenNetworkAddress = data.tokenNetworkAddress;
        this.config.agentTokenAddress = data.agentTokenAddress;

        // Re-initialize EVM
        await this.initializeEVM();

        res.writeHead(200);
        res.end(JSON.stringify({ success: true }));
        return;
      }

      // Configure XRP (called by test runner)
      if (req.method === 'POST' && url.pathname === '/configure-xrp') {
        const body = await this.readRequestBody(req);
        const data = JSON.parse(body) as {
          xrpWssUrl: string;
          xrpAccountSecret: string;
          xrpNetwork?: string;
        };

        // Update config
        this.config.xrpEnabled = true;
        this.config.xrpWssUrl = data.xrpWssUrl;
        this.config.xrpAccountSecret = data.xrpAccountSecret;
        if (data.xrpNetwork) {
          this.config.xrpNetwork = data.xrpNetwork;
        }

        // Re-initialize XRP
        await this.initializeXRP();

        res.writeHead(200);
        res.end(
          JSON.stringify({
            success: true,
            xrpAddress: this.config.xrpAccountAddress,
          })
        );
        return;
      }

      // Configure Aptos (called by test runner)
      if (req.method === 'POST' && url.pathname === '/configure-aptos') {
        const body = await this.readRequestBody(req);
        const data = JSON.parse(body) as {
          aptosNodeUrl: string;
          aptosPrivateKey: string;
          aptosModuleAddress: string;
          aptosCoinType?: string; // Optional coin type for channels (default: AptosCoin)
        };

        // Update config
        this.config.aptosEnabled = true;
        this.config.aptosNodeUrl = data.aptosNodeUrl;
        this.config.aptosPrivateKey = data.aptosPrivateKey;
        this.config.aptosModuleAddress = data.aptosModuleAddress;
        if (data.aptosCoinType) {
          this.config.aptosCoinType = data.aptosCoinType;
        }

        // Re-initialize Aptos with error handling
        try {
          await this.initializeAptos();

          // Check if initialization actually succeeded
          if (!this.aptosClient || !this.aptosChannelSDK) {
            res.writeHead(500);
            res.end(
              JSON.stringify({
                success: false,
                error: 'Aptos initialization failed - client or SDK not created',
              })
            );
            return;
          }

          res.writeHead(200);
          res.end(
            JSON.stringify({
              success: true,
              aptosAddress: this.config.aptosAccountAddress,
            })
          );
        } catch (error) {
          this.logger.error({ err: error }, 'Failed to configure Aptos');
          res.writeHead(500);
          res.end(
            JSON.stringify({
              success: false,
              error: (error as Error).message,
            })
          );
        }
        return;
      }

      // Configure settlement threshold (event-driven - checked on each balance update)
      if (req.method === 'POST' && url.pathname === '/configure-settlement') {
        const body = await this.readRequestBody(req);
        const data = JSON.parse(body) as {
          threshold: string | null; // Base units (octas, drops, wei) or null to disable
        };

        const threshold = data.threshold ? BigInt(data.threshold) : null;
        this.setSettlementThreshold(threshold);

        res.writeHead(200);
        res.end(
          JSON.stringify({
            success: true,
            threshold: threshold?.toString() || null,
          })
        );
        return;
      }

      // Get settlement status
      if (req.method === 'GET' && url.pathname === '/settlement-status') {
        res.writeHead(200);
        res.end(
          JSON.stringify({
            threshold: this.config.settlementThreshold?.toString() || null,
            enabled: this.config.settlementThreshold !== null, // Event-driven, enabled if threshold is set
          })
        );
        return;
      }

      // Get Aptos payment channels
      if (req.method === 'GET' && url.pathname === '/aptos-channels') {
        const channels = Array.from(this.aptosChannels.values()).map((ch) => ({
          channelOwner: ch.channelOwner,
          destination: ch.destination,
          deposited: ch.deposited,
          claimed: ch.claimed,
          status: ch.status,
          settleDelay: ch.settleDelay,
          nonce: ch.nonce,
        }));
        res.writeHead(200);
        res.end(JSON.stringify({ channels }));
        return;
      }

      // Open Aptos payment channel
      if (req.method === 'POST' && url.pathname === '/aptos-channels/open') {
        const body = await this.readRequestBody(req);
        const data = JSON.parse(body) as {
          destination: string;
          destinationPubkey: string;
          amount: string;
          settleDelay?: number;
          coinType?: string; // Optional: coin type for channel (default: AptosCoin)
        };
        const result = await this.openAptosPaymentChannel(
          data.destination,
          data.destinationPubkey,
          data.amount,
          data.settleDelay || 86400 // Default 24 hours
          // Note: coinType is configured at SDK initialization, not per-channel
        );
        res.writeHead(result.success ? 200 : 400);
        res.end(JSON.stringify(result));
        return;
      }

      // Get Aptos channel by ID
      if (
        req.method === 'GET' &&
        url.pathname.startsWith('/aptos-channels/') &&
        !url.pathname.includes('/claim') &&
        !url.pathname.includes('/close')
      ) {
        const channelOwner = url.pathname.split('/aptos-channels/')[1];

        if (!channelOwner) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Channel owner address required' }));
          return;
        }

        if (!this.aptosChannelSDK) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Aptos not initialized' }));
          return;
        }

        // Check local cache first
        let channel = this.aptosChannels.get(channelOwner);

        // If not in cache, try to fetch from chain
        if (!channel) {
          const state = await this.aptosChannelSDK.getChannelState(channelOwner);
          if (state) {
            channel = {
              channelOwner: state.channelOwner,
              destination: state.destination,
              destinationPubkey: state.destinationPubkey,
              deposited: state.deposited.toString(),
              claimed: state.claimed.toString(),
              status: state.status,
              settleDelay: state.settleDelay,
              nonce: state.nonce,
            };
            this.aptosChannels.set(channelOwner, channel);
          }
        }

        if (!channel) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Channel not found' }));
          return;
        }

        res.writeHead(200);
        res.end(JSON.stringify({ channel }));
        return;
      }

      // Aptos channel claim
      if (req.method === 'POST' && url.pathname === '/aptos-channels/claim') {
        const body = await this.readRequestBody(req);
        const data = JSON.parse(body) as {
          channelOwner: string;
          amount: string;
          nonce: number;
          signature: string;
        };
        const result = await this.claimAptosChannel(data);
        res.writeHead(result.success ? 200 : 400);
        res.end(JSON.stringify(result));
        return;
      }

      // Aptos channel close
      if (req.method === 'POST' && url.pathname === '/aptos-channels/close') {
        const body = await this.readRequestBody(req);
        const data = JSON.parse(body) as { channelOwner: string };
        const result = await this.closeAptosChannel(data.channelOwner);
        res.writeHead(result.success ? 200 : 400);
        res.end(JSON.stringify(result));
        return;
      }

      // Get XRP payment channels
      if (req.method === 'GET' && url.pathname === '/xrp-channels') {
        const channels = Array.from(this.xrpChannels.values()).map((ch) => ({
          channelId: ch.channelId,
          destination: ch.destination,
          amount: ch.amount,
          balance: ch.balance,
          status: ch.status,
          settleDelay: ch.settleDelay,
        }));
        res.writeHead(200);
        res.end(JSON.stringify({ channels }));
        return;
      }

      // Open XRP payment channel
      if (req.method === 'POST' && url.pathname === '/xrp-channels/open') {
        const body = await this.readRequestBody(req);
        const data = JSON.parse(body) as {
          destination: string;
          amount: string;
          settleDelay?: number;
        };
        const result = await this.openXRPPaymentChannel(
          data.destination,
          data.amount,
          data.settleDelay || 3600
        );
        res.writeHead(result.success ? 200 : 400);
        res.end(JSON.stringify(result));
        return;
      }

      // Sign EVM balance proof
      if (req.method === 'POST' && url.pathname === '/channels/sign-proof') {
        const body = await this.readRequestBody(req);
        const data = JSON.parse(body) as {
          channelId: string;
          nonce: number;
          transferredAmount: string;
        };
        const result = await this.signBalanceProof(
          data.channelId,
          data.nonce,
          data.transferredAmount
        );
        res.writeHead(result.signature ? 200 : 400);
        res.end(JSON.stringify(result));
        return;
      }

      // EVM cooperative settle
      if (req.method === 'POST' && url.pathname === '/channels/cooperative-settle') {
        const body = await this.readRequestBody(req);
        const data = JSON.parse(body) as {
          channelId: string;
          proof1: {
            channelId: string;
            nonce: number;
            transferredAmount: string;
            lockedAmount: number;
            locksRoot: string;
          };
          sig1: string;
          proof2: {
            channelId: string;
            nonce: number;
            transferredAmount: string;
            lockedAmount: number;
            locksRoot: string;
          };
          sig2: string;
        };
        const result = await this.cooperativeSettle(data);
        res.writeHead(result.success ? 200 : 400);
        res.end(JSON.stringify(result));
        return;
      }

      // XRP payment channel claim
      if (req.method === 'POST' && url.pathname === '/xrp-channels/claim') {
        const body = await this.readRequestBody(req);
        const data = JSON.parse(body) as { channelId: string };
        const result = await this.claimXRPChannel(data.channelId);
        res.writeHead(result.success ? 200 : 400);
        res.end(JSON.stringify(result));
        return;
      }

      // Get stored claims for a peer
      if (req.method === 'GET' && url.pathname.startsWith('/claims/')) {
        if (!this.claimStore) {
          res.writeHead(503);
          res.end(JSON.stringify({ error: 'Claim exchange not enabled' }));
          return;
        }

        const peerId = url.pathname.split('/claims/')[1];
        const chainParam = url.searchParams.get('chain') as 'evm' | 'xrp' | 'aptos' | null;

        // Validate peerId
        if (!peerId) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Peer ID required' }));
          return;
        }

        try {
          if (chainParam && this.claimManager) {
            // Get claims for specific chain
            const claims = this.claimManager.getClaimsForSettlement(peerId, chainParam);
            res.writeHead(200);
            res.end(JSON.stringify({ peerId, chain: chainParam, claims }));
          } else {
            // Get all claims for peer
            const allClaims = this.claimStore.getAllClaimsByPeer(peerId);
            res.writeHead(200);
            res.end(JSON.stringify({ peerId, claims: allClaims }));
          }
        } catch (error) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: (error as Error).message }));
        }
        return;
      }

      // Not found
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
    } catch (error) {
      this.logger.error({ err: error }, 'HTTP request error');
      res.writeHead(500);
      res.end(JSON.stringify({ error: (error as Error).message }));
    }
  }

  private readRequestBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });
  }

  // ============================================
  // BTP WebSocket Server
  // ============================================

  private startBtpServer(): Promise<void> {
    return new Promise((resolve) => {
      this.btpServer = new WebSocketServer({ port: this.config.btpPort });

      this.btpServer.on('connection', (ws, req) => {
        const peerId = req.url?.slice(1) || `peer-${Date.now()}`;
        this.logger.info({ peerId }, 'BTP connection established');

        ws.on('message', async (data) => {
          await this.handleBtpMessage(ws, peerId, data as Buffer);
        });

        ws.on('close', () => {
          this.logger.info({ peerId }, 'BTP connection closed');
        });

        ws.on('error', (err) => {
          this.logger.error({ peerId, err }, 'BTP connection error');
        });
      });

      this.btpServer.on('listening', () => {
        resolve();
      });
    });
  }

  private async handleBtpMessage(ws: WebSocket, peerId: string, data: Buffer): Promise<void> {
    try {
      // Try to parse as proper BTP message first
      let btpMessage: BTPMessage | null = null;
      let packet: ILPPreparePacket | null = null;

      try {
        btpMessage = parseBTPMessage(data);
        this.logger.debug(
          { peerId, messageType: BTPMessageType[btpMessage.type], requestId: btpMessage.requestId },
          'Received BTP message'
        );

        // Handle AUTH messages - respond immediately
        if (btpMessage.type === BTPMessageType.MESSAGE && isBTPData(btpMessage)) {
          const messageData = btpMessage.data as BTPData;
          const authProtocolData = messageData.protocolData.find(
            (pd) => pd.protocolName === 'auth'
          );

          if (authProtocolData) {
            // This is an auth message - extract peer info and send success response
            try {
              const authData = JSON.parse(authProtocolData.data.toString('utf8'));
              this.logger.info({ peerId: authData.peerId }, 'BTP auth received - auto-accepting');

              // Send RESPONSE acknowledging authentication (simple auto-accept for internal messaging)
              const responseMessage: BTPMessage = {
                type: BTPMessageType.RESPONSE,
                requestId: btpMessage.requestId,
                data: {
                  protocolData: [],
                },
              };

              ws.send(serializeBTPMessage(responseMessage));
              this.logger.info({ peerId: authData.peerId }, 'BTP auth success response sent');
              return;
            } catch (authError) {
              this.logger.warn({ peerId, err: authError }, 'Failed to parse auth message');
            }
          }

          // Not an auth message - extract ILP packet
          if (messageData.ilpPacket && messageData.ilpPacket.length > 0) {
            const ilpPacket = deserializePacket(messageData.ilpPacket);
            if (ilpPacket.type === PacketType.PREPARE) {
              packet = ilpPacket as ILPPreparePacket;
            }
          }
        }
      } catch {
        // Not a proper BTP message - try simplified JSON format (backward compatibility)
        this.logger.debug({ peerId }, 'Not a proper BTP message, trying JSON format');
      }

      // If we didn't get an ILP packet from BTP parsing, try simplified JSON format
      if (!packet) {
        packet = this.parseBtpPacket(data);
      }

      // Story 32.7: Check if packet is destined for private messaging address
      if (
        packet.type === PacketType.PREPARE &&
        this.config.enablePrivateMessaging &&
        packet.destination.startsWith(this.config.messagingAddress)
      ) {
        const messagingResponse = await this.handleMessagingPacket(ws, packet);
        if (messagingResponse) {
          // Packet was handled by messaging - send response and return
          const responseBuffer = this.serializeBtpResponse(messagingResponse);
          ws.send(responseBuffer);
          return;
        }
        // If messagingResponse is null, fall through to normal processing
      }

      // ILP FORWARDING: Forward packets destined for other addresses to next hop
      // This enables multi-hop routing through connector chain
      if (
        packet.type === PacketType.PREPARE &&
        this._messagingBtpClient &&
        this._messagingBtpClient.isConnected &&
        !packet.destination.startsWith(this.config.ilpAddress)
      ) {
        try {
          // Calculate connector fee (default 1% or configured percentage)
          const feePercentage = 0.01; // 1% fee
          const connectorFee = BigInt(Math.ceil(Number(packet.amount) * feePercentage));
          const forwardAmount = packet.amount - connectorFee;

          this.logger.info(
            {
              peerId,
              destination: packet.destination,
              originalAmount: packet.amount.toString(),
              connectorFee: connectorFee.toString(),
              forwardAmount: forwardAmount.toString(),
            },
            'Forwarding ILP packet to next hop'
          );

          // Emit telemetry for packet forwarding
          this.telemetryEmitter.emit({
            type: 'PACKET_FORWARDED',
            timestamp: new Date().toISOString(),
            agentId: this.config.agentId,
            data: {
              source: peerId,
              destination: packet.destination,
              amount: packet.amount.toString(),
              forwardAmount: forwardAmount.toString(),
              connectorFee: connectorFee.toString(),
            },
          });

          // Create forwarded packet with reduced amount and adjusted expiry
          const forwardPacket: ILPPreparePacket = {
            type: PacketType.PREPARE,
            amount: forwardAmount,
            destination: packet.destination,
            executionCondition: packet.executionCondition,
            expiresAt: new Date(packet.expiresAt.getTime() - 1000), // Reduce expiry by 1 second
            data: packet.data,
          };

          // Forward to next hop via BTP client
          const response = await this._messagingBtpClient.sendPacket(forwardPacket);

          this.logger.info(
            {
              peerId,
              destination: packet.destination,
              responseType: response.type === PacketType.FULFILL ? 'FULFILL' : 'REJECT',
            },
            'Received response from next hop'
          );

          // Log response for observability (telemetry is already emitted via PACKET_FORWARDED)
          this.logger.debug(
            {
              destination: packet.destination,
              responseType: response.type === PacketType.FULFILL ? 'FULFILL' : 'REJECT',
            },
            'ILP forwarding response'
          );

          // Send response back to upstream peer
          const responseBuffer = this.serializeBtpResponse(response);
          ws.send(responseBuffer);
          return;
        } catch (error) {
          this.logger.error({ peerId, err: error }, 'Failed to forward ILP packet');

          // Return reject packet on forwarding failure
          const rejectPacket: ILPRejectPacket = {
            type: PacketType.REJECT,
            code: ILPErrorCode.T01_PEER_UNREACHABLE,
            message: 'Failed to forward to next hop',
            triggeredBy: this.config.ilpAddress,
            data: Buffer.alloc(0),
          };
          const responseBuffer = this.serializeBtpResponse(rejectPacket);
          ws.send(responseBuffer);
          return;
        }
      }

      if (packet.type === PacketType.PREPARE) {
        // Decode the Nostr event from the packet data
        let decodedEvent: NostrEvent | undefined;
        try {
          decodedEvent = this.toonCodec.decode(packet.data);
        } catch (decodeError) {
          this.logger.debug(
            { peerId, err: decodeError },
            'Could not decode Nostr event from packet'
          );
        }

        // CLAIM INTEGRATION: Detect and process claim events
        let originalEvent = decodedEvent;
        let signedResponses: SignedClaim[] = [];

        if (this.config.claimExchangeEnabled && this.claimManager && decodedEvent) {
          try {
            const claimEventParser = new ClaimEventParser(this.logger);
            if (claimEventParser.isClaimEvent(decodedEvent)) {
              this.logger.info({ peerId, kind: decodedEvent.kind }, 'Received claim event');

              // Get peer wallet addresses for verification
              const peer = this.peers.get(peerId);
              const peerAddresses: WalletAddresses = {
                evm: peer?.evmAddress,
                xrp: peer?.xrpAddress,
                aptos: peer?.aptosAddress,
              };

              // Process received claim event
              const result = await this.claimManager.processReceivedClaimEvent(
                peerId,
                decodedEvent,
                peerAddresses
              );

              // Log results
              this.logger.info(
                {
                  peerId,
                  storedClaims: result.signedClaims.length,
                  unsignedRequests: result.unsignedRequests.length,
                  signedResponses: result.signedResponses.length,
                  errors: result.errors.length,
                },
                'Processed claim event'
              );

              // Log errors for debugging (graceful degradation)
              if (result.errors.length > 0) {
                this.logger.warn({ peerId, errors: result.errors }, 'Claim processing errors');
              }

              // Store signed responses to include in FULFILL
              signedResponses = result.signedResponses;

              // Extract original event content (unwrapped from claim event)
              const contentStr = claimEventParser.extractContent(decodedEvent);
              if (contentStr) {
                try {
                  originalEvent = JSON.parse(contentStr);
                } catch {
                  this.logger.warn(
                    { peerId },
                    'Failed to parse wrapped event content - using claim event as-is'
                  );
                }
              }
            }
          } catch (error) {
            this.logger.warn(
              { peerId, err: error },
              'Failed to process claim event - continuing with packet processing'
            );
            // Graceful degradation: continue with original event
          }
        }

        // Process originalEvent (either unwrapped from claim event or original event)
        const response = await this.agentNode.processIncomingPacket(packet, peerId);

        // Use originalEvent for telemetry (unwrapped if it was a claim event)
        decodedEvent = originalEvent;

        if (response.type === PacketType.FULFILL) {
          this.eventsReceived++;

          // Emit FULFILL telemetry event
          // Get peer's ILP address for display
          const peerConnection = this.peers.get(peerId);
          const peerIlpAddress = peerConnection?.ilpAddress || `g.agent.${peerId}`;
          // Use Nostr event ID as packet ID for correlation (unique per packet)
          const fulfillPacketId =
            decodedEvent?.id ||
            `${peerId}-${packet.executionCondition.toString('hex').slice(0, 16)}`;
          this.telemetryEmitter.emit({
            type: 'AGENT_CHANNEL_PAYMENT_SENT',
            timestamp: Date.now(),
            nodeId: this.config.agentId,
            agentId: this.config.agentId,
            packetType: 'fulfill',
            packetId: fulfillPacketId,
            from: this.config.ilpAddress,
            to: peerIlpAddress,
            peerId: peerId,
            channelId: `${this.config.agentId}-${peerId}`,
            amount: packet.amount.toString(),
            destination: packet.destination,
            executionCondition: packet.executionCondition.toString('hex'),
            expiresAt: packet.expiresAt.toISOString(),
            fulfillment: response.fulfillment.toString('hex'),
            event: decodedEvent
              ? {
                  id: decodedEvent.id,
                  pubkey: decodedEvent.pubkey,
                  kind: decodedEvent.kind,
                  content: decodedEvent.content,
                  created_at: decodedEvent.created_at,
                  tags: decodedEvent.tags,
                  sig: decodedEvent.sig,
                }
              : undefined,
          });
        } else if (response.type === PacketType.REJECT) {
          // Emit REJECT telemetry event
          const rejectResponse = response as ILPRejectPacket;
          const rejectPeerConnection = this.peers.get(peerId);
          const rejectPeerIlpAddress = rejectPeerConnection?.ilpAddress || `g.agent.${peerId}`;
          // Use Nostr event ID as packet ID for correlation (unique per packet)
          const rejectPacketId =
            decodedEvent?.id ||
            `${peerId}-${packet.executionCondition.toString('hex').slice(0, 16)}`;
          this.telemetryEmitter.emit({
            type: 'AGENT_CHANNEL_PAYMENT_SENT',
            timestamp: Date.now(),
            nodeId: this.config.agentId,
            agentId: this.config.agentId,
            packetType: 'reject',
            packetId: rejectPacketId,
            from: this.config.ilpAddress,
            to: rejectPeerIlpAddress,
            peerId: peerId,
            channelId: `${this.config.agentId}-${peerId}`,
            amount: packet.amount.toString(),
            destination: packet.destination,
            executionCondition: packet.executionCondition.toString('hex'),
            expiresAt: packet.expiresAt.toISOString(),
            errorCode: rejectResponse.code,
            errorMessage: rejectResponse.message,
            event: decodedEvent
              ? {
                  id: decodedEvent.id,
                  pubkey: decodedEvent.pubkey,
                  kind: decodedEvent.kind,
                  content: decodedEvent.content,
                  created_at: decodedEvent.created_at,
                  tags: decodedEvent.tags,
                  sig: decodedEvent.sig,
                }
              : undefined,
          });
        }

        // CLAIM INTEGRATION: Include signed responses in FULFILL
        if (signedResponses.length > 0 && response.type === PacketType.FULFILL) {
          try {
            // Wrap FULFILL data with signed response claims
            const claimEvent = await this.claimManager!.generateClaimEventForPeer(
              peerId,
              '', // Empty content (FULFILL has no content)
              signedResponses,
              [] // No new requests in FULFILL
            );
            if (claimEvent) {
              response.data = this.toonCodec.encode(claimEvent);
              this.logger.info(
                { peerId, responseCount: signedResponses.length },
                'Included signed responses in FULFILL'
              );
            }
          } catch (error) {
            this.logger.warn(
              { peerId, err: error },
              'Failed to wrap FULFILL with signed responses - sending without claims'
            );
            // Graceful degradation: send original FULFILL response
          }
        }

        // Send response - cast to union type for serialization
        const responseData = this.serializeBtpResponse(
          response as ILPFulfillPacket | ILPRejectPacket
        );
        ws.send(responseData);
      }
    } catch (error) {
      this.logger.error({ peerId, err: error }, 'BTP message handling error');
    }
  }

  // ============================================
  // Peer Communication
  // ============================================

  private async connectToPeer(peerId: string, btpUrl: string): Promise<void> {
    const existingPeer = this.peers.get(peerId);
    if (existingPeer?.ws?.readyState === WebSocket.OPEN) {
      return; // Already connected
    }

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${btpUrl}/${this.config.agentId}`);

      ws.on('open', () => {
        this.logger.info({ peerId, btpUrl }, 'Connected to peer');

        const peer = this.peers.get(peerId);
        if (peer) {
          peer.ws = ws;
        } else {
          this.peers.set(peerId, { peerId, ilpAddress: '', btpUrl, ws });
        }

        resolve();
      });

      ws.on('message', (data) => {
        this.handlePeerResponse(peerId, data as Buffer);
      });

      ws.on('error', (err) => {
        this.logger.error({ peerId, err }, 'Peer connection error');
        reject(err);
      });

      ws.on('close', () => {
        this.logger.info({ peerId }, 'Peer connection closed');
        const peer = this.peers.get(peerId);
        if (peer) {
          peer.ws = undefined;
        }
      });
    });
  }

  private handlePeerResponse(peerId: string, data: Buffer): void {
    try {
      const response = this.parseBtpResponse(data);
      this.logger.debug({ peerId, responseType: response.type }, 'Received peer response');

      // CLAIM INTEGRATION: Extract claims from FULFILL response
      if (
        this.config.claimExchangeEnabled &&
        this.claimManager &&
        response.type === PacketType.FULFILL
      ) {
        try {
          const fulfillResponse = response as ILPFulfillPacket;
          if (fulfillResponse.data.length > 0) {
            const decodedEvent = this.toonCodec.decode(fulfillResponse.data);
            if (decodedEvent) {
              const claimEventParser = new ClaimEventParser(this.logger);
              if (claimEventParser.isClaimEvent(decodedEvent)) {
                this.logger.info(
                  { peerId, kind: decodedEvent.kind },
                  'Received claim event in FULFILL'
                );

                // Get peer wallet addresses for verification
                const peer = this.peers.get(peerId);
                const peerAddresses: WalletAddresses = {
                  evm: peer?.evmAddress,
                  xrp: peer?.xrpAddress,
                  aptos: peer?.aptosAddress,
                };

                // Process received claim event
                this.claimManager
                  .processReceivedClaimEvent(peerId, decodedEvent, peerAddresses)
                  .then((result) => {
                    this.logger.info(
                      {
                        peerId,
                        storedClaims: result.signedClaims.length,
                        errors: result.errors.length,
                      },
                      'Processed claims from FULFILL'
                    );

                    if (result.errors.length > 0) {
                      this.logger.warn(
                        { peerId, errors: result.errors },
                        'Claim processing errors in FULFILL'
                      );
                    }
                  });
              }
            }
          }
        } catch (error) {
          this.logger.warn(
            { peerId, err: error },
            'Failed to process claims from FULFILL - continuing normally'
          );
          // Graceful degradation: continue with response processing
        }
      }

      // Get pending packet info for correlation
      const pendingPacket = this.pendingPackets.get(peerId);
      if (pendingPacket) {
        this.pendingPackets.delete(peerId);

        // Emit response received telemetry
        const packetType = response.type === PacketType.FULFILL ? 'fulfill' : 'reject';
        const responsePeerConnection = this.peers.get(peerId);
        const responsePeerIlpAddress = responsePeerConnection?.ilpAddress || `g.agent.${peerId}`;
        this.telemetryEmitter.emit({
          type: 'AGENT_CHANNEL_PAYMENT_SENT',
          timestamp: Date.now(),
          nodeId: this.config.agentId,
          agentId: this.config.agentId,
          packetType: packetType as 'prepare' | 'fulfill' | 'reject',
          packetId: pendingPacket.packetId, // Correlate with PREPARE
          from: responsePeerIlpAddress, // Response comes FROM the peer
          to: this.config.ilpAddress, // Response goes TO us
          peerId: peerId,
          channelId: `${peerId}-${this.config.agentId}`,
          amount: pendingPacket.amount,
          destination: pendingPacket.destination,
        });
      }
    } catch (error) {
      this.logger.error({ peerId, err: error }, 'Failed to parse peer response');
    }
  }

  private async sendEventToPeer(
    request: SendEventRequest
  ): Promise<{ success: boolean; error?: string }> {
    const peer = this.peers.get(request.targetPeerId);
    if (!peer) {
      return { success: false, error: `Peer ${request.targetPeerId} not found` };
    }

    // Connect if not connected
    if (!peer.ws || peer.ws.readyState !== WebSocket.OPEN) {
      try {
        await this.connectToPeer(peer.peerId, peer.btpUrl);
      } catch (error) {
        return { success: false, error: `Failed to connect to peer: ${(error as Error).message}` };
      }
    }

    // Create Nostr event
    const event = this.createNostrEvent(request.kind, request.content, request.tags);

    // CLAIM INTEGRATION: Wrap event in claim event if enabled
    let finalEvent = event;
    if (this.config.claimExchangeEnabled && this.claimManager) {
      try {
        // Generate claims for all channels with this peer
        const claimsToSend: SignedClaim[] = [];
        const requestsForPeer: ClaimRequest[] = [];

        // Generate EVM claim if channel exists
        if (peer.evmAddress) {
          const evmChannel = this.findEVMChannel(peer.evmAddress);
          if (evmChannel) {
            const evmClaim = await this.claimManager.generateClaimForPeer(
              request.targetPeerId,
              'evm',
              evmChannel.channelId,
              evmChannel.transferredAmount,
              evmChannel.nonce
            );
            if (evmClaim) claimsToSend.push(evmClaim);

            // Request peer to sign claim for what they owe us
            // TODO: Calculate expected amount from inbound channel state
            requestsForPeer.push({
              chain: 'evm',
              channelId: evmChannel.channelId,
              amount: 0n, // Placeholder - need inbound channel tracking
              nonce: 0, // Placeholder - need inbound channel tracking
            });
          }
        }

        // Generate XRP claim if channel exists
        if (peer.xrpAddress) {
          const xrpChannel = this.findXRPChannel(peer.xrpAddress);
          if (xrpChannel) {
            const xrpClaim = await this.claimManager.generateClaimForPeer(
              request.targetPeerId,
              'xrp',
              xrpChannel.channelId,
              BigInt(xrpChannel.balance)
            );
            if (xrpClaim) claimsToSend.push(xrpClaim);

            // Request peer to sign claim for what they owe us
            requestsForPeer.push({
              chain: 'xrp',
              channelId: xrpChannel.channelId,
              amount: 0n, // Placeholder - need inbound channel tracking
            });
          }
        }

        // Generate Aptos claim if channel exists
        if (peer.aptosAddress) {
          const aptosChannel = this.findAptosChannel(peer.aptosAddress);
          if (aptosChannel) {
            const aptosClaim = await this.claimManager.generateClaimForPeer(
              request.targetPeerId,
              'aptos',
              aptosChannel.channelOwner,
              BigInt(aptosChannel.claimed),
              aptosChannel.nonce
            );
            if (aptosClaim) claimsToSend.push(aptosClaim);

            // Request peer to sign claim for what they owe us
            requestsForPeer.push({
              chain: 'aptos',
              channelOwner: aptosChannel.channelOwner,
              amount: 0n, // Placeholder - need inbound channel tracking
              nonce: 0, // Placeholder - need inbound channel tracking
            });
          }
        }

        // Wrap content in claim event if we have claims to send
        if (claimsToSend.length > 0) {
          const claimEvent = await this.claimManager.generateClaimEventForPeer(
            request.targetPeerId,
            JSON.stringify(event), // Wrap original event as content
            claimsToSend,
            requestsForPeer
          );
          if (claimEvent) {
            finalEvent = claimEvent;
            this.logger.info(
              {
                peerId: request.targetPeerId,
                claimCount: claimsToSend.length,
                requestCount: requestsForPeer.length,
              },
              'Wrapped event in claim event'
            );
          }
        }
      } catch (error) {
        this.logger.warn(
          { peerId: request.targetPeerId, err: error },
          'Failed to wrap event in claim event - sending without claims'
        );
        // Graceful degradation: continue with original event
      }
    }

    // Define packet amount (in token units for EVM, drops for XRP)
    const packetAmount = 100n;

    // Create ILP Prepare packet with final event (may be claim-wrapped)
    const packet: ILPPreparePacket = {
      type: PacketType.PREPARE,
      amount: packetAmount,
      destination: peer.ilpAddress,
      executionCondition: AgentNode.AGENT_CONDITION,
      expiresAt: new Date(Date.now() + 30000),
      data: this.toonCodec.encode(finalEvent), // Use claim-wrapped event
    };

    // Find payment channel for this peer and update balance
    const channelInfo = this.updateChannelBalanceForPeer(peer, packetAmount);

    // Send via BTP
    try {
      const btpData = this.serializeBtpPacket(packet);
      peer.ws!.send(btpData);
      this.eventsSent++;

      // Use Nostr event ID as packet ID for correlation (same ID used by receiver)
      const packetId = event.id;

      // Track pending packet for response correlation
      this.pendingPackets.set(request.targetPeerId, {
        peerId: request.targetPeerId,
        destination: packet.destination,
        amount: packet.amount.toString(),
        timestamp: Date.now(),
        packetId,
      });

      // Emit PREPARE telemetry event with channel info
      const preparePeerConnection = this.peers.get(request.targetPeerId);
      const preparePeerIlpAddress =
        preparePeerConnection?.ilpAddress || `g.agent.${request.targetPeerId}`;
      this.telemetryEmitter.emit({
        type: 'AGENT_CHANNEL_PAYMENT_SENT',
        timestamp: Date.now(),
        nodeId: this.config.agentId,
        agentId: this.config.agentId,
        packetType: 'prepare',
        packetId,
        from: this.config.ilpAddress,
        to: preparePeerIlpAddress,
        peerId: request.targetPeerId,
        channelId: channelInfo.channelId || `${this.config.agentId}-${request.targetPeerId}`,
        amount: packet.amount.toString(),
        destination: packet.destination,
        executionCondition: packet.executionCondition.toString('hex'),
        expiresAt: packet.expiresAt.toISOString(),
        // Extended fields for channel tracking
        channelType: channelInfo.channelType,
        channelBalance: channelInfo.balance,
        channelDeposit: channelInfo.deposit,
        event: {
          id: event.id,
          pubkey: event.pubkey,
          kind: event.kind,
          content: event.content,
          created_at: event.created_at,
          tags: event.tags,
          sig: event.sig,
        },
      } as Parameters<typeof this.telemetryEmitter.emit>[0]);

      // Emit balance update telemetry if channel found
      if (channelInfo.channelId) {
        this.telemetryEmitter.emit({
          type: 'AGENT_CHANNEL_BALANCE_UPDATE',
          timestamp: Date.now(),
          nodeId: this.config.agentId,
          agentId: this.config.agentId,
          channelId: channelInfo.channelId,
          channelType: channelInfo.channelType,
          peerId: request.targetPeerId,
          previousBalance: channelInfo.previousBalance,
          newBalance: channelInfo.balance,
          amount: packetAmount.toString(),
          direction: 'outgoing',
          deposit: channelInfo.deposit,
        } as unknown as Parameters<typeof this.telemetryEmitter.emit>[0]);
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Helper methods for finding payment channels by peer address
   */
  private findEVMChannel(peerAddress: string): PaymentChannel | null {
    for (const channel of this.paymentChannels.values()) {
      if (channel.peerAddress === peerAddress && channel.status === 'opened') {
        return channel;
      }
    }
    return null;
  }

  private findXRPChannel(destination: string): XRPPaymentChannel | null {
    for (const channel of this.xrpChannels.values()) {
      if (channel.destination === destination && channel.status === 'open') {
        return channel;
      }
    }
    return null;
  }

  private findAptosChannel(destination: string): AptosPaymentChannel | null {
    for (const channel of this.aptosChannels.values()) {
      if (channel.destination === destination && channel.status === 'open') {
        return channel;
      }
    }
    return null;
  }

  /**
   * Find and update the payment channel balance for a peer
   * Prefers EVM channels, falls back to XRP channels, then Aptos channels
   */
  private updateChannelBalanceForPeer(
    peer: { evmAddress?: string; xrpAddress?: string; aptosAddress?: string },
    amount: bigint
  ): {
    channelId: string | null;
    channelType: 'evm' | 'xrp' | 'aptos' | 'none';
    balance: string;
    previousBalance: string;
    deposit: string;
  } {
    // Try EVM channel first
    if (peer.evmAddress) {
      for (const [channelId, channel] of this.paymentChannels) {
        if (channel.peerAddress === peer.evmAddress && channel.status === 'opened') {
          const previousBalance = channel.transferredAmount.toString();
          channel.transferredAmount += amount;
          channel.nonce++;

          // Check settlement threshold
          this.checkChannelSettlementThreshold(
            'evm',
            channelId,
            channel.peerAddress,
            channel.transferredAmount,
            channel.deposit
          );

          return {
            channelId,
            channelType: 'evm',
            balance: channel.transferredAmount.toString(),
            previousBalance,
            deposit: channel.deposit.toString(),
          };
        }
      }
    }

    // Try XRP channel
    if (peer.xrpAddress) {
      for (const [channelId, channel] of this.xrpChannels) {
        if (channel.destination === peer.xrpAddress && channel.status === 'open') {
          const previousBalance = channel.balance;
          const newBalance = (BigInt(channel.balance) + amount).toString();
          channel.balance = newBalance;

          // Check settlement threshold
          this.checkChannelSettlementThreshold(
            'xrp',
            channelId,
            channel.destination,
            BigInt(newBalance),
            BigInt(channel.amount)
          );

          return {
            channelId,
            channelType: 'xrp',
            balance: newBalance,
            previousBalance,
            deposit: channel.amount,
          };
        }
      }
    }

    // Try Aptos channel
    if (peer.aptosAddress) {
      for (const [channelOwner, channel] of this.aptosChannels) {
        if (channel.destination === peer.aptosAddress && channel.status === 'open') {
          const previousClaimed = channel.claimed;
          const newClaimed = (BigInt(channel.claimed) + amount).toString();
          channel.claimed = newClaimed;
          channel.nonce++;

          // Check settlement threshold
          this.checkChannelSettlementThreshold(
            'aptos',
            channelOwner,
            channel.destination,
            BigInt(newClaimed),
            BigInt(channel.deposited)
          );

          return {
            channelId: channelOwner,
            channelType: 'aptos',
            balance: newClaimed,
            previousBalance: previousClaimed,
            deposit: channel.deposited,
          };
        }
      }
    }

    return {
      channelId: null,
      channelType: 'none',
      balance: '0',
      previousBalance: '0',
      deposit: '0',
    };
  }

  /**
   * Check if channel balance exceeds settlement threshold and trigger settlement
   */
  private checkChannelSettlementThreshold(
    chain: 'evm' | 'xrp' | 'aptos',
    channelId: string,
    peerId: string,
    currentBalance: bigint,
    _deposit: bigint
  ): void {
    if (!this.config.settlementThreshold) return;

    const threshold = this.config.settlementThreshold;

    if (currentBalance >= threshold) {
      const exceedsBy = currentBalance - threshold;

      this.logger.info(
        {
          chain,
          channelId,
          peerId,
          currentBalance: currentBalance.toString(),
          threshold: threshold.toString(),
          exceedsBy: exceedsBy.toString(),
        },
        'Settlement threshold exceeded - triggering settlement'
      );

      this.telemetryEmitter.emit({
        type: 'SETTLEMENT_TRIGGERED',
        nodeId: this.config.agentId,
        peerId,
        tokenId: chain,
        currentBalance: currentBalance.toString(),
        threshold: threshold.toString(),
        exceedsBy: exceedsBy.toString(),
        triggerReason: 'THRESHOLD_EXCEEDED',
        timestamp: new Date().toISOString(),
      });

      // Trigger actual settlement asynchronously
      this.performSettlement(chain, channelId, peerId, currentBalance).catch((err) => {
        this.logger.error({ err, chain, channelId, peerId }, 'Settlement failed');
      });
    }
  }

  /**
   * Perform on-chain settlement for a payment channel using stored claims.
   *
   * This method retrieves the latest stored claim from ClaimStore for the peer/chain,
   * then executes chain-specific settlement:
   * - EVM: Calls cooperativeSettle() with both parties' signed balance proofs
   * - XRP: Submits PaymentChannelClaim transaction with peer's signature
   * - Aptos: Submits claim via AptosChannelSDK with peer's signature
   *
   * Graceful degradation: Missing claims or settlement failures are logged and
   * emit CLAIM_SETTLEMENT_FAILED telemetry but do not break packet processing.
   *
   * Settlement success emits CLAIM_SETTLEMENT_SUCCESS with transaction hash.
   *
   * @param chain - Blockchain chain ('evm', 'xrp', or 'aptos')
   * @param channelId - Channel identifier (format depends on chain)
   * @param peerId - Nostr public key of peer
   * @param amount - Amount to settle (in smallest unit: wei, drops, octas)
   */
  private async performSettlement(
    chain: 'evm' | 'xrp' | 'aptos',
    channelId: string,
    peerId: string,
    amount: bigint
  ): Promise<void> {
    this.logger.info(
      { chain, channelId, peerId, amount: amount.toString() },
      'Attempting settlement'
    );

    try {
      switch (chain) {
        case 'evm': {
          // EVM requires cooperative settlement with both parties' signatures
          const channel = this.paymentChannels.get(channelId);
          if (!channel) {
            this.logger.warn({ channelId }, 'EVM channel not found for settlement');
            this.telemetryEmitter.emit({
              type: 'CLAIM_SETTLEMENT_FAILED',
              nodeId: this.config.agentId,
              chain: 'evm',
              channelId,
              peerId,
              error: 'EVM channel not found',
              attemptedAmount: amount.toString(),
              timestamp: new Date().toISOString(),
            });
            return;
          }

          // Retrieve latest claim from ClaimStore for the channel/peer
          const storedClaims = await this.claimStore?.getClaimsForSettlement(peerId, 'evm');
          if (!storedClaims || storedClaims.length === 0) {
            this.logger.warn({ channelId, peerId }, 'No stored EVM claim available for settlement');
            this.telemetryEmitter.emit({
              type: 'CLAIM_SETTLEMENT_FAILED',
              nodeId: this.config.agentId,
              chain: 'evm',
              channelId,
              peerId,
              error: 'No stored claim available',
              attemptedAmount: amount.toString(),
              timestamp: new Date().toISOString(),
            });
            return;
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const storedClaim = storedClaims[0] as any; // Type assertion for discriminated union

          // Extract balance proof data from stored claim
          const peerBalanceProof = {
            channelId: storedClaim.channelId,
            nonce: storedClaim.nonce,
            transferredAmount: storedClaim.transferredAmount,
            lockedAmount: storedClaim.lockedAmount || 0n,
            locksRoot: storedClaim.locksRoot || ethers.ZeroHash,
          };

          this.logger.info(
            { channelId, peerBalanceProof },
            'Retrieved peer balance proof from stored claim'
          );

          // Generate our own balance proof and signature
          const ourBalanceProof = {
            channelId,
            nonce: channel.nonce,
            transferredAmount: channel.transferredAmount,
            lockedAmount: 0n,
            locksRoot: ethers.ZeroHash,
          };

          const ourSignature = await this.paymentChannelSDK!.signBalanceProof(
            channelId,
            channel.nonce,
            channel.transferredAmount,
            0n, // lockedAmount
            ethers.ZeroHash // locksRoot
          );

          this.logger.info({ channelId, ourBalanceProof }, 'Generated our balance proof');

          // Emit settlement initiated telemetry
          this.telemetryEmitter.emit({
            type: 'CLAIM_SETTLEMENT_INITIATED',
            nodeId: this.config.agentId,
            chain: 'evm',
            channelId,
            amount: amount.toString(),
            peerId,
            timestamp: new Date().toISOString(),
          });

          // Call cooperativeSettle() with both parties' balance proofs
          await this.paymentChannelSDK!.cooperativeSettle(
            channelId,
            this.config.agentTokenAddress!, // Token address
            ourBalanceProof, // Our proof
            ourSignature, // Our signature
            peerBalanceProof, // Peer's proof
            storedClaim.signature // Peer's signature from stored claim
          );

          this.logger.info(
            {
              channelId,
              settlementAmount: amount.toString(),
            },
            'EVM cooperative settlement completed'
          );

          // Emit settlement success telemetry
          this.telemetryEmitter.emit({
            type: 'CLAIM_SETTLEMENT_SUCCESS',
            nodeId: this.config.agentId,
            chain: 'evm',
            channelId,
            txHash: 'evm-settlement-' + channelId, // Use channel ID as placeholder since cooperativeSettle doesn't return tx hash
            settledAmount: amount.toString(),
            peerId,
            timestamp: new Date().toISOString(),
          });

          // Update channel state after successful settlement
          channel.status = 'settled';
          this.paymentChannels.set(channelId, channel);

          break;
        }

        case 'xrp': {
          // XRP PayChan can be claimed with a signed claim from the channel owner
          const xrpChannel = this.xrpChannels.get(channelId);
          if (!xrpChannel) {
            this.logger.warn({ channelId }, 'XRP channel not found for settlement');
            this.telemetryEmitter.emit({
              type: 'CLAIM_SETTLEMENT_FAILED',
              nodeId: this.config.agentId,
              chain: 'xrp',
              channelId,
              peerId,
              error: 'XRP channel not found',
              attemptedAmount: amount.toString(),
              timestamp: new Date().toISOString(),
            });
            return;
          }

          // Retrieve latest claim from ClaimStore
          const storedClaims = await this.claimStore?.getClaimsForSettlement(peerId, 'xrp');
          if (!storedClaims || storedClaims.length === 0) {
            this.logger.warn({ channelId, peerId }, 'No stored XRP claim available for settlement');
            this.telemetryEmitter.emit({
              type: 'CLAIM_SETTLEMENT_FAILED',
              nodeId: this.config.agentId,
              chain: 'xrp',
              channelId,
              peerId,
              error: 'No stored claim available',
              attemptedAmount: amount.toString(),
              timestamp: new Date().toISOString(),
            });
            return;
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const storedClaim = storedClaims[0] as any; // Type assertion for discriminated union

          // Construct PaymentChannelClaim transaction
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const claimTx: any = {
            TransactionType: 'PaymentChannelClaim',
            Account: this.config.xrpAccountAddress!, // Claimer's XRP address
            Channel: channelId, // 64-char hex channel ID
            Balance: storedClaim.amount.toString(), // Drops as string (cumulative)
            Signature: storedClaim.signature, // 128 hex char ed25519 signature
            PublicKey: storedClaim.signer, // 66 hex char ed25519 public key (ED prefix)
          };

          this.logger.info({ channelId, claimTx }, 'Constructed PaymentChannelClaim transaction');

          // Emit settlement initiated telemetry
          this.telemetryEmitter.emit({
            type: 'CLAIM_SETTLEMENT_INITIATED',
            nodeId: this.config.agentId,
            chain: 'xrp',
            channelId,
            amount: amount.toString(),
            peerId,
            timestamp: new Date().toISOString(),
          });

          // Submit claim transaction using xrplClient
          const result = await this.xrplClient!.submitAndWait(claimTx, {
            wallet: this.xrplWallet!,
          });

          this.logger.info(
            {
              channelId,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              txHash: (result.result as any).hash,
              validated: result.result.validated,
            },
            'XRP PaymentChannelClaim submitted'
          );

          // Emit settlement success telemetry
          this.telemetryEmitter.emit({
            type: 'CLAIM_SETTLEMENT_SUCCESS',
            nodeId: this.config.agentId,
            chain: 'xrp',
            channelId,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            txHash: (result.result as any).hash,
            settledAmount: storedClaim.amount.toString(),
            peerId,
            timestamp: new Date().toISOString(),
          });

          // Update channel state after successful settlement
          xrpChannel.balance = storedClaim.amount.toString();
          this.xrpChannels.set(channelId, xrpChannel);

          break;
        }

        case 'aptos': {
          // Aptos channel claim requires a signature from the channel owner
          const aptosChannel = this.aptosChannels.get(channelId);
          if (!aptosChannel) {
            this.logger.warn({ channelOwner: channelId }, 'Aptos channel not found for settlement');
            this.telemetryEmitter.emit({
              type: 'CLAIM_SETTLEMENT_FAILED',
              nodeId: this.config.agentId,
              chain: 'aptos',
              channelId,
              peerId,
              error: 'Aptos channel not found',
              attemptedAmount: amount.toString(),
              timestamp: new Date().toISOString(),
            });
            return;
          }

          // Retrieve latest claim from ClaimStore
          const storedClaims = await this.claimStore?.getClaimsForSettlement(peerId, 'aptos');
          if (!storedClaims || storedClaims.length === 0) {
            this.logger.warn(
              { channelOwner: channelId, peerId },
              'No stored Aptos claim available for settlement'
            );
            this.telemetryEmitter.emit({
              type: 'CLAIM_SETTLEMENT_FAILED',
              nodeId: this.config.agentId,
              chain: 'aptos',
              channelId,
              peerId,
              error: 'No stored claim available',
              attemptedAmount: amount.toString(),
              timestamp: new Date().toISOString(),
            });
            return;
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const storedClaim = storedClaims[0] as any; // Type assertion for discriminated union

          this.logger.info(
            { channelOwner: channelId, storedClaim },
            'Retrieved Aptos claim from store'
          );

          // Emit settlement initiated telemetry
          this.telemetryEmitter.emit({
            type: 'CLAIM_SETTLEMENT_INITIATED',
            nodeId: this.config.agentId,
            chain: 'aptos',
            channelId,
            amount: amount.toString(),
            peerId,
            timestamp: new Date().toISOString(),
          });

          // Submit claim via AptosChannelSDK
          const aptosClaim = {
            channelOwner: channelId,
            amount: storedClaim.amount,
            nonce: storedClaim.nonce,
            signature: storedClaim.signature,
            publicKey: storedClaim.signer,
            createdAt: Date.now(),
          };

          await this.aptosChannelSDK!.submitClaim(aptosClaim);

          this.logger.info({ channelOwner: channelId }, 'Aptos claim submitted');

          // Emit settlement success telemetry
          this.telemetryEmitter.emit({
            type: 'CLAIM_SETTLEMENT_SUCCESS',
            nodeId: this.config.agentId,
            chain: 'aptos',
            channelId,
            txHash: 'aptos-tx-hash', // TODO: Get actual txHash from submitClaim result
            settledAmount: storedClaim.amount.toString(),
            peerId,
            timestamp: new Date().toISOString(),
          });

          // Update channel state after successful settlement
          aptosChannel.claimed = storedClaim.amount.toString();
          aptosChannel.nonce = storedClaim.nonce;
          this.aptosChannels.set(channelId, aptosChannel);

          break;
        }
      }
    } catch (error) {
      this.logger.error(
        { err: error, chain, channelId, peerId },
        'Error during settlement execution'
      );

      // Emit settlement failure telemetry
      this.telemetryEmitter.emit({
        type: 'CLAIM_SETTLEMENT_FAILED',
        nodeId: this.config.agentId,
        chain,
        channelId,
        peerId,
        error: error instanceof Error ? error.message : String(error),
        attemptedAmount: amount.toString(),
        timestamp: new Date().toISOString(),
      });

      // Don't rethrow - settlement failures should not break packet processing
    }
  }

  private async broadcastToFollows(
    data: Omit<SendEventRequest, 'targetPeerId'>
  ): Promise<{ sent: number; failed: number; errors: string[] }> {
    const follows = this.agentNode.followGraphRouter.getAllFollows();
    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const follow of follows) {
      const peer = Array.from(this.peers.values()).find((p) => p.ilpAddress === follow.ilpAddress);
      if (!peer) {
        failed++;
        errors.push(`No peer connection for ${follow.petname || follow.pubkey}`);
        continue;
      }

      const result = await this.sendEventToPeer({
        targetPeerId: peer.peerId,
        kind: data.kind,
        content: data.content,
        tags: data.tags,
      });

      if (result.success) {
        sent++;
      } else {
        failed++;
        errors.push(`${peer.peerId}: ${result.error}`);
      }
    }

    return { sent, failed, errors };
  }

  // ============================================
  // BTP Packet Serialization (Simplified)
  // ============================================

  private parseBtpPacket(data: Buffer): ILPPreparePacket {
    // Simplified BTP parsing - just JSON for now
    // Real implementation would use proper BTP binary framing
    const json = JSON.parse(data.toString());
    return {
      type: PacketType.PREPARE,
      amount: BigInt(json.amount || 0),
      destination: json.destination || '',
      executionCondition: Buffer.from(json.executionCondition || '', 'base64'),
      expiresAt: new Date(json.expiresAt || Date.now() + 30000),
      data: Buffer.from(json.data || '', 'base64'),
    };
  }

  private serializeBtpPacket(packet: ILPPreparePacket): Buffer {
    const json = {
      type: 'PREPARE',
      amount: packet.amount.toString(),
      destination: packet.destination,
      executionCondition: packet.executionCondition.toString('base64'),
      expiresAt: packet.expiresAt.toISOString(),
      data: packet.data.toString('base64'),
    };
    return Buffer.from(JSON.stringify(json));
  }

  private parseBtpResponse(data: Buffer): { type: PacketType } {
    const json = JSON.parse(data.toString());
    return { type: json.type === 'FULFILL' ? PacketType.FULFILL : PacketType.REJECT };
  }

  private serializeBtpResponse(response: ILPFulfillPacket | ILPRejectPacket): Buffer {
    const typeStr = response.type === PacketType.FULFILL ? 'FULFILL' : 'REJECT';
    const json: Record<string, unknown> = {
      type: typeStr,
    };

    if (response.type === PacketType.FULFILL && response.fulfillment) {
      json.fulfillment = response.fulfillment.toString('base64');
      if (response.data) {
        json.data = response.data.toString('base64');
      }
    } else if (response.type === PacketType.REJECT) {
      json.code = response.code;
      json.message = response.message;
      if (response.data) {
        json.data = response.data.toString('base64');
      }
    }

    return Buffer.from(JSON.stringify(json));
  }

  // ============================================
  // Nostr Event Creation
  // ============================================

  private createNostrEvent(kind: number, content: string, tags?: string[][]): NostrEvent {
    const timestamp = Math.floor(Date.now() / 1000);
    return {
      id: crypto.randomBytes(32).toString('hex'),
      pubkey: this.config.nostrPubkey,
      created_at: timestamp,
      kind,
      tags: tags || [],
      content,
      sig: crypto.randomBytes(64).toString('hex'),
    };
  }

  // ============================================
  // Payment Channels
  // ============================================

  private async openPaymentChannel(
    peerEvmAddress: string,
    depositAmount: bigint
  ): Promise<{ success: boolean; channelId?: string; error?: string }> {
    if (
      !this.evmProvider ||
      !this.evmWallet ||
      !this.tokenNetworkContract ||
      !this.agentTokenContract
    ) {
      return { success: false, error: 'EVM not initialized' };
    }

    try {
      // Get fresh nonce from provider to avoid stale nonce issues
      let nonce = await this.evmProvider.getTransactionCount(this.evmWallet.address);

      // Approve tokens for TokenNetwork
      const tokenNetworkAddress = await this.tokenNetworkContract.getAddress();
      const approveFn = this.agentTokenContract.getFunction('approve');
      const approveTx = await approveFn(tokenNetworkAddress, depositAmount, { nonce });
      await approveTx.wait();
      nonce++;

      this.logger.info(
        { peerEvmAddress, depositAmount: depositAmount.toString() },
        'Opening payment channel'
      );

      // Open channel with 1 hour settlement timeout
      const settlementTimeout = 3600;
      const openChannelFn = this.tokenNetworkContract.getFunction('openChannel');
      const openTx = await openChannelFn(peerEvmAddress, settlementTimeout, { nonce });
      const receipt = await openTx.wait();
      nonce++;

      // Parse ChannelOpened event to get channel ID
      const event = receipt.logs.find((log: ethers.Log) => {
        try {
          const parsed = this.tokenNetworkContract!.interface.parseLog({
            topics: log.topics as string[],
            data: log.data,
          });
          return parsed?.name === 'ChannelOpened';
        } catch {
          return false;
        }
      });

      if (!event) {
        return { success: false, error: 'ChannelOpened event not found' };
      }

      const parsed = this.tokenNetworkContract.interface.parseLog({
        topics: event.topics as string[],
        data: event.data,
      });
      const channelId = parsed?.args[0] as string;

      // Deposit to channel
      const myAddress = await this.evmWallet.getAddress();
      const setDepositFn = this.tokenNetworkContract.getFunction('setTotalDeposit');
      const depositTx = await setDepositFn(channelId, myAddress, depositAmount, { nonce });
      await depositTx.wait();

      // Track channel
      this.paymentChannels.set(channelId, {
        channelId,
        peerAddress: peerEvmAddress,
        deposit: depositAmount,
        status: 'opened',
        nonce: 0,
        transferredAmount: 0n,
      });

      this.logger.info({ channelId, peerEvmAddress }, 'Payment channel opened');

      // Emit telemetry for payment channel opened
      this.telemetryEmitter.emit({
        type: 'AGENT_CHANNEL_OPENED',
        timestamp: Date.now(),
        nodeId: this.config.agentId,
        agentId: this.config.agentId,
        channelId,
        chain: 'evm',
        peerId: peerEvmAddress,
        amount: depositAmount.toString(),
      });

      return { success: true, channelId };
    } catch (error) {
      this.logger.error({ err: error, peerEvmAddress }, 'Failed to open payment channel');
      return { success: false, error: (error as Error).message };
    }
  }

  // ============================================
  // XRP Payment Channels
  // ============================================

  private async openXRPPaymentChannel(
    destination: string,
    amount: string,
    settleDelay: number
  ): Promise<{ success: boolean; channelId?: string; error?: string }> {
    if (!this.xrplClient || !this.xrplWallet) {
      return { success: false, error: 'XRP not initialized' };
    }

    if (!this.xrplClient.isConnected()) {
      try {
        await this.xrplClient.connect();
      } catch (error) {
        return {
          success: false,
          error: `Failed to connect to XRP ledger: ${(error as Error).message}`,
        };
      }
    }

    try {
      this.logger.info(
        {
          destination,
          amount,
          settleDelay,
          account: this.xrplWallet.address,
          network: this.config.xrpNetwork,
        },
        'Opening XRP payment channel'
      );

      // Get the public key from the wallet for the channel
      const publicKey = this.xrplWallet.publicKey;

      // In standalone mode, advance ledger first to ensure account state is current
      if (this.config.xrpNetwork === 'standalone') {
        try {
          await this.xrplClient.request({ command: 'ledger_accept' } as never);
        } catch {
          // Ignore - may not be needed
        }
      }

      // Construct PaymentChannelCreate transaction
      const tx = {
        TransactionType: 'PaymentChannelCreate' as const,
        Account: this.xrplWallet.address,
        Destination: destination,
        Amount: amount,
        SettleDelay: settleDelay,
        PublicKey: publicKey,
      };

      // Autofill and sign transaction
      const prepared = await this.xrplClient.autofill(tx);
      const signed = this.xrplWallet.sign(prepared);

      let result;
      if (this.config.xrpNetwork === 'standalone') {
        // In standalone mode, submit and manually advance the ledger
        const submitResult = await this.xrplClient.submit(signed.tx_blob);
        if (submitResult.result.engine_result !== 'tesSUCCESS') {
          return { success: false, error: `Submit failed: ${submitResult.result.engine_result}` };
        }
        // Advance the ledger to validate the transaction
        await this.xrplClient.request({ command: 'ledger_accept' } as never);
        // Fetch the transaction to get meta
        const txResponse = await this.xrplClient.request({
          command: 'tx',
          transaction: submitResult.result.tx_json?.hash || signed.hash,
        } as never);
        result = txResponse;
      } else {
        // Normal mode - submit and wait for validation
        result = await this.xrplClient.submitAndWait(signed.tx_blob);
      }

      // The channel ID is derived from the transaction
      // For PaymentChannelCreate, the channel ID is in the meta.AffectedNodes
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resultObj = result as any;

      // Handle different response formats from xrpl.js
      // - submitAndWait returns { result: { meta: ... } }
      // - tx command returns { result: { meta: ... } }
      const txResult = resultObj.result || resultObj;
      const meta = txResult.meta as {
        AffectedNodes?: Array<{
          CreatedNode?: {
            LedgerEntryType: string;
            LedgerIndex: string;
          };
        }>;
        TransactionResult?: string;
      };

      // Check if transaction was successful
      if (meta?.TransactionResult && meta.TransactionResult !== 'tesSUCCESS') {
        return { success: false, error: `Transaction failed: ${meta.TransactionResult}` };
      }

      let channelId: string | undefined;
      if (meta?.AffectedNodes) {
        for (const node of meta.AffectedNodes) {
          if (node.CreatedNode?.LedgerEntryType === 'PayChannel') {
            channelId = node.CreatedNode.LedgerIndex;
            break;
          }
        }
      }

      if (!channelId) {
        // Log the result for debugging
        this.logger.warn(
          {
            hasResult: !!txResult,
            hasMeta: !!meta,
            affectedNodesCount: meta?.AffectedNodes?.length || 0,
            transactionResult: meta?.TransactionResult,
          },
          'Channel ID not found in transaction result'
        );
        return { success: false, error: 'Channel ID not found in transaction result' };
      }

      // Track channel
      this.xrpChannels.set(channelId, {
        channelId,
        destination,
        amount,
        balance: '0',
        status: 'open',
        settleDelay,
        publicKey,
      });

      this.logger.info({ channelId, destination }, 'XRP payment channel opened');

      // Emit telemetry for XRP channel opened
      this.telemetryEmitter.emit({
        type: 'AGENT_CHANNEL_OPENED',
        timestamp: Date.now(),
        nodeId: this.config.agentId,
        agentId: this.config.agentId,
        channelId,
        chain: 'xrp',
        peerId: destination,
        amount,
      });

      return { success: true, channelId };
    } catch (error) {
      this.logger.error({ err: error, destination }, 'Failed to open XRP payment channel');
      return { success: false, error: (error as Error).message };
    }
  }

  // ============================================
  // Aptos Payment Channels
  // ============================================

  private async openAptosPaymentChannel(
    destination: string,
    destinationPubkey: string,
    amount: string,
    settleDelay: number
    // Note: coinType is configured at SDK initialization via configure-aptos endpoint
  ): Promise<{ success: boolean; channelOwner?: string; error?: string }> {
    if (!this.aptosChannelSDK) {
      return { success: false, error: 'Aptos not initialized' };
    }

    try {
      this.logger.info(
        {
          destination,
          amount,
          settleDelay,
        },
        'Opening Aptos payment channel'
      );

      // Open channel via SDK (uses coin type from SDK config)
      // Note: coinType is configured when SDK is initialized, not per-channel
      const channelOwner = await this.aptosChannelSDK.openChannel(
        destination,
        destinationPubkey,
        BigInt(amount),
        settleDelay
      );

      // Fetch channel state and track locally
      const channelState = await this.aptosChannelSDK.getChannelState(channelOwner);
      if (channelState) {
        this.aptosChannels.set(channelOwner, {
          channelOwner: channelState.channelOwner,
          destination: channelState.destination,
          destinationPubkey: channelState.destinationPubkey,
          deposited: channelState.deposited.toString(),
          claimed: channelState.claimed.toString(),
          status: channelState.status,
          settleDelay: channelState.settleDelay,
          nonce: channelState.nonce,
        });
      }

      this.logger.info({ channelOwner, destination }, 'Aptos payment channel opened');

      // Emit telemetry
      this.telemetryEmitter.emit({
        type: 'AGENT_CHANNEL_OPENED',
        timestamp: Date.now(),
        nodeId: this.config.agentId,
        agentId: this.config.agentId,
        channelId: channelOwner,
        chain: 'aptos',
        peerId: destination,
        amount,
      });

      return { success: true, channelOwner };
    } catch (error) {
      // Get more detailed error message including original error
      let errorMessage = (error as Error).message;
      if (error && typeof error === 'object' && 'originalError' in error) {
        const originalError = (error as { originalError: unknown }).originalError;
        if (originalError instanceof Error) {
          errorMessage = `${errorMessage}: ${originalError.message}`;
        }
      }
      this.logger.error(
        { err: error, destination, errorMessage },
        'Failed to open Aptos payment channel'
      );
      return { success: false, error: errorMessage };
    }
  }

  private async claimAptosChannel(claim: {
    channelOwner: string;
    amount: string;
    nonce: number;
    signature: string;
  }): Promise<{
    success: boolean;
    channelOwner: string;
    claimedAmount?: string;
    error?: string;
  }> {
    if (!this.aptosChannelSDK) {
      return { success: false, channelOwner: claim.channelOwner, error: 'Aptos not initialized' };
    }

    try {
      this.logger.info(
        {
          channelOwner: claim.channelOwner,
          amount: claim.amount,
          nonce: claim.nonce,
        },
        'Submitting Aptos channel claim'
      );

      // Fetch channel state to get destination public key for claim verification
      const channelState = this.aptosChannels.get(claim.channelOwner);
      if (!channelState) {
        return {
          success: false,
          channelOwner: claim.channelOwner,
          error: 'Channel not found in local state',
        };
      }

      // Submit claim to chain with public key from channel state
      await this.aptosChannelSDK.submitClaim({
        channelOwner: claim.channelOwner,
        amount: BigInt(claim.amount),
        nonce: claim.nonce,
        signature: claim.signature,
        publicKey: channelState.destinationPubkey,
        createdAt: Date.now(),
      });

      // Refresh channel state
      const state = await this.aptosChannelSDK.getChannelState(claim.channelOwner);
      if (state) {
        this.aptosChannels.set(claim.channelOwner, {
          channelOwner: state.channelOwner,
          destination: state.destination,
          destinationPubkey: state.destinationPubkey,
          deposited: state.deposited.toString(),
          claimed: state.claimed.toString(),
          status: state.status,
          settleDelay: state.settleDelay,
          nonce: state.nonce,
        });
      }

      this.logger.info(
        {
          channelOwner: claim.channelOwner,
          claimedAmount: claim.amount,
        },
        'Aptos channel claim submitted'
      );

      return {
        success: true,
        channelOwner: claim.channelOwner,
        claimedAmount: claim.amount,
      };
    } catch (error) {
      this.logger.error(
        { err: error, channelOwner: claim.channelOwner },
        'Aptos channel claim failed'
      );
      return { success: false, channelOwner: claim.channelOwner, error: (error as Error).message };
    }
  }

  private async closeAptosChannel(channelOwner: string): Promise<{
    success: boolean;
    channelOwner: string;
    error?: string;
  }> {
    if (!this.aptosChannelSDK) {
      return { success: false, channelOwner, error: 'Aptos not initialized' };
    }

    try {
      this.logger.info({ channelOwner }, 'Requesting Aptos channel close');

      // Request channel close (starts settle delay)
      await this.aptosChannelSDK.requestClose(channelOwner);

      // Update local state to 'closing'
      const channel = this.aptosChannels.get(channelOwner);
      if (channel) {
        channel.status = 'closing';
      }

      this.logger.info({ channelOwner }, 'Aptos channel close requested');

      return { success: true, channelOwner };
    } catch (error) {
      this.logger.error({ err: error, channelOwner }, 'Aptos channel close failed');
      return { success: false, channelOwner, error: (error as Error).message };
    }
  }

  // ============================================
  // EVM Settlement
  // ============================================

  private async signBalanceProof(
    channelId: string,
    nonce: number,
    transferredAmount: string
  ): Promise<{ signature?: string; signer?: string; error?: string }> {
    if (!this.evmWallet || !this.evmProvider || !this.config.tokenNetworkAddress) {
      return { error: 'EVM not initialized' };
    }

    try {
      const network = await this.evmProvider.getNetwork();
      const domain = getDomainSeparator(network.chainId, this.config.tokenNetworkAddress);
      const types = getBalanceProofTypes();
      const value = {
        channelId,
        nonce,
        transferredAmount,
        lockedAmount: 0,
        locksRoot: ethers.ZeroHash,
      };

      const signature = await this.evmWallet.signTypedData(domain, types, value);
      return { signature, signer: this.evmWallet.address };
    } catch (error) {
      this.logger.error({ err: error, channelId }, 'Failed to sign balance proof');
      return { error: (error as Error).message };
    }
  }

  private async cooperativeSettle(data: {
    channelId: string;
    proof1: {
      channelId: string;
      nonce: number;
      transferredAmount: string;
      lockedAmount: number;
      locksRoot: string;
    };
    sig1: string;
    proof2: {
      channelId: string;
      nonce: number;
      transferredAmount: string;
      lockedAmount: number;
      locksRoot: string;
    };
    sig2: string;
  }): Promise<{ success: boolean; txHash?: string; error?: string }> {
    if (!this.tokenNetworkContract || !this.evmWallet) {
      return { success: false, error: 'EVM not initialized' };
    }

    const proof1Tuple = [
      data.proof1.channelId,
      data.proof1.nonce,
      data.proof1.transferredAmount,
      data.proof1.lockedAmount,
      data.proof1.locksRoot,
    ];
    const proof2Tuple = [
      data.proof2.channelId,
      data.proof2.nonce,
      data.proof2.transferredAmount,
      data.proof2.lockedAmount,
      data.proof2.locksRoot,
    ];

    // Retry with escalating nonce on nonce collision (ethers v6 internal tracker can get out of sync)
    const maxRetries = 3;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const nonce = await this.evmProvider!.getTransactionCount(this.evmWallet.address, 'latest');
        const adjustedNonce = nonce + attempt; // Escalate nonce on retry
        const settleFn = this.tokenNetworkContract.getFunction('cooperativeSettle');
        const tx = await settleFn(data.channelId, proof1Tuple, data.sig1, proof2Tuple, data.sig2, {
          nonce: adjustedNonce,
        });
        // Wait for 1 confirmation with a timeout
        const receipt = await Promise.race([
          tx.wait(1),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('tx.wait timeout')), 30000)
          ),
        ]);

        // Update local channel state
        const channel = this.paymentChannels.get(data.channelId);
        if (channel) {
          channel.status = 'settled';
        }

        this.logger.info(
          { channelId: data.channelId, txHash: receipt.hash },
          'Channel cooperatively settled'
        );
        return { success: true, txHash: receipt.hash };
      } catch (error) {
        const errMsg = (error as Error).message || '';
        if (errMsg.includes('nonce') && attempt < maxRetries - 1) {
          this.logger.warn(
            { channelId: data.channelId, attempt, nonce: attempt },
            'Nonce collision, retrying with incremented nonce'
          );
          await new Promise((resolve) => setTimeout(resolve, 200));
          continue;
        }
        this.logger.error({ err: error, channelId: data.channelId }, 'Cooperative settle failed');
        return { success: false, error: errMsg };
      }
    }
    return { success: false, error: 'Max retries exceeded' };
  }

  // ============================================
  // XRP Settlement
  // ============================================

  private async claimXRPChannel(channelId: string): Promise<{
    success: boolean;
    channelId: string;
    claimedAmount?: string;
    txHash?: string;
    error?: string;
  }> {
    if (!this.xrplClient || !this.xrplWallet) {
      return { success: false, channelId, error: 'XRP not initialized' };
    }

    const channel = this.xrpChannels.get(channelId);
    if (!channel) {
      return { success: false, channelId, error: 'Channel not found' };
    }

    if (!this.xrplClient.isConnected()) {
      try {
        await this.xrplClient.connect();
      } catch (error) {
        return {
          success: false,
          channelId,
          error: `Failed to connect to XRP ledger: ${(error as Error).message}`,
        };
      }
    }

    try {
      const balance = channel.balance;

      // Sign the payment channel claim (signPaymentChannelClaim expects XRP, not drops)
      const balanceInXRP = dropsToXrp(balance);
      const signature = signPaymentChannelClaim(
        channelId,
        balanceInXRP,
        this.xrplWallet.privateKey
      );

      // Submit PaymentChannelClaim transaction
      const tx = {
        TransactionType: 'PaymentChannelClaim' as const,
        Account: this.xrplWallet.address,
        Channel: channelId,
        Balance: balance,
        Amount: balance,
        Signature: signature.toUpperCase(),
        PublicKey: this.xrplWallet.publicKey,
      };

      const prepared = await this.xrplClient.autofill(tx);
      const signed = this.xrplWallet.sign(prepared);

      let txHash: string | undefined;
      if (this.config.xrpNetwork === 'standalone') {
        const submitResult = await this.xrplClient.submit(signed.tx_blob);
        if (submitResult.result.engine_result !== 'tesSUCCESS') {
          return {
            success: false,
            channelId,
            error: `Claim submit failed: ${submitResult.result.engine_result}`,
          };
        }
        await this.xrplClient.request({ command: 'ledger_accept' } as never);
        txHash = submitResult.result.tx_json?.hash || signed.hash;
      } else {
        const result = await this.xrplClient.submitAndWait(signed.tx_blob);
        txHash = result.result.hash;
      }

      this.logger.info({ channelId, claimedAmount: balance, txHash }, 'XRP channel claimed');

      return {
        success: true,
        channelId,
        claimedAmount: balance,
        txHash,
      };
    } catch (error) {
      this.logger.error({ err: error, channelId }, 'XRP channel claim failed');
      return { success: false, channelId, error: (error as Error).message };
    }
  }

  // ============================================
  // Balance Queries
  // ============================================

  private async getBalances(): Promise<{
    agentId: string;
    evmAddress: string;
    xrpAddress: string | null;
    aptosAddress: string | null;
    ethBalance: string | null;
    agentTokenBalance: string | null;
    xrpBalance: string | null;
    aptosBalance: string | null;
    evmChannels: Array<{
      channelId: string;
      peerAddress: string;
      deposit: string;
      transferredAmount: string;
      status: string;
    }>;
    xrpChannels: Array<{
      channelId: string;
      destination: string;
      amount: string;
      balance: string;
      status: string;
    }>;
    aptosChannels: Array<{
      channelOwner: string;
      destination: string;
      deposited: string;
      claimed: string;
      status: string;
    }>;
  }> {
    let ethBalance: string | null = null;
    let agentTokenBalance: string | null = null;
    let xrpBalance: string | null = null;
    let aptosBalance: string | null = null;

    // Query EVM balances
    if (this.evmProvider && this.evmWallet) {
      try {
        const rawEth = await this.evmProvider.getBalance(this.evmWallet.address);
        ethBalance = ethers.formatEther(rawEth);
      } catch {
        // ignore
      }

      if (this.agentTokenContract) {
        try {
          const balFn = this.agentTokenContract.getFunction('balanceOf');
          const rawToken = await balFn(this.evmWallet.address);
          agentTokenBalance = ethers.formatUnits(rawToken, 18);
        } catch {
          // ignore
        }
      }
    }

    // Query XRP balance
    if (this.xrplClient?.isConnected() && this.config.xrpAccountAddress) {
      try {
        const info = await this.xrplClient.request({
          command: 'account_info',
          account: this.config.xrpAccountAddress,
          ledger_index: 'validated',
        });
        const drops = info.result.account_data.Balance;
        xrpBalance = (Number(drops) / 1_000_000).toFixed(6);
      } catch {
        // ignore
      }
    }

    // Query Aptos balance
    if (this.aptosClient?.isConnected() && this.config.aptosAccountAddress) {
      try {
        // Query APT balance via Aptos client (returns bigint in octas)
        const balanceOctas = await this.aptosClient.getBalance(this.config.aptosAccountAddress);
        // Convert octas to APT (1 APT = 100,000,000 octas)
        aptosBalance = (Number(balanceOctas) / 100_000_000).toFixed(8);
      } catch {
        // ignore - balance query failed
      }
    }

    return {
      agentId: this.config.agentId,
      evmAddress: this.config.evmAddress,
      xrpAddress: this.config.xrpAccountAddress,
      aptosAddress: this.config.aptosAccountAddress,
      ethBalance,
      agentTokenBalance,
      xrpBalance,
      aptosBalance,
      evmChannels: Array.from(this.paymentChannels.values()).map((ch) => ({
        channelId: ch.channelId,
        peerAddress: ch.peerAddress,
        deposit: ethers.formatUnits(ch.deposit, 18),
        transferredAmount: ethers.formatUnits(ch.transferredAmount, 18),
        status: ch.status,
      })),
      xrpChannels: Array.from(this.xrpChannels.values()).map((ch) => ({
        channelId: ch.channelId,
        destination: ch.destination,
        amount: (Number(ch.amount) / 1_000_000).toFixed(6),
        balance: (Number(ch.balance) / 1_000_000).toFixed(6),
        status: ch.status,
      })),
      aptosChannels: Array.from(this.aptosChannels.values()).map((ch) => ({
        channelOwner: ch.channelOwner,
        destination: ch.destination,
        deposited: (Number(ch.deposited) / 100_000_000).toFixed(8), // Octas to APT
        claimed: (Number(ch.claimed) / 100_000_000).toFixed(8),
        status: ch.status,
      })),
    };
  }

  // ============================================
  // Peer & Routing Data for Explorer
  // ============================================

  private async getPeers(): Promise<
    Array<{
      peerId: string;
      ilpAddress: string;
      evmAddress?: string;
      xrpAddress?: string;
      btpUrl?: string;
      connected: boolean;
      petname?: string;
      pubkey?: string;
    }>
  > {
    const follows = this.agentNode.followGraphRouter.getAllFollows();
    return follows.map((follow) => {
      // Find matching peer connection by ILP address to get richer data
      const peerConn = Array.from(this.peers.values()).find(
        (p) => p.ilpAddress === follow.ilpAddress
      );
      const isConnected = peerConn?.ws?.readyState === WebSocket.OPEN;

      return {
        peerId: follow.petname || follow.pubkey.slice(0, 8),
        ilpAddress: follow.ilpAddress,
        evmAddress: peerConn?.evmAddress,
        xrpAddress: peerConn?.xrpAddress,
        btpUrl: peerConn?.btpUrl,
        connected: isConnected,
        petname: follow.petname,
        pubkey: follow.pubkey,
      };
    });
  }

  private async getRoutes(): Promise<
    Array<{ prefix: string; nextHop: string; priority?: number }>
  > {
    // Build routing table from follows — each follow's ILP address is a route prefix
    const follows = this.agentNode.followGraphRouter.getAllFollows();
    return follows.map((follow) => ({
      prefix: follow.ilpAddress,
      nextHop: follow.petname || follow.pubkey.slice(0, 8),
    }));
  }

  // ============================================
  // Accessors
  // ============================================

  get agentId(): string {
    return this.config.agentId;
  }

  get pubkey(): string {
    return this.config.nostrPubkey;
  }

  get ilpAddress(): string {
    return this.config.ilpAddress;
  }

  get node(): AgentNode {
    return this.agentNode;
  }

  // ============================================
  // Settlement Threshold Configuration
  // ============================================

  /**
   * Configure settlement threshold at runtime
   * Threshold is checked automatically when channel balances change (no polling)
   */
  public setSettlementThreshold(threshold: bigint | null): void {
    this.config.settlementThreshold = threshold;
    this.logger.info(
      { threshold: threshold?.toString() || 'disabled' },
      'Settlement threshold updated'
    );
  }
}

// ============================================
// Main Entry Point
// ============================================

async function main(): Promise<void> {
  const server = new AgentServer({
    agentId: process.env.AGENT_ID,
    httpPort: parseInt(process.env.AGENT_HTTP_PORT || '8080', 10),
    btpPort: parseInt(process.env.AGENT_BTP_PORT || '3000', 10),
    explorerPort: parseInt(process.env.AGENT_EXPLORER_PORT || '9000', 10),
    nostrPubkey: process.env.AGENT_PUBKEY,
    nostrPrivkey: process.env.AGENT_PRIVKEY,
    databasePath: process.env.AGENT_DATABASE_PATH || ':memory:',
    explorerDbPath: process.env.AGENT_EXPLORER_DB_PATH || ':memory:',
  });

  // Handle shutdown signals
  const shutdown = async (): Promise<void> => {
    await server.shutdown();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await server.start();
}

// Run if executed directly
if (require.main === module) {
  main().catch((err) => {
    console.error('Failed to start agent server:', err);
    process.exit(1);
  });
}
