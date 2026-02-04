// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { Dashboard } from './Dashboard';
import { TelemetryEvent } from '../lib/event-types';
import { vi } from 'vitest';

/**
 * Test helpers for creating mock telemetry events
 */
function createPrepareEvent(overrides?: Partial<TelemetryEvent>): TelemetryEvent {
  return {
    type: 'PACKET_RECEIVED',
    timestamp: Date.now(),
    packetType: 'prepare',
    from: 'g.peer1',
    to: 'g.peer2',
    destination: 'g.peer3.alice',
    amount: '1000000',
    nodeId: 'test-node',
    ...overrides,
  };
}

function createFulfillEvent(overrides?: Partial<TelemetryEvent>): TelemetryEvent {
  return {
    type: 'PACKET_FORWARDED',
    timestamp: Date.now(),
    packetType: 'fulfill',
    from: 'g.peer2',
    to: 'g.peer1',
    amount: '1000000',
    nodeId: 'test-node',
    ...overrides,
  };
}

function createRejectEvent(overrides?: Partial<TelemetryEvent>): TelemetryEvent {
  return {
    type: 'PACKET_FORWARDED',
    timestamp: Date.now(),
    packetType: 'reject',
    from: 'g.peer2',
    to: 'g.peer1',
    nodeId: 'test-node',
    ...overrides,
  };
}

