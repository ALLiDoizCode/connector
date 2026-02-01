import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ArrowRight, CheckCircle, Clock } from 'lucide-react';
import React from 'react';

interface RouteHop {
  id: string;
  name: string;
  icon: string; // Emoji or icon character
  fee: number; // In M2M tokens (negative for deductions, positive for recipient)
  amount: number; // Total amount at this hop
  status: 'pending' | 'processing' | 'completed';
}

interface RouteData {
  hops: RouteHop[];
  progress: number; // 0-100
  latency: number; // In milliseconds
  totalCost: number; // In M2M tokens
  privacyLevel: 'high' | 'medium' | 'low';
  deliveryProof: boolean; // True if ILP Fulfill received
}

export interface RoutingVisualizationProps {
  route: RouteData | null;
}

export function RoutingVisualization({ route }: RoutingVisualizationProps) {
  if (!route) {
    return null; // Don't render until message is sent
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">💰 Payment Route</CardTitle>
        <CardDescription>
          Message routed through {route.hops.length - 2} hops in {route.latency}ms
        </CardDescription>
      </CardHeader>

      <CardContent>
        {/* Route Diagram */}
        <div className="flex items-center justify-between mb-6">
          {route.hops.map((hop, index) => (
            <React.Fragment key={hop.id}>
              {/* Hop Node */}
              <div className="flex flex-col items-center">
                <Avatar className={hop.status === 'completed' ? 'ring-2 ring-green-500' : ''}>
                  <AvatarFallback>{hop.icon}</AvatarFallback>
                </Avatar>

                <div className="text-xs font-medium mt-2">{hop.name}</div>

                <div className="text-xs text-muted-foreground mt-1">
                  {hop.fee > 0 ? `+${hop.fee} M2M` : `${hop.fee} M2M`}
                </div>

                <div className="mt-1">
                  {hop.status === 'completed' && (
                    <Badge variant="outline" className="text-green-600">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Done
                    </Badge>
                  )}
                  {hop.status === 'processing' && (
                    <Badge variant="outline" className="text-blue-600">
                      <Clock className="h-3 w-3 mr-1 animate-spin" />
                      Processing
                    </Badge>
                  )}
                </div>
              </div>

              {/* Arrow Between Hops */}
              {index < route.hops.length - 1 && (
                <div className="flex flex-col items-center">
                  <ArrowRight
                    className={`h-6 w-6 ${
                      hop.status === 'completed' ? 'text-green-500' : 'text-gray-300'
                    }`}
                  />
                  <div className="text-xs text-muted-foreground mt-1">
                    {route.hops[index + 1].amount} M2M
                  </div>
                </div>
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Progress Bar */}
        <Progress value={route.progress} className="h-2 mb-4" />

        {/* Status Text */}
        {route.progress < 100 && (
          <div className="text-sm text-muted-foreground text-center mb-4">
            Routing through ILP network...
          </div>
        )}
        {route.progress === 100 && (
          <div className="text-sm text-green-600 text-center mb-4 flex items-center justify-center gap-2">
            <CheckCircle className="h-4 w-4" />
            Message delivered successfully!
          </div>
        )}

        {/* Cost Breakdown */}
        <div className="grid grid-cols-2 gap-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
          <div>
            <div className="text-xs text-muted-foreground">Total Cost</div>
            <div className="text-lg font-bold">{route.totalCost} M2M</div>
            <div className="text-xs text-muted-foreground">Aptos Testnet</div>
          </div>

          <div>
            <div className="text-xs text-muted-foreground">Delivery Time</div>
            <div className="text-lg font-bold">{route.latency}ms</div>
            <div className="text-xs text-muted-foreground">Including privacy delays</div>
          </div>

          <div>
            <div className="text-xs text-muted-foreground">Privacy Level</div>
            <div className="flex items-center gap-1">
              <Badge variant="secondary" className="text-sm">
                🔒 {route.privacyLevel.charAt(0).toUpperCase() + route.privacyLevel.slice(1)}
              </Badge>
            </div>
          </div>

          <div>
            <div className="text-xs text-muted-foreground">Delivery Proof</div>
            <div className="flex items-center gap-1">
              {route.deliveryProof ? (
                <>
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <span className="text-sm">ILP Fulfill</span>
                </>
              ) : (
                <>
                  <Clock className="h-4 w-4 text-gray-400" />
                  <span className="text-sm">Pending</span>
                </>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
