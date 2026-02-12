/**
 * KeyManagerSigner - Ethers.js Signer implementation backed by KeyManager
 *
 * This class wraps KeyManager to provide an ethers.Signer interface,
 * allowing KeyManager to be used with ethers.js contracts and transactions
 * while keeping private keys secure in HSM/KMS backends.
 *
 * Story: 12.2 Task 4 - PaymentChannelSDK KeyManager Integration
 */

import type { KeyManager } from './key-manager';
import type {
  Provider,
  TransactionRequest,
  Signer,
  TypedDataDomain,
  TypedDataField,
  TransactionResponse,
} from 'ethers';
import { requireOptional } from '../utils/optional-require';

/**
 * Interface matching the KeyManagerSigner public API.
 * Consumers should use this type rather than the concrete class (which is lazily defined).
 */
export interface IKeyManagerSigner extends Signer {
  getAddress(): Promise<string>;
  signTransaction(transaction: TransactionRequest): Promise<string>;
  sendTransaction(transaction: TransactionRequest): Promise<TransactionResponse>;
  signMessage(message: string | Uint8Array): Promise<string>;
  signTypedData(
    domain: TypedDataDomain,
    types: Record<string, TypedDataField[]>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    value: Record<string, any>
  ): Promise<string>;
  connect(provider: Provider): IKeyManagerSigner;
}

/**
 * Create a KeyManagerSigner instance.
 * Dynamically imports ethers to avoid top-level dependency.
 *
 * @param keyManager - KeyManager for secure key operations
 * @param evmKeyId - EVM key identifier for KeyManager
 * @param provider - Optional ethers Provider
 * @returns KeyManagerSigner instance (ethers.AbstractSigner subclass)
 */
