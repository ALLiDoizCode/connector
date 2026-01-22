import { KeyManager, KeyManagerConfig } from './key-manager';
import { EnvironmentVariableBackend } from './backends/environment-backend';
import pino from 'pino';

// Mock the backend modules
jest.mock('./backends/environment-backend');
jest.mock('./backends/aws-kms-backend', () => ({
  AWSKMSBackend: jest.fn(),
}));
jest.mock('./backends/gcp-kms-backend', () => ({
  GCPKMSBackend: jest.fn(),
}));
jest.mock('./backends/azure-kv-backend', () => ({
  AzureKeyVaultBackend: jest.fn(),
}));
jest.mock('./backends/hsm-backend', () => ({
  HSMBackend: jest.fn(),
}));

describe('KeyManager', () => {
  let logger: pino.Logger;
  let mockBackend: jest.Mocked<EnvironmentVariableBackend>;

  beforeEach(() => {
    logger = pino({ level: 'silent' });
    jest.clearAllMocks();

    // Create mock backend
    mockBackend = {
      sign: jest.fn(),
      getPublicKey: jest.fn(),
      rotateKey: jest.fn(),
    } as any;

    // Mock the EnvironmentVariableBackend constructor
    (EnvironmentVariableBackend as jest.Mock).mockImplementation(() => mockBackend);
  });

  describe('Backend Selection', () => {
    it('should select EnvironmentVariableBackend when backend=env', () => {
      const config: KeyManagerConfig = {
        backend: 'env',
        nodeId: 'test-node',
      };

      new KeyManager(config, logger);

      expect(EnvironmentVariableBackend).toHaveBeenCalledWith(expect.any(Object));
    });

    it('should select AWSKMSBackend when backend=aws-kms', () => {
      const { AWSKMSBackend } = require('./backends/aws-kms-backend');

      const config: KeyManagerConfig = {
        backend: 'aws-kms',
        nodeId: 'test-node',
        aws: {
          region: 'us-east-1',
          evmKeyId: 'arn:aws:kms:us-east-1:123456789012:key/evm-key',
          xrpKeyId: 'arn:aws:kms:us-east-1:123456789012:key/xrp-key',
        },
      };

      new KeyManager(config, logger);

      expect(AWSKMSBackend).toHaveBeenCalledWith(config.aws, expect.any(Object));
    });

    it('should select GCPKMSBackend when backend=gcp-kms', () => {
      const { GCPKMSBackend } = require('./backends/gcp-kms-backend');

      const config: KeyManagerConfig = {
        backend: 'gcp-kms',
        nodeId: 'test-node',
        gcp: {
          projectId: 'test-project',
          locationId: 'us-east1',
          keyRingId: 'test-keyring',
          evmKeyId: 'evm-key',
          xrpKeyId: 'xrp-key',
        },
      };

      new KeyManager(config, logger);

      expect(GCPKMSBackend).toHaveBeenCalledWith(config.gcp, expect.any(Object));
    });

    it('should select AzureKeyVaultBackend when backend=azure-kv', () => {
      const { AzureKeyVaultBackend } = require('./backends/azure-kv-backend');

      const config: KeyManagerConfig = {
        backend: 'azure-kv',
        nodeId: 'test-node',
        azure: {
          vaultUrl: 'https://test-vault.vault.azure.net/',
          evmKeyName: 'evm-key',
          xrpKeyName: 'xrp-key',
        },
      };

      new KeyManager(config, logger);

      expect(AzureKeyVaultBackend).toHaveBeenCalledWith(config.azure, expect.any(Object));
    });

    it('should select HSMBackend when backend=hsm', () => {
      const { HSMBackend } = require('./backends/hsm-backend');

      const config: KeyManagerConfig = {
        backend: 'hsm',
        nodeId: 'test-node',
        hsm: {
          pkcs11LibraryPath: '/usr/lib/softhsm/libsofthsm2.so',
          slotId: 0,
          pin: '1234',
          evmKeyLabel: 'evm-key',
          xrpKeyLabel: 'xrp-key',
        },
      };

      new KeyManager(config, logger);

      expect(HSMBackend).toHaveBeenCalledWith(config.hsm, expect.any(Object));
    });

    it('should throw error for unknown backend type', () => {
      const config: KeyManagerConfig = {
        backend: 'invalid' as any,
        nodeId: 'test-node',
      };

      expect(() => new KeyManager(config, logger)).toThrow('Unknown backend type: invalid');
    });

    it('should throw error if AWS config missing for aws-kms backend', () => {
      const config: KeyManagerConfig = {
        backend: 'aws-kms',
        nodeId: 'test-node',
      };

      expect(() => new KeyManager(config, logger)).toThrow(
        'AWS configuration required for aws-kms backend'
      );
    });

    it('should throw error if GCP config missing for gcp-kms backend', () => {
      const config: KeyManagerConfig = {
        backend: 'gcp-kms',
        nodeId: 'test-node',
      };

      expect(() => new KeyManager(config, logger)).toThrow(
        'GCP configuration required for gcp-kms backend'
      );
    });

    it('should throw error if Azure config missing for azure-kv backend', () => {
      const config: KeyManagerConfig = {
        backend: 'azure-kv',
        nodeId: 'test-node',
      };

      expect(() => new KeyManager(config, logger)).toThrow(
        'Azure configuration required for azure-kv backend'
      );
    });

    it('should throw error if HSM config missing for hsm backend', () => {
      const config: KeyManagerConfig = {
        backend: 'hsm',
        nodeId: 'test-node',
      };

      expect(() => new KeyManager(config, logger)).toThrow(
        'HSM configuration required for hsm backend'
      );
    });
  });

  describe('sign()', () => {
    let keyManager: KeyManager;

    beforeEach(() => {
      const config: KeyManagerConfig = {
        backend: 'env',
        nodeId: 'test-node',
      };
      keyManager = new KeyManager(config, logger);
    });

    it('should delegate sign() to backend', async () => {
      const testMessage = Buffer.from('test-message');
      const testSignature = Buffer.from('test-signature');
      mockBackend.sign.mockResolvedValue(testSignature);

      const result = await keyManager.sign(testMessage, 'evm-key');

      expect(mockBackend.sign).toHaveBeenCalledWith(testMessage, 'evm-key');
      expect(result).toBe(testSignature);
    });

    it('should return signature buffer from backend', async () => {
      const testMessage = Buffer.from('test-message');
      const testSignature = Buffer.from('signature-bytes-here');
      mockBackend.sign.mockResolvedValue(testSignature);

      const result = await keyManager.sign(testMessage, 'evm-key');

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result).toEqual(testSignature);
    });

    it('should throw error if backend.sign() fails', async () => {
      const testMessage = Buffer.from('test-message');
      const testError = new Error('Signing failed');
      mockBackend.sign.mockRejectedValue(testError);

      await expect(keyManager.sign(testMessage, 'evm-key')).rejects.toThrow('Signing failed');
    });
  });

  describe('getPublicKey()', () => {
    let keyManager: KeyManager;

    beforeEach(() => {
      const config: KeyManagerConfig = {
        backend: 'env',
        nodeId: 'test-node',
      };
      keyManager = new KeyManager(config, logger);
    });

    it('should delegate getPublicKey() to backend', async () => {
      const testPublicKey = Buffer.from('test-public-key');
      mockBackend.getPublicKey.mockResolvedValue(testPublicKey);

      const result = await keyManager.getPublicKey('evm-key');

      expect(mockBackend.getPublicKey).toHaveBeenCalledWith('evm-key');
      expect(result).toBe(testPublicKey);
    });

    it('should return public key buffer from backend', async () => {
      const testPublicKey = Buffer.from('public-key-bytes-here');
      mockBackend.getPublicKey.mockResolvedValue(testPublicKey);

      const result = await keyManager.getPublicKey('evm-key');

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result).toEqual(testPublicKey);
    });

    it('should throw error if key not found', async () => {
      const testError = new Error('Key not found');
      mockBackend.getPublicKey.mockRejectedValue(testError);

      await expect(keyManager.getPublicKey('invalid-key')).rejects.toThrow('Key not found');
    });
  });

  describe('rotateKey()', () => {
    let keyManager: KeyManager;

    beforeEach(() => {
      const config: KeyManagerConfig = {
        backend: 'env',
        nodeId: 'test-node',
      };
      keyManager = new KeyManager(config, logger);
    });

    it('should initiate key rotation via backend.rotateKey()', async () => {
      const newKeyId = 'new-key-id';
      mockBackend.rotateKey.mockResolvedValue(newKeyId);

      const result = await keyManager.rotateKey('old-key-id');

      expect(mockBackend.rotateKey).toHaveBeenCalledWith('old-key-id');
      expect(result).toBe(newKeyId);
    });

    it('should return new key ID from backend', async () => {
      const newKeyId = 'arn:aws:kms:us-east-1:123456789012:key/new-key';
      mockBackend.rotateKey.mockResolvedValue(newKeyId);

      const result = await keyManager.rotateKey('old-key-id');

      expect(result).toBe(newKeyId);
    });
  });
});
