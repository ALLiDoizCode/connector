/**
 * Tests for useNodeStatus hook
 */

import { renderHook, act } from '@testing-library/react';
import { useNodeStatus } from './useNodeStatus';
import { TelemetryEvent } from './useTelemetry';

describe('useNodeStatus', () => {
  it('should build node status cache from NODE_STATUS telemetry events', () => {
    // Arrange: Create mock NODE_STATUS telemetry events
    const mockEvents: TelemetryEvent[] = [
      {
        type: 'NODE_STATUS',
        nodeId: 'connector-a',
        timestamp: '2025-12-29T10:00:00.000Z',
        data: {
          health: 'healthy',
          uptime: 120000,
          routes: [
            { prefix: 'g.alice', nextHop: 'peer-alice', priority: 0 },
            { prefix: 'g.bob', nextHop: 'peer-bob', priority: 0 },
          ],
          peers: [
            {
              peerId: 'peer-alice',
              url: 'ws://connector-alice:3000',
              connected: true,
              lastSeen: '2025-12-29T10:00:00.000Z',
            },
          ],
        },
      },
    ];

    // Act: Render hook with events
    const { result } = renderHook(() => useNodeStatus(mockEvents));

    // Assert: Node statuses cached with correct data
    const nodeStatus = result.current.nodeStatuses.get('connector-a');
    expect(nodeStatus).toBeDefined();
    expect(nodeStatus?.nodeId).toBe('connector-a');
    expect(nodeStatus?.healthStatus).toBe('healthy');
    expect(nodeStatus?.uptime).toBe(120000);
    expect(nodeStatus?.routes).toHaveLength(2);
    expect(nodeStatus?.peers).toHaveLength(1);
    expect(nodeStatus?.routes[0]?.prefix).toBe('g.alice');
    expect(nodeStatus?.peers[0]?.peerId).toBe('peer-alice');
  });

  it('should update statistics from PACKET_RECEIVED and PACKET_SENT events', () => {
    // Arrange: Create sequence of packet telemetry events
    const initialEvents: TelemetryEvent[] = [
      {
        type: 'NODE_STATUS',
        nodeId: 'connector-a',
        timestamp: '2025-12-29T10:00:00.000Z',
        data: {
          health: 'healthy',
          uptime: 120000,
          routes: [],
          peers: [],
        },
      },
    ];

    const packetEvents: TelemetryEvent[] = [
      ...initialEvents,
      {
        type: 'PACKET_RECEIVED',
        nodeId: 'connector-a',
        timestamp: '2025-12-29T10:01:00.000Z',
        data: {},
      },
      {
        type: 'PACKET_SENT',
        nodeId: 'connector-a',
        timestamp: '2025-12-29T10:01:01.000Z',
        data: {},
      },
      {
        type: 'PACKET_RECEIVED',
        nodeId: 'connector-a',
        timestamp: '2025-12-29T10:01:02.000Z',
        data: {},
      },
    ];

    // Act: Render hook with events
    const { result } = renderHook(({ events }) => useNodeStatus(events), {
      initialProps: { events: packetEvents },
    });

    // Assert: Node statistics updated correctly
    const nodeStatus = result.current.nodeStatuses.get('connector-a');
    expect(nodeStatus).toBeDefined();
    expect(nodeStatus?.statistics.packetsReceived).toBeGreaterThanOrEqual(2);
    expect(nodeStatus?.statistics.packetsForwarded).toBeGreaterThanOrEqual(1);
  });

  it('should set selectedNodeId when selectNode is called', () => {
    // Arrange: Render hook
    const { result } = renderHook(() => useNodeStatus([]));

    // Act: Call selectNode
    act(() => {
      result.current.selectNode('connector-a');
    });

    // Assert: selectedNodeId updated
    expect(result.current.selectedNodeId).toBe('connector-a');
  });

  it('should clear selectedNodeId when clearSelection is called', () => {
    // Arrange: Select node first
    const { result } = renderHook(() => useNodeStatus([]));
    act(() => {
      result.current.selectNode('connector-a');
    });

    // Act: Call clearSelection
    act(() => {
      result.current.clearSelection();
    });

    // Assert: selectedNodeId cleared
    expect(result.current.selectedNodeId).toBeNull();
  });

  it('should return selected node status from getSelectedNode', () => {
    // Arrange: Create mock node status event
    const mockEvents: TelemetryEvent[] = [
      {
        type: 'NODE_STATUS',
        nodeId: 'connector-b',
        timestamp: '2025-12-29T10:00:00.000Z',
        data: {
          health: 'healthy',
          uptime: 240000,
          routes: [{ prefix: 'g.charlie', nextHop: 'peer-charlie' }],
          peers: [],
        },
      },
    ];

    const { result } = renderHook(() => useNodeStatus(mockEvents));

    // Act: Select node
    act(() => {
      result.current.selectNode('connector-b');
    });

    // Assert: getSelectedNode returns correct node
    const selectedNode = result.current.getSelectedNode();
    expect(selectedNode).toBeDefined();
    expect(selectedNode?.nodeId).toBe('connector-b');
    expect(selectedNode?.uptime).toBe(240000);
  });

  it('should return null from getSelectedNode when no node selected', () => {
    // Arrange: Render hook with no selection
    const { result } = renderHook(() => useNodeStatus([]));

    // Act & Assert: getSelectedNode returns null
    const selectedNode = result.current.getSelectedNode();
    expect(selectedNode).toBeNull();
  });

  it('should handle malformed NODE_STATUS events gracefully', () => {
    // Arrange: Create malformed events (missing required fields)
    const malformedEvents: TelemetryEvent[] = [
      {
        type: 'NODE_STATUS',
        nodeId: 'connector-c',
        timestamp: '2025-12-29T10:00:00.000Z',
        data: {
          health: 'healthy',
          // Missing uptime, routes, peers
        },
      },
      {
        type: 'NODE_STATUS',
        nodeId: 'connector-d',
        timestamp: '2025-12-29T10:00:00.000Z',
        data: {
          uptime: 100000,
          // Missing health, routes, peers
        },
      },
    ];

    // Act: Render hook
    const { result } = renderHook(() => useNodeStatus(malformedEvents));

    // Assert: Malformed events ignored, no nodes cached
    expect(result.current.nodeStatuses.size).toBe(0);
  });

  describe('processedEventCount Prevents Event Reprocessing (AC 8)', () => {
    it('should not reprocess events on component re-render', () => {
      // Arrange: Create initial events
      const events: TelemetryEvent[] = [
        {
          type: 'NODE_STATUS',
          nodeId: 'connector-a',
          timestamp: '2025-12-29T10:00:00.000Z',
          data: { health: 'healthy', uptime: 100, routes: [], peers: [] },
        },
        {
          type: 'PACKET_RECEIVED',
          nodeId: 'connector-a',
          timestamp: '2025-12-29T10:01:00.000Z',
          data: {},
        },
      ];

      // Act: Initial render
      const { result, rerender } = renderHook((props) => useNodeStatus(props.events), {
        initialProps: { events },
      });

      const initialReceived =
        result.current.nodeStatuses.get('connector-a')?.statistics.packetsReceived;
      expect(initialReceived).toBe(1);

      // Re-render with SAME events (simulating React re-render with same props)
      rerender({ events });

      // Assert: Counters should NOT increment again (processedEventCount prevents reprocessing)
      const afterRerender =
        result.current.nodeStatuses.get('connector-a')?.statistics.packetsReceived;
      expect(afterRerender).toBe(1); // Still 1, not 2
    });

    it('should only process new events added since last update', () => {
      // Arrange: Start with 2 events
      let events: TelemetryEvent[] = [
        {
          type: 'NODE_STATUS',
          nodeId: 'connector-a',
          timestamp: '2025-12-29T10:00:00.000Z',
          data: { health: 'healthy', uptime: 100, routes: [], peers: [] },
        },
        {
          type: 'PACKET_RECEIVED',
          nodeId: 'connector-a',
          timestamp: '2025-12-29T10:01:00.000Z',
          data: {},
        },
      ];

      const { result, rerender } = renderHook((props) => useNodeStatus(props.events), {
        initialProps: { events },
      });

      expect(result.current.nodeStatuses.get('connector-a')?.statistics.packetsReceived).toBe(1);

      // Act: Add NEW event to array
      events = [
        ...events,
        {
          type: 'PACKET_RECEIVED',
          nodeId: 'connector-a',
          timestamp: '2025-12-29T10:02:00.000Z',
          data: {},
        },
      ];
      rerender({ events });

      // Assert: Only new event processed (total should be 2, not 3)
      expect(result.current.nodeStatuses.get('connector-a')?.statistics.packetsReceived).toBe(2);
    });
  });

  describe('Sending 10 PACKET_RECEIVED Events Increments packetsReceived by 10 (AC 8)', () => {
    it('should increment packetsReceived by exactly 10 when 10 PACKET_RECEIVED events sent', () => {
      // Arrange: Create NODE_STATUS + 10 PACKET_RECEIVED events
      const events: TelemetryEvent[] = [
        {
          type: 'NODE_STATUS',
          nodeId: 'connector-a',
          timestamp: '2025-12-29T10:00:00.000Z',
          data: { health: 'healthy', uptime: 100, routes: [], peers: [] },
        },
      ];

      // Add 10 PACKET_RECEIVED events
      for (let i = 0; i < 10; i++) {
        events.push({
          type: 'PACKET_RECEIVED',
          nodeId: 'connector-a',
          timestamp: `2025-12-29T10:01:${String(i).padStart(2, '0')}.000Z`,
          data: { packetId: `packet-${i}` },
        });
      }

      // Act: Render hook
      const { result } = renderHook(() => useNodeStatus(events));

      // Assert: Should be exactly 10, not 20, not 100
      expect(result.current.nodeStatuses.get('connector-a')?.statistics.packetsReceived).toBe(10);
    });

    it('should increment packetsForwarded by exactly 5 when 5 PACKET_SENT events sent', () => {
      const events: TelemetryEvent[] = [
        {
          type: 'NODE_STATUS',
          nodeId: 'connector-b',
          timestamp: '2025-12-29T10:00:00.000Z',
          data: { health: 'healthy', uptime: 100, routes: [], peers: [] },
        },
      ];

      // Add 5 PACKET_SENT events
      for (let i = 0; i < 5; i++) {
        events.push({
          type: 'PACKET_SENT',
          nodeId: 'connector-b',
          timestamp: `2025-12-29T10:01:${String(i).padStart(2, '0')}.000Z`,
          data: { packetId: `packet-${i}` },
        });
      }

      const { result } = renderHook(() => useNodeStatus(events));

      expect(result.current.nodeStatuses.get('connector-b')?.statistics.packetsForwarded).toBe(5);
    });

    it('should increment packetsRejected by exactly 3 when 3 PACKET_REJECT events sent', () => {
      const events: TelemetryEvent[] = [
        {
          type: 'NODE_STATUS',
          nodeId: 'connector-c',
          timestamp: '2025-12-29T10:00:00.000Z',
          data: { health: 'healthy', uptime: 100, routes: [], peers: [] },
        },
      ];

      // Add 3 PACKET_REJECT events
      for (let i = 0; i < 3; i++) {
        events.push({
          type: 'PACKET_REJECT',
          nodeId: 'connector-c',
          timestamp: `2025-12-29T10:01:${String(i).padStart(2, '0')}.000Z`,
          data: { packetId: `packet-${i}` },
        });
      }

      const { result } = renderHook(() => useNodeStatus(events));

      expect(result.current.nodeStatuses.get('connector-c')?.statistics.packetsRejected).toBe(3);
    });
  });

  describe('NODE_STATUS Preserves Existing Statistics When Updating Node (AC 8)', () => {
    it('should preserve packet statistics when NODE_STATUS is updated', () => {
      // Arrange: Initial events with packet statistics
      let events: TelemetryEvent[] = [
        {
          type: 'NODE_STATUS',
          nodeId: 'connector-a',
          timestamp: '2025-12-29T10:00:00.000Z',
          data: { health: 'healthy', uptime: 100, routes: [], peers: [] },
        },
        {
          type: 'PACKET_RECEIVED',
          nodeId: 'connector-a',
          timestamp: '2025-12-29T10:01:00.000Z',
          data: {},
        },
        {
          type: 'PACKET_SENT',
          nodeId: 'connector-a',
          timestamp: '2025-12-29T10:01:01.000Z',
          data: {},
        },
      ];

      const { result, rerender } = renderHook((props) => useNodeStatus(props.events), {
        initialProps: { events },
      });

      expect(result.current.nodeStatuses.get('connector-a')?.statistics.packetsReceived).toBe(1);
      expect(result.current.nodeStatuses.get('connector-a')?.statistics.packetsForwarded).toBe(1);

      // Act: Send NEW NODE_STATUS (e.g., uptime update)
      events = [
        ...events,
        {
          type: 'NODE_STATUS',
          nodeId: 'connector-a',
          timestamp: '2025-12-29T10:05:00.000Z',
          data: { health: 'healthy', uptime: 400, routes: [], peers: [] },
        },
      ];
      rerender({ events });

      // Assert: Uptime updated, but statistics preserved
      const node = result.current.nodeStatuses.get('connector-a');
      expect(node?.uptime).toBe(400);
      expect(node?.statistics.packetsReceived).toBe(1); // Still 1
      expect(node?.statistics.packetsForwarded).toBe(1); // Still 1
    });

    it('should accumulate statistics across multiple NODE_STATUS updates', () => {
      let events: TelemetryEvent[] = [
        {
          type: 'NODE_STATUS',
          nodeId: 'connector-a',
          timestamp: '2025-12-29T10:00:00.000Z',
          data: { health: 'healthy', uptime: 100, routes: [], peers: [] },
        },
        {
          type: 'PACKET_RECEIVED',
          nodeId: 'connector-a',
          timestamp: '2025-12-29T10:01:00.000Z',
          data: {},
        },
      ];

      const { result, rerender } = renderHook((props) => useNodeStatus(props.events), {
        initialProps: { events },
      });

      expect(result.current.nodeStatuses.get('connector-a')?.statistics.packetsReceived).toBe(1);

      // Update NODE_STATUS
      events = [
        ...events,
        {
          type: 'NODE_STATUS',
          nodeId: 'connector-a',
          timestamp: '2025-12-29T10:02:00.000Z',
          data: { health: 'healthy', uptime: 200, routes: [], peers: [] },
        },
      ];
      rerender({ events });

      // Add more packets
      events = [
        ...events,
        {
          type: 'PACKET_RECEIVED',
          nodeId: 'connector-a',
          timestamp: '2025-12-29T10:03:00.000Z',
          data: {},
        },
      ];
      rerender({ events });

      // Another NODE_STATUS
      events = [
        ...events,
        {
          type: 'NODE_STATUS',
          nodeId: 'connector-a',
          timestamp: '2025-12-29T10:04:00.000Z',
          data: { health: 'healthy', uptime: 300, routes: [], peers: [] },
        },
      ];
      rerender({ events });

      // More packets
      events = [
        ...events,
        {
          type: 'PACKET_RECEIVED',
          nodeId: 'connector-a',
          timestamp: '2025-12-29T10:05:00.000Z',
          data: {},
        },
      ];
      rerender({ events });

      // Assert: Latest uptime, accumulated statistics
      const node = result.current.nodeStatuses.get('connector-a');
      expect(node?.uptime).toBe(300);
      expect(node?.statistics.packetsReceived).toBe(3); // Accumulated across all updates
    });
  });
});
