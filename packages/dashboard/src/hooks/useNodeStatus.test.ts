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
});
