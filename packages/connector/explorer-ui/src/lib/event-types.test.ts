/**
 * Tests for ILP packet type utilities
 */
import { describe, expect, it } from 'vitest';
import { getIlpPacketType, isIlpPacketEvent, PACKET_TYPE_COLORS } from './event-types';
import type { TelemetryEvent, StoredEvent } from './event-types';

describe('getIlpPacketType', () => {
  it('should return "prepare" for PACKET_RECEIVED events', () => {
    const event: TelemetryEvent = {
      type: 'PACKET_RECEIVED',
      nodeId: 'node1',
      timestamp: Date.now(),
    };
    expect(getIlpPacketType(event)).toBe('prepare');
  });

  it('should return "prepare" for PACKET_FORWARDED events', () => {
    const event: TelemetryEvent = {
      type: 'PACKET_FORWARDED',
      nodeId: 'node1',
      timestamp: Date.now(),
    };
    expect(getIlpPacketType(event)).toBe('prepare');
  });

  it('should extract packet type from AGENT_CHANNEL_PAYMENT_SENT with packetType field', () => {
    const prepareEvent: TelemetryEvent = {
      type: 'AGENT_CHANNEL_PAYMENT_SENT',
      nodeId: 'node1',
      timestamp: Date.now(),
      packetType: 'prepare',
    };
    expect(getIlpPacketType(prepareEvent)).toBe('prepare');

    const fulfillEvent: TelemetryEvent = {
      type: 'AGENT_CHANNEL_PAYMENT_SENT',
      nodeId: 'node1',
      timestamp: Date.now(),
      packetType: 'fulfill',
    };
    expect(getIlpPacketType(fulfillEvent)).toBe('fulfill');

    const rejectEvent: TelemetryEvent = {
      type: 'AGENT_CHANNEL_PAYMENT_SENT',
      nodeId: 'node1',
      timestamp: Date.now(),
      packetType: 'reject',
    };
    expect(getIlpPacketType(rejectEvent)).toBe('reject');
  });

  it('should extract packet_type from StoredEvent', () => {
    const storedEvent: StoredEvent = {
      id: 1,
      event_type: 'AGENT_CHANNEL_PAYMENT_SENT',
      timestamp: Date.now(),
      node_id: 'node1',
      direction: 'sent',
      peer_id: 'peer1',
      packet_id: 'packet123',
      amount: '1000',
      destination: 'g.peer.dest',
      packet_type: 'fulfill',
      from_address: null,
      to_address: null,
      payload: {
        type: 'AGENT_CHANNEL_PAYMENT_SENT',
        nodeId: 'node1',
        timestamp: Date.now(),
      },
    };
    expect(getIlpPacketType(storedEvent)).toBe('fulfill');
  });

  it('should return null for non-ILP events', () => {
    const event: TelemetryEvent = {
      type: 'SETTLEMENT_COMPLETED',
      nodeId: 'node1',
      timestamp: Date.now(),
    };
    expect(getIlpPacketType(event)).toBe(null);
  });

  it('should handle case-insensitive packet types', () => {
    const event: TelemetryEvent = {
      type: 'AGENT_CHANNEL_PAYMENT_SENT',
      nodeId: 'node1',
      timestamp: Date.now(),
      packetType: 'PREPARE',
    };
    expect(getIlpPacketType(event)).toBe('prepare');
  });
});

describe('isIlpPacketEvent', () => {
  it('should return true for ILP packet events', () => {
    const packetReceivedEvent: TelemetryEvent = {
      type: 'PACKET_RECEIVED',
      nodeId: 'node1',
      timestamp: Date.now(),
    };
    expect(isIlpPacketEvent(packetReceivedEvent)).toBe(true);

    const packetForwardedEvent: TelemetryEvent = {
      type: 'PACKET_FORWARDED',
      nodeId: 'node1',
      timestamp: Date.now(),
    };
    expect(isIlpPacketEvent(packetForwardedEvent)).toBe(true);

    const agentPaymentEvent: TelemetryEvent = {
      type: 'AGENT_CHANNEL_PAYMENT_SENT',
      nodeId: 'node1',
      timestamp: Date.now(),
      packetType: 'fulfill',
    };
    expect(isIlpPacketEvent(agentPaymentEvent)).toBe(true);
  });

  it('should return false for non-ILP events', () => {
    const event: TelemetryEvent = {
      type: 'SETTLEMENT_COMPLETED',
      nodeId: 'node1',
      timestamp: Date.now(),
    };
    expect(isIlpPacketEvent(event)).toBe(false);
  });
});

describe('PACKET_TYPE_COLORS', () => {
  it('should have colors for all ILP packet types', () => {
    expect(PACKET_TYPE_COLORS.prepare).toBeDefined();
    expect(PACKET_TYPE_COLORS.fulfill).toBeDefined();
    expect(PACKET_TYPE_COLORS.reject).toBeDefined();
  });

  it('should use appropriate colors for each packet type (NOC aesthetic)', () => {
    // Story 18.3: NOC color palette - cyan for prepare, emerald for fulfill, rose for reject
    expect(PACKET_TYPE_COLORS.prepare).toContain('cyan');
    expect(PACKET_TYPE_COLORS.fulfill).toContain('emerald');
    expect(PACKET_TYPE_COLORS.reject).toContain('rose');
  });
});
