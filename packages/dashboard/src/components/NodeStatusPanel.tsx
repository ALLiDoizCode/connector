/**
 * NodeStatusPanel component - Side panel for inspecting connector node status
 * Displays routing table, peer connections, and packet statistics
 */

import { CheckCircle2, AlertTriangle, XCircle, ArrowDown, ArrowRight } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet';
import { Badge } from './ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { NodeStatus, formatUptime } from '../types/node';

export interface NodeStatusPanelProps {
  /** Controls panel open/close state */
  open: boolean;

  /** Callback when panel open state changes */
  onOpenChange: (open: boolean) => void;

  /** Node status data to display (null if no node selected) */
  node: NodeStatus | null;
}

/**
 * NodeStatusPanel component renders node inspection panel
 * Features: routing table, peer connections, packet statistics, health status
 */
export const NodeStatusPanel = ({
  open,
  onOpenChange,
  node,
}: NodeStatusPanelProps): JSX.Element => {
  // Render "no node selected" message if node is null
  if (!node && open) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-[500px] sm:w-[600px]">
          <SheetHeader>
            <SheetTitle>Node Status</SheetTitle>
            <SheetDescription>
              View connector routing table, peer connections, and statistics
            </SheetDescription>
          </SheetHeader>
          <div className="mt-8 text-center text-gray-400">No node selected</div>
        </SheetContent>
      </Sheet>
    );
  }

  if (!node) {
    return <></>;
  }

  // Health status badge rendering
  const renderHealthBadge = (): JSX.Element => {
    const { healthStatus } = node;

    if (healthStatus === 'healthy') {
      return (
        <Badge variant="outline" className="bg-green-500 text-white flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" /> Healthy
        </Badge>
      );
    } else if (healthStatus === 'degraded') {
      return (
        <Badge variant="outline" className="bg-yellow-500 text-white flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" /> Degraded
        </Badge>
      );
    } else {
      return (
        <Badge variant="outline" className="bg-red-500 text-white flex items-center gap-1">
          <XCircle className="h-3 w-3" /> Down
        </Badge>
      );
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[500px] sm:w-[600px] bg-gray-900 text-gray-100 overflow-y-auto"
      >
        <SheetHeader>
          <SheetTitle className="font-mono text-xl">{node.nodeId}</SheetTitle>
          <SheetDescription>
            View connector routing table, peer connections, and statistics
          </SheetDescription>
        </SheetHeader>

        {/* Node Header Section */}
        <div className="mt-6 space-y-4">
          <div className="flex items-center gap-3">
            {renderHealthBadge()}
            <span className="text-sm text-gray-400">Uptime: {formatUptime(node.uptime)}</span>
          </div>

          {/* Routing Table Section */}
          <div className="border-t border-gray-700 pt-4">
            <h3 className="text-lg font-semibold mb-3">Routing Table</h3>
            {node.routes.length === 0 ? (
              <div className="text-gray-400 text-sm">No routes configured</div>
            ) : (
              <div className="rounded-md border border-gray-700">
                <Table>
                  <TableHeader>
                    <TableRow className="border-gray-700 hover:bg-gray-800">
                      <TableHead className="text-gray-300">Prefix</TableHead>
                      <TableHead className="text-gray-300">Next Hop</TableHead>
                      <TableHead className="text-gray-300">Priority</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {node.routes
                      .sort((a, b) => a.prefix.localeCompare(b.prefix))
                      .map((route, index) => (
                        <TableRow
                          key={`${route.prefix}-${route.nextHop}`}
                          className={`border-gray-700 ${index % 2 === 0 ? 'bg-gray-800' : 'bg-gray-850'}`}
                        >
                          <TableCell className="font-mono text-sm">{route.prefix}</TableCell>
                          <TableCell className="font-mono text-sm">{route.nextHop}</TableCell>
                          <TableCell className="font-mono text-sm">
                            {route.priority !== undefined ? route.priority : '-'}
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          {/* Peer Connections Section */}
          <div className="border-t border-gray-700 pt-4">
            <h3 className="text-lg font-semibold mb-3">Peer Connections</h3>
            {node.peers.length === 0 ? (
              <div className="text-gray-400 text-sm">No peers configured</div>
            ) : (
              <div className="space-y-3">
                {node.peers.map((peer) => (
                  <div
                    key={peer.peerId}
                    className="rounded-md border border-gray-700 p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-sm font-semibold">{peer.peerId}</span>
                      <div className="flex items-center gap-1">
                        {peer.connected ? (
                          <>
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                            <Badge variant="outline" className="bg-green-500 text-white text-xs">
                              Connected
                            </Badge>
                          </>
                        ) : (
                          <>
                            <XCircle className="h-4 w-4 text-red-500" />
                            <Badge variant="outline" className="bg-red-500 text-white text-xs">
                              Disconnected
                            </Badge>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="text-xs text-gray-400 font-mono truncate" title={peer.url}>
                      {peer.url}
                    </div>
                    {peer.lastSeen && (
                      <div className="text-xs text-gray-500">
                        Last seen:{' '}
                        {formatDistanceToNow(new Date(peer.lastSeen), { addSuffix: true })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Statistics Section */}
          <div className="border-t border-gray-700 pt-4">
            <h3 className="text-lg font-semibold mb-3">Statistics</h3>
            <div className="grid grid-cols-3 gap-4">
              {/* Packets Received */}
              <div className="flex flex-col items-center space-y-2 p-4 rounded-md border border-gray-700 bg-gray-800">
                <ArrowDown className="h-5 w-5 text-blue-500" />
                <div className="text-2xl font-bold">{node.statistics.packetsReceived}</div>
                <div className="text-xs text-gray-400">Received</div>
              </div>

              {/* Packets Forwarded */}
              <div className="flex flex-col items-center space-y-2 p-4 rounded-md border border-gray-700 bg-gray-800">
                <ArrowRight className="h-5 w-5 text-green-500" />
                <div className="text-2xl font-bold">{node.statistics.packetsForwarded}</div>
                <div className="text-xs text-gray-400">Forwarded</div>
              </div>

              {/* Packets Rejected */}
              <div className="flex flex-col items-center space-y-2 p-4 rounded-md border border-gray-700 bg-gray-800">
                <XCircle className="h-5 w-5 text-red-500" />
                <div
                  className={`text-2xl font-bold ${node.statistics.packetsRejected > 0 ? 'text-red-400' : ''}`}
                >
                  {node.statistics.packetsRejected}
                </div>
                <div className="text-xs text-gray-400">Rejected</div>
              </div>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

NodeStatusPanel.displayName = 'NodeStatusPanel';
