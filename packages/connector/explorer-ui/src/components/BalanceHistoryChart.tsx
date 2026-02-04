import { useMemo } from 'react';
import { BalanceHistoryEntry } from '@/lib/event-types';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

/**
 * BalanceHistoryChart props interface
 */
export interface BalanceHistoryChartProps {
  history: BalanceHistoryEntry[];
  /** Maximum bars to display */
  maxBars?: number;
}

/**
 * Format bigint balance for display with abbreviations
 */
function formatBalance(value: bigint): string {
  const absValue = value < 0n ? -value : value;
  const sign = value < 0n ? '-' : '';

  if (absValue >= 1_000_000_000n) {
    return `${sign}${(Number(absValue) / 1_000_000_000).toFixed(1)}B`;
  }
  if (absValue >= 1_000_000n) {
    return `${sign}${(Number(absValue) / 1_000_000).toFixed(1)}M`;
  }
  if (absValue >= 1_000n) {
    return `${sign}${(Number(absValue) / 1_000).toFixed(1)}K`;
  }
  return value.toString();
}

/**
 * Calculate trend from history
 */
function calculateTrend(history: BalanceHistoryEntry[]): 'up' | 'down' | 'stable' {
  if (history.length < 2) return 'stable';

  const recent = history.slice(-5);
  if (recent.length < 2) return 'stable';

  const first = recent[0].balance;
  const last = recent[recent.length - 1].balance;

  if (last > first) return 'up';
  if (last < first) return 'down';
  return 'stable';
}

/**
 * Bar data for chart rendering
 */
interface BarData {
  timestamp: number;
  balance: bigint;
  height: number;
  changeType: 'up' | 'down' | 'neutral';
  isPositive: boolean;
}

/**
 * BalanceHistoryChart component - mini sparkline showing balance changes over time
 * Story 14.6: Settlement and Balance Visualization
 * Story 18.4: NOC aesthetic with gradient fills and hover tooltips
 *
 * Uses CSS-based bars with gradient fills (emerald for positive, rose for negative).
 * Shows last N balance changes with hover tooltips displaying exact balance and timestamp.
 */
export function BalanceHistoryChart({ history, maxBars = 20 }: BalanceHistoryChartProps) {
  // Calculate bar data
  const { bars, trend, hasZeroCrossing, zeroLinePosition } = useMemo(() => {
    if (history.length === 0) {
      return { bars: [], trend: 'stable' as const, hasZeroCrossing: false, zeroLinePosition: 0 };
    }

    // Take last N entries
    const recentHistory = history.slice(-maxBars);

    // Find min and max for normalization
    let minBalance = recentHistory[0].balance;
    let maxBalance = recentHistory[0].balance;

    for (const entry of recentHistory) {
      if (entry.balance < minBalance) minBalance = entry.balance;
      if (entry.balance > maxBalance) maxBalance = entry.balance;
    }

    // Check if there's a zero crossing (both positive and negative values)
    const hasZeroCrossing = minBalance < 0n && maxBalance > 0n;

    // Calculate zero line position if there's a crossing
    let zeroLinePosition = 0;
    if (hasZeroCrossing) {
      const range = maxBalance - minBalance;
      // Zero line position from bottom (as percentage)
      zeroLinePosition = Number(((0n - minBalance) * 100n) / range);
    }

    // Calculate range (avoid division by zero)
    const range = maxBalance - minBalance;
    const hasRange = range !== 0n;

    // Build bars with normalized heights, change direction, and balance values
    const bars: BarData[] = recentHistory.map((entry, index) => {
      // Normalize height (0-100%)
      const normalizedHeight = hasRange
        ? Number(((entry.balance - minBalance) * 100n) / range)
        : 50;

      // Determine color based on change from previous
      let changeType: 'up' | 'down' | 'neutral' = 'neutral';
      if (index > 0) {
        const prev = recentHistory[index - 1].balance;
        if (entry.balance > prev) changeType = 'up';
        else if (entry.balance < prev) changeType = 'down';
      }

      // Determine if balance is positive or negative for gradient color
      const isPositive = entry.balance >= 0n;

      return {
        timestamp: entry.timestamp,
        balance: entry.balance,
        height: Math.max(5, Math.min(100, normalizedHeight)), // Min 5% height for visibility
        changeType,
        isPositive,
      };
    });

    const trend = calculateTrend(recentHistory);

    return { bars, trend, hasZeroCrossing, zeroLinePosition };
  }, [history, maxBars]);

  if (bars.length === 0) {
    return null;
  }

  // Trend icon and styling (NOC aesthetic: emerald/rose)
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
  const trendColor =
    trend === 'up'
      ? 'text-emerald-500'
      : trend === 'down'
        ? 'text-rose-500'
        : 'text-muted-foreground';
  const trendLabel = trend === 'up' ? 'Increasing' : trend === 'down' ? 'Decreasing' : 'Stable';

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Balance History</span>
        <span className={`flex items-center gap-1 ${trendColor}`}>
          <TrendIcon className="h-3 w-3" />
          {trendLabel}
        </span>
      </div>

      {/* Sparkline bars with hover tooltips */}
      <div
        className="relative flex items-end gap-px h-12 bg-muted/10 rounded px-1 py-1"
        role="img"
        aria-label={`Balance history chart showing ${bars.length} data points`}
      >
        {/* Zero baseline marker */}
        {hasZeroCrossing && (
          <div
            className="absolute left-0 right-0 h-px bg-muted-foreground/30"
            style={{ bottom: `${zeroLinePosition}%` }}
            aria-hidden="true"
          />
        )}

        {bars.map((bar, index) => (
          <Tooltip key={index}>
            <TooltipTrigger asChild>
              <div
                className={`flex-1 min-w-[2px] max-w-[6px] rounded-t transition-all cursor-pointer ${
                  bar.isPositive
                    ? 'bg-gradient-to-t from-emerald-500/50 to-emerald-500'
                    : 'bg-gradient-to-t from-rose-500/50 to-rose-500'
                }`}
                style={{ height: `${bar.height}%` }}
                aria-label={`Balance: ${formatBalance(bar.balance)} at ${new Date(bar.timestamp).toLocaleString()}`}
              />
            </TooltipTrigger>
            <TooltipContent>
              <div className="text-xs font-mono">
                <div className={bar.isPositive ? 'text-emerald-400' : 'text-rose-400'}>
                  {formatBalance(bar.balance)}
                </div>
                <div className="text-muted-foreground">
                  {new Date(bar.timestamp).toLocaleString()}
                </div>
              </div>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>

      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{bars.length} changes</span>
      </div>
    </div>
  );
}
