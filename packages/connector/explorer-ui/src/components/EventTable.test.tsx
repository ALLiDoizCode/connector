/**
 * EventTable Unit Tests - Story 18.3
 * Tests for Packets Tab redesign with ILP terminology
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { EventTable } from './EventTable';
import { TelemetryEvent } from '@/lib/event-types';

// Mock dependencies
vi.mock('../hooks/useKeyboardNavigation', () => ({
  useKeyboardNavigation: () => ({ selectedIndex: null }),
}));

// Mock @tanstack/react-virtual to render all items in tests
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: Math.min(count, 20) }, (_, index) => ({
        index,
        start: index * 48,
        size: 48,
        key: index,
      })),
    getTotalSize: () => count * 48,
    scrollToIndex: vi.fn(),
  }),
}));

describe('EventTable - Story 18.3: Packets Tab Redesign', () => {
  const mockOnEventClick = vi.fn();
  const mockOnClearFilters = vi.fn();
  const mockOnLoadMore = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Packet Type Display (AC 2)', () => {
    it('should display PREPARE packet with cyan badge', () => {
      const events: TelemetryEvent[] = [
        {
          type: 'PACKET_RECEIVED',
          packetType: 'prepare',
          timestamp: Date.now(),
          from: 'peer-0',
          to: 'peer-1',
        },
      ];

      render(<EventTable events={events} onEventClick={mockOnEventClick} />);

      const badge = screen.getByText('prepare');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveClass('bg-cyan-500');
    });

    it('should display FULFILL packet with emerald badge', () => {
      const events: TelemetryEvent[] = [
        {
          type: 'PACKET_FORWARDED',
          packetType: 'fulfill',
          timestamp: Date.now(),
          from: 'peer-1',
          to: 'peer-0',
        },
      ];

      render(<EventTable events={events} onEventClick={mockOnEventClick} />);

      const badge = screen.getByText('fulfill');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveClass('bg-emerald-500');
    });

    it('should display REJECT packet with rose badge', () => {
      const events: TelemetryEvent[] = [
        {
          type: 'PACKET_FORWARDED',
          packetType: 'reject',
          timestamp: Date.now(),
          from: 'peer-1',
          to: 'peer-0',
        },
      ];

      render(<EventTable events={events} onEventClick={mockOnEventClick} />);

      const badge = screen.getByText('reject');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveClass('bg-rose-500');
    });

    it('should display secondary label for packet action', () => {
      const events: TelemetryEvent[] = [
        {
          type: 'PACKET_RECEIVED',
          packetType: 'prepare',
          timestamp: Date.now(),
          from: 'peer-0',
          to: 'peer-1',
        },
      ];

      render(<EventTable events={events} onEventClick={mockOnEventClick} />);

      const secondaryLabel = screen.getByText('received');
      expect(secondaryLabel).toBeInTheDocument();
      expect(secondaryLabel).toHaveClass('text-muted-foreground');
    });
  });

  describe('Status Column (AC 4)', () => {
    it('should display success icon for FULFILL packets', () => {
      const events: TelemetryEvent[] = [
        {
          type: 'PACKET_FORWARDED',
          packetType: 'fulfill',
          timestamp: Date.now(),
          from: 'peer-1',
          to: 'peer-0',
        },
      ];

      render(<EventTable events={events} onEventClick={mockOnEventClick} />);

      // Check for Success text
      expect(screen.getByText('Success')).toBeInTheDocument();
      // Check for emerald color class
      const statusCell = screen.getByText('Success').closest('div');
      expect(statusCell).toHaveClass('text-emerald-500');
    });

    it('should display failure icon for REJECT packets', () => {
      const events: TelemetryEvent[] = [
        {
          type: 'PACKET_FORWARDED',
          packetType: 'reject',
          timestamp: Date.now(),
          from: 'peer-1',
          to: 'peer-0',
        },
      ];

      render(<EventTable events={events} onEventClick={mockOnEventClick} />);

      // Check for Failed text
      expect(screen.getByText('Failed')).toBeInTheDocument();
      // Check for rose color class
      const statusCell = screen.getByText('Failed').closest('div');
      expect(statusCell).toHaveClass('text-rose-500');
    });

    it('should display pending icon for PREPARE packets', () => {
      const events: TelemetryEvent[] = [
        {
          type: 'PACKET_RECEIVED',
          packetType: 'prepare',
          timestamp: Date.now(),
          from: 'peer-0',
          to: 'peer-1',
          packetId: 'test-packet-123',
        },
      ];

      render(<EventTable events={events} onEventClick={mockOnEventClick} />);

      // Check for Pending text
      expect(screen.getByText('Pending')).toBeInTheDocument();
      // Check for cyan color class
      const statusCell = screen.getByText('Pending').closest('div');
      expect(statusCell).toHaveClass('text-cyan-500');
    });

    it('should display neutral icon for non-packet events', () => {
      const events: TelemetryEvent[] = [
        {
          type: 'NODE_STATUS',
          timestamp: Date.now(),
        },
      ];

      render(<EventTable events={events} onEventClick={mockOnEventClick} />);

      // Check for N/A text
      expect(screen.getByText('N/A')).toBeInTheDocument();
      // Check for muted color class
      const statusCell = screen.getByText('N/A').closest('div');
      expect(statusCell).toHaveClass('text-muted-foreground');
    });
  });

  describe('Empty States (AC 6)', () => {
    it('should display "Waiting for packet activity..." when no packets and no filters', () => {
      render(
        <EventTable
          events={[]}
          onEventClick={mockOnEventClick}
          hasActiveFilters={false}
          connectionStatus="connected"
        />
      );

      expect(screen.getByText('Waiting for packet activity...')).toBeInTheDocument();
      expect(
        screen.getByText('Packets will appear here when your node receives or forwards ILP traffic')
      ).toBeInTheDocument();
    });

    it('should display "No packets match your filters" when filters active', () => {
      render(
        <EventTable
          events={[]}
          onEventClick={mockOnEventClick}
          hasActiveFilters={true}
          onClearFilters={mockOnClearFilters}
          connectionStatus="connected"
        />
      );

      expect(screen.getByText('No packets match your filters')).toBeInTheDocument();
      expect(screen.getByText('Try adjusting or clearing your filters')).toBeInTheDocument();
      expect(screen.getByText('Clear filters')).toBeInTheDocument();
    });

    it('should display "Disconnected" when connection lost', () => {
      render(
        <EventTable events={[]} onEventClick={mockOnEventClick} connectionStatus="disconnected" />
      );

      expect(screen.getByText('Disconnected')).toBeInTheDocument();
      expect(
        screen.getByText('Unable to connect to agent. Attempting to reconnect...')
      ).toBeInTheDocument();
    });
  });

  describe('Routing Flow Visualization (AC 3)', () => {
    it('should display From and To peer addresses', () => {
      const events: TelemetryEvent[] = [
        {
          type: 'PACKET_RECEIVED',
          packetType: 'prepare',
          timestamp: Date.now(),
          from: 'peer-0',
          to: 'peer-1',
        },
      ];

      const { container } = render(<EventTable events={events} onEventClick={mockOnEventClick} />);

      // Check for peer links in DOM (button elements)
      const buttons = container.querySelectorAll('button');
      expect(buttons.length).toBeGreaterThan(0);

      // Verify From header column exists
      expect(screen.getByText('From')).toBeInTheDocument();
      expect(screen.getByText('To')).toBeInTheDocument();
    });

    it('should make peer links clickable with Explorer URL', () => {
      const events: TelemetryEvent[] = [
        {
          type: 'PACKET_RECEIVED',
          packetType: 'prepare',
          timestamp: Date.now(),
          from: 'peer-0',
          to: 'peer-1',
        },
      ];

      const { container } = render(<EventTable events={events} onEventClick={mockOnEventClick} />);

      // Find clickable peer buttons
      const peerButtons = container.querySelectorAll('button[title*="Explorer"]');
      expect(peerButtons.length).toBeGreaterThan(0);

      // Verify title contains Explorer URL
      const firstPeerButton = peerButtons[0];
      expect(firstPeerButton).toHaveAttribute('title', expect.stringContaining('Explorer'));
    });
  });

  describe('Virtual Scrolling Performance (AC 7)', () => {
    it('should render table with virtual scrolling container for large datasets', () => {
      // Create 100 mock events
      const largeEventSet: TelemetryEvent[] = Array.from({ length: 100 }, (_, i) => ({
        type: 'PACKET_RECEIVED',
        packetType: 'prepare',
        timestamp: Date.now() - i * 1000,
        from: `peer-${i % 5}`,
        to: `peer-${(i + 1) % 5}`,
        packetId: `packet-${i}`,
      }));

      const { container } = render(
        <EventTable events={largeEventSet} onEventClick={mockOnEventClick} />
      );

      // Virtual scroller container should be present with position: relative
      const scrollContainer = container.querySelector('[style*="position: relative"]');
      expect(scrollContainer).toBeInTheDocument();

      // Table headers should be present
      expect(screen.getByText('Time')).toBeInTheDocument();
      expect(screen.getByText('Type')).toBeInTheDocument();
      expect(screen.getByText('Status')).toBeInTheDocument();
    });
  });

  describe('Pagination Mode (AC 7)', () => {
    it('should display pagination footer in history mode', () => {
      const events: TelemetryEvent[] = [
        {
          type: 'PACKET_RECEIVED',
          packetType: 'prepare',
          timestamp: Date.now(),
        },
      ];

      render(
        <EventTable
          events={events}
          onEventClick={mockOnEventClick}
          showPagination={true}
          total={50}
          onLoadMore={mockOnLoadMore}
        />
      );

      expect(screen.getByText('Showing 1 of 50 events')).toBeInTheDocument();
      expect(screen.getByText('Load More')).toBeInTheDocument();
    });

    it('should not display pagination footer in live mode', () => {
      const events: TelemetryEvent[] = [
        {
          type: 'PACKET_RECEIVED',
          packetType: 'prepare',
          timestamp: Date.now(),
        },
      ];

      render(<EventTable events={events} onEventClick={mockOnEventClick} showPagination={false} />);

      expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
      expect(screen.queryByText('Load More')).not.toBeInTheDocument();
    });
  });

  describe('Loading State', () => {
    it('should display skeleton loading state', () => {
      render(<EventTable events={[]} onEventClick={mockOnEventClick} loading={true} />);

      // Check for animated skeleton loaders
      const skeletons = document.querySelectorAll('.animate-pulse');
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });
});
