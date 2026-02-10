/**
 * Unit Tests for AdminChannelStatus type and normalizeChannelStatus function (Story 21.5)
 *
 * @module settlement/types.test
 */

import { normalizeChannelStatus } from './types';
import type { Logger } from 'pino';

describe('normalizeChannelStatus', () => {
  // --- Canonical values pass through ---

  it('should pass through "opening" as-is', () => {
    expect(normalizeChannelStatus('opening')).toBe('opening');
  });

  it('should pass through "open" as-is', () => {
    expect(normalizeChannelStatus('open')).toBe('open');
  });

  it('should pass through "closing" as-is', () => {
    expect(normalizeChannelStatus('closing')).toBe('closing');
  });

  it('should pass through "closed" as-is', () => {
    expect(normalizeChannelStatus('closed')).toBe('closed');
  });

  it('should pass through "settling" as-is', () => {
    expect(normalizeChannelStatus('settling')).toBe('settling');
  });

  it('should pass through "settled" as-is', () => {
    expect(normalizeChannelStatus('settled')).toBe('settled');
  });

  // --- Alias mappings ---

  it('should normalize "active" (ChannelMetadata alias) to "open"', () => {
    expect(normalizeChannelStatus('active')).toBe('open');
  });

  it('should normalize "opened" (on-chain SDK alias) to "open"', () => {
    expect(normalizeChannelStatus('opened')).toBe('open');
  });

  // --- Unknown status handling ---

  it('should default unknown status to "opening" and log a warning', () => {
    const mockLogger = {
      warn: jest.fn(),
    } as unknown as Logger;

    const result = normalizeChannelStatus('unknown', mockLogger);
    expect(result).toBe('opening');
    expect(mockLogger.warn).toHaveBeenCalledWith(
      { status: 'unknown' },
      'Unknown channel status, defaulting to opening'
    );
  });

  it('should not throw when no logger is provided for unknown status (graceful no-op)', () => {
    const result = normalizeChannelStatus('bogus');
    expect(result).toBe('opening');
  });

  it('should not call logger.warn for canonical statuses', () => {
    const mockLogger = {
      warn: jest.fn(),
    } as unknown as Logger;

    normalizeChannelStatus('open', mockLogger);
    normalizeChannelStatus('closed', mockLogger);
    normalizeChannelStatus('settling', mockLogger);
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('should not call logger.warn for alias statuses', () => {
    const mockLogger = {
      warn: jest.fn(),
    } as unknown as Logger;

    normalizeChannelStatus('active', mockLogger);
    normalizeChannelStatus('opened', mockLogger);
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });
});
