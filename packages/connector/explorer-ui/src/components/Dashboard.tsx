import { useEffect, useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Activity,
  ArrowUpRight,
  ArrowDownLeft,
  Zap,
  TrendingUp,
  Wallet,
  Network,
  Circle,
} from 'lucide-react';
import { TelemetryEvent, getIlpPacketType } from '../lib/event-types';
import { cn } from '@/lib/utils';
import { usePeers } from '../hooks/usePeers';
import { useFeeStatistics } from '../hooks/useFeeStatistics';
import { FeeStatistics } from './FeeStatistics';

interface DashboardProps {
  events: TelemetryEvent[];
  connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'error';
}

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  trend?: {
    value: number;
    label: string;
  };
  pulse?: boolean;
  variant?: 'default' | 'success' | 'warning' | 'error';
  staggerClass?: string;
}

interface PacketFlowItem {
  id: string;
  type: 'prepare' | 'fulfill' | 'reject';
  from: string;
  to: string;
  destination?: string;
  amount?: string;
  timestamp: number;
}

function MetricCard({
  title,
  value,
  subtitle,
  icon,
  trend,
  pulse,
  variant = 'default',
  staggerClass,
}: MetricCardProps) {
  const variantStyles = {
    default: 'border-border bg-card status-transition',
    success: 'border-emerald-500/30 bg-emerald-950/20 status-transition',
    warning: 'border-yellow-500/30 bg-yellow-950/20 status-transition',
    error: 'border-rose-500/30 bg-rose-950/20 status-transition',
  };

  return (
    <Card
      className={cn(
        'relative overflow-hidden hover-elevate fade-in-up',
        variantStyles[variant],
        staggerClass
      )}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-white/5 pointer-events-none" />
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          {title}
        </CardTitle>
        <div className={cn('relative', pulse && 'animate-pulse')}>{icon}</div>
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          <div className="text-3xl font-bold font-mono tabular-nums tracking-tight">{value}</div>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          {trend && (
            <div
              className={cn(
                'flex items-center gap-1 text-xs font-medium',
                trend.value >= 0 ? 'text-emerald-500' : 'text-rose-500'
              )}
            >
              {trend.value >= 0 ? (
                <TrendingUp className="h-3 w-3" />
              ) : (
                <TrendingUp className="h-3 w-3 rotate-180" />
              )}
              <span>{Math.abs(trend.value)}%</span>
              <span className="text-muted-foreground">{trend.label}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function PacketFlowVisualization({ events }: { events: PacketFlowItem[] }) {
  const recentEvents = events.slice(0, 10);

  const getPacketColor = (type: 'prepare' | 'fulfill' | 'reject') => {
    switch (type) {
      case 'prepare':
        return 'bg-cyan-500/20 border-cyan-500/50 text-cyan-400';
      case 'fulfill':
        return 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400';
      case 'reject':
        return 'bg-rose-500/20 border-rose-500/50 text-rose-400';
    }
  };

  const getPacketDot = (type: 'prepare' | 'fulfill' | 'reject') => {
    switch (type) {
      case 'prepare':
        return 'bg-cyan-500';
      case 'fulfill':
        return 'bg-emerald-500';
      case 'reject':
        return 'bg-rose-500';
    }
  };

  return (
    <Card className="border-border bg-card/50 backdrop-blur-sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg font-semibold">Live Packet Flow</CardTitle>
            <CardDescription>Real-time ILP packet routing activity</CardDescription>
          </div>
          <Badge variant="outline" className="border-emerald-500/30 text-emerald-400">
            <Circle className="h-2 w-2 mr-1.5 fill-emerald-500 animate-pulse" />
            Live
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {recentEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Activity className="h-12 w-12 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">Waiting for packet activity...</p>
            </div>
          ) : (
            recentEvents.map((event, index) => (
              <div
                key={event.id}
                className="group relative flex items-center gap-3 p-3 rounded-lg border border-border bg-card/50 hover:bg-card transition-all animate-in fade-in slide-in-from-left-2"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <div className={cn('h-2 w-2 rounded-full shrink-0', getPacketDot(event.type))} />

                <div className="flex-1 min-w-0 grid grid-cols-[auto_1fr_auto_1fr] gap-x-3 gap-y-1 items-center text-sm">
                  <Badge className={cn('text-xs uppercase font-mono', getPacketColor(event.type))}>
                    {event.type}
                  </Badge>

                  <div className="flex items-center gap-2 min-w-0">
                    <ArrowUpRight className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="font-mono text-xs truncate">{event.from}</span>
                  </div>

                  <ArrowDownLeft className="h-3 w-3 text-muted-foreground shrink-0" />

                  <span className="font-mono text-xs truncate">{event.to}</span>
                </div>

                {event.amount && (
                  <div className="text-xs font-mono text-muted-foreground shrink-0">
                    {formatAmount(event.amount)}
                  </div>
                )}

                <div className="text-xs text-muted-foreground/60 shrink-0">
                  {formatTime(event.timestamp)}
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function formatAmount(amount: string): string {
  try {
    const num = BigInt(amount);
    if (num > BigInt(1e18)) {
      return `${(Number(num) / 1e18).toFixed(4)} ETH`;
    }
    if (num > BigInt(1e12)) {
      return `${(Number(num) / 1e12).toFixed(2)}T`;
    }
    if (num > BigInt(1e9)) {
      return `${(Number(num) / 1e9).toFixed(2)}B`;
    }
    if (num > BigInt(1e6)) {
      return `${(Number(num) / 1e6).toFixed(2)}M`;
    }
    return amount;
  } catch {
    return amount;
  }
}

function formatTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 1000) return 'now';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  return new Date(timestamp).toLocaleTimeString();
}

export function Dashboard({ events, connectionStatus }: DashboardProps) {
  const [metrics, setMetrics] = useState({
    totalPackets: 0,
    prepareCount: 0,
    fulfillCount: 0,
    rejectCount: 0,
    successRate: 0,
    avgResponseTime: 0,
    activeChannels: 0,
    totalVolume: BigInt(0),
  });

  // Fetch peer information for network detection
  const { peers } = usePeers();

  // Calculate fee statistics per network
  const feeStats = useFeeStatistics(events, peers);

  const packetFlow = useMemo(() => {
    const flow: PacketFlowItem[] = [];
    let counter = 0;

    for (const event of events) {
      const packetType = getIlpPacketType(event);
      if (packetType) {
        const from = 'from' in event && typeof event.from === 'string' ? event.from : 'unknown';
        const to = 'to' in event && typeof event.to === 'string' ? event.to : 'unknown';
        const destination =
          'destination' in event && typeof event.destination === 'string'
            ? event.destination
            : undefined;
        const amount =
          'amount' in event && typeof event.amount === 'string' ? event.amount : undefined;
        const timestamp =
          typeof event.timestamp === 'number'
            ? event.timestamp
            : new Date(event.timestamp).getTime();

        flow.push({
          id: `${timestamp}-${from}-${to}-${counter++}`,
          type: packetType,
          from,
          to,
          destination,
          amount,
          timestamp,
        });
      }
    }

    return flow.sort((a, b) => b.timestamp - a.timestamp);
  }, [events]);

  useEffect(() => {
    let prepareCount = 0;
    let fulfillCount = 0;
    let rejectCount = 0;
    let totalVolume = BigInt(0);

    for (const event of events) {
      const packetType = getIlpPacketType(event);
      if (packetType === 'prepare') prepareCount++;
      else if (packetType === 'fulfill') fulfillCount++;
      else if (packetType === 'reject') rejectCount++;

      if ('amount' in event && typeof event.amount === 'string') {
        try {
          totalVolume += BigInt(event.amount);
        } catch {
          // Ignore invalid amounts
        }
      }
    }

    const totalPackets = prepareCount + fulfillCount + rejectCount;
    const successRate = prepareCount > 0 ? (fulfillCount / prepareCount) * 100 : 0;

    setMetrics({
      totalPackets,
      prepareCount,
      fulfillCount,
      rejectCount,
      successRate,
      avgResponseTime: 0, // TODO: Calculate from event timestamps
      activeChannels: 0, // TODO: Fetch from API
      totalVolume,
    });
  }, [events]);

  return (
    <div className="space-y-6">
      {/* Hero Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Total Packets"
          value={metrics.totalPackets.toLocaleString()}
          subtitle="All-time routed"
          icon={<Activity className="h-4 w-4 text-muted-foreground" />}
          pulse={connectionStatus === 'connected'}
          staggerClass="stagger-1"
        />

        <MetricCard
          title="Success Rate"
          value={`${metrics.successRate.toFixed(1)}%`}
          subtitle={`${metrics.fulfillCount} fulfilled / ${metrics.rejectCount} rejected`}
          icon={<Zap className="h-4 w-4 text-emerald-500" />}
          variant={
            metrics.successRate > 90 ? 'success' : metrics.successRate > 70 ? 'warning' : 'error'
          }
          staggerClass="stagger-2"
        />

        <MetricCard
          title="Active Channels"
          value={metrics.activeChannels}
          subtitle="Payment channels open"
          icon={<Wallet className="h-4 w-4 text-cyan-500" />}
          staggerClass="stagger-3"
        />

        <MetricCard
          title="Routing Status"
          value={connectionStatus === 'connected' ? 'Active' : 'Inactive'}
          subtitle={connectionStatus === 'connected' ? 'Accepting packets' : 'Waiting...'}
          icon={<Network className="h-4 w-4 text-muted-foreground" />}
          variant={connectionStatus === 'connected' ? 'success' : 'warning'}
          pulse={connectionStatus === 'connected'}
          staggerClass="stagger-4"
        />
      </div>

      {/* Packet Type Distribution */}
      <Card className="border-border bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Packet Distribution</CardTitle>
          <CardDescription>ILP packet types by volume</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-cyan-500" />
                  <span className="text-sm font-medium">PREPARE</span>
                </div>
                <span className="text-lg font-mono font-bold">{metrics.prepareCount}</span>
              </div>
              <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-cyan-500 progress-smooth"
                  style={{
                    width: `${metrics.totalPackets > 0 ? (metrics.prepareCount / metrics.totalPackets) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-emerald-500" />
                  <span className="text-sm font-medium">FULFILL</span>
                </div>
                <span className="text-lg font-mono font-bold">{metrics.fulfillCount}</span>
              </div>
              <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 progress-smooth"
                  style={{
                    width: `${metrics.totalPackets > 0 ? (metrics.fulfillCount / metrics.totalPackets) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-rose-500" />
                  <span className="text-sm font-medium">REJECT</span>
                </div>
                <span className="text-lg font-mono font-bold">{metrics.rejectCount}</span>
              </div>
              <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-rose-500 progress-smooth"
                  style={{
                    width: `${metrics.totalPackets > 0 ? (metrics.rejectCount / metrics.totalPackets) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Fee Statistics by Network */}
      <FeeStatistics
        stats={feeStats.stats}
        grandTotal={feeStats.grandTotalFormatted}
        totalPackets={feeStats.totalPackets}
        tokenSymbol={feeStats.tokenConfig.symbol}
      />

      {/* Live Packet Flow */}
      <PacketFlowVisualization events={packetFlow} />
    </div>
  );
}
