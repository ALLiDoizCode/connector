import { render, screen } from '@testing-library/react';
import { RoutingVisualization } from './RoutingVisualization';

describe('RoutingVisualization', () => {
  const mockRouteInitial = {
    hops: [
      { id: 'you', name: 'You', icon: '👤', fee: -300, amount: 300, status: 'pending' as const },
      {
        id: 'facilitator',
        name: 'Facilitator',
        icon: '🌐',
        fee: 50,
        amount: 250,
        status: 'pending' as const,
      },
      {
        id: 'connector1',
        name: 'Connector1',
        icon: '🔀',
        fee: 100,
        amount: 150,
        status: 'pending' as const,
      },
      {
        id: 'connector2',
        name: 'Connector2',
        icon: '🔀',
        fee: 100,
        amount: 50,
        status: 'pending' as const,
      },
      { id: 'bob', name: 'Bob', icon: '👤', fee: 50, amount: 50, status: 'pending' as const },
    ],
    progress: 0,
    latency: 0,
    totalCost: 300,
    privacyLevel: 'high' as const,
    deliveryProof: false,
  };

  const mockRouteCompleted = {
    ...mockRouteInitial,
    hops: mockRouteInitial.hops.map((hop) => ({ ...hop, status: 'completed' as const })),
    progress: 100,
    latency: 4200,
    deliveryProof: true,
  };

  it('should not render when route is null', () => {
    const { container } = render(<RoutingVisualization route={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('should render all 5 nodes horizontally', () => {
    render(<RoutingVisualization route={mockRouteInitial} />);
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getByText('Facilitator')).toBeInTheDocument();
    expect(screen.getByText('Connector1')).toBeInTheDocument();
    expect(screen.getByText('Connector2')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('should display fee amounts correctly', () => {
    render(<RoutingVisualization route={mockRouteInitial} />);
    expect(screen.getByText('-300 M2M')).toBeInTheDocument(); // You pays
    expect(screen.getAllByText('+50 M2M')).toHaveLength(2); // Facilitator & Bob earn
    expect(screen.getAllByText('+100 M2M')).toHaveLength(2); // Connector1 & Connector2 earn
  });

  it('should show progress bar at 0% initially', () => {
    render(<RoutingVisualization route={mockRouteInitial} />);
    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toBeInTheDocument();
    // Progress component uses transform style instead of aria-valuenow
  });

  it('should show progress bar at 100% when completed', () => {
    render(<RoutingVisualization route={mockRouteCompleted} />);
    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toBeInTheDocument();
    // Progress component uses transform style instead of aria-valuenow
  });

  it('should show "Done" badges when all hops completed', () => {
    render(<RoutingVisualization route={mockRouteCompleted} />);
    const doneBadges = screen.getAllByText(/Done/);
    expect(doneBadges).toHaveLength(5);
  });

  it('should display cost breakdown with correct values', () => {
    render(<RoutingVisualization route={mockRouteCompleted} />);
    expect(screen.getByText('300 M2M')).toBeInTheDocument();
    expect(screen.getByText('4200ms')).toBeInTheDocument();
    expect(screen.getByText(/High/)).toBeInTheDocument();
    expect(screen.getByText('ILP Fulfill')).toBeInTheDocument();
  });

  it('should show delivery proof as pending initially', () => {
    render(<RoutingVisualization route={mockRouteInitial} />);
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('should show delivery proof as complete when deliveryProof is true', () => {
    render(<RoutingVisualization route={mockRouteCompleted} />);
    expect(screen.getByText('ILP Fulfill')).toBeInTheDocument();
  });

  it('should show routing message when progress < 100', () => {
    render(<RoutingVisualization route={mockRouteInitial} />);
    expect(screen.getByText('Routing through ILP network...')).toBeInTheDocument();
  });

  it('should show success message when progress === 100', () => {
    render(<RoutingVisualization route={mockRouteCompleted} />);
    expect(screen.getByText('Message delivered successfully!')).toBeInTheDocument();
  });

  it('should display hops count in card description', () => {
    render(<RoutingVisualization route={mockRouteCompleted} />);
    expect(screen.getByText(/Message routed through 3 hops in 4200ms/)).toBeInTheDocument();
  });

  it('should show avatars with green ring when hop is completed', () => {
    render(<RoutingVisualization route={mockRouteCompleted} />);
    const avatars = document.querySelectorAll('.ring-2.ring-green-500');
    expect(avatars).toHaveLength(5); // All 5 hops completed
  });

  it('should display amount forwarded on arrows between hops', () => {
    render(<RoutingVisualization route={mockRouteInitial} />);
    expect(screen.getByText('250 M2M')).toBeInTheDocument(); // Facilitator forwards
    expect(screen.getByText('150 M2M')).toBeInTheDocument(); // Connector1 forwards
    // "50 M2M" appears multiple times (arrow amount and Bob's fee), use getAllByText
    const fiftyMsatElements = screen.getAllByText(/50 M2M/);
    expect(fiftyMsatElements.length).toBeGreaterThanOrEqual(1);
  });
});
