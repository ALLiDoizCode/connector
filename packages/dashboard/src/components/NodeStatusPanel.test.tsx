/**
 * Tests for NodeStatusPanel component
 */

import { render, screen } from '@testing-library/react';
import { NodeStatusPanel } from './NodeStatusPanel';
import { NodeStatus } from '../types/node';

describe('NodeStatusPanel', () => {
  const mockNodeStatus: NodeStatus = {
    nodeId: 'connector-a',
    healthStatus: 'healthy',
    uptime: 7200000, // 2 hours
    routes: [
      { prefix: 'g.alice', nextHop: 'peer-alice', priority: 0 },
      { prefix: 'g.bob', nextHop: 'peer-bob', priority: 0 },
      { prefix: 'g.charlie', nextHop: 'peer-charlie', priority: 1 },
    ],
    peers: [
      {
        peerId: 'peer-alice',
        url: 'ws://connector-alice:3000',
        connected: true,
        lastSeen: '2025-12-29T10:00:00.000Z',
      },
      {
        peerId: 'peer-bob',
        url: 'ws://connector-bob:3000',
        connected: false,
        lastSeen: '2025-12-29T09:45:00.000Z',
      },
    ],
    statistics: {
      packetsReceived: 42,
      packetsForwarded: 40,
      packetsRejected: 2,
    },
    lastUpdated: '2025-12-29T10:00:00.000Z',
  };

  it('should render node details correctly', () => {
    // Arrange & Act
    render(<NodeStatusPanel open={true} onOpenChange={() => {}} node={mockNodeStatus} />);

    // Assert: Node ID displayed
    expect(screen.getByText('connector-a')).toBeInTheDocument();

    // Assert: Health status badge displayed
    expect(screen.getByText('Healthy')).toBeInTheDocument();

    // Assert: Uptime displayed
    expect(screen.getByText(/Uptime:/)).toBeInTheDocument();
    expect(screen.getByText(/2h/)).toBeInTheDocument();
  });

  it('should render routing table as tabular data', () => {
    // Arrange & Act
    render(<NodeStatusPanel open={true} onOpenChange={() => {}} node={mockNodeStatus} />);

    // Assert: Routing table section visible
    expect(screen.getByText('Routing Table')).toBeInTheDocument();

    // Assert: Table has correct routes
    expect(screen.getAllByText('g.alice').length).toBeGreaterThan(0);
    expect(screen.getAllByText('peer-alice').length).toBeGreaterThan(0);
    expect(screen.getAllByText('g.bob').length).toBeGreaterThan(0);
    expect(screen.getAllByText('peer-bob').length).toBeGreaterThan(0);
    expect(screen.getAllByText('g.charlie').length).toBeGreaterThan(0);
    expect(screen.getAllByText('peer-charlie').length).toBeGreaterThan(0);

    // Assert: Priority values displayed
    const priorityCells = screen.getAllByText('0');
    expect(priorityCells.length).toBeGreaterThan(0);
  });

  it('should display peer connection status correctly', () => {
    // Arrange & Act
    render(<NodeStatusPanel open={true} onOpenChange={() => {}} node={mockNodeStatus} />);

    // Assert: Peer connections section visible
    expect(screen.getByText('Peer Connections')).toBeInTheDocument();

    // Assert: Connected peer shows green badge
    expect(screen.getByText('Connected')).toBeInTheDocument();

    // Assert: Disconnected peer shows red badge
    expect(screen.getByText('Disconnected')).toBeInTheDocument();

    // Assert: Peer IDs displayed (there are multiple instances due to routing table)
    expect(screen.getAllByText('peer-alice').length).toBeGreaterThan(0);
    expect(screen.getAllByText('peer-bob').length).toBeGreaterThan(0);
  });

  it('should display packet statistics', () => {
    // Arrange & Act
    render(<NodeStatusPanel open={true} onOpenChange={() => {}} node={mockNodeStatus} />);

    // Assert: Statistics section visible
    expect(screen.getByText('Statistics')).toBeInTheDocument();

    // Assert: Packet counts displayed
    expect(screen.getByText('42')).toBeInTheDocument(); // Received
    expect(screen.getByText('40')).toBeInTheDocument(); // Forwarded
    expect(screen.getByText('2')).toBeInTheDocument(); // Rejected

    // Assert: Labels displayed
    expect(screen.getByText('Received')).toBeInTheDocument();
    expect(screen.getByText('Forwarded')).toBeInTheDocument();
    expect(screen.getByText('Rejected')).toBeInTheDocument();
  });

  it('should show "No node selected" when node is null', () => {
    // Arrange & Act
    render(<NodeStatusPanel open={true} onOpenChange={() => {}} node={null} />);

    // Assert: "No node selected" message displayed
    expect(screen.getByText('No node selected')).toBeInTheDocument();
  });

  it('should show "No routes configured" when routes empty', () => {
    // Arrange: Create node with empty routes
    const nodeWithoutRoutes: NodeStatus = {
      ...mockNodeStatus,
      routes: [],
    };

    // Act
    render(<NodeStatusPanel open={true} onOpenChange={() => {}} node={nodeWithoutRoutes} />);

    // Assert
    expect(screen.getByText('No routes configured')).toBeInTheDocument();
  });

  it('should show "No peers configured" when peers empty', () => {
    // Arrange: Create node with empty peers
    const nodeWithoutPeers: NodeStatus = {
      ...mockNodeStatus,
      peers: [],
    };

    // Act
    render(<NodeStatusPanel open={true} onOpenChange={() => {}} node={nodeWithoutPeers} />);

    // Assert
    expect(screen.getByText('No peers configured')).toBeInTheDocument();
  });

  it('should render degraded health status with yellow badge', () => {
    // Arrange: Create degraded node
    const degradedNode: NodeStatus = {
      ...mockNodeStatus,
      healthStatus: 'degraded',
    };

    // Act
    render(<NodeStatusPanel open={true} onOpenChange={() => {}} node={degradedNode} />);

    // Assert: Degraded badge displayed
    expect(screen.getByText('Degraded')).toBeInTheDocument();
  });

  it('should render down health status with red badge', () => {
    // Arrange: Create down node
    const downNode: NodeStatus = {
      ...mockNodeStatus,
      healthStatus: 'down',
    };

    // Act
    render(<NodeStatusPanel open={true} onOpenChange={() => {}} node={downNode} />);

    // Assert: Down badge displayed
    expect(screen.getByText('Down')).toBeInTheDocument();
  });
});
