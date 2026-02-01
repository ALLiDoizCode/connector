import { ClaimEventParser } from './claim-event-parser';
import { ClaimEventBuilder } from './claim-event-builder';
import pino from 'pino';
import {
  EVMSignedClaim,
  XRPSignedClaim,
  AptosSignedClaim,
  EVMClaimRequest,
  XRPClaimRequest,
  AptosClaimRequest,
  NostrClaimEvent,
  CLAIM_EVENT_EVM,
  CLAIM_EVENT_XRP,
  CLAIM_EVENT_APTOS,
  CLAIM_TAG,
  isEVMSignedClaim,
  isXRPSignedClaim,
  isAptosSignedClaim,
} from '@m2m/shared';
import { NostrEvent } from './toon-codec';

describe('ClaimEventParser', () => {
  let parser: ClaimEventParser;
  let builder: ClaimEventBuilder;
  const testPrivateKey = 'a'.repeat(64);
  const logger = pino({ level: 'silent' }); // Silent logger for tests

  beforeEach(() => {
    parser = new ClaimEventParser(logger);
    builder = new ClaimEventBuilder(testPrivateKey);
  });

  describe('isClaimEvent', () => {
    it('should return true for EVM claim event (kind 30001)', () => {
      const event: NostrClaimEvent = {
        id: 'test',
        pubkey: 'test',
        kind: CLAIM_EVENT_EVM,
        created_at: 123,
        content: 'test',
        tags: [],
        sig: 'test',
      };
      expect(parser.isClaimEvent(event)).toBe(true);
    });

    it('should return true for XRP claim event (kind 30002)', () => {
      const event: NostrClaimEvent = {
        id: 'test',
        pubkey: 'test',
        kind: CLAIM_EVENT_XRP,
        created_at: 123,
        content: 'test',
        tags: [],
        sig: 'test',
      };
      expect(parser.isClaimEvent(event)).toBe(true);
    });

    it('should return true for Aptos claim event (kind 30003)', () => {
      const event: NostrClaimEvent = {
        id: 'test',
        pubkey: 'test',
        kind: CLAIM_EVENT_APTOS,
        created_at: 123,
        content: 'test',
        tags: [],
        sig: 'test',
      };
      expect(parser.isClaimEvent(event)).toBe(true);
    });

    it('should return false for non-claim event', () => {
      const event = {
        id: 'test',
        pubkey: 'test',
        kind: 1, // Note event
        created_at: 123,
        content: 'test',
        tags: [],
        sig: 'test',
      };
      expect(parser.isClaimEvent(event)).toBe(false);
    });
  });

  describe('extractSignedClaim - EVM', () => {
    const evmClaimFixture: EVMSignedClaim = {
      chain: 'evm',
      channelId: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      transferredAmount: BigInt('1000000'),
      nonce: 5,
      lockedAmount: BigInt(0),
      locksRoot: '0x0000000000000000000000000000000000000000000000000000000000000000',
      signature: '0xsig',
      signer: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
    };

    it('should extract EVM signed claim', () => {
      const event = builder.wrapWithEVMClaim('Test', evmClaimFixture, []);
      const extracted = parser.extractSignedClaim(event);

      expect(extracted).not.toBeNull();
      expect(isEVMSignedClaim(extracted!)).toBe(true);

      const evmClaim = extracted as EVMSignedClaim;
      expect(evmClaim.chain).toBe('evm');
      expect(evmClaim.channelId).toBe(evmClaimFixture.channelId);
      expect(evmClaim.transferredAmount).toBe(evmClaimFixture.transferredAmount);
      expect(evmClaim.nonce).toBe(evmClaimFixture.nonce);
      expect(evmClaim.lockedAmount).toBe(evmClaimFixture.lockedAmount);
      expect(evmClaim.locksRoot).toBe(evmClaimFixture.locksRoot);
      expect(evmClaim.signature).toBe(evmClaimFixture.signature);
      expect(evmClaim.signer).toBe(evmClaimFixture.signer);
    });

    it('should convert amount string to bigint', () => {
      const event = builder.wrapWithEVMClaim('Test', evmClaimFixture, []);
      const extracted = parser.extractSignedClaim(event) as EVMSignedClaim;

      expect(typeof extracted.transferredAmount).toBe('bigint');
      expect(extracted.transferredAmount).toBe(BigInt('1000000'));
    });

    it('should convert nonce string to number', () => {
      const event = builder.wrapWithEVMClaim('Test', evmClaimFixture, []);
      const extracted = parser.extractSignedClaim(event) as EVMSignedClaim;

      expect(typeof extracted.nonce).toBe('number');
      expect(extracted.nonce).toBe(5);
    });

    it('should return null for missing required tag', () => {
      const event = builder.wrapWithEVMClaim('Test', evmClaimFixture, []);
      // Remove a required tag
      event.tags = event.tags.filter((t) => t[0] !== CLAIM_TAG.AMOUNT);

      const extracted = parser.extractSignedClaim(event);
      expect(extracted).toBeNull();
    });

    it('should return null for invalid amount', () => {
      const event = builder.wrapWithEVMClaim('Test', evmClaimFixture, []);
      // Set invalid amount
      const amountTag = event.tags.find((t) => t[0] === CLAIM_TAG.AMOUNT);
      if (amountTag) amountTag[1] = 'not-a-number';

      const extracted = parser.extractSignedClaim(event);
      expect(extracted).toBeNull();
    });
  });

  describe('extractSignedClaim - XRP', () => {
    const xrpClaimFixture: XRPSignedClaim = {
      chain: 'xrp',
      channelId: 'ABC1234567890DEF1234567890ABC1234567890DEF1234567890ABC1234567890',
      amount: BigInt(5000000),
      signature: '3045022100abcdef',
      signer: 'ED1234567890ABCDEF',
    };

    it('should extract XRP signed claim (NO nonce)', () => {
      const event = builder.wrapWithXRPClaim('Test', xrpClaimFixture, []);
      const extracted = parser.extractSignedClaim(event);

      expect(extracted).not.toBeNull();
      expect(isXRPSignedClaim(extracted!)).toBe(true);

      const xrpClaim = extracted as XRPSignedClaim;
      expect(xrpClaim.chain).toBe('xrp');
      expect(xrpClaim.channelId).toBe(xrpClaimFixture.channelId);
      expect(xrpClaim.amount).toBe(xrpClaimFixture.amount);
      expect(xrpClaim.signature).toBe(xrpClaimFixture.signature);
      expect(xrpClaim.signer).toBe(xrpClaimFixture.signer);
    });

    it('should not have nonce field for XRP', () => {
      const event = builder.wrapWithXRPClaim('Test', xrpClaimFixture, []);
      const extracted = parser.extractSignedClaim(event) as XRPSignedClaim;

      expect('nonce' in extracted).toBe(false);
    });
  });

  describe('extractSignedClaim - Aptos', () => {
    const aptosClaimFixture: AptosSignedClaim = {
      chain: 'aptos',
      channelOwner: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      amount: BigInt(100000000),
      nonce: 7,
      signature: 'abcdef1234567890',
      signer: '1234567890abcdef',
    };

    it('should extract Aptos signed claim', () => {
      const event = builder.wrapWithAptosClaim('Test', aptosClaimFixture, []);
      const extracted = parser.extractSignedClaim(event);

      expect(extracted).not.toBeNull();
      expect(isAptosSignedClaim(extracted!)).toBe(true);

      const aptosClaim = extracted as AptosSignedClaim;
      expect(aptosClaim.chain).toBe('aptos');
      expect(aptosClaim.channelOwner).toBe(aptosClaimFixture.channelOwner);
      expect(aptosClaim.amount).toBe(aptosClaimFixture.amount);
      expect(aptosClaim.nonce).toBe(aptosClaimFixture.nonce);
      expect(aptosClaim.signature).toBe(aptosClaimFixture.signature);
      expect(aptosClaim.signer).toBe(aptosClaimFixture.signer);
    });
  });

  describe('extractUnsignedRequests', () => {
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

    it('should extract single EVM request', () => {
      const requests: EVMClaimRequest[] = [
        {
          chain: 'evm',
          channelId: '0x1111',
          amount: BigInt(500),
          nonce: 3,
        },
      ];

      const event = builder.wrapWithEVMClaim('Test', evmClaimFixture, requests);
      const extracted = parser.extractUnsignedRequests(event);

      expect(extracted.length).toBe(1);
      expect(extracted[0]?.chain).toBe('evm');
      expect((extracted[0] as EVMClaimRequest).channelId).toBe('0x1111');
      expect((extracted[0] as EVMClaimRequest).amount).toBe(BigInt(500));
      expect((extracted[0] as EVMClaimRequest).nonce).toBe(3);
    });

    it('should extract single XRP request (NO nonce)', () => {
      const requests: XRPClaimRequest[] = [
        {
          chain: 'xrp',
          channelId: 'ABC123',
          amount: BigInt(25000),
        },
      ];

      const event = builder.wrapWithEVMClaim('Test', evmClaimFixture, requests);
      const extracted = parser.extractUnsignedRequests(event);

      expect(extracted.length).toBe(1);
      expect(extracted[0]?.chain).toBe('xrp');
      expect((extracted[0] as XRPClaimRequest).channelId).toBe('ABC123');
      expect((extracted[0] as XRPClaimRequest).amount).toBe(BigInt(25000));
      if (extracted[0]) {
        expect('nonce' in extracted[0]).toBe(false);
      }
    });

    it('should extract multiple requests (all chains)', () => {
      const requests: (EVMClaimRequest | XRPClaimRequest | AptosClaimRequest)[] = [
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
        {
          chain: 'aptos',
          channelOwner: '0x2222',
          amount: BigInt(100000),
          nonce: 5,
        },
      ];

      const event = builder.wrapWithEVMClaim('Test', evmClaimFixture, requests);
      const extracted = parser.extractUnsignedRequests(event);

      expect(extracted.length).toBe(3);
      expect(extracted[0]?.chain).toBe('evm');
      expect(extracted[1]?.chain).toBe('xrp');
      expect(extracted[2]?.chain).toBe('aptos');
    });

    it('should return empty array for no requests', () => {
      const event = builder.wrapWithEVMClaim('Test', evmClaimFixture, []);
      const extracted = parser.extractUnsignedRequests(event);

      expect(extracted).toEqual([]);
      expect(Array.isArray(extracted)).toBe(true);
    });

    it('should handle incomplete request tags gracefully', () => {
      const event = builder.wrapWithEVMClaim('Test', evmClaimFixture, []);
      // Add incomplete request tags
      event.tags.push([CLAIM_TAG.REQUEST_CHAIN, 'evm']);
      // Missing channel and amount

      const extracted = parser.extractUnsignedRequests(event);
      expect(extracted.length).toBe(0); // Should skip incomplete request
    });
  });

  describe('extractContent', () => {
    it('should extract plain text content', () => {
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

      const content = 'Payment received for task completion';
      const event = builder.wrapWithEVMClaim(content, evmClaim, []);
      const extracted = parser.extractContent(event);

      expect(extracted).toBe(content);
    });
  });

  describe('extractNestedEvent', () => {
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

    it('should extract nested NostrEvent from JSON content', () => {
      const nestedEvent: NostrEvent = {
        id: 'nested123',
        pubkey: 'pubkey123',
        kind: 1,
        created_at: 1234567890,
        content: 'Original message',
        tags: [['e', 'ref1']],
        sig: 'sig123',
      };

      const event = builder.wrapNestedEvent(nestedEvent, evmClaimFixture, []);
      const extracted = parser.extractNestedEvent(event);

      expect(extracted).not.toBeNull();
      expect(extracted!.id).toBe('nested123');
      expect(extracted!.content).toBe('Original message');
      expect(extracted!.tags).toEqual([['e', 'ref1']]);
    });

    it('should return null for plain text content', () => {
      const event = builder.wrapWithEVMClaim('Plain text', evmClaimFixture, []);
      const extracted = parser.extractNestedEvent(event);

      expect(extracted).toBeNull();
    });

    it('should return null for invalid JSON', () => {
      const event = builder.wrapWithEVMClaim('Not valid JSON {', evmClaimFixture, []);
      const extracted = parser.extractNestedEvent(event);

      expect(extracted).toBeNull();
    });

    it('should return null for JSON without NostrEvent structure', () => {
      const event = builder.wrapWithEVMClaim(JSON.stringify({ foo: 'bar' }), evmClaimFixture, []);
      const extracted = parser.extractNestedEvent(event);

      expect(extracted).toBeNull();
    });
  });

  describe('round-trip validation - EVM', () => {
    it('should preserve all data through build → parse cycle', () => {
      const originalClaim: EVMSignedClaim = {
        chain: 'evm',
        channelId: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        transferredAmount: BigInt('1000000000000000000'), // 1 ETH
        nonce: 5,
        lockedAmount: BigInt('500000000000000000'),
        locksRoot: '0x0000000000000000000000000000000000000000000000000000000000000000',
        signature: '0xabcdef',
        signer: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      };

      const originalRequests: (EVMClaimRequest | XRPClaimRequest)[] = [
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

      // Build event
      const event = builder.wrapContent('Test message', originalClaim, originalRequests);

      // Parse event
      const extractedClaim = parser.extractSignedClaim(event);
      const extractedRequests = parser.extractUnsignedRequests(event);
      const extractedContent = parser.extractContent(event);

      // Verify claim matches
      expect(extractedClaim).not.toBeNull();
      const evmClaim = extractedClaim as EVMSignedClaim;
      expect(evmClaim.chain).toBe(originalClaim.chain);
      expect(evmClaim.channelId).toBe(originalClaim.channelId);
      expect(evmClaim.transferredAmount).toBe(originalClaim.transferredAmount);
      expect(evmClaim.nonce).toBe(originalClaim.nonce);
      expect(evmClaim.lockedAmount).toBe(originalClaim.lockedAmount);
      expect(evmClaim.locksRoot).toBe(originalClaim.locksRoot);
      expect(evmClaim.signature).toBe(originalClaim.signature);
      expect(evmClaim.signer).toBe(originalClaim.signer);

      // Verify requests match
      expect(extractedRequests.length).toBe(2);
      expect(extractedRequests[0]?.chain).toBe('evm');
      expect((extractedRequests[0] as EVMClaimRequest).amount).toBe(BigInt(500));
      expect(extractedRequests[1]?.chain).toBe('xrp');
      expect((extractedRequests[1] as XRPClaimRequest).amount).toBe(BigInt(25000));

      // Verify content matches
      expect(extractedContent).toBe('Test message');
    });
  });

  describe('round-trip validation - XRP', () => {
    it('should preserve XRP data through build → parse cycle', () => {
      const originalClaim: XRPSignedClaim = {
        chain: 'xrp',
        channelId: 'ABC1234567890DEF',
        amount: BigInt(5000000),
        signature: '3045022100abcdef',
        signer: 'ED1234567890ABCDEF',
      };

      const event = builder.wrapContent('XRP payment', originalClaim, []);
      const extractedClaim = parser.extractSignedClaim(event);

      expect(extractedClaim).not.toBeNull();
      const xrpClaim = extractedClaim as XRPSignedClaim;
      expect(xrpClaim.chain).toBe(originalClaim.chain);
      expect(xrpClaim.channelId).toBe(originalClaim.channelId);
      expect(xrpClaim.amount).toBe(originalClaim.amount);
      expect(xrpClaim.signature).toBe(originalClaim.signature);
      expect(xrpClaim.signer).toBe(originalClaim.signer);
    });
  });

  describe('round-trip validation - Aptos', () => {
    it('should preserve Aptos data through build → parse cycle', () => {
      const originalClaim: AptosSignedClaim = {
        chain: 'aptos',
        channelOwner: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        amount: BigInt(100000000),
        nonce: 7,
        signature: 'abcdef1234567890',
        signer: '1234567890abcdef',
      };

      const event = builder.wrapContent('Aptos payment', originalClaim, []);
      const extractedClaim = parser.extractSignedClaim(event);

      expect(extractedClaim).not.toBeNull();
      const aptosClaim = extractedClaim as AptosSignedClaim;
      expect(aptosClaim.chain).toBe(originalClaim.chain);
      expect(aptosClaim.channelOwner).toBe(originalClaim.channelOwner);
      expect(aptosClaim.amount).toBe(originalClaim.amount);
      expect(aptosClaim.nonce).toBe(originalClaim.nonce);
      expect(aptosClaim.signature).toBe(originalClaim.signature);
      expect(aptosClaim.signer).toBe(originalClaim.signer);
    });
  });

  describe('round-trip validation - nested events', () => {
    it('should preserve nested event through build → parse cycle', () => {
      const originalNested: NostrEvent = {
        id: 'nested789',
        pubkey: 'pubkey789',
        kind: 5,
        created_at: 9876543210,
        content: 'Delete this event',
        tags: [
          ['e', 'event123'],
          ['p', 'pubkey123'],
        ],
        sig: 'sig789',
      };

      const claim: EVMSignedClaim = {
        chain: 'evm',
        channelId: '0xabc',
        transferredAmount: BigInt(1000),
        nonce: 1,
        lockedAmount: BigInt(0),
        locksRoot: '0x000',
        signature: '0xsig',
        signer: '0xsigner',
      };

      const event = builder.wrapNestedEvent(originalNested, claim, []);
      const extractedNested = parser.extractNestedEvent(event);

      expect(extractedNested).not.toBeNull();
      expect(extractedNested!.id).toBe(originalNested.id);
      expect(extractedNested!.pubkey).toBe(originalNested.pubkey);
      expect(extractedNested!.kind).toBe(originalNested.kind);
      expect(extractedNested!.created_at).toBe(originalNested.created_at);
      expect(extractedNested!.content).toBe(originalNested.content);
      expect(extractedNested!.tags).toEqual(originalNested.tags);
      expect(extractedNested!.sig).toBe(originalNested.sig);
    });
  });

  describe('graceful error handling', () => {
    it('should return null for non-claim event kind', () => {
      const event = {
        id: 'test',
        pubkey: 'test',
        kind: 1, // Not a claim event
        created_at: 123,
        content: 'test',
        tags: [],
        sig: 'test',
      };

      const extracted = parser.extractSignedClaim(event as NostrClaimEvent);
      expect(extracted).toBeNull();
    });

    it('should not throw for missing tags', () => {
      const event: NostrClaimEvent = {
        id: 'test',
        pubkey: 'test',
        kind: CLAIM_EVENT_EVM,
        created_at: 123,
        content: 'test',
        tags: [], // Empty tags
        sig: 'test',
      };

      expect(() => parser.extractSignedClaim(event)).not.toThrow();
      expect(parser.extractSignedClaim(event)).toBeNull();
    });

    it('should not throw for malformed amount', () => {
      const event: NostrClaimEvent = {
        id: 'test',
        pubkey: 'test',
        kind: CLAIM_EVENT_EVM,
        created_at: 123,
        content: 'test',
        tags: [
          [CLAIM_TAG.CHANNEL, '0xabc'],
          [CLAIM_TAG.AMOUNT, 'not-a-number'],
        ],
        sig: 'test',
      };

      expect(() => parser.extractSignedClaim(event)).not.toThrow();
      expect(parser.extractSignedClaim(event)).toBeNull();
    });
  });
});
