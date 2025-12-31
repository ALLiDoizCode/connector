/**
 * Custom React hook for network graph state management
 * Processes telemetry events to build network topology graph
 */

import { useState, useEffect } from 'react';
import { NetworkGraphData, NetworkNode, NetworkEdge } from '../types/network';
import { TelemetryEvent } from './useTelemetry';

/**
 * Hook interface for network graph state
 */
export interface UseNetworkGraphResult {
  graphData: NetworkGraphData;
}

/**
 * Custom hook to process telemetry events and build network graph data
 * Handles NODE_STATUS events to create nodes and edges
 */
export function useNetworkGraph(events: TelemetryEvent[]): UseNetworkGraphResult {
  const [graphData, setGraphData] = useState<NetworkGraphData>({
    nodes: [],
    edges: [],
  });

  useEffect(() => {
    // Process telemetry events to build graph
    const nodesMap = new Map<string, NetworkNode>();
    const edgesMap = new Map<string, NetworkEdge>();

    events.forEach((event) => {
      if (event.type === 'NODE_STATUS') {
        const { nodeId, data } = event;

        // Extract node information
        const healthStatus = (data.health as 'healthy' | 'unhealthy' | 'starting') || 'starting';
        const peers = (data.peers || []) as Array<{ id: string; connected: boolean; url: string }>;

        // Count connected peers
        const peersConnected = peers.filter((p) => p.connected).length;
        const totalPeers = peers.length;

        // Calculate uptime (will come from telemetry data)
        const uptime = (data.uptime as number) || 0;

        // Create or update NetworkNode
        const node: NetworkNode = {
          id: nodeId,
          label: nodeId,
          healthStatus,
          peersConnected,
          totalPeers,
          uptime,
        };

        nodesMap.set(nodeId, node);

        // Extract peer connections to create NetworkEdges
        peers.forEach((peer) => {
          // Create edge ID (sorted to ensure uniqueness for bidirectional edges)
          const edgeId = nodeId < peer.id ? `${nodeId}-${peer.id}` : `${peer.id}-${nodeId}`;

          // Create or update edge
          const existingEdge = edgesMap.get(edgeId);

          if (existingEdge) {
            // Update existing edge with latest connection state
            // If either direction is connected, mark edge as connected
            existingEdge.connected = existingEdge.connected || peer.connected;
          } else {
            // Create new edge
            const edge: NetworkEdge = {
              id: edgeId,
              source: nodeId,
              target: peer.id,
              connected: peer.connected,
            };
            edgesMap.set(edgeId, edge);
          }
        });
      }
    });

    // Update graph data state
    setGraphData({
      nodes: Array.from(nodesMap.values()),
      edges: Array.from(edgesMap.values()),
    });
  }, [events]);

  return { graphData };
}
