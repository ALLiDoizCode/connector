import type { Wallet, Provider } from 'ethers';
import type { Client as XRPLClient, Wallet as XRPLWallet, Payment } from 'xrpl';
import pino from 'pino';
import { requireOptional } from '../utils/optional-require';

const logger = pino({ name: 'treasury-wallet' });

/**
 * ERC20 ABI for transfer function only
 */
const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
];

/**
 * Transaction result interface
 */
export interface Transaction {
  hash: string;
  to: string;
  value?: string;
}

/**
 * TreasuryWallet manages the platform's treasury for funding agent wallets.
 *
 * Handles:
 * - ETH transfers for EVM gas
 * - ERC20 token transfers for platform tokens
 * - XRP transfers for XRP Ledger accounts
 *
 * Security: Private keys loaded from environment variables only.
 * NEVER stores or logs private keys.
 */
export class TreasuryWallet {
  private evmWallet: Wallet | null = null;
  private xrpWallet!: XRPLWallet;
  private evmProvider: Provider;
  private xrplClient: XRPLClient;
  public evmAddress: string = '';
  public xrpAddress!: string;
  private noncePromise: Promise<number> | null = null;
  private evmPrivateKey: string;
  private xrpPrivateKey: string;
  private xrpInitialized: boolean = false;

  /**
   * Creates a new TreasuryWallet instance
   *
   * @param evmPrivateKey - EVM private key (hex string with 0x prefix)
   * @param xrpPrivateKey - XRP private key (secret string starting with 's')
   * @param evmProvider - Ethers provider for EVM blockchain
   * @param xrplClient - XRPL client for XRP Ledger
   */
  constructor(
    evmPrivateKey: string,
    xrpPrivateKey: string,
    evmProvider: Provider,
    xrplClient: XRPLClient
  ) {
    // Validate private keys are present
    if (!evmPrivateKey || !xrpPrivateKey) {
      throw new Error('Treasury private keys are required');
    }

    // Store private keys for lazy wallet initialization
    this.evmPrivateKey = evmPrivateKey;
    this.xrpPrivateKey = xrpPrivateKey;
    this.evmProvider = evmProvider;
    this.xrplClient = xrplClient;

    logger.info('Treasury wallet config stored (wallet initialization deferred)');
  }

