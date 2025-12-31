/**
 * Unit tests for usePacketAnimation hook
 */

import { renderHook, waitFor } from '@testing-library/react';
import { usePacketAnimation } from './usePacketAnimation';
import { TelemetryEvent } from './useTelemetry';

describe('usePacketAnimation', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('should create AnimatedPacket from PACKET_SENT event', () => {
    const events: TelemetryEvent[] = [
      {
        type: 'PACKET_RECEIVED',
        nodeId: 'connector-a',
        timestamp: new Date().toISOString(),
        data: {
          packetId: 'packet-123',
          packetType: 'PREPARE',
        },
      },
      {
        type: 'PACKET_SENT',
        nodeId: 'connector-a',
        timestamp: new Date().toISOString(),
        data: {
          packetId: 'packet-123',
          nextHop: 'connector-b',
        },
      },
    ];

    const { result } = renderHook(() => usePacketAnimation(events));

    expect(result.current.activePackets).toHaveLength(1);
    expect(result.current.activePackets[0]).toMatchObject({
      id: 'packet-123',
      type: 'PREPARE',
      sourceNodeId: 'connector-a',
      targetNodeId: 'connector-b',
      color: '#3b82f6', // PREPARE color (blue)
    });
  });

  it('should handle multiple concurrent packets', () => {
    const events: TelemetryEvent[] = [
      {
        type: 'PACKET_SENT',
        nodeId: 'connector-a',
        timestamp: new Date().toISOString(),
        data: {
          packetId: 'packet-1',
          nextHop: 'connector-b',
        },
      },
      {
        type: 'PACKET_SENT',
        nodeId: 'connector-a',
        timestamp: new Date().toISOString(),
        data: {
          packetId: 'packet-2',
          nextHop: 'connector-b',
        },
      },
      {
        type: 'PACKET_SENT',
        nodeId: 'connector-b',
        timestamp: new Date().toISOString(),
        data: {
          packetId: 'packet-3',
          nextHop: 'connector-c',
        },
      },
    ];

    const { result } = renderHook(() => usePacketAnimation(events));

    expect(result.current.activePackets).toHaveLength(3);
    expect(result.current.activePackets.map((p) => p.id)).toEqual([
      'packet-1',
      'packet-2',
      'packet-3',
    ]);
  });

  it('should clean up completed packets after animation duration', async () => {
    const events: TelemetryEvent[] = [
      {
        type: 'PACKET_SENT',
        nodeId: 'connector-a',
        timestamp: new Date().toISOString(),
        data: {
          packetId: 'packet-123',
          nextHop: 'connector-b',
        },
      },
    ];

    const { result, rerender } = renderHook(({ events }) => usePacketAnimation(events), {
      initialProps: { events },
    });

    // Initially packet is active
    expect(result.current.activePackets).toHaveLength(1);

    // Fast-forward past animation duration (800ms)
    jest.advanceTimersByTime(800);
    rerender({ events });

    // Wait for cleanup to complete
    await waitFor(
      () => {
        expect(result.current.activePackets).toHaveLength(0);
      },
      { timeout: 2000 }
    );
  });

  it('should determine packet color based on packet type', () => {
    // First, send PACKET_RECEIVED events to establish packet types
    const receivedEvents: TelemetryEvent[] = [
      {
        type: 'PACKET_RECEIVED',
        nodeId: 'connector-a',
        timestamp: new Date().toISOString(),
        data: {
          packetId: 'packet-prepare',
          packetType: 'PREPARE',
        },
      },
      {
        type: 'PACKET_RECEIVED',
        nodeId: 'connector-b',
        timestamp: new Date().toISOString(),
        data: {
          packetId: 'packet-fulfill',
          packetType: 'FULFILL',
        },
      },
      {
        type: 'PACKET_RECEIVED',
        nodeId: 'connector-c',
        timestamp: new Date().toISOString(),
        data: {
          packetId: 'packet-reject',
          packetType: 'REJECT',
        },
      },
    ];

    const { result, rerender } = renderHook(({ events }) => usePacketAnimation(events), {
      initialProps: { events: receivedEvents },
    });

    // Now add PACKET_SENT events
    const allEvents: TelemetryEvent[] = [
      ...receivedEvents,
      {
        type: 'PACKET_SENT',
        nodeId: 'connector-a',
        timestamp: new Date().toISOString(),
        data: {
          packetId: 'packet-prepare',
          nextHop: 'connector-b',
        },
      },
      {
        type: 'PACKET_SENT',
        nodeId: 'connector-b',
        timestamp: new Date().toISOString(),
        data: {
          packetId: 'packet-fulfill',
          nextHop: 'connector-a',
        },
      },
      {
        type: 'PACKET_SENT',
        nodeId: 'connector-c',
        timestamp: new Date().toISOString(),
        data: {
          packetId: 'packet-reject',
          nextHop: 'connector-a',
        },
      },
    ];

    rerender({ events: allEvents });

    expect(result.current.activePackets).toHaveLength(3);

    const preparePacket = result.current.activePackets.find((p) => p.id === 'packet-prepare');
    const fulfillPacket = result.current.activePackets.find((p) => p.id === 'packet-fulfill');
    const rejectPacket = result.current.activePackets.find((p) => p.id === 'packet-reject');

    expect(preparePacket?.color).toBe('#3b82f6'); // Blue
    expect(preparePacket?.type).toBe('PREPARE');

    expect(fulfillPacket?.color).toBe('#10b981'); // Green
    expect(fulfillPacket?.type).toBe('FULFILL');

    expect(rejectPacket?.color).toBe('#ef4444'); // Red
    expect(rejectPacket?.type).toBe('REJECT');
  });

  it('should default to PREPARE type if packet type not found', () => {
    const events: TelemetryEvent[] = [
      {
        type: 'PACKET_SENT',
        nodeId: 'connector-a',
        timestamp: new Date().toISOString(),
        data: {
          packetId: 'unknown-packet',
          nextHop: 'connector-b',
        },
      },
    ];

    const { result } = renderHook(() => usePacketAnimation(events));

    expect(result.current.activePackets).toHaveLength(1);
    const packet = result.current.activePackets[0];
    expect(packet).toBeDefined();
    expect(packet?.type).toBe('PREPARE');
    expect(packet?.color).toBe('#3b82f6');
  });
});
