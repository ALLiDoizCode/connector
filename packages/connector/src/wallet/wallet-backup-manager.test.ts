/**
 * Wallet Backup Manager Tests
 * Story 11.8: Wallet Backup and Recovery Procedures
 */

import { WalletBackupManager, WalletBackup, BackupConfig } from './wallet-backup-manager';
import { WalletSeedManager, MasterSeed } from './wallet-seed-manager';
import { AgentWalletDerivation, AgentWallet } from './agent-wallet-derivation';
import { AgentWalletLifecycle, WalletLifecycleRecord, WalletState } from './agent-wallet-lifecycle';
import { AgentBalanceTracker, AgentBalance } from './agent-balance-tracker';
import { S3Client } from '@aws-sdk/client-s3';
import { promises as fs } from 'fs';
import * as nodeCron from 'node-cron';

// Mock dependencies
jest.mock('./wallet-seed-manager');
jest.mock('./agent-wallet-derivation');
jest.mock('./agent-wallet-lifecycle');
jest.mock('./agent-balance-tracker');
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      mkdir: jest.fn(),
      writeFile: jest.fn(),
      readFile: jest.fn(),
    },
  };
});
jest.mock('@aws-sdk/client-s3');
jest.mock('node-cron', () => ({
  schedule: jest.fn(),
}));

