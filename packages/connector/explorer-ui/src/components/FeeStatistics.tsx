/**
 * FeeStatistics Component
 *
 * Displays total connector fees collected per network (EVM, XRP, Aptos).
 * Shows aggregated fee data with visual indicators for each supported blockchain.
 */

import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Coins, TrendingUp, Layers } from 'lucide-react';
import type { NetworkFeeStats } from '../hooks/useFeeStatistics';

/**
 * FeeStatistics component props
 */
export interface FeeStatisticsProps {
  /** Fee statistics per network */
  stats: NetworkFeeStats[];
  /** Grand total fees across all networks */
  grandTotal: string;
  /** Total packets that generated fees */
  totalPackets: number;
  /** Token symbol being displayed (e.g., "M2M", "USDC") */
  tokenSymbol?: string;
}

/**
 * Get network display name
 */
function getNetworkDisplayName(network: string): string {
  switch (network) {
    case 'evm':
      return 'EVM (Base)';
    case 'xrp':
      return 'XRP Ledger';
    case 'aptos':
      return 'Aptos';
    default:
      return 'Unknown';
  }
}

/**
 * Get network badge color class
 */
function getNetworkBadgeColor(network: string): string {
  switch (network) {
    case 'evm':
      return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    case 'xrp':
      return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
    case 'aptos':
      return 'bg-teal-500/20 text-teal-400 border-teal-500/30';
    default:
      return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  }
}

/**
 * Get network icon color
 */
function getNetworkIconColor(network: string): string {
  switch (network) {
    case 'evm':
      return 'text-blue-400';
    case 'xrp':
      return 'text-orange-400';
    case 'aptos':
      return 'text-teal-400';
    default:
      return 'text-gray-400';
  }
}

/**
 * Get progress bar color
 */
function getProgressBarColor(network: string): string {
  switch (network) {
    case 'evm':
      return 'bg-blue-500';
    case 'xrp':
      return 'bg-orange-500';
    case 'aptos':
      return 'bg-teal-500';
    default:
      return 'bg-gray-500';
  }
}

/**
 * Single network fee card
 */
const NetworkFeeCard: React.FC<{ stat: NetworkFeeStats; maxFees: bigint }> = ({
  stat,
  maxFees,
}) => {
  // Calculate percentage for progress bar
  const percentage = maxFees > 0n ? Number((stat.totalFees * 100n) / maxFees) : 0;

  return (
    <Card className="w-full border-border bg-card/50 backdrop-blur-sm hover:bg-card/70 transition-colors">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Coins className={`h-5 w-5 ${getNetworkIconColor(stat.network)}`} />
            {getNetworkDisplayName(stat.network)}
          </CardTitle>
          <Badge
            variant="outline"
            className={`text-xs border ${getNetworkBadgeColor(stat.network)}`}
          >
            {stat.network.toUpperCase()}
          </Badge>
        </div>
        <CardDescription>Fees collected from packet routing</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Total fees */}
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Fees</p>
          <p className="text-3xl font-bold font-mono tabular-nums">{stat.totalFeesFormatted}</p>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Packets</p>
            <p className="text-xl font-semibold">{stat.packetCount.toLocaleString()}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Avg Fee</p>
            <p className="text-xl font-semibold font-mono">{stat.averageFeeFormatted}</p>
          </div>
        </div>

        {/* Relative share progress bar */}
        <div className="pt-2 border-t border-border">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground">Share of Total</span>
            <span className="text-xs text-muted-foreground">{percentage.toFixed(1)}%</span>
          </div>
          <div className="w-full bg-muted rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${getProgressBarColor(stat.network)}`}
              style={{ width: `${percentage}%` }}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

/**
 * FeeStatistics component
 *
 * Displays connector fee collection statistics per blockchain network.
 *
 * @example
 * ```tsx
 * <FeeStatistics
 *   stats={[
 *     { network: 'evm', totalFees: 1000000n, totalFeesFormatted: '0.001 ETH', ... },
 *     { network: 'xrp', totalFees: 5000000n, totalFeesFormatted: '5 XRP', ... }
 *   ]}
 *   grandTotal="$15.50"
 *   totalPackets={1500}
 * />
 * ```
 */
export function FeeStatistics({
  stats,
  grandTotal,
  totalPackets,
  tokenSymbol = 'M2M',
}: FeeStatisticsProps): React.ReactElement {
  // Find max fees for percentage calculations
  const maxFees = stats.reduce((max, s) => (s.totalFees > max ? s.totalFees : max), 0n);

  return (
    <div className="w-full space-y-4">
      {/* Header with summary */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <TrendingUp className="h-5 w-5 text-emerald-500" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold">Fees Collected by Network</h3>
              <Badge
                variant="outline"
                className="text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
              >
                {tokenSymbol}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Revenue from packet routing across blockchains
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-xs text-muted-foreground uppercase">Total Fees</p>
            <p className="text-xl font-bold font-mono">{grandTotal}</p>
          </div>
          <div className="text-right border-l border-border pl-4">
            <p className="text-xs text-muted-foreground uppercase">Packets</p>
            <p className="text-xl font-bold">{totalPackets.toLocaleString()}</p>
          </div>
        </div>
      </div>

      {/* Network fee cards */}
      {stats.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {stats.map((stat) => (
            <NetworkFeeCard key={stat.network} stat={stat} maxFees={maxFees} />
          ))}
        </div>
      ) : (
        <Card className="border-border bg-card/50">
          <CardContent className="py-12">
            <div className="flex flex-col items-center justify-center text-center">
              <Layers className="h-12 w-12 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">No fee data available yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Fees will appear as packets are routed through the connector
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
