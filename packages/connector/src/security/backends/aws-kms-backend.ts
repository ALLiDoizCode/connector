import { Logger } from 'pino';
import type {
  KMSClient as KMSClientType,
  SigningAlgorithmSpec as SigningAlgorithmSpecType,
  KeySpec as KeySpecType,
} from '@aws-sdk/client-kms';
import { KeyManagerBackend, AWSConfig } from '../key-manager';
import { requireOptional } from '../../utils/optional-require';

/**
 * AWSKMSBackend implements KeyManagerBackend using AWS Key Management Service
 * Supports EVM (secp256k1) and XRP (ed25519) key types
 */
export class AWSKMSBackend implements KeyManagerBackend {
  private client: KMSClientType | null = null;
  private awsSdk: typeof import('@aws-sdk/client-kms') | null = null;
  private config: AWSConfig;
  private logger: Logger;

  constructor(config: AWSConfig, logger: Logger) {
    this.config = config;
    this.logger = logger.child({ component: 'AWSKMSBackend' });

    this.logger.info(
      { region: config.region, evmKeyId: config.evmKeyId, xrpKeyId: config.xrpKeyId },
      'AWSKMSBackend initialized'
    );
  }

  /**
   * Lazily loads the AWS SDK and initializes the KMS client
   */
  private async _getClient(): Promise<KMSClientType> {
    if (!this.client) {
      this.awsSdk = await requireOptional<typeof import('@aws-sdk/client-kms')>(
        '@aws-sdk/client-kms',
        'AWS KMS key management'
      );
      this.client = new this.awsSdk.KMSClient({
        region: this.config.region,
        credentials: this.config.credentials,
      });
    }
    return this.client;
  }

  /**
   * Lazily loads the AWS SDK module
   */
  private async _getSdk(): Promise<typeof import('@aws-sdk/client-kms')> {
    if (!this.awsSdk) {
      this.awsSdk = await requireOptional<typeof import('@aws-sdk/client-kms')>(
        '@aws-sdk/client-kms',
        'AWS KMS key management'
      );
    }
    return this.awsSdk;
  }

  /**
   * Detects key type based on keyId
   * @param keyId - Key identifier (ARN or alias)
   * @returns Key type ('evm' or 'xrp')
   */
  private _detectKeyType(keyId: string): 'evm' | 'xrp' {
    const lowerKeyId = keyId.toLowerCase();
    if (lowerKeyId.includes('evm') || keyId === this.config.evmKeyId) {
      return 'evm';
    }
    if (lowerKeyId.includes('xrp') || keyId === this.config.xrpKeyId) {
      return 'xrp';
    }
    // Default to EVM
    return 'evm';
  }

  /**
   * Gets the appropriate signing algorithm based on key type
   * @param keyType - Key type ('evm' or 'xrp')
   * @returns AWS KMS signing algorithm
   */
  private async _getSigningAlgorithm(keyType: 'evm' | 'xrp'): Promise<SigningAlgorithmSpecType> {
    const sdk = await this._getSdk();
    if (keyType === 'evm') {
      return sdk.SigningAlgorithmSpec.ECDSA_SHA_256;
    } else {
      // XRP uses ed25519 - ED25519_SHA_512 for RAW message signing
      return sdk.SigningAlgorithmSpec.ED25519_SHA_512;
    }
  }

  /**
   * Gets the appropriate key spec for key creation
   * @param keyType - Key type ('evm' | 'xrp')
   * @returns AWS KMS key spec
   */
  private async _getKeySpec(keyType: 'evm' | 'xrp'): Promise<KeySpecType> {
    const sdk = await this._getSdk();
    if (keyType === 'evm') {
      return sdk.KeySpec.ECC_SECG_P256K1; // secp256k1 for EVM
    } else {
      return sdk.KeySpec.ECC_NIST_EDWARDS25519; // ed25519 for XRP
    }
  }

  /**
   * Signs a message using AWS KMS
   * @param message - Message to sign
   * @param keyId - AWS KMS key ID or ARN
   * @returns Signature buffer
   */
  async sign(message: Buffer, keyId: string): Promise<Buffer> {
    const keyType = this._detectKeyType(keyId);
    const signingAlgorithm = await this._getSigningAlgorithm(keyType);
    const sdk = await this._getSdk();
    const client = await this._getClient();

    this.logger.debug({ keyId, keyType, signingAlgorithm }, 'Signing with AWS KMS');

    try {
      const command = new sdk.SignCommand({
        KeyId: keyId,
        Message: message,
        SigningAlgorithm: signingAlgorithm,
        MessageType: 'RAW', // Sign raw message (not digest)
      });

      const response = await client.send(command);

      if (!response.Signature) {
        throw new Error('AWS KMS returned no signature');
      }

      const signature = Buffer.from(response.Signature);
      this.logger.info({ keyId, signatureLength: signature.length }, 'AWS KMS signature generated');

      return signature;
    } catch (error) {
      this.logger.error({ keyId, error }, 'AWS KMS signing failed');
      throw error;
    }
  }

  /**
   * Retrieves public key from AWS KMS
   * @param keyId - AWS KMS key ID or ARN
   * @returns Public key buffer
   */
  async getPublicKey(keyId: string): Promise<Buffer> {
    this.logger.debug({ keyId }, 'Retrieving public key from AWS KMS');
    const sdk = await this._getSdk();
    const client = await this._getClient();

    try {
      const command = new sdk.GetPublicKeyCommand({
        KeyId: keyId,
      });

      const response = await client.send(command);

      if (!response.PublicKey) {
        throw new Error('AWS KMS returned no public key');
      }

      const publicKey = Buffer.from(response.PublicKey);
      this.logger.info(
        { keyId, publicKeyLength: publicKey.length },
        'AWS KMS public key retrieved'
      );

      return publicKey;
    } catch (error) {
      this.logger.error({ keyId, error }, 'AWS KMS public key retrieval failed');
      throw error;
    }
  }

  /**
   * Creates a new AWS KMS key for rotation
   * @param keyId - Current key ID (used to determine key type)
   * @returns New key ID (ARN)
   */
  async rotateKey(keyId: string): Promise<string> {
    const keyType = this._detectKeyType(keyId);
    const keySpec = await this._getKeySpec(keyType);
    const sdk = await this._getSdk();
    const client = await this._getClient();

    this.logger.info(
      { oldKeyId: keyId, keyType, keySpec },
      'Creating new AWS KMS key for rotation'
    );

    try {
      const command = new sdk.CreateKeyCommand({
        KeyUsage: sdk.KeyUsageType.SIGN_VERIFY,
        KeySpec: keySpec,
        Description: `Rotated ${keyType.toUpperCase()} key from ${keyId}`,
        Tags: [
          {
            TagKey: 'Purpose',
            TagValue: 'ILP-Connector-Settlement',
          },
          {
            TagKey: 'KeyType',
            TagValue: keyType.toUpperCase(),
          },
          {
            TagKey: 'RotatedFrom',
            TagValue: keyId,
          },
        ],
      });

      const response = await client.send(command);

      if (!response.KeyMetadata?.Arn) {
        throw new Error('AWS KMS returned no key ARN');
      }

      const newKeyId = response.KeyMetadata.Arn;
      this.logger.info({ oldKeyId: keyId, newKeyId }, 'AWS KMS key rotation completed');

      return newKeyId;
    } catch (error) {
      this.logger.error({ keyId, error }, 'AWS KMS key rotation failed');
      throw error;
    }
  }
}