describe('Dashboard', () => {
  describe('Rendering', () => {
    it('should render without crashing with empty events', () => {
      const { container } = render(<Dashboard events={[]} connectionStatus="connected" />);
      expect(container).toBeInTheDocument();
    });

    it('should display empty state when no packets', () => {
      render(<Dashboard events={[]} connectionStatus="connected" />);
      expect(screen.getByText('Waiting for packet activity...')).toBeInTheDocument();
    });

    it('should render all four metric cards', () => {
      render(<Dashboard events={[]} connectionStatus="connected" />);

      expect(screen.getByText('Total Packets')).toBeInTheDocument();
      expect(screen.getByText('Success Rate')).toBeInTheDocument();
      expect(screen.getByText('Active Channels')).toBeInTheDocument();
      expect(screen.getByText('Routing Status')).toBeInTheDocument();
    });
  });

  describe('Metric Calculations', () => {
    it('should calculate total packets correctly', () => {
      const events: TelemetryEvent[] = [
        createPrepareEvent(),
        createFulfillEvent(),
        createRejectEvent(),
      ];

      render(<Dashboard events={events} connectionStatus="connected" />);

      // Total packets should be 3 (1 prepare + 1 fulfill + 1 reject)
      expect(screen.getByText('3')).toBeInTheDocument();
    });

    it('should calculate success rate correctly', () => {
      const events: TelemetryEvent[] = [
        createPrepareEvent({ timestamp: Date.now() - 1000 }),
        createPrepareEvent({ timestamp: Date.now() - 2000 }),
        createFulfillEvent({ timestamp: Date.now() - 3000 }),
        createRejectEvent({ timestamp: Date.now() - 4000 }),
      ];

      render(<Dashboard events={events} connectionStatus="connected" />);

      // Success rate = (1 fulfill / 2 prepare) * 100 = 50.0%
      expect(screen.getByText('50.0%')).toBeInTheDocument();
    });

    it('should handle division by zero when no PREPARE packets', () => {
      const events: TelemetryEvent[] = [createFulfillEvent(), createRejectEvent()];

      render(<Dashboard events={events} connectionStatus="connected" />);

      // Success rate should be 0.0% when no PREPARE packets
      expect(screen.getByText('0.0%')).toBeInTheDocument();
    });

    it('should calculate 100% success rate when all prepares are fulfilled', () => {
      const events: TelemetryEvent[] = [createPrepareEvent(), createFulfillEvent()];

      render(<Dashboard events={events} connectionStatus="connected" />);

      // Success rate = (1 fulfill / 1 prepare) * 100 = 100.0%
      expect(screen.getByText('100.0%')).toBeInTheDocument();
    });

    it('should update metrics when events prop changes', () => {
      const { rerender } = render(<Dashboard events={[]} connectionStatus="connected" />);

      // Initially should show 0% success rate
      expect(screen.getByText('0.0%')).toBeInTheDocument();
      expect(screen.getByText('0 fulfilled / 0 rejected')).toBeInTheDocument();

      // Add events and re-render
      const events: TelemetryEvent[] = [createPrepareEvent(), createFulfillEvent()];
      rerender(<Dashboard events={events} connectionStatus="connected" />);

      // Now should show 100% success rate and updated counts
      expect(screen.getByText('100.0%')).toBeInTheDocument();
      expect(screen.getByText('1 fulfilled / 0 rejected')).toBeInTheDocument();
    });
  });

  describe('Packet Flow', () => {
    it('should display recent packets in packet flow', () => {
      const events: TelemetryEvent[] = [createPrepareEvent({ from: 'g.alice', to: 'g.bob' })];

      render(<Dashboard events={events} connectionStatus="connected" />);

      expect(screen.getByText('g.alice')).toBeInTheDocument();
      expect(screen.getByText('g.bob')).toBeInTheDocument();
    });

    it('should limit packet flow to 10 items', () => {
      // Create 15 events
      const events: TelemetryEvent[] = Array.from({ length: 15 }, (_, i) =>
        createPrepareEvent({ timestamp: Date.now() - i * 1000 })
      );

      const { container } = render(<Dashboard events={events} connectionStatus="connected" />);

      // Count the number of packet flow items (excluding empty state)
      // Each packet flow item has class "group relative flex items-center"
      const packetItems = container.querySelectorAll('.group.relative.flex.items-center');
      expect(packetItems.length).toBe(10);
    });

    it('should sort packet flow by timestamp (most recent first)', () => {
      const events: TelemetryEvent[] = [
        createPrepareEvent({ timestamp: 1000, from: 'oldest' }),
        createPrepareEvent({ timestamp: 3000, from: 'newest' }),
        createPrepareEvent({ timestamp: 2000, from: 'middle' }),
      ];

      render(<Dashboard events={events} connectionStatus="connected" />);

      const fromElements = screen.getAllByText(/newest|middle|oldest/);
      // First element should be 'newest' (timestamp 3000)
      expect(fromElements[0].textContent).toContain('newest');
    });

    it('should apply correct color classes for packet types', () => {
      const events: TelemetryEvent[] = [
        createPrepareEvent(),
        createFulfillEvent(),
        createRejectEvent(),
      ];

      const { container } = render(<Dashboard events={events} connectionStatus="connected" />);

      // Check for packet type badges with correct colors
      expect(container.querySelector('.bg-cyan-500\\/20')).toBeInTheDocument(); // PREPARE
      expect(container.querySelector('.bg-emerald-500\\/20')).toBeInTheDocument(); // FULFILL
      expect(container.querySelector('.bg-rose-500\\/20')).toBeInTheDocument(); // REJECT
    });

    it('should format packet flow items correctly', () => {
      const events: TelemetryEvent[] = [
        createPrepareEvent({
          from: 'g.peer1',
          to: 'g.peer2',
          amount: '5000000',
          destination: 'g.peer3.alice',
        }),
      ];

      render(<Dashboard events={events} connectionStatus="connected" />);

      // Should display from and to addresses
      expect(screen.getByText('g.peer1')).toBeInTheDocument();
      expect(screen.getByText('g.peer2')).toBeInTheDocument();

      // Should display PREPARE badge
      expect(screen.getByText('prepare')).toBeInTheDocument();
    });
  });

  describe('Success Rate Color Coding', () => {
    it('should show success variant when success rate > 90%', () => {
      const events: TelemetryEvent[] = [
        createPrepareEvent(),
        createFulfillEvent(), // 100% success rate
      ];

      const { container } = render(<Dashboard events={events} connectionStatus="connected" />);

      // Success Rate card should have success border color
      const successCard = container.querySelector('.border-emerald-500\\/30');
      expect(successCard).toBeInTheDocument();
    });

    it('should show warning variant when success rate between 70% and 90%', () => {
      const events: TelemetryEvent[] = [
        createPrepareEvent(),
        createPrepareEvent(),
        createPrepareEvent(),
        createPrepareEvent(),
        createPrepareEvent(),
        createFulfillEvent(),
        createFulfillEvent(),
        createFulfillEvent(),
        createFulfillEvent(), // 80% success rate (4/5)
      ];

      const { container } = render(<Dashboard events={events} connectionStatus="connected" />);

      // Success Rate card should have warning border color
      const warningCard = container.querySelector('.border-yellow-500\\/30');
      expect(warningCard).toBeInTheDocument();
    });

    it('should show error variant when success rate < 70%', () => {
      const events: TelemetryEvent[] = [
        createPrepareEvent(),
        createPrepareEvent(),
        createFulfillEvent(), // 50% success rate (1/2)
      ];

      const { container } = render(<Dashboard events={events} connectionStatus="connected" />);

      // Success Rate card should have error border color
      const errorCard = container.querySelector('.border-rose-500\\/30');
      expect(errorCard).toBeInTheDocument();
    });
  });

  describe('Packet Distribution', () => {
    it('should display packet distribution with correct counts', () => {
      const events: TelemetryEvent[] = [
        createPrepareEvent({ timestamp: Date.now() - 1000 }),
        createPrepareEvent({ timestamp: Date.now() - 2000 }),
        createFulfillEvent({ timestamp: Date.now() - 3000 }),
        createRejectEvent({ timestamp: Date.now() - 4000 }),
      ];

      const { container } = render(<Dashboard events={events} connectionStatus="connected" />);

      // Check for PREPARE, FULFILL, REJECT labels
      expect(screen.getByText('PREPARE')).toBeInTheDocument();
      expect(screen.getByText('FULFILL')).toBeInTheDocument();
      expect(screen.getByText('REJECT')).toBeInTheDocument();

      // Check for counts using more specific queries
      const prepareSection = container.querySelector('.space-y-2:has(.bg-cyan-500)');
      expect(prepareSection?.textContent).toContain('2');

      const fulfillSection = container.querySelector('.space-y-2:has(.bg-emerald-500)');
      expect(fulfillSection?.textContent).toContain('1');

      const rejectSection = container.querySelector('.space-y-2:has(.bg-rose-500)');
      expect(rejectSection?.textContent).toContain('1');
    });
  });

  describe('Routing Status', () => {
    it('should show Active when connected', () => {
      render(<Dashboard events={[]} connectionStatus="connected" />);
      expect(screen.getByText('Active')).toBeInTheDocument();
      expect(screen.getByText('Accepting packets')).toBeInTheDocument();
    });

    it('should show Inactive when not connected', () => {
      render(<Dashboard events={[]} connectionStatus="disconnected" />);
      expect(screen.getByText('Inactive')).toBeInTheDocument();
      expect(screen.getByText('Waiting...')).toBeInTheDocument();
    });
  });

  describe('Animation Classes (Story 18.7)', () => {
    it('should apply hover-elevate class to metric cards', () => {
      const { container } = render(<Dashboard events={[]} connectionStatus="connected" />);

      // All metric cards should have hover-elevate class
      const hoverElevateCards = container.querySelectorAll('.hover-elevate');
      expect(hoverElevateCards.length).toBeGreaterThanOrEqual(4);
    });

    it('should apply fade-in-up class to metric cards', () => {
      const { container } = render(<Dashboard events={[]} connectionStatus="connected" />);

      // All metric cards should have fade-in-up class
      const fadeInUpCards = container.querySelectorAll('.fade-in-up');
      expect(fadeInUpCards.length).toBeGreaterThanOrEqual(4);
    });

    it('should apply stagger classes to metric cards', () => {
      const { container } = render(<Dashboard events={[]} connectionStatus="connected" />);

      // Check for stagger classes
      expect(container.querySelector('.stagger-1')).toBeInTheDocument();
      expect(container.querySelector('.stagger-2')).toBeInTheDocument();
      expect(container.querySelector('.stagger-3')).toBeInTheDocument();
      expect(container.querySelector('.stagger-4')).toBeInTheDocument();
    });

    it('should apply status-transition class to success rate card', () => {
      const { container } = render(<Dashboard events={[]} connectionStatus="connected" />);

      // Status-transition should be applied to cards with variant styling
      const statusTransitionCards = container.querySelectorAll('.status-transition');
      expect(statusTransitionCards.length).toBeGreaterThanOrEqual(1);
    });

    it('should apply progress-smooth class to packet distribution bars', () => {
      const events: TelemetryEvent[] = [createPrepareEvent(), createFulfillEvent()];

      const { container } = render(<Dashboard events={events} connectionStatus="connected" />);

      // Progress bars should have progress-smooth class
      const progressBars = container.querySelectorAll('.progress-smooth');
      expect(progressBars.length).toBe(3); // PREPARE, FULFILL, REJECT bars
    });

    it('should apply slide-in animation to packet flow items', () => {
      const events: TelemetryEvent[] = [createPrepareEvent({ from: 'g.alice', to: 'g.bob' })];

      const { container } = render(<Dashboard events={events} connectionStatus="connected" />);

      // Packet flow items should have animate-in and slide-in-from-left-2 classes
      const animatedItems = container.querySelectorAll('.animate-in.slide-in-from-left-2');
      expect(animatedItems.length).toBeGreaterThanOrEqual(1);
    });

    it('should apply animate-pulse to live indicator when connected', () => {
      const { container } = render(<Dashboard events={[]} connectionStatus="connected" />);

      // Live badge should have animate-pulse
      const pulsingElements = container.querySelectorAll('.animate-pulse');
      expect(pulsingElements.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Reduced Motion Preferences (Story 18.7)', () => {
    beforeEach(() => {
      // Mock window.matchMedia for prefers-reduced-motion
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: vi.fn().mockImplementation((query: string) => ({
          matches: query === '(prefers-reduced-motion: reduce)',
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      });
    });

    it('should render correctly when prefers-reduced-motion is set', () => {
      // Component should still render - CSS handles the animation disabling
      const { container } = render(<Dashboard events={[]} connectionStatus="connected" />);
      expect(container).toBeInTheDocument();

      // Animation classes should still be present (CSS media query handles disabling)
      const hoverElevateCards = container.querySelectorAll('.hover-elevate');
      expect(hoverElevateCards.length).toBeGreaterThanOrEqual(4);
    });
  });
});
