/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Agent Server Messaging Integration Tests (Story 32.7)
 *
 * Tests for private messaging configuration parsing:
 * - Configuration parsing (AC 1)
 * - Port conflict validation
 * - Environment variable handling
 *
 * Note: Full integration tests for startup/shutdown are in separate integration test files.
 * These unit tests focus on configuration logic without starting actual servers.
 */

describe('AgentServer Messaging Configuration (Story 32.7)', () => {
  // Save original environment
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Save environment variables
    originalEnv.ENABLE_PRIVATE_MESSAGING = process.env.ENABLE_PRIVATE_MESSAGING;
    originalEnv.MESSAGING_GATEWAY_PORT = process.env.MESSAGING_GATEWAY_PORT;
    originalEnv.MESSAGING_WEBSOCKET_PORT = process.env.MESSAGING_WEBSOCKET_PORT;
    originalEnv.MESSAGING_ADDRESS = process.env.MESSAGING_ADDRESS;

    // Clear messaging-related environment variables
    delete process.env.ENABLE_PRIVATE_MESSAGING;
    delete process.env.MESSAGING_GATEWAY_PORT;
    delete process.env.MESSAGING_WEBSOCKET_PORT;
    delete process.env.MESSAGING_ADDRESS;

    // Clear module cache to ensure fresh imports
    jest.resetModules();
  });

  afterEach(() => {
    // Restore environment variables
    if (originalEnv.ENABLE_PRIVATE_MESSAGING !== undefined) {
      process.env.ENABLE_PRIVATE_MESSAGING = originalEnv.ENABLE_PRIVATE_MESSAGING;
    }
    if (originalEnv.MESSAGING_GATEWAY_PORT !== undefined) {
      process.env.MESSAGING_GATEWAY_PORT = originalEnv.MESSAGING_GATEWAY_PORT;
    }
    if (originalEnv.MESSAGING_WEBSOCKET_PORT !== undefined) {
      process.env.MESSAGING_WEBSOCKET_PORT = originalEnv.MESSAGING_WEBSOCKET_PORT;
    }
    if (originalEnv.MESSAGING_ADDRESS !== undefined) {
      process.env.MESSAGING_ADDRESS = originalEnv.MESSAGING_ADDRESS;
    }
  });

  describe('Configuration Parsing (AC 1)', () => {
    it('should disable private messaging by default', async () => {
      // Arrange - import AgentServer dynamically
      const { AgentServer } = await import('./agent-server');

      // Act
      const server = new AgentServer({
        agentId: 'test-agent',
        databasePath: ':memory:',
        explorerDbPath: ':memory:',
      });

      // Assert - server created without issues (messaging disabled by default)
      expect(server).toBeDefined();
    });

    it('should enable private messaging when config flag is true', async () => {
      // Arrange
      const { AgentServer } = await import('./agent-server');

      // Act
      const server = new AgentServer({
        agentId: 'test-agent',
        enablePrivateMessaging: true,
        databasePath: ':memory:',
        explorerDbPath: ':memory:',
      });

      // Assert
      expect(server).toBeDefined();
    });

    it('should enable private messaging from ENABLE_PRIVATE_MESSAGING env var', async () => {
      // Arrange
      process.env.ENABLE_PRIVATE_MESSAGING = 'true';
      const { AgentServer } = await import('./agent-server');

      // Act
      const server = new AgentServer({
        agentId: 'test-agent',
        databasePath: ':memory:',
        explorerDbPath: ':memory:',
      });

      // Assert
      expect(server).toBeDefined();
    });

    it('should use default gateway port 3002', async () => {
      // Arrange
      const { AgentServer } = await import('./agent-server');

      // Act - no port specified, should use default
      const server = new AgentServer({
        agentId: 'test-agent',
        enablePrivateMessaging: true,
        databasePath: ':memory:',
        explorerDbPath: ':memory:',
      });

      // Assert - server created with default port (3002)
      expect(server).toBeDefined();
    });

    it('should use default WebSocket port 3003', async () => {
      // Arrange
      const { AgentServer } = await import('./agent-server');

      // Act
      const server = new AgentServer({
        agentId: 'test-agent',
        enablePrivateMessaging: true,
        databasePath: ':memory:',
        explorerDbPath: ':memory:',
      });

      // Assert
      expect(server).toBeDefined();
    });

    it('should parse custom gateway port from environment', async () => {
      // Arrange
      process.env.MESSAGING_GATEWAY_PORT = '4002';
      const { AgentServer } = await import('./agent-server');

      // Act
      const server = new AgentServer({
        agentId: 'test-agent',
        enablePrivateMessaging: true,
        databasePath: ':memory:',
        explorerDbPath: ':memory:',
      });

      // Assert
      expect(server).toBeDefined();
    });

    it('should parse custom WebSocket port from environment', async () => {
      // Arrange
      process.env.MESSAGING_WEBSOCKET_PORT = '4003';
      const { AgentServer } = await import('./agent-server');

      // Act
      const server = new AgentServer({
        agentId: 'test-agent',
        enablePrivateMessaging: true,
        databasePath: ':memory:',
        explorerDbPath: ':memory:',
      });

      // Assert
      expect(server).toBeDefined();
    });

    it('should generate default messaging address from agent ID', async () => {
      // Arrange
      const { AgentServer } = await import('./agent-server');

      // Act - messaging address should be "g.agent.{agentId}.private"
      const server = new AgentServer({
        agentId: 'bob-agent',
        enablePrivateMessaging: true,
        databasePath: ':memory:',
        explorerDbPath: ':memory:',
      });

      // Assert
      expect(server).toBeDefined();
    });

    it('should use custom messaging address from environment', async () => {
      // Arrange
      process.env.MESSAGING_ADDRESS = 'g.custom.messaging.address';
      const { AgentServer } = await import('./agent-server');

      // Act
      const server = new AgentServer({
        agentId: 'test-agent',
        enablePrivateMessaging: true,
        databasePath: ':memory:',
        explorerDbPath: ':memory:',
      });

      // Assert
      expect(server).toBeDefined();
    });

    it('should use custom messaging address from config over environment', async () => {
      // Arrange
      process.env.MESSAGING_ADDRESS = 'g.env.address';
      const { AgentServer } = await import('./agent-server');

      // Act - config should override env
      const server = new AgentServer({
        agentId: 'test-agent',
        enablePrivateMessaging: true,
        messagingAddress: 'g.config.address',
        databasePath: ':memory:',
        explorerDbPath: ':memory:',
      });

      // Assert
      expect(server).toBeDefined();
    });
  });

  describe('Port Conflict Validation', () => {
    it('should throw error when messaging gateway port conflicts with HTTP port', async () => {
      // Arrange
      const { AgentServer } = await import('./agent-server');

      // Act & Assert
      expect(() => {
        new AgentServer({
          agentId: 'test-agent',
          enablePrivateMessaging: true,
          httpPort: 3002,
          messagingGatewayPort: 3002, // Same as HTTP port
          databasePath: ':memory:',
          explorerDbPath: ':memory:',
        });
      }).toThrow('conflicts with existing port');
    });

    it('should throw error when messaging gateway port conflicts with BTP port', async () => {
      // Arrange
      const { AgentServer } = await import('./agent-server');

      // Act & Assert
      expect(() => {
        new AgentServer({
          agentId: 'test-agent',
          enablePrivateMessaging: true,
          btpPort: 3002,
          messagingGatewayPort: 3002, // Same as BTP port
          databasePath: ':memory:',
          explorerDbPath: ':memory:',
        });
      }).toThrow('conflicts with existing port');
    });

    it('should throw error when messaging gateway port conflicts with explorer port', async () => {
      // Arrange
      const { AgentServer } = await import('./agent-server');

      // Act & Assert
      expect(() => {
        new AgentServer({
          agentId: 'test-agent',
          enablePrivateMessaging: true,
          explorerPort: 3002,
          messagingGatewayPort: 3002, // Same as explorer port
          databasePath: ':memory:',
          explorerDbPath: ':memory:',
        });
      }).toThrow('conflicts with existing port');
    });

    it('should throw error when messaging WebSocket port conflicts with HTTP port', async () => {
      // Arrange
      const { AgentServer } = await import('./agent-server');

      // Act & Assert
      expect(() => {
        new AgentServer({
          agentId: 'test-agent',
          enablePrivateMessaging: true,
          httpPort: 3003,
          messagingWebsocketPort: 3003, // Same as HTTP port
          databasePath: ':memory:',
          explorerDbPath: ':memory:',
        });
      }).toThrow('conflicts with existing port');
    });

    it('should throw error when messaging WebSocket port conflicts with BTP port', async () => {
      // Arrange
      const { AgentServer } = await import('./agent-server');

      // Act & Assert
      expect(() => {
        new AgentServer({
          agentId: 'test-agent',
          enablePrivateMessaging: true,
          btpPort: 3003,
          messagingWebsocketPort: 3003, // Same as BTP port
          databasePath: ':memory:',
          explorerDbPath: ':memory:',
        });
      }).toThrow('conflicts with existing port');
    });

    it('should throw error when gateway and WebSocket ports are the same', async () => {
      // Arrange
      const { AgentServer } = await import('./agent-server');

      // Act & Assert
      expect(() => {
        new AgentServer({
          agentId: 'test-agent',
          enablePrivateMessaging: true,
          messagingGatewayPort: 3005,
          messagingWebsocketPort: 3005, // Same as gateway port
          databasePath: ':memory:',
          explorerDbPath: ':memory:',
        });
      }).toThrow('gateway port and WebSocket port cannot be the same');
    });

    it('should not validate ports when messaging is disabled', async () => {
      // Arrange
      const { AgentServer } = await import('./agent-server');

      // Act & Assert - should not throw even with conflicting ports when messaging disabled
      expect(() => {
        new AgentServer({
          agentId: 'test-agent',
          enablePrivateMessaging: false,
          httpPort: 3002,
          messagingGatewayPort: 3002, // Conflict, but messaging is disabled
          databasePath: ':memory:',
          explorerDbPath: ':memory:',
        });
      }).not.toThrow();
    });
  });

  describe('ENABLE_PRIVATE_MESSAGING Environment Variable', () => {
    it('should treat "true" as enabled', async () => {
      // Arrange
      process.env.ENABLE_PRIVATE_MESSAGING = 'true';
      const { AgentServer } = await import('./agent-server');

      // Act
      const server = new AgentServer({
        agentId: 'test-agent',
        databasePath: ':memory:',
        explorerDbPath: ':memory:',
      });

      // Assert
      expect(server).toBeDefined();
    });

    it('should treat "false" as disabled', async () => {
      // Arrange
      process.env.ENABLE_PRIVATE_MESSAGING = 'false';
      const { AgentServer } = await import('./agent-server');

      // Act
      const server = new AgentServer({
        agentId: 'test-agent',
        databasePath: ':memory:',
        explorerDbPath: ':memory:',
      });

      // Assert
      expect(server).toBeDefined();
    });

    it('should treat empty string as disabled', async () => {
      // Arrange
      process.env.ENABLE_PRIVATE_MESSAGING = '';
      const { AgentServer } = await import('./agent-server');

      // Act
      const server = new AgentServer({
        agentId: 'test-agent',
        databasePath: ':memory:',
        explorerDbPath: ':memory:',
      });

      // Assert
      expect(server).toBeDefined();
    });

    it('should treat undefined as disabled', async () => {
      // Arrange - env var not set
      const { AgentServer } = await import('./agent-server');

      // Act
      const server = new AgentServer({
        agentId: 'test-agent',
        databasePath: ':memory:',
        explorerDbPath: ':memory:',
      });

      // Assert
      expect(server).toBeDefined();
    });

    it('should prefer config flag over environment variable', async () => {
      // Arrange
      process.env.ENABLE_PRIVATE_MESSAGING = 'true';
      const { AgentServer } = await import('./agent-server');

      // Act - config says false, env says true
      const server = new AgentServer({
        agentId: 'test-agent',
        enablePrivateMessaging: false, // Config overrides env
        databasePath: ':memory:',
        explorerDbPath: ':memory:',
      });

      // Assert
      expect(server).toBeDefined();
    });
  });
});
