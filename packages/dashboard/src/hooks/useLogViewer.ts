/**
 * useLogViewer Hook - React hook for log viewer state management
 * @packageDocumentation
 * @remarks
 * Manages log entries extraction from telemetry events, filtering, and UI state.
 */

import { useState, useEffect, useMemo } from 'react';
import { TelemetryEvent } from './useTelemetry';
import { LogEntry } from '../types/log';

/**
 * Maximum number of log entries to keep in memory
 * @remarks
 * Prevents memory growth by limiting to 1000 most recent entries
 */
const MAX_LOG_ENTRIES = 1000;

/**
 * Return type for useLogViewer hook
 */
export interface UseLogViewerResult {
  /** All log entries (limited to MAX_LOG_ENTRIES) */
  logEntries: LogEntry[];
  /** Filtered log entries based on active filters */
  filteredEntries: LogEntry[];
  /** Active log level filters */
  levelFilter: Set<string>;
  /** Active node ID filters */
  nodeFilter: Set<string>;
  /** Search query for message filtering */
  searchText: string;
  /** Auto-scroll enabled/disabled */
  autoScroll: boolean;
  /** Toggle log level filter */
  toggleLevelFilter: (level: string) => void;
  /** Toggle node ID filter */
  toggleNodeFilter: (nodeId: string) => void;
  /** Update search query */
  setSearchText: (text: string) => void;
  /** Toggle auto-scroll */
  toggleAutoScroll: () => void;
  /** Clear all filters */
  clearFilters: () => void;
}

/**
 * Custom React hook for log viewer state management
 * @param events - Array of telemetry events from useTelemetry hook
 * @returns Log viewer state and control functions
 *
 * @example
 * ```typescript
 * const { events } = useTelemetry();
 * const {
 *   filteredEntries,
 *   toggleLevelFilter,
 *   setSearchText,
 *   autoScroll
 * } = useLogViewer(events);
 * ```
 *
 * @remarks
 * - Extracts LOG events from telemetry stream
 * - Maintains rolling window of 1000 most recent log entries
 * - Sorts entries in reverse chronological order (newest first)
 * - Applies level, node, and text search filters
 * - Manages auto-scroll state for real-time log viewing
 */
export function useLogViewer(events: TelemetryEvent[]): UseLogViewerResult {
  // State: All log entries (limited to MAX_LOG_ENTRIES)
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);

  // State: Filter selections
  const [levelFilter, setLevelFilter] = useState<Set<string>>(new Set());
  const [nodeFilter, setNodeFilter] = useState<Set<string>>(new Set());
  const [searchText, setSearchText] = useState<string>('');

  // State: Auto-scroll enabled/disabled (default: true)
  const [autoScroll, setAutoScroll] = useState<boolean>(true);

  // Extract log entries from telemetry events
  useEffect(() => {
    // Filter for LOG events
    const logEvents = events.filter((event) => event.type === 'LOG');

    // Extract log entries from event data
    const newLogEntries = logEvents.map((event) => event.data as unknown as LogEntry);

    // Sort in reverse chronological order (newest first)
    newLogEntries.sort((a, b) => {
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });

    // Limit to MAX_LOG_ENTRIES (keep most recent)
    const limitedEntries = newLogEntries.slice(0, MAX_LOG_ENTRIES);

    // Only update if the entries have actually changed (avoid infinite loops)
    setLogEntries((prev) => {
      // Compare lengths first (quick check)
      if (prev.length !== limitedEntries.length) {
        return limitedEntries;
      }

      // If lengths are same, check if content is actually different
      const hasChanged = limitedEntries.some((entry, index) => {
        const prevEntry = prev[index];
        return (
          !prevEntry ||
          entry.timestamp !== prevEntry.timestamp ||
          entry.message !== prevEntry.message
        );
      });

      return hasChanged ? limitedEntries : prev;
    });
  }, [events]);

  // Compute filtered entries based on active filters
  const filteredEntries = useMemo(() => {
    return logEntries.filter((entry) => {
      // Filter by log level
      if (levelFilter.size > 0 && !levelFilter.has(entry.level)) {
        return false;
      }

      // Filter by node ID
      if (nodeFilter.size > 0 && !nodeFilter.has(entry.nodeId)) {
        return false;
      }

      // Filter by search text (case-insensitive message search)
      if (searchText && !entry.message.toLowerCase().includes(searchText.toLowerCase())) {
        return false;
      }

      return true;
    });
  }, [logEntries, levelFilter, nodeFilter, searchText]);

  // Toggle level filter
  const toggleLevelFilter = (level: string): void => {
    setLevelFilter((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(level)) {
        newSet.delete(level);
      } else {
        newSet.add(level);
      }
      return newSet;
    });
  };

  // Toggle node filter
  const toggleNodeFilter = (nodeId: string): void => {
    setNodeFilter((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(nodeId)) {
        newSet.delete(nodeId);
      } else {
        newSet.add(nodeId);
      }
      return newSet;
    });
  };

  // Toggle auto-scroll
  const toggleAutoScroll = (): void => {
    setAutoScroll((prev) => !prev);
  };

  // Clear all filters
  const clearFilters = (): void => {
    setLevelFilter(new Set());
    setNodeFilter(new Set());
    setSearchText('');
  };

  return {
    logEntries,
    filteredEntries,
    levelFilter,
    nodeFilter,
    searchText,
    autoScroll,
    toggleLevelFilter,
    toggleNodeFilter,
    setSearchText,
    toggleAutoScroll,
    clearFilters,
  };
}
