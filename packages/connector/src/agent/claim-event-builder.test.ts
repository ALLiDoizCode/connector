import { ClaimEventBuilder } from './claim-event-builder';
import {
  EVMSignedClaim,
  XRPSignedClaim,
  AptosSignedClaim,
  EVMClaimRequest,
  XRPClaimRequest,
  CLAIM_EVENT_EVM,
  CLAIM_EVENT_XRP,
  CLAIM_EVENT_APTOS,
  CLAIM_TAG,
} from '@m2m/shared';
import { NostrEvent } from './toon-codec';

describe('ClaimEventBuilder', () => {
  // Test private key (hex-encoded 64 characters)
  const testPrivateKey = 'a'.repeat(64);
  let builder: ClaimEventBuilder;

  beforeEach(() => {
    builder = new ClaimEventBuilder(testPrivateKey);
  });

  describe('constructor', () => {
    it('should throw error for invalid private key length', () => {
      expect(() => new ClaimEventBuilder('short')).toThrow('Invalid private key length');
    });

    it('should accept 64-character hex private key', () => {
      expect(() => new ClaimEventBuilder(testPrivateKey)).not.toThrow();
    });
  });

  describe('wrapWithEVMClaim', () => {
    const evmClaimFixture: EVMSignedClaim = {
      chain: 'evm',
      channelId: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      transferredAmount: BigInt('1000000'),
      nonce: 5,
      lockedAmount: BigInt(0),
      locksRoot: '0x0000000000000000000000000000000000000000000000000000000000000000',
      signature:
        '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
      signer: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
    };

    it('should create event with kind 30001', () => {
      const event = builder.wrapWithEVMClaim('Test message', evmClaimFixture, []);
      expect(event.kind).toBe(CLAIM_EVENT_EVM);
    });

    it('should include all EVM-specific tags', () => {
      const event = builder.wrapWithEVMClaim('Test message', evmClaimFixture, []);

      const findTag = (name: string) => event.tags.find((t) => t[0] === name)?.[1];

      expect(findTag(CLAIM_TAG.IDENTIFIER)).toBe(evmClaimFixture.channelId);
      expect(findTag(CLAIM_TAG.CHAIN)).toBe('evm');
      expect(findTag(CLAIM_TAG.CHANNEL)).toBe(evmClaimFixture.channelId);
      expect(findTag(CLAIM_TAG.AMOUNT)).toBe('1000000');
      expect(findTag(CLAIM_TAG.NONCE)).toBe('5');
      expect(findTag(CLAIM_TAG.LOCKED)).toBe('0');
      expect(findTag(CLAIM_TAG.LOCKS_ROOT)).toBe(evmClaimFixture.locksRoot);
      expect(findTag(CLAIM_TAG.SIGNATURE)).toBe(evmClaimFixture.signature);
      expect(findTag(CLAIM_TAG.SIGNER)).toBe(evmClaimFixture.signer);
    });

    it('should set d tag to channelId', () => {
      const event = builder.wrapWithEVMClaim('Test message', evmClaimFixture, []);
      const dTag = event.tags.find((t) => t[0] === 'd')?.[1];
      expect(dTag).toBe(evmClaimFixture.channelId);
    });

    it('should include content field', () => {
      const content = 'Payment received';
      const event = builder.wrapWithEVMClaim(content, evmClaimFixture, []);
      expect(event.content).toBe(content);
    });

    it('should have valid Nostr event structure', () => {
      const event = builder.wrapWithEVMClaim('Test', evmClaimFixture, []);
      expect(event.id).toBeDefined();
      expect(event.pubkey).toBeDefined();
      expect(event.created_at).toBeGreaterThan(0);
      expect(event.sig).toBeDefined();
      expect(Array.isArray(event.tags)).toBe(true);
    });
  });

  describe('wrapWithXRPClaim', () => {
    const xrpClaimFixture: XRPSignedClaim = {
      chain: 'xrp',
      channelId: 'ABC1234567890DEF1234567890ABC1234567890DEF1234567890ABC1234567890',
      amount: BigInt(5000000), // 5 XRP in drops
      signature:
        '3045022100abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890022000fedcba0987654321fedcba0987654321fedcba0987654321fedcba09876543',
      signer: 'ED1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF',
    };

    it('should create event with kind 30002', () => {
      const event = builder.wrapWithXRPClaim('Test message', xrpClaimFixture, []);
      expect(event.kind).toBe(CLAIM_EVENT_XRP);
    });

    it('should include XRP-specific tags (NO nonce)', () => {
      const event = builder.wrapWithXRPClaim('Test message', xrpClaimFixture, []);

      const findTag = (name: string) => event.tags.find((t) => t[0] === name)?.[1];

      expect(findTag(CLAIM_TAG.IDENTIFIER)).toBe(xrpClaimFixture.channelId);
      expect(findTag(CLAIM_TAG.CHAIN)).toBe('xrp');
      expect(findTag(CLAIM_TAG.CHANNEL)).toBe(xrpClaimFixture.channelId);
      expect(findTag(CLAIM_TAG.AMOUNT)).toBe('5000000');
      expect(findTag(CLAIM_TAG.SIGNATURE)).toBe(xrpClaimFixture.signature);
      expect(findTag(CLAIM_TAG.SIGNER)).toBe(xrpClaimFixture.signer);

      // XRP should NOT have nonce tag
      const nonceTag = event.tags.find((t) => t[0] === CLAIM_TAG.NONCE);
      expect(nonceTag).toBeUndefined();
    });
  });

  describe('wrapWithAptosClaim', () => {
    const aptosClaimFixture: AptosSignedClaim = {
      chain: 'aptos',
      channelOwner: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      amount: BigInt(100000000), // 1 APT in octas
      nonce: 7,
      signature:
        'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      signer: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    };

    it('should create event with kind 30003', () => {
      const event = builder.wrapWithAptosClaim('Test message', aptosClaimFixture, []);
      expect(event.kind).toBe(CLAIM_EVENT_APTOS);
    });

    it('should include Aptos-specific tags', () => {
      const event = builder.wrapWithAptosClaim('Test message', aptosClaimFixture, []);

      const findTag = (name: string) => event.tags.find((t) => t[0] === name)?.[1];

      expect(findTag(CLAIM_TAG.IDENTIFIER)).toBe(aptosClaimFixture.channelOwner);
      expect(findTag(CLAIM_TAG.CHAIN)).toBe('aptos');
      expect(findTag(CLAIM_TAG.CHANNEL)).toBe(aptosClaimFixture.channelOwner);
      expect(findTag(CLAIM_TAG.AMOUNT)).toBe('100000000');
      expect(findTag(CLAIM_TAG.NONCE)).toBe('7');
      expect(findTag(CLAIM_TAG.SIGNATURE)).toBe(aptosClaimFixture.signature);
      expect(findTag(CLAIM_TAG.SIGNER)).toBe(aptosClaimFixture.signer);
    });

    it('should set d tag to channelOwner', () => {
      const event = builder.wrapWithAptosClaim('Test message', aptosClaimFixture, []);
      const dTag = event.tags.find((t) => t[0] === 'd')?.[1];
      expect(dTag).toBe(aptosClaimFixture.channelOwner);
    });
  });

  describe('unsigned request tags', () => {
    const evmClaimFixture: EVMSignedClaim = {
      chain: 'evm',
      channelId: '0xabc',
      transferredAmount: BigInt(1000),
      nonce: 1,
      lockedAmount: BigInt(0),
      locksRoot: '0x000',
      signature: '0xsig',
      signer: '0xsigner',
    };

    it('should add unsigned EVM request tags', () => {
      const requests: EVMClaimRequest[] = [
        {
          chain: 'evm',
          channelId: '0x1111',
          amount: BigInt(500),
          nonce: 3,
        },
      ];

      const event = builder.wrapWithEVMClaim('Test', evmClaimFixture, requests);

      const requestTags = event.tags.filter((t) => t[0]?.startsWith('request-'));
      expect(requestTags.length).toBeGreaterThan(0);

      const findRequestTag = (name: string) => event.tags.find((t) => t[0] === name)?.[1];
      expect(findRequestTag(CLAIM_TAG.REQUEST_CHAIN)).toBe('evm');
      expect(findRequestTag(CLAIM_TAG.REQUEST_CHANNEL)).toBe('0x1111');
      expect(findRequestTag(CLAIM_TAG.REQUEST_AMOUNT)).toBe('500');
      expect(findRequestTag(CLAIM_TAG.REQUEST_NONCE)).toBe('3');
    });

    it('should add unsigned XRP request tags (NO nonce)', () => {
      const requests: XRPClaimRequest[] = [
        {
          chain: 'xrp',
          channelId: 'ABC123',
          amount: BigInt(25000),
        },
      ];

      const event = builder.wrapWithEVMClaim('Test', evmClaimFixture, requests);

      const findRequestTag = (name: string) => event.tags.find((t) => t[0] === name)?.[1];
      expect(findRequestTag(CLAIM_TAG.REQUEST_CHAIN)).toBe('xrp');
      expect(findRequestTag(CLAIM_TAG.REQUEST_CHANNEL)).toBe('ABC123');
      expect(findRequestTag(CLAIM_TAG.REQUEST_AMOUNT)).toBe('25000');

      // XRP should NOT have request-nonce tag
      const nonceTag = event.tags.find((t) => t[0] === CLAIM_TAG.REQUEST_NONCE);
      expect(nonceTag).toBeUndefined();
    });

    it('should add multiple unsigned requests', () => {
      const requests: (EVMClaimRequest | XRPClaimRequest)[] = [
        {
          chain: 'evm',
          channelId: '0x1111',
          amount: BigInt(500),
          nonce: 3,
        },
        {
          chain: 'xrp',
          channelId: 'ABC123',
          amount: BigInt(25000),
        },
      ];

      const event = builder.wrapWithEVMClaim('Test', evmClaimFixture, requests);

      const requestChainTags = event.tags.filter((t) => t[0] === CLAIM_TAG.REQUEST_CHAIN);
      expect(requestChainTags.length).toBe(2);
      expect(requestChainTags[0]?.[1]).toBe('evm');
      expect(requestChainTags[1]?.[1]).toBe('xrp');
    });

    it('should handle empty request array', () => {
      const event = builder.wrapWithEVMClaim('Test', evmClaimFixture, []);
      const requestTags = event.tags.filter((t) => t[0]?.startsWith('request-'));
      expect(requestTags.length).toBe(0);
    });
  });

  describe('wrapContent - dispatcher', () => {
    it('should dispatch to EVM wrapper for EVM claim', () => {
      const evmClaim: EVMSignedClaim = {
        chain: 'evm',
        channelId: '0xabc',
        transferredAmount: BigInt(1000),
        nonce: 1,
        lockedAmount: BigInt(0),
        locksRoot: '0x000',
        signature: '0xsig',
        signer: '0xsigner',
      };

      const event = builder.wrapContent('Test', evmClaim, []);
      expect(event.kind).toBe(CLAIM_EVENT_EVM);
    });

    it('should dispatch to XRP wrapper for XRP claim', () => {
      const xrpClaim: XRPSignedClaim = {
        chain: 'xrp',
        channelId: 'ABC',
        amount: BigInt(1000),
        signature: 'sig',
        signer: 'signer',
      };

      const event = builder.wrapContent('Test', xrpClaim, []);
      expect(event.kind).toBe(CLAIM_EVENT_XRP);
    });

    it('should dispatch to Aptos wrapper for Aptos claim', () => {
      const aptosClaim: AptosSignedClaim = {
        chain: 'aptos',
        channelOwner: '0xowner',
        amount: BigInt(1000),
        nonce: 1,
        signature: 'sig',
        signer: 'signer',
      };

      const event = builder.wrapContent('Test', aptosClaim, []);
      expect(event.kind).toBe(CLAIM_EVENT_APTOS);
    });
  });

  describe('wrapNestedEvent', () => {
    const evmClaimFixture: EVMSignedClaim = {
      chain: 'evm',
      channelId: '0xabc',
      transferredAmount: BigInt(1000),
      nonce: 1,
      lockedAmount: BigInt(0),
      locksRoot: '0x000',
      signature: '0xsig',
      signer: '0xsigner',
    };

    it('should wrap nested event as JSON in content', () => {
      const nestedEvent: NostrEvent = {
        id: 'nested123',
        pubkey: 'pubkey123',
        kind: 1,
        created_at: 1234567890,
        content: 'Original message',
        tags: [],
        sig: 'sig123',
      };

      const event = builder.wrapNestedEvent(nestedEvent, evmClaimFixture, []);

      // Content should be JSON string
      expect(() => JSON.parse(event.content)).not.toThrow();
      const parsed = JSON.parse(event.content);
      expect(parsed.id).toBe('nested123');
      expect(parsed.content).toBe('Original message');
    });

    it('should preserve nested event structure', () => {
      const nestedEvent: NostrEvent = {
        id: 'nested456',
        pubkey: 'pubkey456',
        kind: 5,
        created_at: 9876543210,
        content: 'Delete event',
        tags: [['e', 'event123']],
        sig: 'sig456',
      };

      const event = builder.wrapNestedEvent(nestedEvent, evmClaimFixture, []);
      const parsed = JSON.parse(event.content);

      expect(parsed.id).toBe(nestedEvent.id);
      expect(parsed.pubkey).toBe(nestedEvent.pubkey);
      expect(parsed.kind).toBe(nestedEvent.kind);
      expect(parsed.created_at).toBe(nestedEvent.created_at);
      expect(parsed.content).toBe(nestedEvent.content);
      expect(parsed.tags).toEqual(nestedEvent.tags);
      expect(parsed.sig).toBe(nestedEvent.sig);
    });
  });

  describe('bigint handling', () => {
    it('should convert large bigint amounts to string', () => {
      const largeClaim: EVMSignedClaim = {
        chain: 'evm',
        channelId: '0xabc',
        transferredAmount: BigInt('1000000000000000000'), // 1 ETH in wei
        nonce: 1,
        lockedAmount: BigInt('500000000000000000'),
        locksRoot: '0x000',
        signature: '0xsig',
        signer: '0xsigner',
      };

      const event = builder.wrapWithEVMClaim('Test', largeClaim, []);
      const amountTag = event.tags.find((t) => t[0] === CLAIM_TAG.AMOUNT)?.[1];
      const lockedTag = event.tags.find((t) => t[0] === CLAIM_TAG.LOCKED)?.[1];

      expect(amountTag).toBe('1000000000000000000');
      expect(lockedTag).toBe('500000000000000000');
    });
  });
});
