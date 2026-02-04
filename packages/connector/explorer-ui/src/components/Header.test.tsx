import { render, screen, waitFor, act } from '@testing-library/react';
import { vi } from 'vitest';
import { Header } from './Header';
import { HealthResponse } from '../lib/event-types';

describe('Header', () => {
  let mockOnHelpOpen: ReturnType<typeof vi.fn>;

  const mockHealthResponse = (overrides?: Partial<HealthResponse>): HealthResponse => ({
    nodeId: 'peer1',
    uptime: 13320, // 3h 42m
    status: 'ready',
    timestamp: Date.now(),
    ...overrides,
  });

  beforeEach(() => {
    mockOnHelpOpen = vi.fn();

    // Mock fetch API
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => mockHealthResponse(),
      } as Response)
    );

    // Use real timers for async tests
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Branding', () => {
    it('should render ILP CONNECTOR branding with lightning bolt icon', () => {
      render(<Header status="connected" eventCount={0} onHelpOpen={mockOnHelpOpen} />);

      expect(screen.getByText('ILP CONNECTOR')).toBeInTheDocument();

      // Verify lightning bolt icon present (Zap from lucide-react)
      const zapIcon = document.querySelector('.lucide-zap');
      expect(zapIcon).toBeInTheDocument();
    });

    it('should render "Network Operations" subtitle', () => {
      render(<Header status="connected" eventCount={0} onHelpOpen={mockOnHelpOpen} />);

      expect(screen.getByText('Network Operations')).toBeInTheDocument();
    });
  });

  describe('Node Identity', () => {
    it('should fetch and display node ID from health API', async () => {
      render(<Header status="connected" eventCount={0} />);

      await waitFor(() => {
        expect(screen.getByText('peer1')).toBeInTheDocument();
      });

      expect(global.fetch).toHaveBeenCalledWith('/api/health');
    });

    it('should fetch and display uptime from health API', async () => {
      render(<Header status="connected" eventCount={0} />);

      await waitFor(() => {
        expect(screen.getByText('3h 42m')).toBeInTheDocument();
      });
    });

    it('should format uptime correctly (hours and minutes)', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => mockHealthResponse({ uptime: 7260 }), // 2h 1m
        } as Response)
      );

      render(<Header status="connected" eventCount={0} />);

      await waitFor(() => {
        expect(screen.getByText('2h 1m')).toBeInTheDocument();
      });
    });

    it('should handle health API fetch errors gracefully without console output', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      global.fetch = vi.fn(() => Promise.reject(new Error('Network error')));

      render(<Header status="connected" eventCount={0} />);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });

      // Verify no console.error called (silent error handling)
      expect(consoleErrorSpy).not.toHaveBeenCalled();

      // Verify health state remains null (no node ID shown)
      expect(screen.queryByText('Node ID')).not.toBeInTheDocument();

      consoleErrorSpy.mockRestore();
    });

    it('should refetch health data every 30 seconds', async () => {
      vi.useFakeTimers();

      render(<Header status="connected" eventCount={0} />);

      // Wait for initial fetch
      await act(async () => {
        await Promise.resolve();
      });

      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Advance timers by 30 seconds
      await act(async () => {
        vi.advanceTimersByTime(30000);
        await Promise.resolve();
      });

      expect(global.fetch).toHaveBeenCalledTimes(2);

      // Advance timers by another 30 seconds
      await act(async () => {
        vi.advanceTimersByTime(30000);
        await Promise.resolve();
      });

      expect(global.fetch).toHaveBeenCalledTimes(3);

      vi.useRealTimers();
    });
  });

  describe('Real-Time Clock', () => {
    it('should update clock every second', () => {
      vi.useFakeTimers();
      const fixedDate = new Date('2024-01-01T15:30:00');
      vi.setSystemTime(fixedDate);

      render(<Header status="connected" eventCount={0} />);

      // Initial time
      expect(screen.getByText(/3:30:00 PM/)).toBeInTheDocument();

      // Advance by 1 second
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(screen.getByText(/3:30:01 PM/)).toBeInTheDocument();

      // Advance by 5 more seconds
      act(() => {
        vi.advanceTimersByTime(5000);
      });

      expect(screen.getByText(/3:30:06 PM/)).toBeInTheDocument();

      vi.useRealTimers();
    });

    it('should format time in HH:MM:SS AM/PM format', () => {
      const morningTime = new Date('2024-01-01T08:45:23');
      vi.setSystemTime(morningTime);

      render(<Header status="connected" eventCount={0} />);

      expect(screen.getByText(/8:45:23 AM/)).toBeInTheDocument();

      vi.setSystemTime(new Date());
    });
  });

  describe('Event Count Badge', () => {
    it('should display event count badge', () => {
      render(<Header status="connected" eventCount={42} />);

      expect(screen.getByText('Events')).toBeInTheDocument();
      expect(screen.getByText('42')).toBeInTheDocument();
    });

    it('should format event count with thousands separator', () => {
      render(<Header status="connected" eventCount={1234} />);

      expect(screen.getByText('1,234')).toBeInTheDocument();
    });
  });

  describe('Connection Status', () => {
    it('should display connection status indicator', () => {
      render(<Header status="connected" eventCount={0} />);

      expect(screen.getByText('connected')).toBeInTheDocument();
    });

    it.each([
      ['connected', 'text-emerald-500', 'bg-emerald-500'],
      ['connecting', 'text-yellow-500', 'bg-yellow-500'],
      ['disconnected', 'text-gray-500', 'bg-gray-500'],
      ['error', 'text-rose-500', 'bg-rose-500'],
    ] as const)('should apply correct color for %s status', (status, textColor, dotColor) => {
      render(<Header status={status} eventCount={0} />);

      const statusText = screen.getByText(status);
      expect(statusText).toHaveClass(textColor);

      // Verify status dot color
      const statusDot = statusText.previousSibling;
      expect(statusDot).toHaveClass(dotColor);
    });

    it('should apply pulse animation when status is connected', () => {
      const { container } = render(<Header status="connected" eventCount={0} />);

      // Check pulse animation on lightning bolt indicator
      const lightningIndicator = container.querySelector('.lucide-circle');
      expect(lightningIndicator).toHaveClass('animate-pulse');

      // Check pulse animation on status dot
      const statusDot = screen.getByText('connected').previousSibling;
      expect(statusDot).toHaveClass('animate-pulse');
    });

    it('should not apply pulse animation when status is not connected', () => {
      const { container } = render(<Header status="disconnected" eventCount={0} />);

      // Lightning indicator should not exist when not connected
      const lightningIndicator = container.querySelector('.lucide-circle');
      expect(lightningIndicator).not.toBeInTheDocument();

      // Status dot should not have pulse animation
      const statusDot = screen.getByText('disconnected').previousSibling;
      expect(statusDot).not.toHaveClass('animate-pulse');
    });
  });

  describe('Keyboard Shortcuts Button', () => {
    it('should render keyboard shortcuts button when onHelpOpen provided', () => {
      render(<Header status="connected" eventCount={0} onHelpOpen={mockOnHelpOpen} />);

      const helpButton = screen.getByRole('button', { name: /keyboard shortcuts/i });
      expect(helpButton).toBeInTheDocument();
    });

    it('should not render keyboard shortcuts button when onHelpOpen not provided', () => {
      render(<Header status="connected" eventCount={0} />);

      const helpButton = screen.queryByRole('button', { name: /keyboard shortcuts/i });
      expect(helpButton).not.toBeInTheDocument();
    });

    it('should call onHelpOpen when button clicked', () => {
      render(<Header status="connected" eventCount={0} onHelpOpen={mockOnHelpOpen} />);

      const helpButton = screen.getByRole('button', { name: /keyboard shortcuts/i });
      helpButton.click();

      expect(mockOnHelpOpen).toHaveBeenCalledTimes(1);
    });
  });

  describe('Cleanup', () => {
    it('should cleanup timers on unmount', () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

      const { unmount } = render(<Header status="connected" eventCount={0} />);

      unmount();

      // Should clear both intervals (health fetch + clock update)
      expect(clearIntervalSpy).toHaveBeenCalledTimes(2);

      clearIntervalSpy.mockRestore();
    });
  });

  describe('Responsive Layout', () => {
    it('should render responsive layout with conditional visibility classes', async () => {
      render(<Header status="connected" eventCount={0} />);

      // Wait for health data to load
      await waitFor(() => {
        expect(screen.getByText('Node ID')).toBeInTheDocument();
      });

      // Node identity should be hidden on small screens (lg:flex)
      const nodeIdSection = screen.getByText('Node ID').parentElement?.parentElement;
      expect(nodeIdSection).toHaveClass('hidden');
      expect(nodeIdSection).toHaveClass('lg:flex');

      // Status indicator should be hidden on extra small screens (sm:flex)
      const statusSection = screen.getByText('connected').parentElement;
      expect(statusSection).toHaveClass('hidden');
      expect(statusSection).toHaveClass('sm:flex');

      // Clock should be hidden on small/medium screens (md:block)
      const clockSection = screen.getByText('System Time').parentElement;
      expect(clockSection).toHaveClass('hidden');
      expect(clockSection).toHaveClass('md:block');
    });
  });
});
