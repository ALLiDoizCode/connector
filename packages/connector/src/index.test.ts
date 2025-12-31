import {
  main,
  ConnectorNode,
  RoutingTable,
  PacketHandler,
  BTPServer,
  BTPClient,
  createLogger,
} from './index';

describe('connector package', () => {
  it('should export main function', () => {
    expect(typeof main).toBe('function');
  });

  it('should export ConnectorNode class', () => {
    expect(ConnectorNode).toBeDefined();
  });

  it('should export RoutingTable class', () => {
    expect(RoutingTable).toBeDefined();
  });

  it('should export PacketHandler class', () => {
    expect(PacketHandler).toBeDefined();
  });

  it('should export BTPServer class', () => {
    expect(BTPServer).toBeDefined();
  });

  it('should export BTPClient class', () => {
    expect(BTPClient).toBeDefined();
  });

  it('should export createLogger function', () => {
    expect(typeof createLogger).toBe('function');
  });
});