describe('WalletBackupManager', () => {
  let backupManager: WalletBackupManager;
  let mockSeedManager: jest.Mocked<WalletSeedManager>;
  let mockWalletDerivation: jest.Mocked<AgentWalletDerivation>;
  let mockLifecycleManager: jest.Mocked<AgentWalletLifecycle>;
  let mockBalanceTracker: jest.Mocked<AgentBalanceTracker>;
  let config: BackupConfig;

  const testWallets: AgentWallet[] = [
    {
      agentId: 'agent-001',
      derivationIndex: 0,
      evmAddress: '0x1234567890123456789012345678901234567890',
      xrpAddress: 'rN7n7otQDd6FczFgLdCqvMZpimW4G9y8Zu',
      createdAt: Date.now(),
    },
    {
      agentId: 'agent-002',
      derivationIndex: 1,
      evmAddress: '0x2345678901234567890123456789012345678901',
      xrpAddress: 'rU6K7V3Po4snVhBBaU29sesqs2qTQJWDw1',
      createdAt: Date.now(),
    },
    {
      agentId: 'agent-003',
      derivationIndex: 2,
      evmAddress: '0x3456789012345678901234567890123456789012',
      xrpAddress: 'rLHzPsX6oXkz66ggHjR1VWz9KLKmvvp8Qr',
      createdAt: Date.now(),
    },
  ];

  const testLifecycleRecords: WalletLifecycleRecord[] = [
    {
      agentId: 'agent-001',
      state: WalletState.ACTIVE,
      createdAt: Date.now(),
      activatedAt: Date.now(),
      totalTransactions: 10,
      totalVolume: { ETH: BigInt('1000000000000000000') },
    },
    {
      agentId: 'agent-002',
      state: WalletState.ACTIVE,
      createdAt: Date.now(),
      activatedAt: Date.now(),
      totalTransactions: 5,
      totalVolume: { XRP: BigInt('1000000') },
    },
  ];

  const testBalances: Record<string, AgentBalance[]> = {
    'agent-001': [
      {
        agentId: 'agent-001',
        chain: 'evm',
        token: 'ETH',
        balance: BigInt('1000000000000000000'),
        lastUpdated: Date.now(),
      },
    ],
    'agent-002': [
      {
        agentId: 'agent-002',
        chain: 'xrp',
        token: 'XRP',
        balance: BigInt('1000000'),
        lastUpdated: Date.now(),
      },
    ],
  };

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock instances
    mockSeedManager = new WalletSeedManager() as jest.Mocked<WalletSeedManager>;
    mockWalletDerivation = new AgentWalletDerivation(
      mockSeedManager,
      'password'
    ) as jest.Mocked<AgentWalletDerivation>;
    mockLifecycleManager = {} as jest.Mocked<AgentWalletLifecycle>;
    mockBalanceTracker = {} as jest.Mocked<AgentBalanceTracker>;

    // Mock methods
    mockSeedManager.decryptAndLoad = jest.fn().mockResolvedValue({
      mnemonic: 'test mnemonic phrase twelve words here and more words yes indeed',
      seed: Buffer.from('test-seed'),
      createdAt: Date.now(),
    } as MasterSeed);

    mockSeedManager.exportBackup = jest.fn().mockResolvedValue({
      version: '1.0',
      createdAt: Date.now(),
      encryptedSeed: 'encrypted-seed-data',
      backupDate: Date.now(),
      checksum: 'test-checksum',
    });

    mockSeedManager.importMasterSeed = jest.fn().mockResolvedValue({
      mnemonic: 'test mnemonic phrase twelve words here and more words yes indeed',
      seed: Buffer.from('test-seed'),
      createdAt: Date.now(),
    } as MasterSeed);

    mockSeedManager.encryptAndStore = jest.fn().mockResolvedValue(undefined);

    mockSeedManager.restoreFromBackup = jest.fn().mockResolvedValue({
      mnemonic: 'test mnemonic phrase twelve words here and more words yes indeed',
      seed: Buffer.from('test-seed'),
      createdAt: Date.now(),
    } as MasterSeed);

    mockWalletDerivation.getAllWallets = jest.fn().mockReturnValue(testWallets);
    mockWalletDerivation.getWalletsModifiedSince = jest.fn().mockReturnValue([testWallets[2]]);
    mockWalletDerivation.importWallet = jest.fn().mockResolvedValue(undefined);

    mockLifecycleManager.getAllRecords = jest.fn().mockReturnValue(testLifecycleRecords);
    mockLifecycleManager.getRecordsModifiedSince = jest
      .fn()
      .mockReturnValue([testLifecycleRecords[1]]);
    mockLifecycleManager.importLifecycleRecord = jest.fn().mockResolvedValue(undefined);

    mockBalanceTracker.getAllBalances = jest
      .fn()
      .mockImplementation(async (agentId: string) => testBalances[agentId] || []);

    // Mock filesystem
    (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
    (fs.writeFile as jest.Mock).mockResolvedValue(undefined);
    (fs.readFile as jest.Mock).mockResolvedValue(
      JSON.stringify(
        {
          version: '1.0',
          timestamp: Date.now(),
          type: 'full',
          encryptedMasterSeed: 'encrypted-seed-data',
          wallets: testWallets,
          lifecycleRecords: testLifecycleRecords,
          balanceSnapshots: testBalances,
          checksum: 'valid-checksum',
        },
        (_key, value) => (typeof value === 'bigint' ? value.toString() : value)
      )
    );

    // Configuration
    config = {
      backupPath: './test-backups',
      backupPassword: 'TestP@ssw0rd12345678',
      fullBackupSchedule: '0 0 * * 0',
      incrementalBackupSchedule: '0 0 * * *',
    };

    backupManager = new WalletBackupManager(
      mockSeedManager,
      mockWalletDerivation,
      mockLifecycleManager,
      mockBalanceTracker,
      config
    );
  });

  describe('createFullBackup', () => {
    it('should create full backup with all wallet data', async () => {
      const backup = await backupManager.createFullBackup('password');

      expect(backup.version).toBe('1.0');
      expect(backup.type).toBe('full');
      expect(backup.wallets).toHaveLength(3);
      expect(backup.lifecycleRecords).toHaveLength(2);
      // Balance snapshots are fetched for all wallets, even if some return empty arrays
      expect(Object.keys(backup.balanceSnapshots)).toHaveLength(3);
      expect(backup.checksum).toBeTruthy();
    });

    it('should export encrypted master seed', async () => {
      await backupManager.createFullBackup('password');

      expect(mockSeedManager.decryptAndLoad).toHaveBeenCalledWith('password');
      expect(mockSeedManager.exportBackup).toHaveBeenCalled();
    });

    it('should export all wallets', async () => {
      await backupManager.createFullBackup('password');

      expect(mockWalletDerivation.getAllWallets).toHaveBeenCalled();
    });

    it('should export lifecycle records', async () => {
      await backupManager.createFullBackup('password');

      expect(mockLifecycleManager.getAllRecords).toHaveBeenCalled();
    });

    it('should export balance snapshots for all wallets', async () => {
      await backupManager.createFullBackup('password');

      expect(mockBalanceTracker.getAllBalances).toHaveBeenCalledWith('agent-001');
      expect(mockBalanceTracker.getAllBalances).toHaveBeenCalledWith('agent-002');
      expect(mockBalanceTracker.getAllBalances).toHaveBeenCalledWith('agent-003');
    });

    it('should calculate checksum correctly', async () => {
      const backup = await backupManager.createFullBackup('password');

      expect(backup.checksum).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex format
    });

    it('should save backup to filesystem', async () => {
      await backupManager.createFullBackup('password');

      expect(fs.mkdir).toHaveBeenCalledWith('./test-backups', { recursive: true });
      expect(fs.writeFile).toHaveBeenCalled();
    });
  });

  describe('createIncrementalBackup', () => {
    it('should create incremental backup with only changed wallets', async () => {
      // Create initial full backup
      await backupManager.createFullBackup('password');

      // Create incremental backup
      const backup = await backupManager.createIncrementalBackup('password');

      expect(backup.type).toBe('incremental');
      expect(backup.wallets).toHaveLength(1); // Only changed wallet
      expect(mockWalletDerivation.getWalletsModifiedSince).toHaveBeenCalled();
    });

    it('should include master seed in incremental backup', async () => {
      const backup = await backupManager.createIncrementalBackup('password');

      expect(backup.encryptedMasterSeed).toBe('encrypted-seed-data');
      expect(mockSeedManager.exportBackup).toHaveBeenCalled();
    });

    it('should export only changed lifecycle records', async () => {
      const backup = await backupManager.createIncrementalBackup('password');

      expect(mockLifecycleManager.getRecordsModifiedSince).toHaveBeenCalled();
      expect(backup.lifecycleRecords).toHaveLength(1);
    });
  });

  describe('restoreFromBackup', () => {
    let testBackup: WalletBackup;

    beforeEach(() => {
      testBackup = {
        version: '1.0',
        timestamp: Date.now(),
        type: 'full',
        encryptedMasterSeed: 'encrypted-seed-data',
        wallets: testWallets,
        lifecycleRecords: testLifecycleRecords,
        balanceSnapshots: testBalances,
        checksum: '',
      };
      // Calculate valid checksum
      testBackup.checksum = backupManager['calculateChecksum'](testBackup);
    });

    it('should validate backup integrity before restore', async () => {
      await backupManager.restoreFromBackup(testBackup, 'password');

      // Should not throw error for valid checksum
      expect(mockSeedManager.importMasterSeed).toHaveBeenCalled();
    });

    it('should reject backup with invalid checksum', async () => {
      testBackup.checksum = 'invalid-checksum';

      await expect(backupManager.restoreFromBackup(testBackup, 'password')).rejects.toThrow(
        'Backup checksum validation failed'
      );
    });

    it('should restore master seed', async () => {
      await backupManager.restoreFromBackup(testBackup, 'password');

      expect(mockSeedManager.importMasterSeed).toHaveBeenCalled();
      expect(mockSeedManager.encryptAndStore).toHaveBeenCalled();
    });

    it('should restore all wallets', async () => {
      await backupManager.restoreFromBackup(testBackup, 'password');

      expect(mockWalletDerivation.importWallet).toHaveBeenCalledTimes(3);
      expect(mockWalletDerivation.importWallet).toHaveBeenCalledWith(testWallets[0]);
      expect(mockWalletDerivation.importWallet).toHaveBeenCalledWith(testWallets[1]);
      expect(mockWalletDerivation.importWallet).toHaveBeenCalledWith(testWallets[2]);
    });

    it('should restore lifecycle records', async () => {
      await backupManager.restoreFromBackup(testBackup, 'password');

      expect(mockLifecycleManager.importLifecycleRecord).toHaveBeenCalledTimes(2);
      expect(mockLifecycleManager.importLifecycleRecord).toHaveBeenCalledWith(
        testLifecycleRecords[0]
      );
      expect(mockLifecycleManager.importLifecycleRecord).toHaveBeenCalledWith(
        testLifecycleRecords[1]
      );
    });

    it('should trigger balance reconciliation', async () => {
      await backupManager.restoreFromBackup(testBackup, 'password');

      expect(mockBalanceTracker.getAllBalances).toHaveBeenCalled();
    });
  });

  describe('S3 upload', () => {
    beforeEach(() => {
      config.s3Bucket = 'test-bucket';
      config.s3Region = 'us-east-1';
      config.s3AccessKeyId = 'test-key';
      config.s3SecretAccessKey = 'test-secret';

      backupManager = new WalletBackupManager(
        mockSeedManager,
        mockWalletDerivation,
        mockLifecycleManager,
        mockBalanceTracker,
        config
      );
    });

    it('should upload backup to S3 when configured', async () => {
      const mockSend = jest.fn().mockResolvedValue({});
      (S3Client as jest.Mock).mockImplementation(() => ({
        send: mockSend,
      }));

      await backupManager.createFullBackup('password');

      expect(mockSend).toHaveBeenCalled();
    });

    it('should not fail if S3 upload fails', async () => {
      const mockSend = jest.fn().mockRejectedValue(new Error('S3 error'));
      (S3Client as jest.Mock).mockImplementation(() => ({
        send: mockSend,
      }));

      // Should not throw - local backup still succeeds
      await expect(backupManager.createFullBackup('password')).resolves.toBeDefined();
    });
  });

  describe('loadBackupFromFile', () => {
    it('should load backup from file', async () => {
      const backup = await backupManager.loadBackupFromFile('./test-backup.json');

      expect(fs.readFile).toHaveBeenCalledWith('./test-backup.json', 'utf-8');
      expect(backup.version).toBe('1.0');
      expect(backup.wallets).toHaveLength(3);
    });

    it('should reject invalid backup structure', async () => {
      (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify({ invalid: 'structure' }));

      await expect(backupManager.loadBackupFromFile('./test-backup.json')).rejects.toThrow(
        'Invalid backup file structure'
      );
    });
  });

  describe('balance reconciliation', () => {
    it('should detect balance mismatches', async () => {
      const testBackup: WalletBackup = {
        version: '1.0',
        timestamp: Date.now(),
        type: 'full',
        encryptedMasterSeed: 'encrypted-seed-data',
        wallets: testWallets,
        lifecycleRecords: testLifecycleRecords,
        balanceSnapshots: {
          'agent-001': [
            {
              agentId: 'agent-001',
              chain: 'evm',
              token: 'ETH',
              balance: BigInt('2000000000000000000'), // Different balance
              lastUpdated: Date.now(),
            },
          ],
        },
        checksum: '',
      };
      testBackup.checksum = backupManager['calculateChecksum'](testBackup);

      // Should not throw - just log warnings
      await expect(
        backupManager.restoreFromBackup(testBackup, 'password')
      ).resolves.toBeUndefined();
    });
  });

  describe('automated scheduling', () => {
    it('should schedule full and incremental backups', () => {
      expect(nodeCron.schedule).toHaveBeenCalledTimes(2);
      expect(nodeCron.schedule).toHaveBeenCalledWith(
        config.fullBackupSchedule,
        expect.any(Function)
      );
      expect(nodeCron.schedule).toHaveBeenCalledWith(
        config.incrementalBackupSchedule,
        expect.any(Function)
      );
    });
  });
});
