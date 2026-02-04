import * as React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BalanceHistoryChart } from './BalanceHistoryChart';
import { BalanceHistoryEntry } from '@/lib/event-types';

describe('BalanceHistoryChart - Story 18.4', () => {
  const createMockHistory = (
    count: number,
    options: { startPositive?: boolean; mixedSign?: boolean } = {}
  ): BalanceHistoryEntry[] => {
    const history: BalanceHistoryEntry[] = [];
    let balance = options.startPositive !== false ? 1000000n : -1000000n;

    for (let i = 0; i < count; i++) {
      if (options.mixedSign) {
        // Create mixed positive/negative values for zero crossing test
        balance = i % 2 === 0 ? 500000n * BigInt(i + 1) : -300000n * BigInt(i + 1);
      } else {
        // Vary balance up and down
        balance += BigInt(Math.floor(Math.random() * 200000) - 100000);
      }
      history.push({
        timestamp: Date.now() - (count - i) * 60000,
        balance,
      });
    }
    return history;
  };

  describe('empty state', () => {
    it('should return null when history is empty', () => {
      const { container } = render(<BalanceHistoryChart history={[]} />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe('bar rendering', () => {
    it('should render bars for each history entry', () => {
      const history = createMockHistory(5);
      render(<BalanceHistoryChart history={history} />);

      // Check that "5 changes" is displayed
      expect(screen.getByText('5 changes')).toBeInTheDocument();
    });

    it('should limit bars to maxBars prop', () => {
      const history = createMockHistory(30);
      render(<BalanceHistoryChart history={history} maxBars={10} />);

      expect(screen.getByText('10 changes')).toBeInTheDocument();
    });

    it('should render chart container with correct aria attributes', () => {
      const history = createMockHistory(5);
      render(<BalanceHistoryChart history={history} />);

      const chartContainer = screen.getByRole('img');
      expect(chartContainer).toHaveAttribute(
        'aria-label',
        'Balance history chart showing 5 data points'
      );
    });
  });

  describe('gradient fills (NOC aesthetic)', () => {
    it('should use emerald gradient for positive balances', () => {
      const history: BalanceHistoryEntry[] = [
        { timestamp: Date.now() - 60000, balance: 1000n },
        { timestamp: Date.now(), balance: 2000n },
      ];
      const { container } = render(<BalanceHistoryChart history={history} />);

      // Check for emerald gradient class
      const bars = container.querySelectorAll('[class*="emerald"]');
      expect(bars.length).toBeGreaterThan(0);
    });

    it('should use rose gradient for negative balances', () => {
      const history: BalanceHistoryEntry[] = [
        { timestamp: Date.now() - 60000, balance: -1000n },
        { timestamp: Date.now(), balance: -2000n },
      ];
      const { container } = render(<BalanceHistoryChart history={history} />);

      // Check for rose gradient class
      const bars = container.querySelectorAll('[class*="rose"]');
      expect(bars.length).toBeGreaterThan(0);
    });
  });

  describe('zero baseline marker', () => {
    it('should display zero baseline when values cross zero', () => {
      // History with both positive and negative values
      const history: BalanceHistoryEntry[] = [
        { timestamp: Date.now() - 120000, balance: -1000n },
        { timestamp: Date.now() - 60000, balance: 500n },
        { timestamp: Date.now(), balance: 1000n },
      ];
      const { container } = render(<BalanceHistoryChart history={history} />);

      // Check for zero baseline element (absolute positioned h-px)
      const baseline = container.querySelector('.absolute.h-px');
      expect(baseline).toBeInTheDocument();
    });

    it('should not display zero baseline when all values are positive', () => {
      const history: BalanceHistoryEntry[] = [
        { timestamp: Date.now() - 60000, balance: 1000n },
        { timestamp: Date.now(), balance: 2000n },
      ];
      const { container } = render(<BalanceHistoryChart history={history} />);

      // Should not have zero baseline
      const baseline = container.querySelector('.absolute.h-px');
      expect(baseline).not.toBeInTheDocument();
    });
  });

  describe('trend indicator', () => {
    it('should show "Increasing" trend when balance is rising', () => {
      const history: BalanceHistoryEntry[] = [
        { timestamp: Date.now() - 120000, balance: 100n },
        { timestamp: Date.now() - 60000, balance: 200n },
        { timestamp: Date.now(), balance: 300n },
      ];
      render(<BalanceHistoryChart history={history} />);

      expect(screen.getByText('Increasing')).toBeInTheDocument();
    });

    it('should show "Decreasing" trend when balance is falling', () => {
      const history: BalanceHistoryEntry[] = [
        { timestamp: Date.now() - 120000, balance: 300n },
        { timestamp: Date.now() - 60000, balance: 200n },
        { timestamp: Date.now(), balance: 100n },
      ];
      render(<BalanceHistoryChart history={history} />);

      expect(screen.getByText('Decreasing')).toBeInTheDocument();
    });

    it('should show "Stable" trend when balance is unchanged', () => {
      const history: BalanceHistoryEntry[] = [
        { timestamp: Date.now() - 60000, balance: 100n },
        { timestamp: Date.now(), balance: 100n },
      ];
      render(<BalanceHistoryChart history={history} />);

      expect(screen.getByText('Stable')).toBeInTheDocument();
    });

    it('should use emerald color for increasing trend', () => {
      const history: BalanceHistoryEntry[] = [
        { timestamp: Date.now() - 120000, balance: 100n },
        { timestamp: Date.now() - 60000, balance: 200n },
        { timestamp: Date.now(), balance: 300n },
      ];
      const { container } = render(<BalanceHistoryChart history={history} />);

      // The trend indicator is in a span with the color class
      const trendContainer = container.querySelector('.text-emerald-500');
      expect(trendContainer).toBeInTheDocument();
      expect(trendContainer?.textContent).toContain('Increasing');
    });

    it('should use rose color for decreasing trend', () => {
      const history: BalanceHistoryEntry[] = [
        { timestamp: Date.now() - 120000, balance: 300n },
        { timestamp: Date.now() - 60000, balance: 200n },
        { timestamp: Date.now(), balance: 100n },
      ];
      const { container } = render(<BalanceHistoryChart history={history} />);

      // The trend indicator is in a span with the color class
      const trendContainer = container.querySelector('.text-rose-500');
      expect(trendContainer).toBeInTheDocument();
      expect(trendContainer?.textContent).toContain('Decreasing');
    });
  });

  describe('tooltip behavior', () => {
    it('should render TooltipTrigger elements for each bar', () => {
      const history = createMockHistory(5);
      const { container } = render(<BalanceHistoryChart history={history} />);

      // Each bar should have cursor-pointer for tooltip interaction
      const tooltipTriggers = container.querySelectorAll('.cursor-pointer');
      expect(tooltipTriggers.length).toBe(5);
    });

    it('should include aria-label with balance and timestamp on bars', () => {
      const history: BalanceHistoryEntry[] = [{ timestamp: Date.now() - 60000, balance: 1500n }];
      const { container } = render(<BalanceHistoryChart history={history} />);

      // Check for aria-label containing balance info
      const bar = container.querySelector('[aria-label*="1.5K"]');
      expect(bar).toBeInTheDocument();
    });
  });

  describe('balance formatting', () => {
    it('should format large balances with K abbreviation', () => {
      const history: BalanceHistoryEntry[] = [{ timestamp: Date.now(), balance: 1500n }];
      const { container } = render(<BalanceHistoryChart history={history} />);

      const bar = container.querySelector('[aria-label*="1.5K"]');
      expect(bar).toBeInTheDocument();
    });

    it('should format million balances with M abbreviation', () => {
      const history: BalanceHistoryEntry[] = [{ timestamp: Date.now(), balance: 2500000n }];
      const { container } = render(<BalanceHistoryChart history={history} />);

      const bar = container.querySelector('[aria-label*="2.5M"]');
      expect(bar).toBeInTheDocument();
    });

    it('should format billion balances with B abbreviation', () => {
      const history: BalanceHistoryEntry[] = [{ timestamp: Date.now(), balance: 1500000000n }];
      const { container } = render(<BalanceHistoryChart history={history} />);

      const bar = container.querySelector('[aria-label*="1.5B"]');
      expect(bar).toBeInTheDocument();
    });

    it('should format negative balances correctly', () => {
      const history: BalanceHistoryEntry[] = [{ timestamp: Date.now(), balance: -2500000n }];
      const { container } = render(<BalanceHistoryChart history={history} />);

      const bar = container.querySelector('[aria-label*="-2.5M"]');
      expect(bar).toBeInTheDocument();
    });
  });

  describe('height normalization', () => {
    it('should normalize bar heights between min and max', () => {
      const history: BalanceHistoryEntry[] = [
        { timestamp: Date.now() - 120000, balance: 0n },
        { timestamp: Date.now() - 60000, balance: 50n },
        { timestamp: Date.now(), balance: 100n },
      ];
      const { container } = render(<BalanceHistoryChart history={history} />);

      // Bars should be rendered with different heights
      const bars = container.querySelectorAll('.cursor-pointer');
      expect(bars.length).toBe(3);

      // Each bar should have a style attribute with height
      bars.forEach((bar) => {
        expect(bar).toHaveAttribute('style');
        const style = bar.getAttribute('style');
        expect(style).toContain('height:');
      });
    });

    it('should handle single value history (no range)', () => {
      const history: BalanceHistoryEntry[] = [{ timestamp: Date.now(), balance: 100n }];
      render(<BalanceHistoryChart history={history} />);

      // Should render without errors
      expect(screen.getByText('1 changes')).toBeInTheDocument();
    });

    it('should handle all same values (zero range)', () => {
      const history: BalanceHistoryEntry[] = [
        { timestamp: Date.now() - 60000, balance: 100n },
        { timestamp: Date.now(), balance: 100n },
      ];
      render(<BalanceHistoryChart history={history} />);

      // Should render without errors
      expect(screen.getByText('2 changes')).toBeInTheDocument();
    });
  });
});
