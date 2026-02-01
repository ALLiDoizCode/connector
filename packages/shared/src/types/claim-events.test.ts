/**
 * Unit tests for claim event types and type guards
 * Epic 30 Story 30.1 Task 8
 */

import {
  CLAIM_EVENT_EVM,
  CLAIM_EVENT_XRP,
  CLAIM_EVENT_APTOS,
  CLAIM_EVENT_KINDS,
  isClaimEventKind,
  getChainFromEventKind,
  getEventKindFromChain,
  EVMSignedClaim,
  XRPSignedClaim,
  AptosSignedClaim,
  isEVMSignedClaim,
  isXRPSignedClaim,
  isAptosSignedClaim,
} from './claim-events';

describe('Claim Event Constants', () => {
  it('should define correct event kinds', () => {
    expect(CLAIM_EVENT_EVM).toBe(30001);
    expect(CLAIM_EVENT_XRP).toBe(30002);
    expect(CLAIM_EVENT_APTOS).toBe(30003);
  });

  it('should include all event kinds in CLAIM_EVENT_KINDS', () => {
    expect(CLAIM_EVENT_KINDS).toContain(CLAIM_EVENT_EVM);
    expect(CLAIM_EVENT_KINDS).toContain(CLAIM_EVENT_XRP);
    expect(CLAIM_EVENT_KINDS).toContain(CLAIM_EVENT_APTOS);
    expect(CLAIM_EVENT_KINDS.length).toBe(3);
  });
});

describe('isClaimEventKind', () => {
  it('should return true for valid claim event kinds', () => {
    expect(isClaimEventKind(30001)).toBe(true);
    expect(isClaimEventKind(30002)).toBe(true);
    expect(isClaimEventKind(30003)).toBe(true);
  });

  it('should return false for non-claim event kinds', () => {
    expect(isClaimEventKind(1)).toBe(false);
    expect(isClaimEventKind(30000)).toBe(false);
    expect(isClaimEventKind(30004)).toBe(false);
  });
});

describe('getChainFromEventKind', () => {
  it('should return correct chain for valid kinds', () => {
    expect(getChainFromEventKind(30001)).toBe('evm');
    expect(getChainFromEventKind(30002)).toBe('xrp');
    expect(getChainFromEventKind(30003)).toBe('aptos');
  });

  it('should return null for invalid kinds', () => {
    expect(getChainFromEventKind(1)).toBeNull();
    expect(getChainFromEventKind(30004)).toBeNull();
  });
});

describe('getEventKindFromChain', () => {
  it('should return correct kind for each chain', () => {
    expect(getEventKindFromChain('evm')).toBe(30001);
    expect(getEventKindFromChain('xrp')).toBe(30002);
    expect(getEventKindFromChain('aptos')).toBe(30003);
  });
});

describe('Signed Claim Type Guards', () => {
  const evmClaim: EVMSignedClaim = {
    chain: 'evm',
    channelId: '0x123',
    transferredAmount: BigInt(1000),
    nonce: 1,
    lockedAmount: BigInt(0),
    locksRoot: '0x000',
    signature: '0xsig',
    signer: '0xaddr',
  };

  const xrpClaim: XRPSignedClaim = {
    chain: 'xrp',
    channelId: 'ABC123',
    amount: BigInt(5000000),
    signature: 'sig',
    signer: 'EDpubkey',
  };

  const aptosClaim: AptosSignedClaim = {
    chain: 'aptos',
    channelOwner: '0xowner',
    amount: BigInt(100000000),
    nonce: 5,
    signature: 'sig',
    signer: 'pubkey',
  };

  it('should identify EVM claims', () => {
    expect(isEVMSignedClaim(evmClaim)).toBe(true);
    expect(isEVMSignedClaim(xrpClaim)).toBe(false);
    expect(isEVMSignedClaim(aptosClaim)).toBe(false);
  });

  it('should identify XRP claims', () => {
    expect(isXRPSignedClaim(xrpClaim)).toBe(true);
    expect(isXRPSignedClaim(evmClaim)).toBe(false);
    expect(isXRPSignedClaim(aptosClaim)).toBe(false);
  });

  it('should identify Aptos claims', () => {
    expect(isAptosSignedClaim(aptosClaim)).toBe(true);
    expect(isAptosSignedClaim(evmClaim)).toBe(false);
    expect(isAptosSignedClaim(xrpClaim)).toBe(false);
  });
});
