/* eslint-disable @typescript-eslint/no-explicit-any */
import { ClaimManager, WalletAddresses } from './claim-manager';
import type { PaymentChannelSDK } from '../settlement/payment-channel-sdk';
import type { ClaimSigner } from '../settlement/xrp-claim-signer';
import type { AptosClaimSigner } from '../settlement/aptos-claim-signer';
import type { ClaimStore } from './claim-store';
import type { ClaimEventBuilder } from './claim-event-builder';
import type { ClaimEventParser } from './claim-event-parser';
import type { Logger } from 'pino';
import type {
  EVMSignedClaim,
  XRPSignedClaim,
  AptosSignedClaim,
  ClaimRequest,
  ClaimChain,
  NostrClaimEvent,
} from '@m2m/shared';

describe('ClaimManager', () => {
  let claimManager: ClaimManager;
  let mockPaymentChannelSDK: jest.Mocked<PaymentChannelSDK>;
  let mockXRPClaimSigner: jest.Mocked<ClaimSigner>;
  let mockAptosClaimSigner: jest.Mocked<AptosClaimSigner>;
  let mockClaimStore: jest.Mocked<ClaimStore>;
  let mockClaimEventBuilder: jest.Mocked<ClaimEventBuilder>;
  let mockClaimEventParser: jest.Mocked<ClaimEventParser>;
  let mockLogger: jest.Mocked<Logger>;
  let walletAddresses: WalletAddresses;

  beforeEach(() => {
    // Create fresh mock instances
    mockPaymentChannelSDK = {
      signBalanceProof: jest.fn(),
      verifyBalanceProof: jest.fn(),
    } as any;

    mockXRPClaimSigner = {
      signClaim: jest.fn(),
      getPublicKey: jest.fn(),
      verifyClaim: jest.fn(),
    } as any;

    mockAptosClaimSigner = {
      signClaim: jest.fn(),
      getPublicKey: jest.fn(),
      verifyClaim: jest.fn(),
    } as any;

    mockClaimStore = {
      storeEVMClaim: jest.fn(),
      storeXRPClaim: jest.fn(),
      storeAptosClaim: jest.fn(),
      getLatestClaim: jest.fn(),
      getClaimsForSettlement: jest.fn(),
      getAllClaimsByPeer: jest.fn(),
    } as any;

    mockClaimEventBuilder = {
      wrapContent: jest.fn(),
    } as any;

    mockClaimEventParser = {
      extractSignedClaim: jest.fn(),
      extractUnsignedRequests: jest.fn(),
    } as any;

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      child: jest.fn(),
    } as any;

    walletAddresses = {
      evm: '0x1234567890123456789012345678901234567890',
      xrp: 'rABCDEFGHIJKLMNOPQRSTUVWXYZ12345',
      aptos: '0x' + 'a'.repeat(64),
    };

    // Create new ClaimManager instance
    claimManager = new ClaimManager(
      mockPaymentChannelSDK,
      mockXRPClaimSigner,
      mockAptosClaimSigner,
      mockClaimStore,
      mockClaimEventBuilder,
      mockClaimEventParser,
      walletAddresses,
      mockLogger
    );
  });

  // Helper function to create mock NostrClaimEvent
  const createMockEvent = (
    peerId: string = 'peer123',
    kind: 30001 | 30002 | 30003 = 30001,
    content: string = 'test'
  ): NostrClaimEvent => ({
    kind,
    content,
    tags: [],
    id: 'eventid123',
    pubkey: peerId,
    created_at: Math.floor(Date.now() / 1000),
    sig: 'signature123',
  });

  describe('generateClaimForPeer', () => {
    describe('EVM claims', () => {
      it('should generate EVM claim with valid signature', async () => {
        const peerId = 'peer123';
        const channelId = '0x' + 'b'.repeat(64);
        const amount = 1000n;
        const nonce = 5;
        const signature = '0xsignature123';

        mockPaymentChannelSDK.signBalanceProof.mockResolvedValue(signature);

        const result = await claimManager.generateClaimForPeer(
          peerId,
          'evm',
          channelId,
          amount,
          nonce
        );

        expect(result).not.toBeNull();
        expect(result).toMatchObject({
          chain: 'evm',
          channelId,
          transferredAmount: amount,
          nonce,
          lockedAmount: 0n,
          signature,
          signer: walletAddresses.evm,
        });

        expect(mockPaymentChannelSDK.signBalanceProof).toHaveBeenCalledWith(
          channelId,
          nonce,
          amount,
          0n,
          '0x' + '0'.repeat(64)
        );

        expect(mockLogger.info).toHaveBeenCalledWith(
          { peerId, chain: 'evm', channelId, amount: amount.toString(), nonce },
          'Claim generated'
        );
      });

      it('should return null if EVM address not configured', async () => {
        const noEvmWallet = { xrp: 'rABC...', aptos: '0xabc...' };
        const managerNoEvm = new ClaimManager(
          mockPaymentChannelSDK,
          mockXRPClaimSigner,
          mockAptosClaimSigner,
          mockClaimStore,
          mockClaimEventBuilder,
          mockClaimEventParser,
          noEvmWallet,
          mockLogger
        );

        const result = await managerNoEvm.generateClaimForPeer(
          'peer123',
          'evm',
          '0xch...',
          1000n,
          5
        );

        expect(result).toBeNull();
        expect(mockLogger.warn).toHaveBeenCalledWith(
          { peerId: 'peer123', chain: 'evm' },
          'EVM address not configured'
        );
      });

      it('should return null if nonce not provided for EVM', async () => {
        const result = await claimManager.generateClaimForPeer(
          'peer123',
          'evm',
          '0xch...',
          1000n,
          undefined // Missing nonce
        );

        expect(result).toBeNull();
        expect(mockLogger.warn).toHaveBeenCalledWith(
          { peerId: 'peer123', chain: 'evm' },
          'Nonce required for EVM claims'
        );
      });

      it('should catch and log signer exceptions', async () => {
        mockPaymentChannelSDK.signBalanceProof.mockRejectedValue(new Error('Signer error'));

        const result = await claimManager.generateClaimForPeer(
          'peer123',
          'evm',
          '0xch...',
          1000n,
          5
        );

        expect(result).toBeNull();
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.objectContaining({
            peerId: 'peer123',
            chain: 'evm',
            error: 'Signer error',
          }),
          'Failed to generate claim'
        );
      });
    });

    describe('XRP claims', () => {
      it('should generate XRP claim with valid signature', async () => {
        const peerId = 'peer123';
        const channelId = 'c'.repeat(64);
        const amount = 5000n;
        const signature = 'sig'.repeat(42);
        const publicKey = 'ED' + 'p'.repeat(64);

        mockXRPClaimSigner.signClaim.mockResolvedValue(signature);
        mockXRPClaimSigner.getPublicKey.mockResolvedValue(publicKey);

        const result = await claimManager.generateClaimForPeer(peerId, 'xrp', channelId, amount);

        expect(result).not.toBeNull();
        expect(result).toMatchObject({
          chain: 'xrp',
          channelId,
          amount,
          signature,
          signer: publicKey,
        });

        expect(mockXRPClaimSigner.signClaim).toHaveBeenCalledWith(channelId, amount.toString());
        expect(mockXRPClaimSigner.getPublicKey).toHaveBeenCalled();

        expect(mockLogger.info).toHaveBeenCalledWith(
          { peerId, chain: 'xrp', channelId, amount: amount.toString(), nonce: undefined },
          'Claim generated'
        );
      });

      it('should return null if XRP address not configured', async () => {
        const noXrpWallet = { evm: '0x123...', aptos: '0xabc...' };
        const managerNoXrp = new ClaimManager(
          mockPaymentChannelSDK,
          mockXRPClaimSigner,
          mockAptosClaimSigner,
          mockClaimStore,
          mockClaimEventBuilder,
          mockClaimEventParser,
          noXrpWallet,
          mockLogger
        );

        const result = await managerNoXrp.generateClaimForPeer('peer123', 'xrp', 'ch123', 5000n);

        expect(result).toBeNull();
        expect(mockLogger.warn).toHaveBeenCalledWith(
          { peerId: 'peer123', chain: 'xrp' },
          'XRP address not configured'
        );
      });
    });

    describe('Aptos claims', () => {
      it('should generate Aptos claim with valid signature', async () => {
        const peerId = 'peer123';
        const channelOwner = '0x' + 'c'.repeat(64);
        const amount = 8000n;
        const nonce = 10;
        const aptosClaim = {
          channelOwner,
          amount,
          nonce,
          signature: 'sig'.repeat(42),
          publicKey: 'pk'.repeat(32),
          createdAt: Date.now(),
        };

        mockAptosClaimSigner.signClaim.mockReturnValue(aptosClaim);

        const result = await claimManager.generateClaimForPeer(
          peerId,
          'aptos',
          channelOwner,
          amount,
          nonce
        );

        expect(result).not.toBeNull();
        expect(result).toMatchObject({
          chain: 'aptos',
          channelOwner: walletAddresses.aptos,
          amount,
          nonce,
          signature: aptosClaim.signature,
          signer: aptosClaim.publicKey,
        });

        expect(mockAptosClaimSigner.signClaim).toHaveBeenCalledWith(
          walletAddresses.aptos,
          amount,
          nonce
        );

        expect(mockLogger.info).toHaveBeenCalledWith(
          { peerId, chain: 'aptos', channelId: channelOwner, amount: amount.toString(), nonce },
          'Claim generated'
        );
      });

      it('should return null if Aptos address not configured', async () => {
        const noAptosWallet = { evm: '0x123...', xrp: 'rABC...' };
        const managerNoAptos = new ClaimManager(
          mockPaymentChannelSDK,
          mockXRPClaimSigner,
          mockAptosClaimSigner,
          mockClaimStore,
          mockClaimEventBuilder,
          mockClaimEventParser,
          noAptosWallet,
          mockLogger
        );

        const result = await managerNoAptos.generateClaimForPeer(
          'peer123',
          'aptos',
          '0xch...',
          8000n,
          10
        );

        expect(result).toBeNull();
        expect(mockLogger.warn).toHaveBeenCalledWith(
          { peerId: 'peer123', chain: 'aptos' },
          'Aptos address not configured'
        );
      });

      it('should return null if nonce not provided for Aptos', async () => {
        const result = await claimManager.generateClaimForPeer(
          'peer123',
          'aptos',
          '0xch...',
          8000n,
          undefined // Missing nonce
        );

        expect(result).toBeNull();
        expect(mockLogger.warn).toHaveBeenCalledWith(
          { peerId: 'peer123', chain: 'aptos' },
          'Nonce required for Aptos claims'
        );
      });
    });
  });

  describe('generateClaimEventForPeer', () => {
    it('should generate claim event with single claim', async () => {
      const peerId = 'peer123';
      const content = 'Hello peer';
      const evmClaim: EVMSignedClaim = {
        chain: 'evm',
        channelId: '0x' + 'b'.repeat(64),
        transferredAmount: 1000n,
        nonce: 5,
        lockedAmount: 0n,
        locksRoot: '0x' + '0'.repeat(64),
        signature: '0xsig...',
        signer: walletAddresses.evm!,
      };
      const mockEvent = { kind: 30001, content, tags: [] } as any;

      mockClaimEventBuilder.wrapContent.mockReturnValue(mockEvent);

      const result = await claimManager.generateClaimEventForPeer(peerId, content, [evmClaim], []);

      expect(result).toEqual(mockEvent);
      expect(mockClaimEventBuilder.wrapContent).toHaveBeenCalledWith(content, evmClaim, []);

      expect(mockLogger.info).toHaveBeenCalledWith(
        { peerId, claimCount: 1, requestCount: 0 },
        'Claim event created'
      );
    });

    it('should generate claim event with multi-chain claims and requests', async () => {
      const peerId = 'peer123';
      const content = 'Multi-chain message';
      const evmClaim: EVMSignedClaim = {
        chain: 'evm',
        channelId: '0xch1',
        transferredAmount: 1000n,
        nonce: 5,
        lockedAmount: 0n,
        locksRoot: '0x' + '0'.repeat(64),
        signature: '0xsig1',
        signer: walletAddresses.evm!,
      };
      const xrpClaim: XRPSignedClaim = {
        chain: 'xrp',
        channelId: 'ch2',
        amount: 5000n,
        signature: 'sig2',
        signer: 'EDpubkey',
      };
      const requests: ClaimRequest[] = [
        { chain: 'evm', channelId: '0xch1', amount: 2000n, nonce: 6 },
        { chain: 'xrp', channelId: 'ch2', amount: 6000n },
      ];
      const mockEvent = { kind: 30001, content, tags: [] } as any;

      mockClaimEventBuilder.wrapContent.mockReturnValue(mockEvent);

      const result = await claimManager.generateClaimEventForPeer(
        peerId,
        content,
        [evmClaim, xrpClaim],
        requests
      );

      expect(result).toEqual(mockEvent);
      expect(mockClaimEventBuilder.wrapContent).toHaveBeenCalledWith(
        content,
        evmClaim,
        requests // All unsigned requests
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        { peerId, claimCount: 2, requestCount: 2 },
        'Claim event created'
      );
    });

    it('should return null if no claims to include', async () => {
      const result = await claimManager.generateClaimEventForPeer('peer123', 'content', [], []);

      expect(result).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        { peerId: 'peer123' },
        'No claims to include in event'
      );
    });

    it('should catch and log builder exceptions', async () => {
      const evmClaim: EVMSignedClaim = {
        chain: 'evm',
        channelId: '0xch',
        transferredAmount: 1000n,
        nonce: 5,
        lockedAmount: 0n,
        locksRoot: '0x' + '0'.repeat(64),
        signature: '0xsig',
        signer: walletAddresses.evm!,
      };

      mockClaimEventBuilder.wrapContent.mockImplementation(() => {
        throw new Error('Builder error');
      });

      const result = await claimManager.generateClaimEventForPeer(
        'peer123',
        'content',
        [evmClaim],
        []
      );

      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          peerId: 'peer123',
          error: 'Builder error',
        }),
        'Failed to create claim event'
      );
    });
  });

  describe('verifyClaimSignature', () => {
    describe('EVM signature verification', () => {
      it('should return true for valid EVM signature', async () => {
        const evmClaim: EVMSignedClaim = {
          chain: 'evm',
          channelId: '0xch',
          transferredAmount: 1000n,
          nonce: 5,
          lockedAmount: 0n,
          locksRoot: '0x' + '0'.repeat(64),
          signature: '0xsig',
          signer: '0x1234567890123456789012345678901234567890',
        };
        const expectedSigner = '0x1234567890123456789012345678901234567890';

        mockPaymentChannelSDK.verifyBalanceProof.mockResolvedValue(true);

        const result = await claimManager.verifyClaimSignature(evmClaim, expectedSigner);

        expect(result).toBe(true);
        expect(mockPaymentChannelSDK.verifyBalanceProof).toHaveBeenCalledWith(
          {
            channelId: evmClaim.channelId,
            nonce: evmClaim.nonce,
            transferredAmount: evmClaim.transferredAmount,
            lockedAmount: evmClaim.lockedAmount,
            locksRoot: evmClaim.locksRoot,
          },
          evmClaim.signature,
          expectedSigner
        );
      });

      it('should return false for invalid EVM signature', async () => {
        const evmClaim: EVMSignedClaim = {
          chain: 'evm',
          channelId: '0xch',
          transferredAmount: 1000n,
          nonce: 5,
          lockedAmount: 0n,
          locksRoot: '0x' + '0'.repeat(64),
          signature: '0xbadsig',
          signer: '0x1234567890123456789012345678901234567890',
        };
        const expectedSigner = '0x1234567890123456789012345678901234567890';

        mockPaymentChannelSDK.verifyBalanceProof.mockResolvedValue(false);

        const result = await claimManager.verifyClaimSignature(evmClaim, expectedSigner);

        expect(result).toBe(false);
      });

      it('should return false for signer address mismatch (case-insensitive)', async () => {
        const evmClaim: EVMSignedClaim = {
          chain: 'evm',
          channelId: '0xch',
          transferredAmount: 1000n,
          nonce: 5,
          lockedAmount: 0n,
          locksRoot: '0x' + '0'.repeat(64),
          signature: '0xsig',
          signer: '0x1234567890123456789012345678901234567890',
        };
        const expectedSigner = '0x9999999999999999999999999999999999999999';

        mockPaymentChannelSDK.verifyBalanceProof.mockResolvedValue(true);

        const result = await claimManager.verifyClaimSignature(evmClaim, expectedSigner);

        expect(result).toBe(false);
      });

      it('should handle case-insensitive EVM address comparison', async () => {
        const evmClaim: EVMSignedClaim = {
          chain: 'evm',
          channelId: '0xch',
          transferredAmount: 1000n,
          nonce: 5,
          lockedAmount: 0n,
          locksRoot: '0x' + '0'.repeat(64),
          signature: '0xsig',
          signer: '0xABCD1234ABCD1234ABCD1234ABCD1234ABCD1234',
        };
        const expectedSigner = '0xabcd1234abcd1234abcd1234abcd1234abcd1234';

        mockPaymentChannelSDK.verifyBalanceProof.mockResolvedValue(true);

        const result = await claimManager.verifyClaimSignature(evmClaim, expectedSigner);

        expect(result).toBe(true);
      });
    });

    describe('XRP signature verification', () => {
      it('should return true for valid XRP signature', async () => {
        const xrpClaim: XRPSignedClaim = {
          chain: 'xrp',
          channelId: 'ch123',
          amount: 5000n,
          signature: 'sig123',
          signer: 'EDpubkey123',
        };
        const expectedSigner = 'EDpubkey123';

        mockXRPClaimSigner.verifyClaim.mockResolvedValue(true);

        const result = await claimManager.verifyClaimSignature(xrpClaim, expectedSigner);

        expect(result).toBe(true);
        expect(mockXRPClaimSigner.verifyClaim).toHaveBeenCalledWith(
          xrpClaim.channelId,
          xrpClaim.amount.toString(),
          xrpClaim.signature,
          xrpClaim.signer
        );
      });

      it('should return false for invalid XRP signature', async () => {
        const xrpClaim: XRPSignedClaim = {
          chain: 'xrp',
          channelId: 'ch123',
          amount: 5000n,
          signature: 'badsig',
          signer: 'EDpubkey123',
        };
        const expectedSigner = 'EDpubkey123';

        mockXRPClaimSigner.verifyClaim.mockResolvedValue(false);

        const result = await claimManager.verifyClaimSignature(xrpClaim, expectedSigner);

        expect(result).toBe(false);
      });

      it('should return false for XRP public key mismatch', async () => {
        const xrpClaim: XRPSignedClaim = {
          chain: 'xrp',
          channelId: 'ch123',
          amount: 5000n,
          signature: 'sig123',
          signer: 'EDpubkey123',
        };
        const expectedSigner = 'EDwrongpubkey';

        mockXRPClaimSigner.verifyClaim.mockResolvedValue(true);

        const result = await claimManager.verifyClaimSignature(xrpClaim, expectedSigner);

        expect(result).toBe(false);
      });
    });

    describe('Aptos signature verification', () => {
      it('should return true for valid Aptos signature', async () => {
        const aptosClaim: AptosSignedClaim = {
          chain: 'aptos',
          channelOwner: '0x' + 'c'.repeat(64),
          amount: 8000n,
          nonce: 10,
          signature: 'sig456',
          signer: 'pk456',
        };
        const expectedSigner = 'pk456';

        mockAptosClaimSigner.verifyClaim.mockReturnValue(true);

        const result = await claimManager.verifyClaimSignature(aptosClaim, expectedSigner);

        expect(result).toBe(true);
        expect(mockAptosClaimSigner.verifyClaim).toHaveBeenCalledWith(
          aptosClaim.channelOwner,
          aptosClaim.amount,
          aptosClaim.nonce,
          aptosClaim.signature,
          aptosClaim.signer
        );
      });

      it('should return false for invalid Aptos signature', async () => {
        const aptosClaim: AptosSignedClaim = {
          chain: 'aptos',
          channelOwner: '0x' + 'c'.repeat(64),
          amount: 8000n,
          nonce: 10,
          signature: 'badsig',
          signer: 'pk456',
        };
        const expectedSigner = 'pk456';

        mockAptosClaimSigner.verifyClaim.mockReturnValue(false);

        const result = await claimManager.verifyClaimSignature(aptosClaim, expectedSigner);

        expect(result).toBe(false);
      });

      it('should return false for Aptos public key mismatch', async () => {
        const aptosClaim: AptosSignedClaim = {
          chain: 'aptos',
          channelOwner: '0x' + 'c'.repeat(64),
          amount: 8000n,
          nonce: 10,
          signature: 'sig456',
          signer: 'pk456',
        };
        const expectedSigner = 'wrongpk';

        mockAptosClaimSigner.verifyClaim.mockReturnValue(true);

        const result = await claimManager.verifyClaimSignature(aptosClaim, expectedSigner);

        expect(result).toBe(false);
      });
    });

    it('should catch and log verification exceptions', async () => {
      const evmClaim: EVMSignedClaim = {
        chain: 'evm',
        channelId: '0xch',
        transferredAmount: 1000n,
        nonce: 5,
        lockedAmount: 0n,
        locksRoot: '0x' + '0'.repeat(64),
        signature: '0xsig',
        signer: '0x1234567890123456789012345678901234567890',
      };

      mockPaymentChannelSDK.verifyBalanceProof.mockRejectedValue(new Error('Verification error'));

      const result = await claimManager.verifyClaimSignature(evmClaim, '0x123...');

      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          chain: 'evm',
          error: 'Verification error',
        }),
        'Claim verification failed'
      );
    });
  });

  describe('verifyMonotonicity', () => {
    describe('EVM nonce monotonicity', () => {
      it('should return true when new nonce is greater than stored nonce', () => {
        const peerId = 'peer123';
        const evmClaim: EVMSignedClaim = {
          chain: 'evm',
          channelId: '0xch',
          transferredAmount: 1000n,
          nonce: 10,
          lockedAmount: 0n,
          locksRoot: '0x' + '0'.repeat(64),
          signature: '0xsig',
          signer: '0x123...',
        };
        const existingClaim: EVMSignedClaim = {
          ...evmClaim,
          nonce: 5,
        };

        mockClaimStore.getLatestClaim.mockReturnValue(existingClaim);

        const result = claimManager.verifyMonotonicity(peerId, evmClaim);

        expect(result).toBe(true);
        expect(mockClaimStore.getLatestClaim).toHaveBeenCalledWith(peerId, 'evm', '0xch');
      });

      it('should return false when new nonce equals stored nonce', () => {
        const peerId = 'peer123';
        const evmClaim: EVMSignedClaim = {
          chain: 'evm',
          channelId: '0xch',
          transferredAmount: 1000n,
          nonce: 5,
          lockedAmount: 0n,
          locksRoot: '0x' + '0'.repeat(64),
          signature: '0xsig',
          signer: '0x123...',
        };
        const existingClaim: EVMSignedClaim = {
          ...evmClaim,
          nonce: 5,
        };

        mockClaimStore.getLatestClaim.mockReturnValue(existingClaim);

        const result = claimManager.verifyMonotonicity(peerId, evmClaim);

        expect(result).toBe(false);
        expect(mockLogger.info).toHaveBeenCalledWith(
          {
            peerId,
            chain: 'evm',
            storedNonce: 5,
            newNonce: 5,
          },
          'Stale nonce rejected'
        );
      });

      it('should return false when new nonce is less than stored nonce', () => {
        const peerId = 'peer123';
        const evmClaim: EVMSignedClaim = {
          chain: 'evm',
          channelId: '0xch',
          transferredAmount: 1000n,
          nonce: 3,
          lockedAmount: 0n,
          locksRoot: '0x' + '0'.repeat(64),
          signature: '0xsig',
          signer: '0x123...',
        };
        const existingClaim: EVMSignedClaim = {
          ...evmClaim,
          nonce: 5,
        };

        mockClaimStore.getLatestClaim.mockReturnValue(existingClaim);

        const result = claimManager.verifyMonotonicity(peerId, evmClaim);

        expect(result).toBe(false);
        expect(mockLogger.info).toHaveBeenCalledWith(
          {
            peerId,
            chain: 'evm',
            storedNonce: 5,
            newNonce: 3,
          },
          'Stale nonce rejected'
        );
      });

      it('should return true when no existing claim', () => {
        const peerId = 'peer123';
        const evmClaim: EVMSignedClaim = {
          chain: 'evm',
          channelId: '0xch',
          transferredAmount: 1000n,
          nonce: 5,
          lockedAmount: 0n,
          locksRoot: '0x' + '0'.repeat(64),
          signature: '0xsig',
          signer: '0x123...',
        };

        mockClaimStore.getLatestClaim.mockReturnValue(null);

        const result = claimManager.verifyMonotonicity(peerId, evmClaim);

        expect(result).toBe(true);
      });
    });

    describe('XRP amount monotonicity', () => {
      it('should return true when new amount is greater than stored amount', () => {
        const peerId = 'peer123';
        const xrpClaim: XRPSignedClaim = {
          chain: 'xrp',
          channelId: 'ch123',
          amount: 10000n,
          signature: 'sig',
          signer: 'EDpk',
        };
        const existingClaim: XRPSignedClaim = {
          ...xrpClaim,
          amount: 5000n,
        };

        mockClaimStore.getLatestClaim.mockReturnValue(existingClaim);

        const result = claimManager.verifyMonotonicity(peerId, xrpClaim);

        expect(result).toBe(true);
      });

      it('should return false when new amount equals stored amount', () => {
        const peerId = 'peer123';
        const xrpClaim: XRPSignedClaim = {
          chain: 'xrp',
          channelId: 'ch123',
          amount: 5000n,
          signature: 'sig',
          signer: 'EDpk',
        };
        const existingClaim: XRPSignedClaim = {
          ...xrpClaim,
          amount: 5000n,
        };

        mockClaimStore.getLatestClaim.mockReturnValue(existingClaim);

        const result = claimManager.verifyMonotonicity(peerId, xrpClaim);

        expect(result).toBe(false);
        expect(mockLogger.info).toHaveBeenCalledWith(
          {
            peerId,
            chain: 'xrp',
            storedAmount: '5000',
            newAmount: '5000',
          },
          'Stale amount rejected'
        );
      });

      it('should return false when new amount is less than stored amount', () => {
        const peerId = 'peer123';
        const xrpClaim: XRPSignedClaim = {
          chain: 'xrp',
          channelId: 'ch123',
          amount: 3000n,
          signature: 'sig',
          signer: 'EDpk',
        };
        const existingClaim: XRPSignedClaim = {
          ...xrpClaim,
          amount: 5000n,
        };

        mockClaimStore.getLatestClaim.mockReturnValue(existingClaim);

        const result = claimManager.verifyMonotonicity(peerId, xrpClaim);

        expect(result).toBe(false);
        expect(mockLogger.info).toHaveBeenCalledWith(
          {
            peerId,
            chain: 'xrp',
            storedAmount: '5000',
            newAmount: '3000',
          },
          'Stale amount rejected'
        );
      });
    });

    describe('Aptos nonce monotonicity', () => {
      it('should return true when new nonce is greater than stored nonce', () => {
        const peerId = 'peer123';
        const aptosClaim: AptosSignedClaim = {
          chain: 'aptos',
          channelOwner: '0x' + 'c'.repeat(64),
          amount: 8000n,
          nonce: 15,
          signature: 'sig',
          signer: 'pk',
        };
        const existingClaim: AptosSignedClaim = {
          ...aptosClaim,
          nonce: 10,
        };

        mockClaimStore.getLatestClaim.mockReturnValue(existingClaim);

        const result = claimManager.verifyMonotonicity(peerId, aptosClaim);

        expect(result).toBe(true);
      });

      it('should return false when new nonce equals stored nonce', () => {
        const peerId = 'peer123';
        const aptosClaim: AptosSignedClaim = {
          chain: 'aptos',
          channelOwner: '0x' + 'c'.repeat(64),
          amount: 8000n,
          nonce: 10,
          signature: 'sig',
          signer: 'pk',
        };
        const existingClaim: AptosSignedClaim = {
          ...aptosClaim,
          nonce: 10,
        };

        mockClaimStore.getLatestClaim.mockReturnValue(existingClaim);

        const result = claimManager.verifyMonotonicity(peerId, aptosClaim);

        expect(result).toBe(false);
        expect(mockLogger.info).toHaveBeenCalledWith(
          {
            peerId,
            chain: 'aptos',
            storedNonce: 10,
            newNonce: 10,
          },
          'Stale nonce rejected'
        );
      });
    });
  });

  describe('verifyAmountWithinBounds', () => {
    it('should return true when claim amount is within channel deposit', () => {
      const evmClaim: EVMSignedClaim = {
        chain: 'evm',
        channelId: '0xch',
        transferredAmount: 5000n,
        nonce: 5,
        lockedAmount: 0n,
        locksRoot: '0x' + '0'.repeat(64),
        signature: '0xsig',
        signer: '0x123...',
      };
      const channelDeposit = 10000n;

      const result = claimManager.verifyAmountWithinBounds(evmClaim, channelDeposit);

      expect(result).toBe(true);
    });

    it('should return true when claim amount equals channel deposit', () => {
      const evmClaim: EVMSignedClaim = {
        chain: 'evm',
        channelId: '0xch',
        transferredAmount: 10000n,
        nonce: 5,
        lockedAmount: 0n,
        locksRoot: '0x' + '0'.repeat(64),
        signature: '0xsig',
        signer: '0x123...',
      };
      const channelDeposit = 10000n;

      const result = claimManager.verifyAmountWithinBounds(evmClaim, channelDeposit);

      expect(result).toBe(true);
    });

    it('should return false when claim amount exceeds channel deposit', () => {
      const evmClaim: EVMSignedClaim = {
        chain: 'evm',
        channelId: '0xch',
        transferredAmount: 15000n,
        nonce: 5,
        lockedAmount: 0n,
        locksRoot: '0x' + '0'.repeat(64),
        signature: '0xsig',
        signer: '0x123...',
      };
      const channelDeposit = 10000n;

      const result = claimManager.verifyAmountWithinBounds(evmClaim, channelDeposit);

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        {
          chain: 'evm',
          claimAmount: '15000',
          deposit: '10000',
        },
        'Claim exceeds deposit - potential fraud'
      );
    });
  });

  describe('processReceivedClaimEvent', () => {
    it('should process valid claim and store it', async () => {
      const peerId = 'peer123';
      const peerAddresses: WalletAddresses = {
        evm: '0x' + '9'.repeat(40),
      };
      const evmClaim: EVMSignedClaim = {
        chain: 'evm',
        channelId: '0xch',
        transferredAmount: 1000n,
        nonce: 5,
        lockedAmount: 0n,
        locksRoot: '0x' + '0'.repeat(64),
        signature: '0xsig',
        signer: peerAddresses.evm!,
      };
      const event = {
        kind: 30001,
        content: 'test',
        tags: [],
        id: 'eventid123',
        pubkey: peerId,
        created_at: Math.floor(Date.now() / 1000),
        sig: 'signature123',
      } as NostrClaimEvent;

      mockClaimEventParser.extractSignedClaim.mockReturnValue(evmClaim);
      mockClaimEventParser.extractUnsignedRequests.mockReturnValue([]);
      mockPaymentChannelSDK.verifyBalanceProof.mockResolvedValue(true);
      mockClaimStore.getLatestClaim.mockReturnValue(null);
      mockClaimStore.storeEVMClaim.mockReturnValue(true);

      const result = await claimManager.processReceivedClaimEvent(peerId, event, peerAddresses);

      expect(result.signedClaims).toHaveLength(1);
      expect(result.signedClaims[0]).toEqual(evmClaim);
      expect(result.errors).toHaveLength(0);
      expect(mockClaimStore.storeEVMClaim).toHaveBeenCalledWith(peerId, evmClaim);
    });

    it('should skip claim with invalid signature', async () => {
      const peerId = 'peer123';
      const peerAddresses: WalletAddresses = {
        evm: '0x' + '9'.repeat(40),
      };
      const evmClaim: EVMSignedClaim = {
        chain: 'evm',
        channelId: '0xch',
        transferredAmount: 1000n,
        nonce: 5,
        lockedAmount: 0n,
        locksRoot: '0x' + '0'.repeat(64),
        signature: '0xbadsig',
        signer: peerAddresses.evm!,
      };
      const event = createMockEvent(peerId);

      mockClaimEventParser.extractSignedClaim.mockReturnValue(evmClaim);
      mockClaimEventParser.extractUnsignedRequests.mockReturnValue([]);
      mockPaymentChannelSDK.verifyBalanceProof.mockResolvedValue(false);

      const result = await claimManager.processReceivedClaimEvent(peerId, event, peerAddresses);

      expect(result.signedClaims).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Invalid signature');
      expect(mockClaimStore.storeEVMClaim).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          peerId,
          chain: 'evm',
          reason: 'invalid_signature',
        }),
        'Claim verification failed'
      );
    });

    it('should skip stale claim', async () => {
      const peerId = 'peer123';
      const peerAddresses: WalletAddresses = {
        evm: '0x' + '9'.repeat(40),
      };
      const evmClaim: EVMSignedClaim = {
        chain: 'evm',
        channelId: '0xch',
        transferredAmount: 1000n,
        nonce: 5,
        lockedAmount: 0n,
        locksRoot: '0x' + '0'.repeat(64),
        signature: '0xsig',
        signer: peerAddresses.evm!,
      };
      const existingClaim: EVMSignedClaim = {
        ...evmClaim,
        nonce: 10,
      };
      const event = createMockEvent(peerId);

      mockClaimEventParser.extractSignedClaim.mockReturnValue(evmClaim);
      mockClaimEventParser.extractUnsignedRequests.mockReturnValue([]);
      mockPaymentChannelSDK.verifyBalanceProof.mockResolvedValue(true);
      mockClaimStore.getLatestClaim.mockReturnValue(existingClaim);

      const result = await claimManager.processReceivedClaimEvent(peerId, event, peerAddresses);

      expect(result.signedClaims).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Stale');
      expect(mockClaimStore.storeEVMClaim).not.toHaveBeenCalled();
    });

    it('should generate signed responses for unsigned requests', async () => {
      const peerId = 'peer123';
      const peerAddresses: WalletAddresses = {};
      const requests: ClaimRequest[] = [
        { chain: 'evm', channelId: '0xch1', amount: 1000n, nonce: 5 },
        { chain: 'xrp', channelId: 'ch2', amount: 5000n },
      ];
      const event = createMockEvent(peerId);

      mockClaimEventParser.extractSignedClaim.mockReturnValue(null);
      mockClaimEventParser.extractUnsignedRequests.mockReturnValue(requests);

      mockPaymentChannelSDK.signBalanceProof.mockResolvedValue('0xsig1');
      mockXRPClaimSigner.signClaim.mockResolvedValue('sig2');
      mockXRPClaimSigner.getPublicKey.mockResolvedValue('EDpk');

      const result = await claimManager.processReceivedClaimEvent(peerId, event, peerAddresses);

      expect(result.unsignedRequests).toHaveLength(2);
      expect(result.signedResponses).toHaveLength(2);
      expect(result.signedResponses[0]).toMatchObject({
        chain: 'evm',
        channelId: '0xch1',
      });
      expect(result.signedResponses[1]).toMatchObject({
        chain: 'xrp',
        channelId: 'ch2',
      });
    });

    it('should handle mixed valid/invalid claims', async () => {
      const peerId = 'peer123';
      const peerAddresses: WalletAddresses = {
        evm: '0x' + '9'.repeat(40),
      };
      const evmClaim: EVMSignedClaim = {
        chain: 'evm',
        channelId: '0xch',
        transferredAmount: 1000n,
        nonce: 5,
        lockedAmount: 0n,
        locksRoot: '0x' + '0'.repeat(64),
        signature: '0xsig',
        signer: peerAddresses.evm!,
      };
      const event = createMockEvent(peerId);

      mockClaimEventParser.extractSignedClaim.mockReturnValue(evmClaim);
      mockClaimEventParser.extractUnsignedRequests.mockReturnValue([]);
      mockPaymentChannelSDK.verifyBalanceProof.mockResolvedValue(true);
      mockClaimStore.getLatestClaim.mockReturnValue(null);
      mockClaimStore.storeEVMClaim.mockReturnValue(false); // Storage fails

      const result = await claimManager.processReceivedClaimEvent(peerId, event, peerAddresses);

      expect(result.signedClaims).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Failed to store');
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          peerId,
          chain: 'evm',
        }),
        'Failed to store evm claim'
      );
    });

    it('should catch parser exceptions', async () => {
      const peerId = 'peer123';
      const peerAddresses: WalletAddresses = {};
      const event = createMockEvent(peerId);

      mockClaimEventParser.extractSignedClaim.mockImplementation(() => {
        throw new Error('Parser error');
      });

      const result = await claimManager.processReceivedClaimEvent(peerId, event, peerAddresses);

      expect(result.signedClaims).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Failed to process claim event');
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          peerId,
          error: 'Parser error',
        }),
        'Failed to process claim event: Parser error'
      );
    });

    it('should handle missing peer address for claim chain', async () => {
      const peerId = 'peer123';
      const peerAddresses: WalletAddresses = {}; // No EVM address
      const evmClaim: EVMSignedClaim = {
        chain: 'evm',
        channelId: '0xch',
        transferredAmount: 1000n,
        nonce: 5,
        lockedAmount: 0n,
        locksRoot: '0x' + '0'.repeat(64),
        signature: '0xsig',
        signer: '0x' + '9'.repeat(40),
      };
      const event = createMockEvent(peerId);

      mockClaimEventParser.extractSignedClaim.mockReturnValue(evmClaim);
      mockClaimEventParser.extractUnsignedRequests.mockReturnValue([]);

      const result = await claimManager.processReceivedClaimEvent(peerId, event, peerAddresses);

      expect(result.signedClaims).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('No evm address configured for peer');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        { peerId, chain: 'evm' },
        'No evm address configured for peer'
      );
    });
  });

  describe('getClaimsForSettlement', () => {
    it('should delegate to ClaimStore', () => {
      const peerId = 'peer123';
      const chain: ClaimChain = 'evm';
      const mockClaims: EVMSignedClaim[] = [
        {
          chain: 'evm',
          channelId: '0xch',
          transferredAmount: 1000n,
          nonce: 5,
          lockedAmount: 0n,
          locksRoot: '0x' + '0'.repeat(64),
          signature: '0xsig',
          signer: '0x123...',
        },
      ];

      mockClaimStore.getClaimsForSettlement.mockReturnValue(mockClaims);

      const result = claimManager.getClaimsForSettlement(peerId, chain);

      expect(result).toEqual(mockClaims);
      expect(mockClaimStore.getClaimsForSettlement).toHaveBeenCalledWith(peerId, chain);
    });
  });
});
