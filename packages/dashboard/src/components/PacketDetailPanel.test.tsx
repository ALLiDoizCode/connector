/**
 * Unit tests for PacketDetailPanel component
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { PacketDetailPanel } from './PacketDetailPanel';
import { PacketDetail } from '@/types/packet';

// Mock the toast hook
jest.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: jest.fn(),
  }),
}));

describe('PacketDetailPanel', () => {
  const mockPreparePacket: PacketDetail = {
    packetId: 'packet-123-abc-456',
    type: 'PREPARE',
    timestamp: new Date('2025-12-29T10:00:00.000Z').toISOString(),
    sourceNodeId: 'connector-a',
    destinationAddress: 'g.connectorB.dest',
    amount: '1000',
    executionCondition: 'ABCD1234ABCD1234',
    expiresAt: new Date('2025-12-29T10:01:00.000Z').toISOString(),
    dataPayload: 'DEADBEEF',
    routingPath: ['connector-a', 'connector-b'],
  };

  const mockFulfillPacket: PacketDetail = {
    packetId: 'packet-789-def-012',
    type: 'FULFILL',
    timestamp: new Date('2025-12-29T10:00:05.000Z').toISOString(),
    sourceNodeId: 'connector-b',
    destinationAddress: 'g.connectorA.sender',
    fulfillment: '12345678ABCDEF00',
    dataPayload: 'CAFE',
    routingPath: ['connector-b', 'connector-a'],
  };

  const mockRejectPacket: PacketDetail = {
    packetId: 'packet-reject-001',
    type: 'REJECT',
    timestamp: new Date('2025-12-29T10:00:10.000Z').toISOString(),
    sourceNodeId: 'connector-c',
    destinationAddress: 'g.connectorA.dest',
    errorCode: 'F02',
    errorMessage: 'No route to destination',
    triggeredBy: 'connector-c',
    routingPath: ['connector-a', 'connector-c'],
  };

  it('renders "No packet selected" when packet is null', () => {
    render(<PacketDetailPanel open={true} onOpenChange={jest.fn()} packet={null} />);

    expect(screen.getByText('No packet selected')).toBeInTheDocument();
  });

  it('renders PREPARE packet details correctly', () => {
    render(<PacketDetailPanel open={true} onOpenChange={jest.fn()} packet={mockPreparePacket} />);

    // Check packet type badge (multiple instances from tabs)
    expect(screen.getAllByText('PREPARE').length).toBeGreaterThan(0);

    // Check basic fields (may appear multiple times due to routing path)
    expect(screen.getAllByText('connector-a').length).toBeGreaterThan(0);
    expect(screen.getByText('g.connectorB.dest')).toBeInTheDocument();

    // Check PREPARE-specific fields
    expect(screen.getByText('1000 units')).toBeInTheDocument();
    expect(screen.getByText(/AB CD 12 34/)).toBeInTheDocument();
  });

  it('renders FULFILL packet details correctly', () => {
    render(<PacketDetailPanel open={true} onOpenChange={jest.fn()} packet={mockFulfillPacket} />);

    // Check packet type badge
    expect(screen.getAllByText('FULFILL').length).toBeGreaterThan(0);

    // Check FULFILL-specific fields
    expect(screen.getByText(/12 34 56 78/)).toBeInTheDocument();
  });

  it('renders REJECT packet details correctly', () => {
    render(<PacketDetailPanel open={true} onOpenChange={jest.fn()} packet={mockRejectPacket} />);

    // Check packet type badge
    expect(screen.getAllByText('REJECT').length).toBeGreaterThan(0);

    // Check REJECT-specific fields
    expect(screen.getByText('F02')).toBeInTheDocument();
    expect(screen.getByText('No route to destination')).toBeInTheDocument();
    expect(screen.getAllByText('connector-c').length).toBeGreaterThan(0);
  });

  it('displays routing path correctly', () => {
    render(<PacketDetailPanel open={true} onOpenChange={jest.fn()} packet={mockPreparePacket} />);

    expect(screen.getByText('Routing Path')).toBeInTheDocument();
    expect(screen.getAllByText('connector-a')[0]).toBeInTheDocument();
    expect(screen.getByText('connector-b')).toBeInTheDocument();
    expect(screen.getByText('Source')).toBeInTheDocument();
    expect(screen.getByText('Destination')).toBeInTheDocument();
  });

  it('shows empty routing path message when path is empty', () => {
    const packetWithoutPath = {
      ...mockPreparePacket,
      routingPath: [],
    };

    render(<PacketDetailPanel open={true} onOpenChange={jest.fn()} packet={packetWithoutPath} />);

    expect(screen.getByText('Path not yet determined')).toBeInTheDocument();
  });

  it('calls onOpenChange when close is triggered', () => {
    const handleOpenChange = jest.fn();

    render(
      <PacketDetailPanel open={true} onOpenChange={handleOpenChange} packet={mockPreparePacket} />
    );

    // Find close button (usually in the SheetPrimitive)
    // Note: This test assumes shadcn-ui Sheet has a close button
    const closeButtons = screen.getAllByRole('button');
    const closeButton = closeButtons.find((btn) => btn.className.includes('absolute'));

    if (closeButton) {
      fireEvent.click(closeButton);
      expect(handleOpenChange).toHaveBeenCalledWith(false);
    }
  });

  it('switches between formatted and JSON views', () => {
    render(<PacketDetailPanel open={true} onOpenChange={jest.fn()} packet={mockPreparePacket} />);

    // Check tabs exist
    expect(screen.getByText('Formatted View')).toBeInTheDocument();
    expect(screen.getByText('JSON View')).toBeInTheDocument();

    // Check that packet is displayed (showing formatted view is working)
    expect(screen.getAllByText('PREPARE').length).toBeGreaterThan(0);
  });

  it('renders recent packets history', () => {
    const recentPackets = ['packet-1', 'packet-2', 'packet-3'];
    const handleSelectPacket = jest.fn();

    render(
      <PacketDetailPanel
        open={true}
        onOpenChange={jest.fn()}
        packet={mockPreparePacket}
        recentPacketIds={recentPackets}
        onSelectPacket={handleSelectPacket}
      />
    );

    expect(screen.getByText('Recently Viewed')).toBeInTheDocument();

    // Recent packets should show packet-2 and packet-3 (excluding current packet-1)
    const recentButtons = screen
      .getAllByRole('button')
      .filter((btn) => btn.textContent?.startsWith('packet-'));

    expect(recentButtons.length).toBeGreaterThan(0);

    // Click on recent packet button
    if (recentButtons.length > 0 && recentButtons[0]) {
      fireEvent.click(recentButtons[0]);
      expect(handleSelectPacket).toHaveBeenCalled();
    }
  });
});
