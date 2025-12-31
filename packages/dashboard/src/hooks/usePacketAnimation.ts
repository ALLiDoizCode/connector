/**
 * Custom React hook for packet animation state management
 */

import { useState, useEffect, useRef } from 'react';
import { TelemetryEvent } from './useTelemetry';
import { AnimatedPacket, PacketAnimationState, PACKET_COLORS } from '../types/animation';

/**
 * Hook result interface
 */
export interface UsePacketAnimationResult {
  activePackets: AnimatedPacket[];
}

const MAX_PACKET_TYPE_CACHE_SIZE = 1000;
const ANIMATION_DURATION = 800; // milliseconds
const CLEANUP_DELAY = 1000; // milliseconds after completion

/**
 * Custom hook to manage packet animation state from telemetry events
 * Tracks packet types from PACKET_RECEIVED and creates animations from PACKET_SENT
 */
export function usePacketAnimation(events: TelemetryEvent[]): UsePacketAnimationResult {
  const [animationState, setAnimationState] = useState<PacketAnimationState>({
    activePackets: new Map(),
    completedPackets: new Set(),
  });

  const [packetTypes, setPacketTypes] = useState<Map<string, 'PREPARE' | 'FULFILL' | 'REJECT'>>(
    new Map()
  );

  // Track packet types from PACKET_RECEIVED events
  useEffect(() => {
    events.forEach((event) => {
      if (event.type === 'PACKET_RECEIVED') {
        const packetId = event.data.packetId as string | undefined;
        const packetType = event.data.packetType as 'PREPARE' | 'FULFILL' | 'REJECT' | undefined;

        if (packetId && packetType) {
          setPacketTypes((prev) => {
            const updated = new Map(prev);
            updated.set(packetId, packetType);

            // Limit cache size to prevent memory growth
            if (updated.size > MAX_PACKET_TYPE_CACHE_SIZE) {
              // Remove oldest entry (first entry in Map)
              const firstKey = updated.keys().next().value;
              if (firstKey) {
                updated.delete(firstKey);
              }
            }

            return updated;
          });
        }
      }
    });
  }, [events]);

  // Track processed event IDs to prevent duplicate animations
  const processedEventsRef = useRef<Set<string>>(new Set());

  // Process PACKET_SENT events to create animations
  useEffect(() => {
    events.forEach((event) => {
      if (event.type === 'PACKET_SENT') {
        const packetId = event.data.packetId as string | undefined;
        const nextHop = event.data.nextHop as string | undefined;
        const sourceNodeId = event.nodeId;

        if (packetId && nextHop && sourceNodeId) {
          // Create unique event key to track processed events
          const eventKey = `${event.timestamp}-${packetId}`;

          // Skip if we've already processed this event
          if (processedEventsRef.current.has(eventKey)) {
            return;
          }

          processedEventsRef.current.add(eventKey);

          // Lookup packet type from cache (default to PREPARE)
          const type = packetTypes.get(packetId) ?? 'PREPARE';

          // Determine color based on packet type
          const color = PACKET_COLORS[type];

          // Create animated packet
          const animationStartTime = Date.now();
          const animatedPacket: AnimatedPacket = {
            id: packetId,
            type,
            sourceNodeId,
            targetNodeId: nextHop,
            startTime: animationStartTime,
            duration: ANIMATION_DURATION,
            color,
          };

          // Measure latency from telemetry event to animation start
          const eventTime = new Date(event.timestamp).getTime();
          const latency = animationStartTime - eventTime;
          // eslint-disable-next-line no-console
          console.debug(
            `[usePacketAnimation] Packet animation started in ${latency}ms (packetId: ${packetId})`
          );

          // Add to active packets
          setAnimationState((prev) => ({
            ...prev,
            activePackets: new Map(prev.activePackets).set(packetId, animatedPacket),
          }));

          // Schedule cleanup after animation completes
          setTimeout(() => {
            setAnimationState((prev) => {
              const newActivePackets = new Map(prev.activePackets);
              newActivePackets.delete(packetId);

              const newCompletedPackets = new Set(prev.completedPackets);
              newCompletedPackets.add(packetId);

              return {
                activePackets: newActivePackets,
                completedPackets: newCompletedPackets,
              };
            });

            // Remove from completed packets after delay to allow for late cleanup
            setTimeout(() => {
              setAnimationState((prev) => {
                const newCompletedPackets = new Set(prev.completedPackets);
                newCompletedPackets.delete(packetId);

                return {
                  ...prev,
                  completedPackets: newCompletedPackets,
                };
              });
            }, CLEANUP_DELAY);
          }, ANIMATION_DURATION);
        }
      }
    });
  }, [events, packetTypes]);

  return {
    activePackets: Array.from(animationState.activePackets.values()),
  };
}
