import * as lib from './lib';

describe('lib.ts exports', () => {
  it('should export ConnectorNode', () => {
    expect(typeof lib.ConnectorNode).toBe('function');
  });

  it('should export createLogger', () => {
    expect(typeof lib.createLogger).toBe('function');
  });

  it('should export ConfigLoader', () => {
    expect(typeof lib.ConfigLoader).toBe('function');
  });

  it('should export BTPClientManager', () => {
    expect(typeof lib.BTPClientManager).toBe('function');
  });

  it('should export AdminServer', () => {
    expect(typeof lib.AdminServer).toBe('function');
  });

  it('should export AccountManager', () => {
    expect(typeof lib.AccountManager).toBe('function');
  });

  it('should export SettlementMonitor', () => {
    expect(typeof lib.SettlementMonitor).toBe('function');
  });

  it('should export UnifiedSettlementExecutor', () => {
    expect(typeof lib.UnifiedSettlementExecutor).toBe('function');
  });

  it('should NOT export main', () => {
    expect('main' in lib).toBe(false);
  });
});
