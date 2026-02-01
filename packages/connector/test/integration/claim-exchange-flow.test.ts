/**
 * Integration Test: Claim Exchange Flow
 *
 * Tests full claim exchange flow between two AgentServer instances.
 * Verifies automatic balance proof exchange during BTP packet transmission.
 */

import { AgentServer } from '../../src/agent/agent-server';
import { getPublicKey } from 'nostr-tools';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('Claim Exchange Flow Integration', () => {
  let agentA: AgentServer;
  let agentB: AgentServer;
  let testDir: string;

  // Test keypairs
  const privkeyA = Buffer.from(
    '0000000000000000000000000000000000000000000000000000000000000001',
    'hex'
  );
  const pubkeyA = getPublicKey(privkeyA);
  const privkeyB = Buffer.from(
    '0000000000000000000000000000000000000000000000000000000000000002',
    'hex'
  );
  const pubkeyB = getPublicKey(privkeyB);

  // EVM test keypairs
  const evmPrivkeyA = '0x1234567890123456789012345678901234567890123456789012345678901234';
  const evmPrivkeyB = '0x2234567890123456789012345678901234567890123456789012345678901234';

  beforeEach(async () => {
    // Create temporary test directory
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claim-exchange-test-'));

    // Create Agent A
    agentA = new AgentServer({
      httpPort: 8081,
      btpPort: 3001,
      explorerPort: 5001,
      agentId: 'agent-a',
      nostrPubkey: pubkeyA,
      nostrPrivkey: privkeyA.toString('hex'),
      databasePath: path.join(testDir, 'agent-a.db'),
      explorerDbPath: path.join(testDir, 'explorer-a.db'),
      ilpAddress: 'g.agent.agent-a',
      evmPrivkey: evmPrivkeyA,
      evmAddress: '0x0000000000000000000000000000000000000001',
      anvilRpcUrl: null, // No blockchain for mock test
      tokenNetworkAddress: null,
      agentTokenAddress: null,
      xrpEnabled: false,
      xrpWssUrl: null,
      xrpNetwork: 'standalone',
      xrpAccountSecret: null,
      xrpAccountAddress: null,
      aptosEnabled: false,
      aptosNodeUrl: null,
      aptosPrivateKey: null,
      aptosModuleAddress: null,
      aptosAccountAddress: null,
      aptosCoinType: null,
      settlementThreshold: null,
      claimExchangeEnabled: true,
    });

    // Create Agent B
    agentB = new AgentServer({
      httpPort: 8082,
      btpPort: 3002,
      explorerPort: 5002,
      agentId: 'agent-b',
      nostrPubkey: pubkeyB,
      nostrPrivkey: privkeyB.toString('hex'),
      databasePath: path.join(testDir, 'agent-b.db'),
      explorerDbPath: path.join(testDir, 'explorer-b.db'),
      ilpAddress: 'g.agent.agent-b',
      evmPrivkey: evmPrivkeyB,
      evmAddress: '0x0000000000000000000000000000000000000002',
      anvilRpcUrl: null,
      tokenNetworkAddress: null,
      agentTokenAddress: null,
      xrpEnabled: false,
      xrpWssUrl: null,
      xrpNetwork: 'standalone',
      xrpAccountSecret: null,
      xrpAccountAddress: null,
      aptosEnabled: false,
      aptosNodeUrl: null,
      aptosPrivateKey: null,
      aptosModuleAddress: null,
      aptosAccountAddress: null,
      aptosCoinType: null,
      settlementThreshold: null,
      claimExchangeEnabled: true,
    });

    // Start both agents (but they won't have ClaimManager without blockchain)
    await agentA.start();
    await agentB.start();
  });

  afterEach(async () => {
    // Stop agents
    await agentA.shutdown();
    await agentB.shutdown();

    // Clean up test directory
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('Feature Flag', () => {
    it('should initialize ClaimStore when feature enabled', () => {
      // ClaimStore should be initialized even without blockchain
      expect(agentA['claimStore']).toBeDefined();
      expect(agentB['claimStore']).toBeDefined();
    });

    it('should not initialize ClaimManager without blockchain', () => {
      // ClaimManager requires blockchain configuration
      expect(agentA['claimManager']).toBeNull();
      expect(agentB['claimManager']).toBeNull();
    });
  });

  describe('Feature Flag Disabled', () => {
    let agentC: AgentServer;

    beforeEach(async () => {
      // Create agent with claim exchange disabled
      agentC = new AgentServer({
        httpPort: 8083,
        btpPort: 3003,
        explorerPort: 5003,
        agentId: 'agent-c',
        nostrPubkey: pubkeyA,
        nostrPrivkey: privkeyA.toString('hex'),
        databasePath: path.join(testDir, 'agent-c.db'),
        explorerDbPath: path.join(testDir, 'explorer-c.db'),
        ilpAddress: 'g.agent.agent-c',
        evmPrivkey: evmPrivkeyA,
        evmAddress: '0x0000000000000000000000000000000000000003',
        anvilRpcUrl: null,
        tokenNetworkAddress: null,
        agentTokenAddress: null,
        xrpEnabled: false,
        xrpWssUrl: null,
        xrpNetwork: 'standalone',
        xrpAccountSecret: null,
        xrpAccountAddress: null,
        aptosEnabled: false,
        aptosNodeUrl: null,
        aptosPrivateKey: null,
        aptosModuleAddress: null,
        aptosAccountAddress: null,
        aptosCoinType: null,
        settlementThreshold: null,
        claimExchangeEnabled: false, // DISABLED
      });

      await agentC.start();
    });

    afterEach(async () => {
      await agentC.shutdown();
    });

    it('should not initialize ClaimStore when feature disabled', () => {
      expect(agentC['claimStore']).toBeNull();
      expect(agentC['claimManager']).toBeNull();
    });

    it('should return 503 from /claims endpoint when disabled', async () => {
      const response = await fetch('http://localhost:8083/claims/agent-b');
      expect(response.status).toBe(503);
      const data = (await response.json()) as { error: string };
      expect(data.error).toBe('Claim exchange not enabled');
    });
  });

  describe('HTTP Endpoint', () => {
    it('should return empty claims for unknown peer', async () => {
      const response = await fetch('http://localhost:8081/claims/unknown-peer');
      expect(response.status).toBe(200);
      const data = (await response.json()) as { peerId: string; claims: unknown[] };
      expect(data.peerId).toBe('unknown-peer');
      expect(data.claims).toEqual([]);
    });

    it('should return 400 for missing peer ID', async () => {
      const response = await fetch('http://localhost:8081/claims/');
      expect(response.status).toBe(400);
    });

    it('should support chain filter parameter', async () => {
      const response = await fetch('http://localhost:8081/claims/agent-b?chain=evm');
      // Should return empty array since ClaimManager is null (no blockchain)
      expect(response.status).toBe(200);
      const data = (await response.json()) as { chain: string };
      expect(data.chain).toBe('evm');
    });
  });

  // Note: Full claim exchange flow tests require blockchain configuration
  // These would test:
  // 1. Agent A sends event to Agent B with EVM/XRP/Aptos claims
  // 2. Agent B receives claims and stores them
  // 3. Agent B sends signed responses in FULFILL
  // 4. Agent A receives and stores signed responses
  // 5. Claims can be retrieved via HTTP endpoint
  // 6. Settlement can be triggered using stored claims
  //
  // These tests are deferred until blockchain mocking is implemented
});
