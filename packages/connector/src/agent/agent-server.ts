/**
 * Standalone Agent Server
 *
 * HTTP/WebSocket server that wraps AgentNode for Docker deployments.
 * Provides:
 * - BTP WebSocket endpoint for ILP communication
 * - HTTP API for configuration and management
 * - Health check endpoint
 *
 * Environment Variables:
 *   AGENT_HTTP_PORT - HTTP API port (default: 8080)
 *   AGENT_BTP_PORT - BTP WebSocket port (default: 3000)
 *   AGENT_PUBKEY - Nostr public key (required or auto-generated)
 *   AGENT_PRIVKEY - Nostr private key (required or auto-generated)
 *   AGENT_ID - Unique agent identifier (default: "agent-0")
 *   AGENT_DATABASE_PATH - Database path (default: ":memory:")
 *   LOG_LEVEL - Log level (default: "info")
 */

import * as http from 'http';
import * as crypto from 'crypto';
import * as path from 'path';
import { getPublicKey } from 'nostr-tools';
import { WebSocketServer, WebSocket } from 'ws';
import pino, { Logger } from 'pino';
import { ethers } from 'ethers';
import { AgentNode, AgentNodeConfig } from './agent-node';
import { ToonCodec, NostrEvent } from './toon-codec';
import { PacketType, ILPPreparePacket, ILPFulfillPacket, ILPRejectPacket } from '@m2m/shared';
import { EventStore } from '../explorer/event-store';
import { TelemetryEmitter } from '../telemetry/telemetry-emitter';
import { ExplorerServer } from '../explorer/explorer-server';

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
}

// Payment channel state tracking
interface PaymentChannel {
  channelId: string;
  peerAddress: string;
  deposit: bigint;
  status: 'opened' | 'closed' | 'settled';
  nonce: number;
  transferredAmount: bigint;
}

interface PeerConnection {
  peerId: string;
  ilpAddress: string;
  btpUrl: string;
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
  // EVM Payment Channel state
  private evmProvider: ethers.JsonRpcProvider | null = null;
  private evmWallet: ethers.Wallet | null = null;
  private paymentChannels: Map<string, PaymentChannel> = new Map(); // channelId -> PaymentChannel
  private tokenNetworkContract: ethers.Contract | null = null;
  private agentTokenContract: ethers.Contract | null = null;

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
      httpPort: config.httpPort || parseInt(process.env.AGENT_HTTP_PORT || '8080', 10),
      btpPort: config.btpPort || parseInt(process.env.AGENT_BTP_PORT || '3000', 10),
      explorerPort: config.explorerPort || parseInt(process.env.AGENT_EXPLORER_PORT || '9000', 10),
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
    };

    this.logger = pino({
      level: process.env.LOG_LEVEL || 'info',
      name: this.config.agentId,
    });

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

    // Initialize EventStore
    await this.eventStore.initialize();

    // Initialize AgentNode
    await this.agentNode.initialize();

    // Initialize EVM provider and contracts if configured
    await this.initializeEVM();

    // Start HTTP server
    await this.startHttpServer();

    // Start BTP WebSocket server
    await this.startBtpServer();

    // Start Explorer server
    await this.explorerServer.start();

    this.logger.info(
      {
        httpPort: this.config.httpPort,
        btpPort: this.config.btpPort,
        explorerPort: this.config.explorerPort,
        agentId: this.config.agentId,
        ilpAddress: this.config.ilpAddress,
        pubkey: this.config.nostrPubkey,
        evmAddress: this.config.evmAddress,
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
      this.evmWallet = new ethers.Wallet(this.config.evmPrivkey, this.evmProvider);

      // Initialize TokenNetwork contract if address provided
      if (this.config.tokenNetworkAddress) {
        const TOKEN_NETWORK_ABI = [
          'function openChannel(address participant2, uint256 settlementTimeout) external returns (bytes32)',
          'function setTotalDeposit(bytes32 channelId, address participant, uint256 totalDeposit) external',
          'function channels(bytes32) external view returns (uint256 settlementTimeout, uint8 state, uint256 closedAt, uint256 openedAt, address participant1, address participant2)',
          'function participants(bytes32, address) external view returns (uint256 deposit, uint256 withdrawnAmount, bool isCloser, uint256 nonce, uint256 transferredAmount)',
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

  async shutdown(): Promise<void> {
    if (this.isShutdown) return;
    this.isShutdown = true;

    this.logger.info('Shutting down agent server...');

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
            initialized: this.agentNode.isInitialized,
            followCount: this.agentNode.followGraphRouter.getFollowCount(),
            peerCount: this.peers.size,
            storedEventCount: events.length,
            eventsSent: this.eventsSent,
            eventsReceived: this.eventsReceived,
            channelCount: this.paymentChannels.size,
          })
        );
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
      // Parse BTP packet (simplified - just the ILP data)
      // In real implementation, this would be proper BTP framing
      const packet = this.parseBtpPacket(data);

      if (packet.type === PacketType.PREPARE) {
        const response = await this.agentNode.processIncomingPacket(packet, peerId);

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

        if (response.type === PacketType.FULFILL) {
          this.eventsReceived++;

          // Emit FULFILL telemetry event
          this.telemetryEmitter.emit({
            type: 'AGENT_CHANNEL_PAYMENT_SENT',
            timestamp: Date.now(),
            nodeId: this.config.agentId,
            agentId: this.config.agentId,
            packetType: 'fulfill',
            from: this.config.agentId,
            to: peerId,
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
          this.telemetryEmitter.emit({
            type: 'AGENT_CHANNEL_PAYMENT_SENT',
            timestamp: Date.now(),
            nodeId: this.config.agentId,
            agentId: this.config.agentId,
            packetType: 'reject',
            from: this.config.agentId,
            to: peerId,
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

    // Create ILP Prepare packet
    const packet: ILPPreparePacket = {
      type: PacketType.PREPARE,
      amount: 100n,
      destination: peer.ilpAddress,
      executionCondition: AgentNode.AGENT_CONDITION,
      expiresAt: new Date(Date.now() + 30000),
      data: this.toonCodec.encode(event),
    };

    // Send via BTP
    try {
      const btpData = this.serializeBtpPacket(packet);
      peer.ws!.send(btpData);
      this.eventsSent++;

      // Emit PREPARE telemetry event
      this.telemetryEmitter.emit({
        type: 'AGENT_CHANNEL_PAYMENT_SENT',
        timestamp: Date.now(),
        nodeId: this.config.agentId,
        agentId: this.config.agentId,
        packetType: 'prepare',
        from: this.config.agentId,
        to: request.targetPeerId,
        peerId: request.targetPeerId,
        channelId: `${this.config.agentId}-${request.targetPeerId}`,
        amount: packet.amount.toString(),
        destination: packet.destination,
        executionCondition: packet.executionCondition.toString('hex'),
        expiresAt: packet.expiresAt.toISOString(),
        event: {
          id: event.id,
          pubkey: event.pubkey,
          kind: event.kind,
          content: event.content,
          created_at: event.created_at,
          tags: event.tags,
          sig: event.sig,
        },
      });

      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
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

      return { success: true, channelId };
    } catch (error) {
      this.logger.error({ err: error, peerEvmAddress }, 'Failed to open payment channel');
      return { success: false, error: (error as Error).message };
    }
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
