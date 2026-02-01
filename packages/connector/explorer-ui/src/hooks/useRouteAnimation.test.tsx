import { renderHook, act } from '@testing-library/react';
import { useRouteAnimation } from './useRouteAnimation';

describe('useRouteAnimation', () => {
  it('should initialize with null routeData', () => {
    const { result } = renderHook(() => useRouteAnimation());
    expect(result.current.routeData).toBeNull();
  });

  it('should start animation with initial state', () => {
    const { result } = renderHook(() => useRouteAnimation());

    act(() => {
      result.current.startAnimation('Bob', 300);
    });

    expect(result.current.routeData).not.toBeNull();
    // Progress starts at 25% because currentHopIndex is 0 (first hop processing)
    expect(result.current.routeData?.progress).toBe(25);
    expect(result.current.routeData?.totalCost).toBe(300);
    expect(result.current.routeData?.hops).toHaveLength(5);
    expect(result.current.routeData?.privacyLevel).toBe('high');
    expect(result.current.routeData?.deliveryProof).toBe(false);
  });

  it('should initialize hops with correct structure', () => {
    const { result } = renderHook(() => useRouteAnimation());

    act(() => {
      result.current.startAnimation('Bob', 300);
    });

    const hops = result.current.routeData?.hops;
    expect(hops).toBeDefined();
    // First hop (index 0) is "processing" because currentHopIndex is 0
    expect(hops?.[0]).toMatchObject({
      id: 'you',
      name: 'You',
      icon: '👤',
      fee: -300,
      amount: 300,
      status: 'processing',
    });
    // Last hop is still "pending"
    expect(hops?.[4]).toMatchObject({
      id: 'bob',
      name: 'Bob',
      icon: '👤',
      fee: 50,
      amount: 50,
      status: 'pending',
    });
  });

  it('should complete animation with latency', () => {
    const { result } = renderHook(() => useRouteAnimation());

    act(() => {
      result.current.startAnimation('Bob', 300);
    });

    act(() => {
      result.current.completeAnimation(4200);
    });

    expect(result.current.routeData?.progress).toBe(100);
    expect(result.current.routeData?.latency).toBe(4200);
    expect(result.current.routeData?.deliveryProof).toBe(true);
    expect(result.current.routeData?.hops.every((hop) => hop.status === 'completed')).toBe(true);
  });

  it('should mark all hops as completed when animation completes', () => {
    const { result } = renderHook(() => useRouteAnimation());

    act(() => {
      result.current.startAnimation('Alice', 300);
    });

    act(() => {
      result.current.completeAnimation(5000);
    });

    const allCompleted = result.current.routeData?.hops.every((hop) => hop.status === 'completed');
    expect(allCompleted).toBe(true);
  });

  it('should use recipient name in last hop', () => {
    const { result } = renderHook(() => useRouteAnimation());

    act(() => {
      result.current.startAnimation('Alice', 300);
    });

    const lastHop = result.current.routeData?.hops[4];
    expect(lastHop?.name).toBe('Alice');
  });

  it('should maintain fee structure across hops', () => {
    const { result } = renderHook(() => useRouteAnimation());

    act(() => {
      result.current.startAnimation('Bob', 300);
    });

    const hops = result.current.routeData?.hops;
    expect(hops?.[0].fee).toBe(-300); // You pays
    expect(hops?.[1].fee).toBe(50); // Facilitator earns
    expect(hops?.[2].fee).toBe(100); // Connector1 earns
    expect(hops?.[3].fee).toBe(100); // Connector2 earns
    expect(hops?.[4].fee).toBe(50); // Bob receives
  });

  it('should calculate forwarded amounts correctly', () => {
    const { result } = renderHook(() => useRouteAnimation());

    act(() => {
      result.current.startAnimation('Bob', 300);
    });

    const hops = result.current.routeData?.hops;
    expect(hops?.[0].amount).toBe(300); // You sends 300
    expect(hops?.[1].amount).toBe(250); // Facilitator forwards 250
    expect(hops?.[2].amount).toBe(150); // Connector1 forwards 150
    expect(hops?.[3].amount).toBe(50); // Connector2 forwards 50
    expect(hops?.[4].amount).toBe(50); // Bob receives 50
  });

  it('should not modify routeData before startAnimation is called', () => {
    const { result } = renderHook(() => useRouteAnimation());

    act(() => {
      result.current.completeAnimation(1000);
    });

    expect(result.current.routeData).toBeNull();
  });
});
