import { Logger } from 'pino';
import type { Wallet } from 'ethers';
import type { Wallet as XrplWallet } from 'xrpl';
import { KeyManagerBackend } from '../key-manager';
import { requireOptional } from '../../utils/optional-require';

/**
 * EnvironmentVariableBackend implements KeyManagerBackend using private keys from environment variables
 * For development and testing only - not suitable for production use
 */
export class EnvironmentVariableBackend implements KeyManagerBackend {
  private evmWallet?: Wallet;
  private evmPrivateKey?: string;
  private xrpWallet?: XrplWallet;
  private xrpSeed?: string;
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.child({ component: 'EnvironmentVariableBackend' });

    // Store EVM private key for lazy wallet initialization (deferred until first use)
    const evmPrivateKey = process.env.EVM_PRIVATE_KEY;
    if (evmPrivateKey) {
      this.evmPrivateKey = evmPrivateKey;
      this.logger.info('EVM private key found in environment (wallet initialization deferred)');
    }

    // Store XRP seed for lazy wallet initialization (deferred until first use)
    const xrpSeed = process.env.XRP_SEED;
    if (xrpSeed) {
      this.xrpSeed = xrpSeed;
      this.logger.info('XRP seed found in environment (wallet initialization deferred)');
    }

    if (!this.evmPrivateKey && !this.xrpSeed) {
      this.logger.warn('No keys loaded from environment (EVM_PRIVATE_KEY or XRP_SEED)');
    }
  }

  /**
   * Lazily initialize EVM wallet on first use (avoids top-level ethers import)
   */
  private async _ensureEvmWallet(): Promise<Wallet> {
    if (this.evmWallet) {
      return this.evmWallet;
    }
    if (!this.evmPrivateKey) {
      throw new Error('EVM wallet not initialized. Set EVM_PRIVATE_KEY environment variable.');
    }
    try {
      const { Wallet } = await requireOptional<typeof import('ethers')>('ethers', 'EVM settlement');
      this.evmWallet = new Wallet(this.evmPrivateKey);
      this.logger.info({ address: this.evmWallet.address }, 'EVM wallet loaded from environment');
      return this.evmWallet;
    } catch (error) {
      if (error instanceof Error && error.message.includes('is required for')) {
        throw error; // Re-throw requireOptional errors as-is
      }
      this.logger.error({ error }, 'Failed to load EVM private key');
      throw new Error('Invalid EVM_PRIVATE_KEY in environment');
    }
  }

  /**
   * Lazily initialize XRP wallet on first use (avoids top-level xrpl import)
   */
  private async _ensureXrpWallet(): Promise<XrplWallet> {
    if (this.xrpWallet) {
      return this.xrpWallet;
    }
    if (!this.xrpSeed) {
      throw new Error('XRP wallet not initialized. Set XRP_SEED environment variable.');
    }
    try {
      const { Wallet: XWallet } = await requireOptional<typeof import('xrpl')>(
        'xrpl',
        'XRP settlement'
      );
      this.xrpWallet = XWallet.fromSeed(this.xrpSeed);
      this.logger.info({ address: this.xrpWallet.address }, 'XRP wallet loaded from environment');
      return this.xrpWallet;
    } catch (error) {
      if (error instanceof Error && error.message.includes('is required for')) {
        throw error; // Re-throw requireOptional errors as-is
      }
      this.logger.error({ error }, 'Failed to load XRP seed');
      throw new Error('Invalid XRP_SEED in environment');
    }
  }

  /**
   * Detects key type based on keyId
   * @param keyId - Key identifier containing 'evm' or 'xrp'
   * @returns Key type ('evm' or 'xrp')
   */
  private _detectKeyType(keyId: string): 'evm' | 'xrp' {
    const lowerKeyId = keyId.toLowerCase();
    if (lowerKeyId.includes('evm')) {
      return 'evm';
    }
    if (lowerKeyId.includes('xrp')) {
      return 'xrp';
    }
    // Default to EVM if no identifier found
    return 'evm';
  }

  /**
   * Signs a message using the appropriate wallet (EVM or XRP)
   * @param message - Message to sign
   * @param keyId - Key identifier (contains 'evm' or 'xrp')
   * @returns Signature buffer
   */
  async sign(message: Buffer, keyId: string): Promise<Buffer> {
    const keyType = this._detectKeyType(keyId);

    if (keyType === 'evm') {
      const evmWallet = await this._ensureEvmWallet();

      // Sign raw message hash using signingKey.sign() (NOT signMessage which adds EIP-191 prefix)
      // This is used for signing transaction hashes where we need raw ECDSA signature
      const signature = evmWallet.signingKey.sign(message);
      // Return concatenated r || s || v (65 bytes)
      return Buffer.from(signature.serialized.slice(2), 'hex'); // Remove '0x' prefix
    } else {
      const xrpWallet = await this._ensureXrpWallet();

      // Sign message using ed25519 (for XRP payment channel claims)
      // The message is expected to be the raw bytes to sign (already encoded by caller)
      const { sign } = await requireOptional<typeof import('ripple-keypairs')>(
        'ripple-keypairs',
        'XRP settlement'
      );
      const signature = sign(message.toString('hex').toUpperCase(), xrpWallet.privateKey);
      return Buffer.from(signature, 'hex');
    }
  }

  /**
   * Retrieves public key derived from private key
   * @param keyId - Key identifier (contains 'evm' or 'xrp')
   * @returns Public key buffer
   */
  async getPublicKey(keyId: string): Promise<Buffer> {
    const keyType = this._detectKeyType(keyId);

    if (keyType === 'evm') {
      const evmWallet = await this._ensureEvmWallet();

      // Get public key from wallet (compressed secp256k1 format)
      const publicKey = evmWallet.signingKey.publicKey;
      return Buffer.from(publicKey.slice(2), 'hex'); // Remove '0x' prefix
    } else {
      const xrpWallet = await this._ensureXrpWallet();

      // Get public key from XRP wallet
      // XRP wallet publicKey is hex string with 'ED' prefix (66 chars)
      // Remove 'ED' prefix and convert remaining 64 hex chars to 32-byte buffer
      const publicKeyHex = xrpWallet.publicKey.slice(2); // Remove 'ED' prefix
      return Buffer.from(publicKeyHex, 'hex');
    }
  }

  /**
   * Key rotation not supported for environment variable backend
   * Manual rotation required (update environment variables and restart)
   * @param keyId - Key identifier
   * @throws Error indicating manual rotation required
   */
  async rotateKey(_keyId: string): Promise<string> {
    throw new Error(
      'Manual rotation required for environment backend. Update EVM_PRIVATE_KEY or XRP_SEED and restart the connector.'
    );
  }
}