  /**
   * Lazily initialize the EVM wallet via dynamic import of ethers.
   */
  private async ensureEvmInitialized(): Promise<Wallet> {
    if (this.evmWallet) return this.evmWallet;

    try {
      const { ethers } = await requireOptional<typeof import('ethers')>('ethers', 'EVM settlement');
      this.evmWallet = new ethers.Wallet(this.evmPrivateKey, this.evmProvider);
      this.evmAddress = this.evmWallet.address;

      logger.info('EVM wallet initialized', { evmAddress: this.evmAddress });
      return this.evmWallet;
    } catch (error) {
      if (error instanceof Error && error.message.includes('is required for')) {
        throw error;
      }
      logger.error('Failed to initialize EVM wallet', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error('Failed to initialize treasury EVM wallet');
    }
  }

  /**
   * Lazily initialize the XRP wallet via dynamic import of xrpl.
   */
  private async ensureXrpInitialized(): Promise<void> {
    if (this.xrpInitialized) return;

    const { Wallet: XWallet } = await requireOptional<typeof import('xrpl')>(
      'xrpl',
      'XRP settlement'
    );
    this.xrpWallet = XWallet.fromSecret(this.xrpPrivateKey);
    this.xrpAddress = this.xrpWallet.address;
    this.xrpInitialized = true;

    logger.info('XRP wallet initialized', { xrpAddress: this.xrpAddress });
  }

  /**
   * Gets the next nonce for EVM transactions, serializing requests to prevent nonce conflicts
   */
  private getNextNonce(): Promise<number> {
    // Chain the new nonce request after any pending one
    this.noncePromise = this.noncePromise
      ? this.noncePromise.then(async (prevNonce) => prevNonce + 1)
      : this.evmProvider.getTransactionCount(this.evmAddress, 'pending');

    return this.noncePromise;
  }

  /**
   * Sends ETH from treasury to recipient address
   *
   * @param to - Recipient EVM address
   * @param amount - Amount in wei (bigint)
   * @returns Transaction object with hash
   */
  async sendETH(to: string, amount: bigint): Promise<Transaction> {
    try {
      const { ethers } = await requireOptional<typeof import('ethers')>('ethers', 'EVM settlement');
      const evmWallet = await this.ensureEvmInitialized();

      // Validate recipient address
      if (!ethers.isAddress(to)) {
        throw new Error(`Invalid EVM address: ${to}`);
      }

      // Get next nonce - this serializes concurrent requests
      const nonce = await this.getNextNonce();

      // Get current fee data for gas pricing
      const feeData = await this.evmProvider.getFeeData();

      // Create transaction
      const tx = await evmWallet.sendTransaction({
        to,
        value: amount,
        nonce,
        gasLimit: 21000, // Standard ETH transfer gas limit
        maxFeePerGas: feeData.maxFeePerGas ?? undefined,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? undefined,
      });

      logger.info('ETH sent', {
        to,
        amount: amount.toString(),
        txHash: tx.hash,
        nonce,
      });

      return {
        hash: tx.hash,
        to: tx.to ?? to,
        value: amount.toString(),
      };
    } catch (error) {
      logger.error('Failed to send ETH', {
        to,
        amount: amount.toString(),
        error: error instanceof Error ? error.message : String(error),
      });
      // Reset nonce promise on error to resync with chain on next request
      this.noncePromise = null;
      throw error;
    }
  }

  /**
   * Sends ERC20 tokens from treasury to recipient address
   *
   * @param to - Recipient EVM address
   * @param tokenAddress - ERC20 token contract address
   * @param amount - Amount in token's smallest unit (bigint)
   * @returns Transaction object with hash
   */
  async sendERC20(to: string, tokenAddress: string, amount: bigint): Promise<Transaction> {
    try {
      const { ethers } = await requireOptional<typeof import('ethers')>('ethers', 'EVM settlement');
      const evmWallet = await this.ensureEvmInitialized();

      // Validate addresses
      if (!ethers.isAddress(to)) {
        throw new Error(`Invalid recipient address: ${to}`);
      }
      if (!ethers.isAddress(tokenAddress)) {
        throw new Error(`Invalid token address: ${tokenAddress}`);
      }

      // Create ERC20 contract instance
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, evmWallet);

      // Send tokens
      const tx = await tokenContract.transfer!(to, amount);

      logger.info('ERC20 sent', {
        to,
        tokenAddress,
        amount: amount.toString(),
        txHash: tx.hash,
      });

      return {
        hash: tx.hash,
        to,
      };
    } catch (error) {
      logger.error('Failed to send ERC20', {
        to,
        tokenAddress,
        amount: amount.toString(),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Sends XRP from treasury to recipient address
   *
   * Note: XRP requires 10 XRP minimum account reserve.
   * This method should be called with at least 15 XRP for new accounts.
   *
   * @param to - Recipient XRP address
   * @param amount - Amount in drops (bigint, 1 XRP = 1,000,000 drops)
   * @returns Transaction object with hash
   */
  async sendXRP(to: string, amount: bigint): Promise<Transaction> {
    try {
      await this.ensureXrpInitialized();

      // Create XRP payment transaction
      const payment: Payment = {
        TransactionType: 'Payment',
        Account: this.xrpWallet.address,
        Destination: to,
        Amount: amount.toString(), // XRPL expects string for Amount
      };

      // Submit and wait for transaction result
      const result = await this.xrplClient.submitAndWait(payment, {
        wallet: this.xrpWallet,
      });

      // Extract transaction hash
      const txHash =
        typeof result.result.hash === 'string'
          ? result.result.hash
          : // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ((result.result as any).tx_json?.hash ?? 'unknown');

      logger.info('XRP sent', {
        to,
        amount: amount.toString(),
        txHash,
      });

      return {
        hash: txHash,
        to,
        value: amount.toString(),
      };
    } catch (error) {
      logger.error('Failed to send XRP', {
        to,
        amount: amount.toString(),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Gets current balance of treasury wallet
   *
   * @param chain - Blockchain ('evm' or 'xrp')
   * @param token - Token identifier ('ETH', '0xTokenAddress', or 'XRP')
   * @returns Balance as bigint
   */
  async getBalance(chain: 'evm' | 'xrp', token: string): Promise<bigint> {
    try {
      if (chain === 'evm') {
        const { ethers } = await requireOptional<typeof import('ethers')>(
          'ethers',
          'EVM settlement'
        );
        await this.ensureEvmInitialized();

        if (token === 'ETH' || token.toLowerCase() === 'eth') {
          // Get ETH balance
          const balance = await this.evmProvider.getBalance(this.evmAddress);
          return balance;
        } else {
          // Get ERC20 balance
          if (!ethers.isAddress(token)) {
            throw new Error(`Invalid token address: ${token}`);
          }
          const tokenContract = new ethers.Contract(token, ERC20_ABI, this.evmProvider);
          const balance = await tokenContract.balanceOf!(this.evmAddress);
          return balance;
        }
      } else {
        // Ensure XRP wallet is initialized (for xrpAddress)
        await this.ensureXrpInitialized();
        // Get XRP balance
        const accountInfo = await this.xrplClient.request({
          command: 'account_info',
          account: this.xrpAddress,
        });
        const balance = BigInt(accountInfo.result.account_data.Balance);
        return balance;
      }
    } catch (error) {
      logger.error('Failed to get balance', {
        chain,
        token,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
