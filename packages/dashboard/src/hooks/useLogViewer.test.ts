/**
 * Unit tests for useLogViewer hook
 */

import { renderHook, act } from '@testing-library/react';
import { useLogViewer } from './useLogViewer';
import { TelemetryEvent } from '../hooks/useTelemetry';

/**
 * Helper to create LOG telemetry events
 */
function createLogEvent(
  level: 'debug' | 'info' | 'warn' | 'error',
  nodeId: string,
  message: string,
  timestamp?: string,
  correlationId?: string
): TelemetryEvent {
  return {
    type: 'LOG',
    nodeId,
    timestamp: timestamp || new Date().toISOString(),
    data: {
      level,
      timestamp: timestamp || new Date().toISOString(),
      nodeId,
      message,
      correlationId,
    } as unknown as Record<string, unknown>,
  };
}

describe('useLogViewer Hook', () => {
  describe('Test 4: LOG event extraction from telemetry', () => {
    it('should extract LOG events from telemetry stream', () => {
      // Arrange
      const events: TelemetryEvent[] = [
        createLogEvent('info', 'connector-a', 'Test message 1'),
        createLogEvent('error', 'connector-b', 'Test message 2'),
        {
          type: 'NODE_STATUS',
          nodeId: 'connector-a',
          timestamp: new Date().toISOString(),
          data: {},
        },
        createLogEvent('warn', 'connector-a', 'Test message 3'),
      ];

      // Act
      const { result } = renderHook(() => useLogViewer(events));

      // Assert
      expect(result.current.logEntries.length).toBe(3);
      expect(result.current.logEntries[0]?.message).toBe('Test message 3'); // Newest first
      expect(result.current.logEntries[1]?.message).toBe('Test message 2');
      expect(result.current.logEntries[2]?.message).toBe('Test message 1');
    });

    it('should extract LogEntry fields correctly', () => {
      // Arrange
      const timestamp = new Date('2024-12-29T12:00:00Z').toISOString();
      const events: TelemetryEvent[] = [
        createLogEvent('info', 'connector-a', 'Packet received', timestamp, 'pkt_abc123'),
      ];

      // Act
      const { result } = renderHook(() => useLogViewer(events));

      // Assert
      const logEntry = result.current.logEntries[0];
      expect(logEntry?.level).toBe('info');
      expect(logEntry?.nodeId).toBe('connector-a');
      expect(logEntry?.message).toBe('Packet received');
      expect(logEntry?.timestamp).toBe(timestamp);
      expect(logEntry?.correlationId).toBe('pkt_abc123');
    });

    it('should update logEntries when new events arrive', () => {
      // Arrange
      const initialEvents: TelemetryEvent[] = [createLogEvent('info', 'connector-a', 'Message 1')];

      const { result, rerender } = renderHook(({ events }) => useLogViewer(events), {
        initialProps: { events: initialEvents },
      });

      // Act - Add new event
      const updatedEvents = [...initialEvents, createLogEvent('warn', 'connector-b', 'Message 2')];
      rerender({ events: updatedEvents });

      // Assert
      expect(result.current.logEntries.length).toBe(2);
      expect(result.current.logEntries[0]?.message).toBe('Message 2');
      expect(result.current.logEntries[1]?.message).toBe('Message 1');
    });

    it('should sort entries in reverse chronological order (newest first)', () => {
      // Arrange
      const events: TelemetryEvent[] = [
        createLogEvent(
          'info',
          'connector-a',
          'First',
          new Date('2024-12-29T10:00:00Z').toISOString()
        ),
        createLogEvent(
          'info',
          'connector-a',
          'Second',
          new Date('2024-12-29T11:00:00Z').toISOString()
        ),
        createLogEvent(
          'info',
          'connector-a',
          'Third',
          new Date('2024-12-29T12:00:00Z').toISOString()
        ),
      ];

      // Act
      const { result } = renderHook(() => useLogViewer(events));

      // Assert - Should be in reverse chronological order
      expect(result.current.logEntries[0]?.message).toBe('Third');
      expect(result.current.logEntries[1]?.message).toBe('Second');
      expect(result.current.logEntries[2]?.message).toBe('First');
    });

    it('should ignore non-LOG telemetry events', () => {
      // Arrange
      const events: TelemetryEvent[] = [
        {
          type: 'NODE_STATUS',
          nodeId: 'connector-a',
          timestamp: new Date().toISOString(),
          data: {},
        },
        {
          type: 'PACKET_SENT',
          nodeId: 'connector-a',
          timestamp: new Date().toISOString(),
          data: {},
        },
        createLogEvent('info', 'connector-a', 'Log message'),
        {
          type: 'ROUTE_LOOKUP',
          nodeId: 'connector-a',
          timestamp: new Date().toISOString(),
          data: {},
        },
      ];

      // Act
      const { result } = renderHook(() => useLogViewer(events));

      // Assert
      expect(result.current.logEntries.length).toBe(1);
      expect(result.current.logEntries[0]?.message).toBe('Log message');
    });
  });

  describe('Test 5: Filtering by log level', () => {
    it('should filter by single log level', () => {
      // Arrange
      const events: TelemetryEvent[] = [
        createLogEvent('debug', 'connector-a', 'Debug message'),
        createLogEvent('info', 'connector-a', 'Info message'),
        createLogEvent('warn', 'connector-a', 'Warn message'),
        createLogEvent('error', 'connector-a', 'Error message'),
      ];

      const { result } = renderHook(() => useLogViewer(events));

      // Act - Filter for errors only
      act(() => {
        result.current.toggleLevelFilter('error');
      });

      // Assert
      expect(result.current.filteredEntries.length).toBe(1);
      expect(result.current.filteredEntries[0]?.level).toBe('error');
      expect(result.current.filteredEntries[0]?.message).toBe('Error message');
    });

    it('should filter by multiple log levels', () => {
      // Arrange
      const events: TelemetryEvent[] = [
        createLogEvent('debug', 'connector-a', 'Debug message'),
        createLogEvent('info', 'connector-a', 'Info message'),
        createLogEvent('warn', 'connector-a', 'Warn message'),
        createLogEvent('error', 'connector-a', 'Error message'),
      ];

      const { result } = renderHook(() => useLogViewer(events));

      // Act - Filter for warnings and errors
      act(() => {
        result.current.toggleLevelFilter('warn');
        result.current.toggleLevelFilter('error');
      });

      // Assert
      expect(result.current.filteredEntries.length).toBe(2);
      expect(result.current.filteredEntries.some((e) => e.level === 'warn')).toBe(true);
      expect(result.current.filteredEntries.some((e) => e.level === 'error')).toBe(true);
      expect(result.current.filteredEntries.some((e) => e.level === 'info')).toBe(false);
      expect(result.current.filteredEntries.some((e) => e.level === 'debug')).toBe(false);
    });

    it('should toggle level filter on and off', () => {
      // Arrange
      const events: TelemetryEvent[] = [
        createLogEvent('info', 'connector-a', 'Info message'),
        createLogEvent('error', 'connector-a', 'Error message'),
      ];

      const { result } = renderHook(() => useLogViewer(events));

      // Act - Toggle error filter on
      act(() => {
        result.current.toggleLevelFilter('error');
      });

      // Assert - Only errors visible
      expect(result.current.filteredEntries.length).toBe(1);
      expect(result.current.filteredEntries[0]?.level).toBe('error');

      // Act - Toggle error filter off
      act(() => {
        result.current.toggleLevelFilter('error');
      });

      // Assert - All entries visible again
      expect(result.current.filteredEntries.length).toBe(2);
    });

    it('should show all entries when no level filter is active', () => {
      // Arrange
      const events: TelemetryEvent[] = [
        createLogEvent('debug', 'connector-a', 'Debug'),
        createLogEvent('info', 'connector-a', 'Info'),
        createLogEvent('warn', 'connector-a', 'Warn'),
        createLogEvent('error', 'connector-a', 'Error'),
      ];

      const { result } = renderHook(() => useLogViewer(events));

      // Assert - No filters active, all entries visible
      expect(result.current.levelFilter.size).toBe(0);
      expect(result.current.filteredEntries.length).toBe(4);
    });
  });

  describe('Test 6: Filtering by node ID', () => {
    it('should filter by single node ID', () => {
      // Arrange
      const events: TelemetryEvent[] = [
        createLogEvent('info', 'connector-a', 'Message from A'),
        createLogEvent('info', 'connector-b', 'Message from B'),
        createLogEvent('info', 'connector-c', 'Message from C'),
      ];

      const { result } = renderHook(() => useLogViewer(events));

      // Act
      act(() => {
        result.current.toggleNodeFilter('connector-a');
      });

      // Assert
      expect(result.current.filteredEntries.length).toBe(1);
      expect(result.current.filteredEntries[0]?.nodeId).toBe('connector-a');
    });

    it('should filter by multiple node IDs', () => {
      // Arrange
      const events: TelemetryEvent[] = [
        createLogEvent('info', 'connector-a', 'Message from A'),
        createLogEvent('info', 'connector-b', 'Message from B'),
        createLogEvent('info', 'connector-c', 'Message from C'),
      ];

      const { result } = renderHook(() => useLogViewer(events));

      // Act
      act(() => {
        result.current.toggleNodeFilter('connector-a');
        result.current.toggleNodeFilter('connector-c');
      });

      // Assert
      expect(result.current.filteredEntries.length).toBe(2);
      expect(result.current.filteredEntries.some((e) => e.nodeId === 'connector-a')).toBe(true);
      expect(result.current.filteredEntries.some((e) => e.nodeId === 'connector-c')).toBe(true);
      expect(result.current.filteredEntries.some((e) => e.nodeId === 'connector-b')).toBe(false);
    });

    it('should toggle node filter on and off', () => {
      // Arrange
      const events: TelemetryEvent[] = [
        createLogEvent('info', 'connector-a', 'Message from A'),
        createLogEvent('info', 'connector-b', 'Message from B'),
      ];

      const { result } = renderHook(() => useLogViewer(events));

      // Act - Toggle on
      act(() => {
        result.current.toggleNodeFilter('connector-a');
      });

      expect(result.current.filteredEntries.length).toBe(1);

      // Act - Toggle off
      act(() => {
        result.current.toggleNodeFilter('connector-a');
      });

      // Assert - All visible
      expect(result.current.filteredEntries.length).toBe(2);
    });
  });

  describe('Test 7: Filtering by search text', () => {
    it('should filter by search text (case-insensitive)', () => {
      // Arrange
      const events: TelemetryEvent[] = [
        createLogEvent('info', 'connector-a', 'Packet received from peer'),
        createLogEvent('info', 'connector-a', 'Route lookup completed'),
        createLogEvent('info', 'connector-a', 'PACKET sent to destination'),
      ];

      const { result } = renderHook(() => useLogViewer(events));

      // Act
      act(() => {
        result.current.setSearchText('packet');
      });

      // Assert - Should match "Packet" and "PACKET" (case-insensitive)
      expect(result.current.filteredEntries.length).toBe(2);
      expect(result.current.filteredEntries.some((e) => e.message.includes('Packet'))).toBe(true);
      expect(result.current.filteredEntries.some((e) => e.message.includes('PACKET'))).toBe(true);
    });

    it('should filter by partial search text', () => {
      // Arrange
      const events: TelemetryEvent[] = [
        createLogEvent('info', 'connector-a', 'Connection established'),
        createLogEvent('info', 'connector-a', 'Connection lost'),
        createLogEvent('info', 'connector-a', 'Packet forwarded'),
      ];

      const { result } = renderHook(() => useLogViewer(events));

      // Act
      act(() => {
        result.current.setSearchText('connect');
      });

      // Assert
      expect(result.current.filteredEntries.length).toBe(2);
      expect(
        result.current.filteredEntries.every((e) => e.message.toLowerCase().includes('connect'))
      ).toBe(true);
    });

    it('should clear search filter when search text is empty', () => {
      // Arrange
      const events: TelemetryEvent[] = [
        createLogEvent('info', 'connector-a', 'Message 1'),
        createLogEvent('info', 'connector-a', 'Message 2'),
      ];

      const { result } = renderHook(() => useLogViewer(events));

      // Act - Set search text
      act(() => {
        result.current.setSearchText('Message 1');
      });

      expect(result.current.filteredEntries.length).toBe(1);

      // Act - Clear search
      act(() => {
        result.current.setSearchText('');
      });

      // Assert - All entries visible
      expect(result.current.filteredEntries.length).toBe(2);
    });

    it('should return empty array when search text matches no entries', () => {
      // Arrange
      const events: TelemetryEvent[] = [
        createLogEvent('info', 'connector-a', 'Packet received'),
        createLogEvent('info', 'connector-a', 'Route updated'),
      ];

      const { result } = renderHook(() => useLogViewer(events));

      // Act
      act(() => {
        result.current.setSearchText('nonexistent');
      });

      // Assert
      expect(result.current.filteredEntries.length).toBe(0);
    });
  });

  describe('Test 8: Entry limit (1000 entries)', () => {
    it('should limit log entries to 1000 most recent', () => {
      // Arrange - Create 1500 log events
      const events: TelemetryEvent[] = Array.from({ length: 1500 }, (_, i) =>
        createLogEvent(
          'info',
          'connector-a',
          `Message ${i}`,
          new Date(Date.now() + i).toISOString()
        )
      );

      // Act
      const { result } = renderHook(() => useLogViewer(events));

      // Assert - Should keep only 1000 most recent
      expect(result.current.logEntries.length).toBe(1000);
      // First entry should be the newest (highest index)
      expect(result.current.logEntries[0]?.message).toBe('Message 1499');
      // Last entry should be message 500 (1500 - 1000 = 500)
      expect(result.current.logEntries[999]?.message).toBe('Message 500');
    });

    it('should keep entries under 1000 without dropping any', () => {
      // Arrange - Create 500 log events
      const events: TelemetryEvent[] = Array.from({ length: 500 }, (_, i) =>
        createLogEvent('info', 'connector-a', `Message ${i}`)
      );

      // Act
      const { result } = renderHook(() => useLogViewer(events));

      // Assert
      expect(result.current.logEntries.length).toBe(500);
    });

    it('should maintain 1000-entry limit when events are updated', () => {
      // Arrange - Start with 900 entries
      const initialEvents: TelemetryEvent[] = Array.from({ length: 900 }, (_, i) =>
        createLogEvent(
          'info',
          'connector-a',
          `Message ${i}`,
          new Date(Date.now() + i).toISOString()
        )
      );

      const { result, rerender } = renderHook(({ events }) => useLogViewer(events), {
        initialProps: { events: initialEvents },
      });

      // Act - Add 200 more entries (total 1100)
      const additionalEvents = Array.from({ length: 200 }, (_, i) =>
        createLogEvent(
          'info',
          'connector-a',
          `New message ${i}`,
          new Date(Date.now() + 900 + i).toISOString()
        )
      );
      const updatedEvents = [...initialEvents, ...additionalEvents];
      rerender({ events: updatedEvents });

      // Assert - Should limit to 1000
      expect(result.current.logEntries.length).toBe(1000);
      // Newest entry should be from additional events
      expect(result.current.logEntries[0]?.message).toBe('New message 199');
    });
  });

  describe('Combined filters', () => {
    it('should apply level, node, and search filters together', () => {
      // Arrange
      const events: TelemetryEvent[] = [
        createLogEvent('error', 'connector-a', 'Error: packet dropped'),
        createLogEvent('error', 'connector-b', 'Error: connection lost'),
        createLogEvent('warn', 'connector-a', 'Warning: packet delayed'),
        createLogEvent('info', 'connector-a', 'Packet received'),
      ];

      const { result } = renderHook(() => useLogViewer(events));

      // Act - Filter: level=error, node=connector-a, search="packet"
      act(() => {
        result.current.toggleLevelFilter('error');
        result.current.toggleNodeFilter('connector-a');
        result.current.setSearchText('packet');
      });

      // Assert - Only "Error: packet dropped" should match all filters
      expect(result.current.filteredEntries.length).toBe(1);
      expect(result.current.filteredEntries[0]?.message).toBe('Error: packet dropped');
    });

    it('should reset all filters with clearFilters()', () => {
      // Arrange
      const events: TelemetryEvent[] = [
        createLogEvent('error', 'connector-a', 'Error message'),
        createLogEvent('info', 'connector-b', 'Info message'),
      ];

      const { result } = renderHook(() => useLogViewer(events));

      // Act - Apply filters
      act(() => {
        result.current.toggleLevelFilter('error');
        result.current.toggleNodeFilter('connector-a');
        result.current.setSearchText('error');
      });

      expect(result.current.filteredEntries.length).toBe(1);

      // Act - Clear all filters
      act(() => {
        result.current.clearFilters();
      });

      // Assert - All entries visible, filters cleared
      expect(result.current.filteredEntries.length).toBe(2);
      expect(result.current.levelFilter.size).toBe(0);
      expect(result.current.nodeFilter.size).toBe(0);
      expect(result.current.searchText).toBe('');
    });
  });

  describe('Auto-scroll state', () => {
    it('should default auto-scroll to true', () => {
      // Arrange & Act
      const { result } = renderHook(() => useLogViewer([]));

      // Assert
      expect(result.current.autoScroll).toBe(true);
    });

    it('should toggle auto-scroll state', () => {
      // Arrange
      const { result } = renderHook(() => useLogViewer([]));

      // Act - Toggle off
      act(() => {
        result.current.toggleAutoScroll();
      });

      // Assert
      expect(result.current.autoScroll).toBe(false);

      // Act - Toggle on
      act(() => {
        result.current.toggleAutoScroll();
      });

      // Assert
      expect(result.current.autoScroll).toBe(true);
    });
  });
});
