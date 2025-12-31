/**
 * Custom React hook for packet detail state management
 * Manages selected packet, packet detail cache, and routing path tracking
 */

import { useState, useMemo } from 'react';
import { TelemetryEvent } from './useTelemetry';
import { PacketDetail, parsePacketDetail } from '../types/packet';

const MAX_CACHED_PACKETS = 100; // Prevent memory growth
const MAX_RECENT_PACKETS = 5; // Recently viewed history size

/**
 * Hook interface for packet detail management
 */
export interface UsePacketDetailResult {
  /** Currently selected packet ID (null if no selection) */
  selectedPacketId: string | null;

  /** Select a packet to display in detail panel */
  selectPacket: (packetId: string) => void;

  /** Clear packet selection (close panel) */
  clearSelection: () => void;

  /** Get currently selected packet details */
  getSelectedPacket: () => PacketDetail | null;

  /** Recently viewed packet IDs (for history sidebar) */
  recentPackets: string[];
}

/**
 * Custom hook to manage packet detail state and cache
 * Builds packet detail cache from PACKET_RECEIVED events
 * Tracks routing path from PACKET_SENT events
 */
export function usePacketDetail(events: TelemetryEvent[]): UsePacketDetailResult {
  const [selectedPacketId, setSelectedPacketId] = useState<string | null>(null);
  const [recentPackets, setRecentPackets] = useState<string[]>([]);

  // Build packet details cache and routing paths from telemetry events
  const packetDetailsCache = useMemo(() => {
    const cache = new Map<string, PacketDetail>();
    const paths = new Map<string, string[]>();

    events.forEach((event) => {
      if (event.type === 'PACKET_RECEIVED') {
        const packetDetail = parsePacketDetail(event);
        if (packetDetail) {
          cache.set(packetDetail.packetId, packetDetail);
        }
      } else if (event.type === 'PACKET_SENT') {
        const packetId = event.data.packetId as string | undefined;
        const nodeId = event.nodeId;

        if (packetId) {
          // Append nodeId to packet's routing path
          const existingPath = paths.get(packetId) || [];
          paths.set(packetId, [...existingPath, nodeId]);
        }
      }
    });

    // Merge routing paths into packet details
    cache.forEach((packetDetail, packetId) => {
      const path = paths.get(packetId);
      if (path) {
        packetDetail.routingPath = path;
      }
    });

    // Limit cache to most recent packets
    if (cache.size > MAX_CACHED_PACKETS) {
      // Sort by timestamp and keep most recent
      const sortedEntries = Array.from(cache.entries()).sort(
        (a, b) => new Date(b[1].timestamp).getTime() - new Date(a[1].timestamp).getTime()
      );
      return new Map(sortedEntries.slice(0, MAX_CACHED_PACKETS));
    }

    return cache;
  }, [events]);

  // Select packet and update recent history
  const selectPacket = (packetId: string): void => {
    setSelectedPacketId(packetId);

    // Add to recent packets (deduped and limited to MAX_RECENT_PACKETS)
    setRecentPackets((prev) => {
      const updated = [packetId, ...prev.filter((id) => id !== packetId)];
      return updated.slice(0, MAX_RECENT_PACKETS);
    });
  };

  // Clear selection
  const clearSelection = (): void => {
    setSelectedPacketId(null);
  };

  // Get selected packet detail
  const getSelectedPacket = (): PacketDetail | null => {
    if (!selectedPacketId) return null;
    return packetDetailsCache.get(selectedPacketId) || null;
  };

  return {
    selectedPacketId,
    selectPacket,
    clearSelection,
    getSelectedPacket,
    recentPackets,
  };
}