export async function createKeyManagerSigner(
  keyManager: KeyManager,
  evmKeyId: string,
  provider?: Provider
): Promise<IKeyManagerSigner> {
  const { ethers } = await requireOptional<typeof import('ethers')>('ethers', 'EVM settlement');

  class KeyManagerSignerImpl extends ethers.AbstractSigner {
    private keyManager: KeyManager;
    private evmKeyId: string;
    private _cachedAddress: string | null = null;

    constructor(km: KeyManager, keyId: string, p?: Provider) {
      super(p);
      this.keyManager = km;
      this.evmKeyId = keyId;
    }

    /**
     * Get the signer's address
     * Derives address from public key
     */
    async getAddress(): Promise<string> {
      if (this._cachedAddress) {
        return this._cachedAddress;
      }

      // Get public key from KeyManager
      const publicKeyBuffer = await this.keyManager.getPublicKey(this.evmKeyId);

      // For secp256k1 (EVM), derive address from public key
      // Public key format: 04 + x (32 bytes) + y (32 bytes) = 65 bytes uncompressed
      // Address = keccak256(pubkey)[12:]
      const publicKeyHex = '0x' + publicKeyBuffer.toString('hex');

      // Remove '04' prefix if present (uncompressed public key marker)
      const pubKeyWithoutPrefix = publicKeyHex.startsWith('0x04')
        ? '0x' + publicKeyHex.slice(4)
        : publicKeyHex;

      // Hash the public key and take last 20 bytes
      const addressHash = ethers.keccak256(pubKeyWithoutPrefix);
      this._cachedAddress = ethers.getAddress('0x' + addressHash.slice(-40));

      return this._cachedAddress;
    }

    /**
     * Sign a transaction
     * Creates transaction hash and signs with KeyManager
     */
    async signTransaction(transaction: TransactionRequest): Promise<string> {
      // Resolve all promises/address-like values in the transaction
      const resolved = await ethers.resolveProperties(transaction);

      // Create transaction object from resolved properties
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = ethers.Transaction.from(resolved as any);

      // Get the digest to sign (keccak256 hash of RLP-encoded unsigned transaction)
      const digest = tx.unsignedHash;

      // Sign with KeyManager
      const signatureBuffer = await this.keyManager.sign(
        Buffer.from(digest.slice(2), 'hex'),
        this.evmKeyId
      );

      // Convert signature Buffer to ethers Signature format
      const signature = ethers.Signature.from('0x' + signatureBuffer.toString('hex'));

      // Set signature on transaction
      tx.signature = signature;

      // Return serialized signed transaction
      return tx.serialized;
    }

    /**
     * Send a transaction to the network
     * Populates EIP-1559 transaction fields and broadcasts to the network
     */
    async sendTransaction(transaction: TransactionRequest): Promise<TransactionResponse> {
      // 1. Get provider (required for sending)
      const provider = this.provider;
      if (!provider) {
        throw new Error('Provider required to send transaction');
      }

      // 2. Get signer address
      const from = await this.getAddress();

      // 3. Get network info for chainId
      const network = await provider.getNetwork();
      const chainId = Number(network.chainId);

      // 4. Get fee data for EIP-1559
      const feeData = await provider.getFeeData();
      if (!feeData.maxFeePerGas || !feeData.maxPriorityFeePerGas) {
        throw new Error('Unable to retrieve EIP-1559 fee data from provider');
      }

      // 5. Populate transaction fields (excluding 'from' - derived from signature)
      const populatedTx = await ethers.resolveProperties({
        to: transaction.to,
        // DO NOT include 'from' - ethers.Transaction.from() rejects unsigned tx with 'from'
        nonce:
          transaction.nonce !== undefined
            ? transaction.nonce
            : await provider.getTransactionCount(from, 'pending'),
        gasLimit:
          transaction.gasLimit !== undefined
            ? transaction.gasLimit
            : await provider.estimateGas({
                ...transaction,
                from: from,
              }),
        data: transaction.data ?? '0x',
        value: transaction.value ?? 0,
        chainId: transaction.chainId ?? chainId,
        type: 2, // EIP-1559
        maxFeePerGas: transaction.maxFeePerGas ?? feeData.maxFeePerGas,
        maxPriorityFeePerGas: transaction.maxPriorityFeePerGas ?? feeData.maxPriorityFeePerGas,
      });

      // 6. Sign transaction using KeyManager
      const signedTx = await this.signTransaction(populatedTx);

      // 7. Broadcast signed transaction to network
      const txResponse = await provider.broadcastTransaction(signedTx);

      return txResponse;
    }

    /**
     * Sign a message
     * Signs arbitrary data with KeyManager
     */
    async signMessage(message: string | Uint8Array): Promise<string> {
      // Convert message to bytes
      const messageBytes = typeof message === 'string' ? ethers.toUtf8Bytes(message) : message;

      // Ethers prepends "\x19Ethereum Signed Message:\n" + length to messages
      const messageHash = ethers.hashMessage(messageBytes);

      // Sign the hash with KeyManager
      const signatureBuffer = await this.keyManager.sign(
        Buffer.from(messageHash.slice(2), 'hex'),
        this.evmKeyId
      );

      // Convert to ethers signature format (hex string)
      return '0x' + signatureBuffer.toString('hex');
    }

    /**
     * Sign typed data (EIP-712)
     * Used for balance proofs and other structured data signing
     */
    async signTypedData(
      domain: TypedDataDomain,
      types: Record<string, TypedDataField[]>,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      value: Record<string, any>
    ): Promise<string> {
      // Create EIP-712 hash
      const hash = ethers.TypedDataEncoder.hash(domain, types, value);

      // Sign the hash with KeyManager
      const signatureBuffer = await this.keyManager.sign(
        Buffer.from(hash.slice(2), 'hex'),
        this.evmKeyId
      );

      // Convert to ethers signature format (hex string)
      return '0x' + signatureBuffer.toString('hex');
    }

    /**
     * Connect signer to a provider
     */
    connect(provider: Provider): KeyManagerSignerImpl {
      return new KeyManagerSignerImpl(this.keyManager, this.evmKeyId, provider);
    }
  }

  return new KeyManagerSignerImpl(keyManager, evmKeyId, provider);
}

/**
 * @deprecated Use createKeyManagerSigner() factory function instead.
 * This export is kept for backward compatibility but requires ethers at import time.
 * Re-exported as a lazy proxy - actual class is created on first instantiation.
 */
export const KeyManagerSigner = null as unknown as {
  new (keyManager: KeyManager, evmKeyId: string, provider?: Provider): IKeyManagerSigner;
};
