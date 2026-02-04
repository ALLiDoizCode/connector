import { useEffect, useState, memo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Keyboard, Circle, Zap } from 'lucide-react';
import { HealthResponse } from '../lib/event-types';
import { cn } from '@/lib/utils';

interface HeaderProps {
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  eventCount: number;
  onHelpOpen?: () => void;
}

export const Header = memo(function Header({ status, eventCount, onHelpOpen }: HeaderProps) {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const response = await fetch('/api/health');
        if (response.ok) {
          const data = await response.json();
          setHealth(data);
        }
      } catch {
        // Silently fail - health state remains null, UI will show N/A
      }
    };

    fetchHealth();
    const interval = setInterval(fetchHealth, 30000); // Refresh every 30s

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const getStatusColor = () => {
    switch (status) {
      case 'connected':
        return 'text-emerald-500';
      case 'connecting':
        return 'text-yellow-500';
      case 'disconnected':
        return 'text-gray-500';
      case 'error':
        return 'text-rose-500';
      default:
        return 'text-gray-500';
    }
  };

  const getStatusDotColor = () => {
    switch (status) {
      case 'connected':
        return 'bg-emerald-500';
      case 'connecting':
        return 'bg-yellow-500';
      case 'disconnected':
        return 'bg-gray-500';
      case 'error':
        return 'bg-rose-500';
      default:
        return 'bg-gray-500';
    }
  };

  const formatUptime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  return (
    <header className="relative border-b border-border/50 bg-gradient-to-r from-background via-card/30 to-background px-4 md:px-6 py-3 md:py-4 backdrop-blur-sm">
      {/* Subtle scan line effect */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-white/[0.02] to-transparent pointer-events-none" />

      <div className="relative flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 md:gap-6 min-w-0">
          <div className="flex items-center gap-3">
            <div className="relative">
              <Zap className="h-6 w-6 md:h-7 md:w-7 text-cyan-500" />
              {status === 'connected' && (
                <Circle className="absolute -top-1 -right-1 h-2.5 w-2.5 fill-emerald-500 text-emerald-500 animate-pulse" />
              )}
            </div>
            <div>
              <h1 className="text-lg md:text-xl font-bold tracking-tight font-mono">
                ILP CONNECTOR
              </h1>
              <p className="text-xs text-muted-foreground/80 uppercase tracking-wider">
                Network Operations
              </p>
            </div>
          </div>

          {health && (
            <div className="hidden lg:flex items-center gap-3 pl-6 border-l border-border/50">
              <div>
                <p className="text-xs text-muted-foreground/60 uppercase tracking-wider">Node ID</p>
                <p className="text-sm font-mono font-medium">{health.nodeId}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground/60 uppercase tracking-wider">Uptime</p>
                <p className="text-sm font-mono font-medium">{formatUptime(health.uptime)}</p>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 md:gap-4">
          <Badge variant="outline" className="font-mono tabular-nums border-border/50 bg-card/50">
            <span className="text-muted-foreground mr-1.5">Events</span>
            <span className="font-bold">{eventCount.toLocaleString()}</span>
          </Badge>

          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-md border border-border/50 bg-card/50">
            <div
              className={cn(
                'w-2 h-2 rounded-full transition-all duration-300',
                getStatusDotColor(),
                status === 'connected' && 'animate-pulse'
              )}
            />
            <span className={cn('text-xs font-medium uppercase tracking-wider', getStatusColor())}>
              {status}
            </span>
          </div>

          <div className="hidden md:block text-right">
            <p className="text-xs text-muted-foreground/60 uppercase tracking-wider">System Time</p>
            <p className="text-sm font-mono font-medium tabular-nums">
              {currentTime.toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                second: '2-digit',
                hour12: true,
              })}
            </p>
          </div>

          {onHelpOpen && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onHelpOpen}
              title="Keyboard shortcuts (?)"
              className="h-9 w-9 border border-border/50 hover:border-border hover:bg-card/50"
            >
              <Keyboard className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </header>
  );
});
