/**
 * Agent Channel Manager Unit Tests
 * Story 11.6: Payment Channel Integration for Agent Wallets
 *
 * Tests channel manager operations with agent wallets across EVM and XRP chains.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { AgentChannelManager } from './agent-channel-manager';
import type { AgentWalletDerivation, AgentWallet } from './agent-wallet-derivation';
import {
  AgentWalletLifecycle,
  WalletState,
  type WalletLifecycleRecord,
} from './agent-wallet-lifecycle';
import type { PaymentChannelSDK } from '../settlement/payment-channel-sdk';
import type { XRPChannelSDK } from '../settlement/xrp-channel-sdk';
import type { TelemetryEmitter } from '../telemetry/telemetry-emitter';
import type { ChannelState } from '@m2m/shared';
import type { XRPChannelState } from '../settlement/xrp-channel-manager';
import type { XRPClaim } from '../settlement/types';
import * as fs from 'fs';
import * as path from 'path';

describe('AgentChannelManager', () => {
  let channelManager: AgentChannelManager;
  let mockWalletDerivation: jest.Mocked<AgentWalletDerivation>;
  let mockEvmChannelSDK: jest.Mocked<PaymentChannelSDK>;
  let mockXrpChannelSDK: jest.Mocked<XRPChannelSDK>;
  let mockLifecycleManager: jest.Mocked<AgentWalletLifecycle>;
  let mockTelemetryEmitter: jest.Mocked<TelemetryEmitter>;
  let dbPath: string;

  beforeEach(() => {
    // Create temporary database for testing
    const testDir = path.join(process.cwd(), 'test-data', 'wallet');
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    dbPath = path.join(testDir, `test-${Date.now()}.db`);

    // Mock AgentWalletDerivation
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockWalletDerivation = {
      getAgentWallet: jest.fn(),
      getAgentSigner: jest.fn(),
    } as any;

    // Mock PaymentChannelSDK
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockEvmChannelSDK = {
      openChannel: jest.fn(),
      signBalanceProof: jest.fn(),
      closeChannel: jest.fn(),
      getChannelState: jest.fn(),
    } as any;

    // Mock XRPChannelSDK
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockXrpChannelSDK = {
      openChannel: jest.fn(),
      signClaim: jest.fn(),
      closeChannel: jest.fn(),
      getChannelState: jest.fn(),
    } as any;

    // Mock AgentWalletLifecycle
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockLifecycleManager = {
      getLifecycleRecord: jest.fn(),
      recordTransaction: jest.fn(),
    } as any;

    // Mock TelemetryEmitter
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockTelemetryEmitter = {
      emit: jest.fn(),
    } as any;

    // Create AgentChannelManager instance
    channelManager = new AgentChannelManager(
      mockWalletDerivation,
      mockEvmChannelSDK,
      mockXrpChannelSDK,
      mockLifecycleManager,
      mockTelemetryEmitter,
      {
        minChannelBalance: 1000000000000000000n, // 1 token
        maxChannelBalance: 10000000000000000000n, // 10 tokens
        rebalanceEnabled: true,
      },
      dbPath
    );
  });

  afterEach(() => {
    // Clean up test database
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  describe('openChannel - EVM', () => {
    it('should open EVM channel for active agent', async () => {
      // Setup mocks
      const mockLifecycleRecord: WalletLifecycleRecord = {
        agentId: 'agent-001',
        state: WalletState.ACTIVE,
        createdAt: Date.now() - 86400000,
        activatedAt: Date.now() - 86400000,
        lastActivity: Date.now(),
        totalTransactions: 10,
        totalVolume: {},
      };

      const mockPeerWallet: AgentWallet = {
        agentId: 'agent-002',
        derivationIndex: 1,
        evmAddress: '0x1234567890123456789012345678901234567890',
        xrpAddress: 'rN7n7otQDd6FczFgLdlqtyMVrn3HMfXEEW',
        createdAt: Date.now(),
      };

      mockLifecycleManager.getLifecycleRecord.mockResolvedValueOnce(mockLifecycleRecord);
      mockWalletDerivation.getAgentWallet.mockResolvedValueOnce(mockPeerWallet);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockWalletDerivation.getAgentSigner.mockResolvedValueOnce({} as any);
      mockEvmChannelSDK.openChannel.mockResolvedValueOnce(
        '0xabc123def456789012345678901234567890123456789012345678901234567890'
      );
      mockLifecycleManager.recordTransaction.mockResolvedValueOnce();

      // Execute
      const channelId = await channelManager.openChannel({
        agentId: 'agent-001',
        peerId: 'agent-002',
        chain: 'evm',
        token: 'USDC',
        amount: 1000000000000000000n,
      });

      // Verify
      expect(channelId).toBe(
        '0xabc123def456789012345678901234567890123456789012345678901234567890'
      );
      expect(mockLifecycleManager.getLifecycleRecord).toHaveBeenCalledWith('agent-001');
      expect(mockWalletDerivation.getAgentWallet).toHaveBeenCalledWith('agent-002');
      expect(mockWalletDerivation.getAgentSigner).toHaveBeenCalledWith('agent-001', 'evm');
      expect(mockEvmChannelSDK.openChannel).toHaveBeenCalledWith(
        mockPeerWallet.evmAddress,
        'USDC',
        3600,
        1000000000000000000n
      );
      expect(mockLifecycleManager.recordTransaction).toHaveBeenCalledWith(
        'agent-001',
        'USDC',
        1000000000000000000n
      );
      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'AGENT_CHANNEL_OPENED',
          agentId: 'agent-001',
          channelId,
          chain: 'evm',
          peerId: 'agent-002',
          amount: '1000000000000000000',
        })
      );
    });

    it('should reject channel open if wallet not active', async () => {
      // Setup mocks
      const mockLifecycleRecord: WalletLifecycleRecord = {
        agentId: 'agent-001',
        state: WalletState.SUSPENDED,
        createdAt: Date.now() - 86400000,
        suspendedAt: Date.now(),
        lastActivity: Date.now(),
        totalTransactions: 10,
        totalVolume: {},
        suspensionReason: 'Low balance',
      };

      mockLifecycleManager.getLifecycleRecord.mockResolvedValueOnce(mockLifecycleRecord);

      // Execute & Verify
      await expect(
        channelManager.openChannel({
          agentId: 'agent-001',
          peerId: 'agent-002',
          chain: 'evm',
          token: 'USDC',
          amount: 1000000000000000000n,
        })
      ).rejects.toThrow('Agent wallet not active: suspended');

      expect(mockEvmChannelSDK.openChannel).not.toHaveBeenCalled();
    });
  });

  describe('openChannel - XRP', () => {
    it('should open XRP channel for active agent', async () => {
      // Setup mocks
      const mockLifecycleRecord: WalletLifecycleRecord = {
        agentId: 'agent-001',
        state: WalletState.ACTIVE,
        createdAt: Date.now() - 86400000,
        activatedAt: Date.now() - 86400000,
        lastActivity: Date.now(),
        totalTransactions: 10,
        totalVolume: {},
      };

      const mockPeerWallet: AgentWallet = {
        agentId: 'agent-002',
        derivationIndex: 1,
        evmAddress: '0x1234567890123456789012345678901234567890',
        xrpAddress: 'rN7n7otQDd6FczFgLdlqtyMVrn3HMfXEEW',
        createdAt: Date.now(),
      };

      const mockChannelId = 'A'.repeat(64);

      mockLifecycleManager.getLifecycleRecord.mockResolvedValueOnce(mockLifecycleRecord);
      mockWalletDerivation.getAgentWallet.mockResolvedValueOnce(mockPeerWallet);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockWalletDerivation.getAgentSigner.mockResolvedValueOnce({} as any);
      mockXrpChannelSDK.openChannel.mockResolvedValueOnce(mockChannelId);
      mockLifecycleManager.recordTransaction.mockResolvedValueOnce();

      // Execute
      const channelId = await channelManager.openChannel({
        agentId: 'agent-001',
        peerId: 'agent-002',
        chain: 'xrp',
        token: 'XRP',
        amount: 25000000n,
      });

      // Verify
      expect(channelId).toBe(mockChannelId);
      expect(mockXrpChannelSDK.openChannel).toHaveBeenCalledWith(
        mockPeerWallet.xrpAddress,
        '25000000',
        3600,
        'agent-002'
      );
      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'AGENT_CHANNEL_OPENED',
          agentId: 'agent-001',
          channelId,
          chain: 'xrp',
          peerId: 'agent-002',
          amount: '25000000',
        })
      );
    });
  });

  describe('sendPayment - EVM', () => {
    it('should send payment through EVM channel', async () => {
      // First open a channel
      const mockLifecycleRecord: WalletLifecycleRecord = {
        agentId: 'agent-001',
        state: WalletState.ACTIVE,
        createdAt: Date.now() - 86400000,
        activatedAt: Date.now() - 86400000,
        lastActivity: Date.now(),
        totalTransactions: 10,
        totalVolume: {},
      };

      const mockPeerWallet: AgentWallet = {
        agentId: 'agent-002',
        derivationIndex: 1,
        evmAddress: '0x1234567890123456789012345678901234567890',
        xrpAddress: 'rN7n7otQDd6FczFgLdlqtyMVrn3HMfXEEW',
        createdAt: Date.now(),
      };

      const channelId = '0xabc123def456789012345678901234567890123456789012345678901234567890';

      mockLifecycleManager.getLifecycleRecord.mockResolvedValueOnce(mockLifecycleRecord);
      mockWalletDerivation.getAgentWallet.mockResolvedValueOnce(mockPeerWallet);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockWalletDerivation.getAgentSigner.mockResolvedValue({} as any);
      mockEvmChannelSDK.openChannel.mockResolvedValueOnce(channelId);
      mockLifecycleManager.recordTransaction.mockResolvedValue();

      await channelManager.openChannel({
        agentId: 'agent-001',
        peerId: 'agent-002',
        chain: 'evm',
        token: 'USDC',
        amount: 1000000000000000000n,
      });

      // Mock channel state
      const mockChannelState: ChannelState = {
        channelId,
        participants: ['0x...', '0x...'] as [string, string],
        myDeposit: 1000000000000000000n,
        theirDeposit: 0n,
        myNonce: 0,
        theirNonce: 0,
        myTransferred: 0n,
        theirTransferred: 0n,
        status: 'opened',
        settlementTimeout: 3600,
        openedAt: Date.now(),
      };

      mockEvmChannelSDK.getChannelState.mockResolvedValueOnce(mockChannelState);
      mockEvmChannelSDK.signBalanceProof.mockResolvedValueOnce('0xsignature...');

      // Execute payment
      await channelManager.sendPayment({
        agentId: 'agent-001',
        channelId,
        amount: 100000000000000000n,
      });

      // Verify
      expect(mockEvmChannelSDK.getChannelState).toHaveBeenCalledWith(channelId, 'USDC');
      expect(mockEvmChannelSDK.signBalanceProof).toHaveBeenCalledWith(
        channelId,
        1,
        100000000000000000n
      );
      expect(mockLifecycleManager.recordTransaction).toHaveBeenCalledWith(
        'agent-001',
        'USDC',
        100000000000000000n
      );
      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'AGENT_CHANNEL_PAYMENT_SENT',
          agentId: 'agent-001',
          channelId,
          amount: '100000000000000000',
        })
      );
    });
  });

  describe('sendPayment - XRP', () => {
    it('should send payment through XRP channel', async () => {
      // First open a channel
      const mockLifecycleRecord: WalletLifecycleRecord = {
        agentId: 'agent-001',
        state: WalletState.ACTIVE,
        createdAt: Date.now() - 86400000,
        activatedAt: Date.now() - 86400000,
        lastActivity: Date.now(),
        totalTransactions: 10,
        totalVolume: {},
      };

      const mockPeerWallet: AgentWallet = {
        agentId: 'agent-002',
        derivationIndex: 1,
        evmAddress: '0x1234567890123456789012345678901234567890',
        xrpAddress: 'rN7n7otQDd6FczFgLdlqtyMVrn3HMfXEEW',
        createdAt: Date.now(),
      };

      const channelId = 'A'.repeat(64);

      mockLifecycleManager.getLifecycleRecord.mockResolvedValueOnce(mockLifecycleRecord);
      mockWalletDerivation.getAgentWallet.mockResolvedValueOnce(mockPeerWallet);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockWalletDerivation.getAgentSigner.mockResolvedValue({} as any);
      mockXrpChannelSDK.openChannel.mockResolvedValueOnce(channelId);
      mockLifecycleManager.recordTransaction.mockResolvedValue();

      await channelManager.openChannel({
        agentId: 'agent-001',
        peerId: 'agent-002',
        chain: 'xrp',
        token: 'XRP',
        amount: 25000000n,
      });

      // Mock channel state
      const mockChannelState: XRPChannelState = {
        channelId,
        account: 'rABC...',
        destination: 'rDEF...',
        amount: '25000000',
        balance: '0',
        settleDelay: 3600,
        publicKey: 'ED' + 'A'.repeat(64),
        status: 'open',
      };

      const mockClaim: XRPClaim = {
        channelId,
        amount: '5000000',
        signature: 'B'.repeat(128),
        publicKey: 'ED' + 'A'.repeat(64),
      };

      mockXrpChannelSDK.getChannelState.mockResolvedValueOnce(mockChannelState);
      mockXrpChannelSDK.signClaim.mockResolvedValueOnce(mockClaim);

      // Execute payment
      await channelManager.sendPayment({
        agentId: 'agent-001',
        channelId,
        amount: 5000000n,
      });

      // Verify
      expect(mockXrpChannelSDK.getChannelState).toHaveBeenCalledWith(channelId);
      expect(mockXrpChannelSDK.signClaim).toHaveBeenCalledWith(channelId, '5000000');
      expect(mockLifecycleManager.recordTransaction).toHaveBeenCalledWith(
        'agent-001',
        'XRP',
        5000000n
      );
      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'AGENT_CHANNEL_PAYMENT_SENT',
          agentId: 'agent-001',
          channelId,
          amount: '5000000',
        })
      );
    });
  });

  describe('closeChannel - EVM', () => {
    it('should close EVM channel', async () => {
      // First open a channel
      const mockLifecycleRecord: WalletLifecycleRecord = {
        agentId: 'agent-001',
        state: WalletState.ACTIVE,
        createdAt: Date.now() - 86400000,
        activatedAt: Date.now() - 86400000,
        lastActivity: Date.now(),
        totalTransactions: 10,
        totalVolume: {},
      };

      const mockPeerWallet: AgentWallet = {
        agentId: 'agent-002',
        derivationIndex: 1,
        evmAddress: '0x1234567890123456789012345678901234567890',
        xrpAddress: 'rN7n7otQDd6FczFgLdlqtyMVrn3HMfXEEW',
        createdAt: Date.now(),
      };

      const channelId = '0xabc123def456789012345678901234567890123456789012345678901234567890';

      mockLifecycleManager.getLifecycleRecord.mockResolvedValueOnce(mockLifecycleRecord);
      mockWalletDerivation.getAgentWallet.mockResolvedValueOnce(mockPeerWallet);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockWalletDerivation.getAgentSigner.mockResolvedValue({} as any);
      mockEvmChannelSDK.openChannel.mockResolvedValueOnce(channelId);
      mockLifecycleManager.recordTransaction.mockResolvedValue();

      await channelManager.openChannel({
        agentId: 'agent-001',
        peerId: 'agent-002',
        chain: 'evm',
        token: 'USDC',
        amount: 1000000000000000000n,
      });

      mockEvmChannelSDK.closeChannel.mockResolvedValueOnce();

      // Execute close
      await channelManager.closeChannel('agent-001', channelId);

      // Verify
      expect(mockEvmChannelSDK.closeChannel).toHaveBeenCalledWith(
        'USDC',
        channelId,
        expect.objectContaining({
          channelId,
          nonce: 0,
          transferredAmount: 0n,
          lockedAmount: 0n,
        }),
        '0x'
      );
      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'AGENT_CHANNEL_CLOSED',
          agentId: 'agent-001',
          channelId,
          chain: 'evm',
        })
      );
    });
  });

  describe('closeChannel - XRP', () => {
    it('should close XRP channel', async () => {
      // First open a channel
      const mockLifecycleRecord: WalletLifecycleRecord = {
        agentId: 'agent-001',
        state: WalletState.ACTIVE,
        createdAt: Date.now() - 86400000,
        activatedAt: Date.now() - 86400000,
        lastActivity: Date.now(),
        totalTransactions: 10,
        totalVolume: {},
      };

      const mockPeerWallet: AgentWallet = {
        agentId: 'agent-002',
        derivationIndex: 1,
        evmAddress: '0x1234567890123456789012345678901234567890',
        xrpAddress: 'rN7n7otQDd6FczFgLdlqtyMVrn3HMfXEEW',
        createdAt: Date.now(),
      };

      const channelId = 'A'.repeat(64);

      mockLifecycleManager.getLifecycleRecord.mockResolvedValueOnce(mockLifecycleRecord);
      mockWalletDerivation.getAgentWallet.mockResolvedValueOnce(mockPeerWallet);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockWalletDerivation.getAgentSigner.mockResolvedValue({} as any);
      mockXrpChannelSDK.openChannel.mockResolvedValueOnce(channelId);
      mockLifecycleManager.recordTransaction.mockResolvedValue();

      await channelManager.openChannel({
        agentId: 'agent-001',
        peerId: 'agent-002',
        chain: 'xrp',
        token: 'XRP',
        amount: 25000000n,
      });

      mockXrpChannelSDK.closeChannel.mockResolvedValueOnce();

      // Execute close
      await channelManager.closeChannel('agent-001', channelId);

      // Verify
      expect(mockXrpChannelSDK.closeChannel).toHaveBeenCalledWith(channelId);
      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'AGENT_CHANNEL_CLOSED',
          agentId: 'agent-001',
          channelId,
          chain: 'xrp',
        })
      );
    });
  });

  describe('getAgentChannels', () => {
    it('should track multiple channels per agent', async () => {
      // Setup mocks for opening multiple channels
      const mockLifecycleRecord: WalletLifecycleRecord = {
        agentId: 'agent-001',
        state: WalletState.ACTIVE,
        createdAt: Date.now() - 86400000,
        activatedAt: Date.now() - 86400000,
        lastActivity: Date.now(),
        totalTransactions: 10,
        totalVolume: {},
      };

      const mockPeerWallet: AgentWallet = {
        agentId: 'agent-002',
        derivationIndex: 1,
        evmAddress: '0x1234567890123456789012345678901234567890',
        xrpAddress: 'rN7n7otQDd6FczFgLdlqtyMVrn3HMfXEEW',
        createdAt: Date.now(),
      };

      mockLifecycleManager.getLifecycleRecord.mockResolvedValue(mockLifecycleRecord);
      mockWalletDerivation.getAgentWallet.mockResolvedValue(mockPeerWallet);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockWalletDerivation.getAgentSigner.mockResolvedValue({} as any);
      mockLifecycleManager.recordTransaction.mockResolvedValue();

      // Open 3 channels (2 EVM, 1 XRP)
      mockEvmChannelSDK.openChannel
        .mockResolvedValueOnce('0xevm-channel-1')
        .mockResolvedValueOnce('0xevm-channel-2');
      mockXrpChannelSDK.openChannel.mockResolvedValueOnce('xrp-channel-1');

      await channelManager.openChannel({
        agentId: 'agent-001',
        peerId: 'agent-002',
        chain: 'evm',
        token: 'USDC',
        amount: 1000000000000000000n,
      });

      await channelManager.openChannel({
        agentId: 'agent-001',
        peerId: 'agent-002',
        chain: 'evm',
        token: 'DAI',
        amount: 2000000000000000000n,
      });

      await channelManager.openChannel({
        agentId: 'agent-001',
        peerId: 'agent-002',
        chain: 'xrp',
        token: 'XRP',
        amount: 25000000n,
      });

      // Get all channels
      const channels = await channelManager.getAgentChannels('agent-001');

      // Verify
      expect(channels).toHaveLength(3);
      expect(channels.filter((c) => c.chain === 'evm')).toHaveLength(2);
      expect(channels.filter((c) => c.chain === 'xrp')).toHaveLength(1);
      expect(channels.every((c) => c.closedAt === undefined)).toBe(true);
    });
  });

  describe('checkChannelRebalancing', () => {
    it('should rebalance channel when balance falls below threshold', async () => {
      // Setup mocks
      const mockLifecycleRecord: WalletLifecycleRecord = {
        agentId: 'agent-001',
        state: WalletState.ACTIVE,
        createdAt: Date.now() - 86400000,
        activatedAt: Date.now() - 86400000,
        lastActivity: Date.now(),
        totalTransactions: 10,
        totalVolume: {},
      };

      const mockPeerWallet: AgentWallet = {
        agentId: 'agent-002',
        derivationIndex: 1,
        evmAddress: '0x1234567890123456789012345678901234567890',
        xrpAddress: 'rN7n7otQDd6FczFgLdlqtyMVrn3HMfXEEW',
        createdAt: Date.now(),
      };

      const channelId = '0xabc123def456789012345678901234567890123456789012345678901234567890';

      mockLifecycleManager.getLifecycleRecord.mockResolvedValue(mockLifecycleRecord);
      mockWalletDerivation.getAgentWallet.mockResolvedValue(mockPeerWallet);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockWalletDerivation.getAgentSigner.mockResolvedValue({} as any);
      mockEvmChannelSDK.openChannel
        .mockResolvedValueOnce(channelId)
        .mockResolvedValueOnce('0xnew-channel');
      mockLifecycleManager.recordTransaction.mockResolvedValue();

      // Open channel
      await channelManager.openChannel({
        agentId: 'agent-001',
        peerId: 'agent-002',
        chain: 'evm',
        token: 'USDC',
        amount: 10000000000000000000n,
      });

      // Mock channel state with low balance
      const mockChannelState: ChannelState = {
        channelId,
        participants: ['0x...', '0x...'] as [string, string],
        myDeposit: 10000000000000000000n,
        theirDeposit: 0n,
        myNonce: 10,
        theirNonce: 0,
        myTransferred: 9500000000000000000n, // 95% transferred, balance = 500000000000000000
        theirTransferred: 0n,
        status: 'opened',
        settlementTimeout: 3600,
        openedAt: Date.now(),
      };

      mockEvmChannelSDK.getChannelState.mockResolvedValueOnce(mockChannelState);
      mockEvmChannelSDK.closeChannel.mockResolvedValueOnce();

      // Execute rebalancing
      await channelManager.checkChannelRebalancing('agent-001');

      // Verify old channel closed and new channel opened
      expect(mockEvmChannelSDK.closeChannel).toHaveBeenCalledWith(
        'USDC',
        channelId,
        expect.objectContaining({
          channelId,
          nonce: 0,
          transferredAmount: 0n,
          lockedAmount: 0n,
        }),
        '0x'
      );
      expect(mockEvmChannelSDK.openChannel).toHaveBeenCalledTimes(2); // Initial + rebalance
      expect(mockEvmChannelSDK.openChannel).toHaveBeenLastCalledWith(
        mockPeerWallet.evmAddress,
        'USDC',
        3600,
        10000000000000000000n // maxChannelBalance
      );
    });

    it('should skip rebalancing if disabled in config', async () => {
      // Create channel manager with rebalancing disabled
      const channelManagerNoRebalance = new AgentChannelManager(
        mockWalletDerivation,
        mockEvmChannelSDK,
        mockXrpChannelSDK,
        mockLifecycleManager,
        mockTelemetryEmitter,
        {
          minChannelBalance: 1000000000000000000n,
          maxChannelBalance: 10000000000000000000n,
          rebalanceEnabled: false,
        },
        dbPath.replace('.db', '-no-rebalance.db')
      );

      // Execute rebalancing (should do nothing)
      await channelManagerNoRebalance.checkChannelRebalancing('agent-001');

      // Verify no SDK calls made
      expect(mockEvmChannelSDK.getChannelState).not.toHaveBeenCalled();
      expect(mockEvmChannelSDK.closeChannel).not.toHaveBeenCalled();

      // Clean up
      const dbPath2 = dbPath.replace('.db', '-no-rebalance.db');
      if (fs.existsSync(dbPath2)) {
        fs.unlinkSync(dbPath2);
      }
    });
  });

  describe('database persistence', () => {
    it('should persist channels and restore from database on restart', async () => {
      // Setup mocks
      const mockLifecycleRecord: WalletLifecycleRecord = {
        agentId: 'agent-001',
        state: WalletState.ACTIVE,
        createdAt: Date.now() - 86400000,
        activatedAt: Date.now() - 86400000,
        lastActivity: Date.now(),
        totalTransactions: 10,
        totalVolume: {},
      };

      const mockPeerWallet: AgentWallet = {
        agentId: 'agent-002',
        derivationIndex: 1,
        evmAddress: '0x1234567890123456789012345678901234567890',
        xrpAddress: 'rN7n7otQDd6FczFgLdlqtyMVrn3HMfXEEW',
        createdAt: Date.now(),
      };

      mockLifecycleManager.getLifecycleRecord.mockResolvedValue(mockLifecycleRecord);
      mockWalletDerivation.getAgentWallet.mockResolvedValue(mockPeerWallet);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockWalletDerivation.getAgentSigner.mockResolvedValue({} as any);
      mockEvmChannelSDK.openChannel
        .mockResolvedValueOnce('0xevm-channel-1')
        .mockResolvedValueOnce('0xevm-channel-2');
      mockLifecycleManager.recordTransaction.mockResolvedValue();

      // Open 2 channels
      await channelManager.openChannel({
        agentId: 'agent-001',
        peerId: 'agent-002',
        chain: 'evm',
        token: 'USDC',
        amount: 1000000000000000000n,
      });

      await channelManager.openChannel({
        agentId: 'agent-001',
        peerId: 'agent-002',
        chain: 'evm',
        token: 'DAI',
        amount: 2000000000000000000n,
      });

      // Verify channels tracked
      const channels1 = await channelManager.getAgentChannels('agent-001');
      expect(channels1).toHaveLength(2);

      // Create new channel manager instance with same database
      const channelManager2 = new AgentChannelManager(
        mockWalletDerivation,
        mockEvmChannelSDK,
        mockXrpChannelSDK,
        mockLifecycleManager,
        mockTelemetryEmitter,
        undefined,
        dbPath
      );

      // Verify channels restored from database
      const channels2 = await channelManager2.getAgentChannels('agent-001');
      expect(channels2).toHaveLength(2);
      expect(channels2[0]?.channelId).toBe('0xevm-channel-1');
      expect(channels2[1]?.channelId).toBe('0xevm-channel-2');
    });
  });
});
