import { useState, useEffect, useCallback } from 'react';

export interface RouteHop {
  id: string;
  name: string;
  icon: string;
  fee: number; // In M2M tokens
  amount: number; // Total amount at this hop (in M2M tokens)
  status: 'pending' | 'processing' | 'completed';
}

export interface RouteData {
  hops: RouteHop[];
  progress: number;
  latency: number;
  totalCost: number; // In M2M tokens
  privacyLevel: 'high' | 'medium' | 'low';
  deliveryProof: boolean;
}

export interface RouteAnimationState {
  currentHopIndex: number;
  startTime: number | null;
  endTime: number | null;
  isAnimating: boolean;
}

export function useRouteAnimation() {
  const [routeData, setRouteData] = useState<RouteData | null>(null);
  const [animationState, setAnimationState] = useState<RouteAnimationState>({
    currentHopIndex: -1,
    startTime: null,
    endTime: null,
    isAnimating: false,
  });

  const startAnimation = useCallback((recipient: string, totalCost: number) => {
    const startTime = Date.now();

    // Initialize route data with all hops pending
    const hops: RouteHop[] = [
      { id: 'you', name: 'You', icon: '👤', fee: -totalCost, amount: totalCost, status: 'pending' },
      {
        id: 'facilitator',
        name: 'Facilitator',
        icon: '🌐',
        fee: 50,
        amount: totalCost - 50,
        status: 'pending',
      },
      {
        id: 'connector1',
        name: 'Connector1',
        icon: '🔀',
        fee: 100,
        amount: totalCost - 150,
        status: 'pending',
      },
      {
        id: 'connector2',
        name: 'Connector2',
        icon: '🔀',
        fee: 100,
        amount: totalCost - 250,
        status: 'pending',
      },
      { id: 'bob', name: recipient, icon: '👤', fee: 50, amount: 50, status: 'pending' },
    ];

    setRouteData({
      hops,
      progress: 0,
      latency: 0,
      totalCost,
      privacyLevel: 'high',
      deliveryProof: false,
    });

    setAnimationState({
      currentHopIndex: 0,
      startTime,
      endTime: null,
      isAnimating: true,
    });
  }, []);

  // Simulate packet flow through hops (called when gateway returns success)
  const completeAnimation = useCallback((actualLatency: number) => {
    const endTime = Date.now();

    setRouteData((prev) =>
      prev
        ? {
            ...prev,
            progress: 100,
            latency: actualLatency,
            deliveryProof: true,
            hops: prev.hops.map((hop) => ({ ...hop, status: 'completed' as const })),
          }
        : null
    );

    setAnimationState((prev) => ({
      ...prev,
      endTime,
      isAnimating: false,
      currentHopIndex: 4, // All hops completed
    }));
  }, []);

  // Update animation progress based on currentHopIndex
  useEffect(() => {
    if (!animationState.isAnimating || animationState.currentHopIndex < 0) return;

    const hopIndex = animationState.currentHopIndex;
    const progressValue = ((hopIndex + 1) / 4) * 100; // 4 hops (0-3, Bob is 4th)

    setRouteData((prev) =>
      prev
        ? {
            ...prev,
            progress: progressValue,
            hops: prev.hops.map((hop, idx) => ({
              ...hop,
              status: idx < hopIndex ? 'completed' : idx === hopIndex ? 'processing' : 'pending',
            })),
          }
        : null
    );
  }, [animationState.currentHopIndex, animationState.isAnimating]);

  return {
    routeData,
    startAnimation,
    completeAnimation,
  };
}
