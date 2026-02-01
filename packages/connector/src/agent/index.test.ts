/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Integration test for agent module exports
 * Verifies that ClaimEventBuilder, ClaimEventParser, ClaimStore, and ClaimManager can be imported correctly
 */

import {
  ClaimEventBuilder,
  ClaimEventParser,
  ClaimStore,
  ClaimManager,
  WalletAddresses,
  ProcessClaimResult,
} from './index';
import pino from 'pino';

describe('Agent module exports', () => {
  describe('ClaimEventBuilder export', () => {
    it('should export ClaimEventBuilder class', () => {
      expect(ClaimEventBuilder).toBeDefined();
      expect(typeof ClaimEventBuilder).toBe('function');
    });

    it('should be instantiable', () => {
      const privateKey = 'a'.repeat(64);
      const builder = new ClaimEventBuilder(privateKey);
      expect(builder).toBeInstanceOf(ClaimEventBuilder);
    });

    it('should have expected methods', () => {
      const privateKey = 'a'.repeat(64);
      const builder = new ClaimEventBuilder(privateKey);
      expect(typeof builder.wrapContent).toBe('function');
      expect(typeof builder.wrapWithEVMClaim).toBe('function');
      expect(typeof builder.wrapWithXRPClaim).toBe('function');
      expect(typeof builder.wrapWithAptosClaim).toBe('function');
      expect(typeof builder.wrapNestedEvent).toBe('function');
    });
  });

  describe('ClaimEventParser export', () => {
    it('should export ClaimEventParser class', () => {
      expect(ClaimEventParser).toBeDefined();
      expect(typeof ClaimEventParser).toBe('function');
    });

    it('should be instantiable', () => {
      const logger = pino({ level: 'silent' });
      const parser = new ClaimEventParser(logger);
      expect(parser).toBeInstanceOf(ClaimEventParser);
    });

    it('should have expected methods', () => {
      const logger = pino({ level: 'silent' });
      const parser = new ClaimEventParser(logger);
      expect(typeof parser.isClaimEvent).toBe('function');
      expect(typeof parser.extractSignedClaim).toBe('function');
      expect(typeof parser.extractUnsignedRequests).toBe('function');
      expect(typeof parser.extractContent).toBe('function');
      expect(typeof parser.extractNestedEvent).toBe('function');
    });
  });

  describe('ClaimStore export', () => {
    it('should export ClaimStore class', () => {
      expect(ClaimStore).toBeDefined();
      expect(typeof ClaimStore).toBe('function');
    });

    it('should be instantiable', () => {
      const logger = pino({ level: 'silent' });
      const store = new ClaimStore(':memory:', logger);
      expect(store).toBeInstanceOf(ClaimStore);
      store.close();
    });

    it('should have expected methods', () => {
      const logger = pino({ level: 'silent' });
      const store = new ClaimStore(':memory:', logger);
      expect(typeof store.storeEVMClaim).toBe('function');
      expect(typeof store.storeXRPClaim).toBe('function');
      expect(typeof store.storeAptosClaim).toBe('function');
      expect(typeof store.getLatestClaim).toBe('function');
      expect(typeof store.getClaimsForSettlement).toBe('function');
      expect(typeof store.getAllClaimsByPeer).toBe('function');
      expect(typeof store.close).toBe('function');
      expect(typeof store.deleteAllClaimsForPeer).toBe('function');
      expect(typeof store.getStorageStats).toBe('function');
      store.close();
    });
  });

  describe('ClaimManager export', () => {
    it('should export ClaimManager class', () => {
      expect(ClaimManager).toBeDefined();
      expect(typeof ClaimManager).toBe('function');
    });

    it('should export WalletAddresses type', () => {
      // TypeScript compilation will fail if type is not exported
      const walletAddresses: WalletAddresses = {
        evm: '0x1234567890123456789012345678901234567890',
        xrp: 'rABCDEFGHIJKLMNOPQRSTUVWXYZ12345',
        aptos: '0x' + 'a'.repeat(64),
      };
      expect(walletAddresses).toBeDefined();
    });

    it('should export ProcessClaimResult type', () => {
      // TypeScript compilation will fail if type is not exported
      const result: ProcessClaimResult = {
        signedClaims: [],
        unsignedRequests: [],
        signedResponses: [],
        errors: [],
      };
      expect(result).toBeDefined();
    });

    it('should be instantiable', () => {
      const logger = pino({ level: 'silent' });
      const privateKey = 'a'.repeat(64);
      const builder = new ClaimEventBuilder(privateKey);
      const parser = new ClaimEventParser(logger);
      const store = new ClaimStore(':memory:', logger);

      const mockPaymentChannelSDK = {} as any;
      const mockXRPClaimSigner = {} as any;
      const mockAptosClaimSigner = {} as any;
      const walletAddresses: WalletAddresses = {
        evm: '0x1234567890123456789012345678901234567890',
      };

      const manager = new ClaimManager(
        mockPaymentChannelSDK,
        mockXRPClaimSigner,
        mockAptosClaimSigner,
        store,
        builder,
        parser,
        walletAddresses,
        logger
      );

      expect(manager).toBeInstanceOf(ClaimManager);
      store.close();
    });

    it('should have expected methods', () => {
      const logger = pino({ level: 'silent' });
      const privateKey = 'a'.repeat(64);
      const builder = new ClaimEventBuilder(privateKey);
      const parser = new ClaimEventParser(logger);
      const store = new ClaimStore(':memory:', logger);

      const mockPaymentChannelSDK = {} as any;
      const mockXRPClaimSigner = {} as any;
      const mockAptosClaimSigner = {} as any;
      const walletAddresses: WalletAddresses = {};

      const manager = new ClaimManager(
        mockPaymentChannelSDK,
        mockXRPClaimSigner,
        mockAptosClaimSigner,
        store,
        builder,
        parser,
        walletAddresses,
        logger
      );

      expect(typeof manager.generateClaimForPeer).toBe('function');
      expect(typeof manager.generateClaimEventForPeer).toBe('function');
      expect(typeof manager.verifyClaimSignature).toBe('function');
      expect(typeof manager.verifyMonotonicity).toBe('function');
      expect(typeof manager.verifyAmountWithinBounds).toBe('function');
      expect(typeof manager.processReceivedClaimEvent).toBe('function');
      expect(typeof manager.getClaimsForSettlement).toBe('function');

      store.close();
    });
  });

  describe('TypeScript compilation', () => {
    it('should have no TypeScript errors for imports', () => {
      // This test verifies that TypeScript compilation succeeds
      // If there are type errors in the imports, Jest with ts-jest will fail
      const privateKey = 'a'.repeat(64);
      const logger = pino({ level: 'silent' });

      const builder = new ClaimEventBuilder(privateKey);
      const parser = new ClaimEventParser(logger);
      const store = new ClaimStore(':memory:', logger);

      expect(builder).toBeDefined();
      expect(parser).toBeDefined();
      expect(store).toBeDefined();

      store.close();
    });
  });
});
