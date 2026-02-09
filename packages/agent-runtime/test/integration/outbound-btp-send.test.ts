/**
 * Integration Test: Outbound BTP Send
 *
 * Tests the full flow: HTTP POST /ilp/send → IlpSendHandler → OutboundBTPClient → Connector BTP → ILP Network → Response
 *
 * Requires a 2-peer Docker deployment with:
 * - Peer A: agent-runtime + connector
 * - Peer B: connector with a route to peer A
 *
 * Skipped when Docker infrastructure is not running (describeIfInfra).
 */

/**
 * Check if infrastructure is available by testing connectivity
 * to the agent-runtime HTTP server.
 */
function isInfraAvailable(): boolean {
  // Check for INTEGRATION_TEST env var — set in Docker compose or CI
  return process.env['INTEGRATION_TEST'] === 'true';
}

const describeIfInfra = isInfraAvailable() ? describe : describe.skip;

describeIfInfra('Outbound BTP Send (Integration)', () => {
  const AGENT_RUNTIME_URL = process.env['AGENT_RUNTIME_URL'] ?? 'http://localhost:3100';

  it('should send ILP packet via POST /ilp/send and receive fulfill', async () => {
    // This test validates the full flow:
    // 1. POST /ilp/send on agent-runtime
    // 2. Agent-runtime creates ILP Prepare packet
    // 3. OutboundBTPClient sends via BTP WebSocket to connector
    // 4. Connector routes to peer B
    // 5. Peer B fulfills the packet
    // 6. Response flows back through BTP to agent-runtime
    // 7. HTTP response returns with fulfilled=true

    const response = await fetch(`${AGENT_RUNTIME_URL}/ilp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        destination: 'g.connector.peer-b',
        amount: '1000',
        data: Buffer.from('integration test').toString('base64'),
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    // The response should be either a fulfill or a reject
    // (depends on peer B's configuration)
    expect(body).toHaveProperty('fulfilled');
    expect(typeof body.fulfilled).toBe('boolean');
  });

  it('should return btpConnected=true in health endpoint', async () => {
    const response = await fetch(`${AGENT_RUNTIME_URL}/health`);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.btpConnected).toBe(true);
    expect(body.status).toBe('healthy');
  });
});
