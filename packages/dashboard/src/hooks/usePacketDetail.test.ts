/**
 * Unit tests for usePacketDetail hook
 */

import { renderHook, act } from '@testing-library/react';
import { usePacketDetail } from './usePacketDetail';
import { TelemetryEvent } from './useTelemetry';

describe('usePacketDetail', () => {
  const createPacketReceivedEvent = (
    packetId: string,
    packetType: 'PREPARE' | 'FULFILL' | 'REJECT',
    nodeId: string
  ): TelemetryEvent => ({
    type: 'PACKET_RECEIVED',
    nodeId,
    timestamp: new Date().toISOString(),
    data: {
      packetId,
      packetType,
      destination: 'g.connectorB.dest',
      amount: '1000',
      executionCondition: 'ABCD1234',
    },
  });

  const createPacketSentEvent = (packetId: string, nodeId: string): TelemetryEvent => ({
    type: 'PACKET_SENT',
    nodeId,
    timestamp: new Date().toISOString(),
    data: {
      packetId,
      nextHop: 'next-node',
    },
  });

  it('builds packet detail cache from PACKET_RECEIVED events', () => {
    const events: TelemetryEvent[] = [
      createPacketReceivedEvent('packet-1', 'PREPARE', 'connector-a'),
      createPacketReceivedEvent('packet-2', 'FULFILL', 'connector-b'),
    ];

    const { result } = renderHook(() => usePacketDetail(events));

    act(() => {
      result.current.selectPacket('packet-1');
    });

    const packet = result.current.getSelectedPacket();
    expect(packet).toBeTruthy();
    expect(packet?.packetId).toBe('packet-1');
    expect(packet?.type).toBe('PREPARE');
    expect(packet?.sourceNodeId).toBe('connector-a');
  });

  it('tracks routing path from PACKET_SENT events', () => {
    const events: TelemetryEvent[] = [
      createPacketReceivedEvent('packet-1', 'PREPARE', 'connector-a'),
      createPacketSentEvent('packet-1', 'connector-a'),
      createPacketSentEvent('packet-1', 'connector-b'),
      createPacketSentEvent('packet-1', 'connector-c'),
    ];

    const { result } = renderHook(() => usePacketDetail(events));

    act(() => {
      result.current.selectPacket('packet-1');
    });

    const packet = result.current.getSelectedPacket();
    expect(packet?.routingPath).toEqual(['connector-a', 'connector-b', 'connector-c']);
  });

  it('selectPacket sets selectedPacketId state', () => {
    const events: TelemetryEvent[] = [
      createPacketReceivedEvent('packet-1', 'PREPARE', 'connector-a'),
    ];

    const { result } = renderHook(() => usePacketDetail(events));

    expect(result.current.selectedPacketId).toBeNull();

    act(() => {
      result.current.selectPacket('packet-1');
    });

    expect(result.current.selectedPacketId).toBe('packet-1');
  });

  it('clearSelection clears selectedPacketId', () => {
    const events: TelemetryEvent[] = [
      createPacketReceivedEvent('packet-1', 'PREPARE', 'connector-a'),
    ];

    const { result } = renderHook(() => usePacketDetail(events));

    act(() => {
      result.current.selectPacket('packet-1');
    });

    expect(result.current.selectedPacketId).toBe('packet-1');

    act(() => {
      result.current.clearSelection();
    });

    expect(result.current.selectedPacketId).toBeNull();
  });

  it('maintains recent packets history', () => {
    const events: TelemetryEvent[] = [
      createPacketReceivedEvent('packet-1', 'PREPARE', 'connector-a'),
      createPacketReceivedEvent('packet-2', 'FULFILL', 'connector-b'),
      createPacketReceivedEvent('packet-3', 'REJECT', 'connector-c'),
    ];

    const { result } = renderHook(() => usePacketDetail(events));

    act(() => {
      result.current.selectPacket('packet-1');
    });

    expect(result.current.recentPackets).toEqual(['packet-1']);

    act(() => {
      result.current.selectPacket('packet-2');
    });

    expect(result.current.recentPackets).toEqual(['packet-2', 'packet-1']);

    act(() => {
      result.current.selectPacket('packet-3');
    });

    expect(result.current.recentPackets).toEqual(['packet-3', 'packet-2', 'packet-1']);
  });

  it('returns null when selecting non-existent packet', () => {
    const events: TelemetryEvent[] = [];

    const { result } = renderHook(() => usePacketDetail(events));

    act(() => {
      result.current.selectPacket('non-existent-packet');
    });

    expect(result.current.getSelectedPacket()).toBeNull();
  });
});
