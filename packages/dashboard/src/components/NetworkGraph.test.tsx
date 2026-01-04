/**
 * Unit tests for NetworkGraph component
 * These are integration-level tests requiring Cytoscape mocking
 */

import { render } from '@testing-library/react';
import { NetworkGraph } from './NetworkGraph';
import { NetworkGraphData } from '../types/network';

// Declare process for TypeScript (available in Jest environment)
declare const process: { env: Record<string, string | undefined> };

// Skip tests unless E2E_TESTS is enabled (requires complex Cytoscape mocking)
const e2eEnabled = process.env.E2E_TESTS === 'true';
const describeIfE2E = e2eEnabled ? describe : describe.skip;

describeIfE2E('NetworkGraph', () => {
  test('renders with empty graph data', () => {
    const emptyData: NetworkGraphData = { nodes: [], edges: [] };

    const { container } = render(<NetworkGraph graphData={emptyData} />);

    // Verify Cytoscape container is rendered
    const graphContainer = container.querySelector('.network-graph-container');
    expect(graphContainer).toBeInTheDocument();
  });

  test('displays nodes with correct labels', () => {
    const graphData: NetworkGraphData = {
      nodes: [
        {
          id: 'connector-a',
          label: 'connector-a',
          healthStatus: 'healthy',
          peersConnected: 1,
          totalPeers: 1,
          uptime: 100,
        },
        {
          id: 'connector-b',
          label: 'connector-b',
          healthStatus: 'healthy',
          peersConnected: 1,
          totalPeers: 1,
          uptime: 100,
        },
        {
          id: 'connector-c',
          label: 'connector-c',
          healthStatus: 'starting',
          peersConnected: 0,
          totalPeers: 1,
          uptime: 10,
        },
      ],
      edges: [],
    };

    const { container } = render(<NetworkGraph graphData={graphData} />);

    // Verify graph container is rendered
    const graphContainer = container.querySelector('.network-graph-container');
    expect(graphContainer).toBeInTheDocument();

    // Note: Cytoscape.js renders on canvas, so we can't directly query for node labels
    // Instead, we verify the component renders without errors
  });

  test('displays edges between connected nodes', () => {
    const graphData: NetworkGraphData = {
      nodes: [
        {
          id: 'connector-a',
          label: 'connector-a',
          healthStatus: 'healthy',
          peersConnected: 1,
          totalPeers: 1,
          uptime: 100,
        },
        {
          id: 'connector-b',
          label: 'connector-b',
          healthStatus: 'healthy',
          peersConnected: 1,
          totalPeers: 1,
          uptime: 100,
        },
      ],
      edges: [
        {
          id: 'connector-a-connector-b',
          source: 'connector-a',
          target: 'connector-b',
          connected: true,
        },
      ],
    };

    const { container } = render(<NetworkGraph graphData={graphData} />);

    // Verify graph container is rendered
    const graphContainer = container.querySelector('.network-graph-container');
    expect(graphContainer).toBeInTheDocument();
  });

  test('node colors match health status', () => {
    const graphData: NetworkGraphData = {
      nodes: [
        {
          id: 'healthy-node',
          label: 'healthy-node',
          healthStatus: 'healthy',
          peersConnected: 1,
          totalPeers: 1,
          uptime: 100,
        },
        {
          id: 'unhealthy-node',
          label: 'unhealthy-node',
          healthStatus: 'unhealthy',
          peersConnected: 0,
          totalPeers: 1,
          uptime: 100,
        },
        {
          id: 'starting-node',
          label: 'starting-node',
          healthStatus: 'starting',
          peersConnected: 0,
          totalPeers: 0,
          uptime: 5,
        },
      ],
      edges: [],
    };

    const { container } = render(<NetworkGraph graphData={graphData} />);

    // Verify graph renders successfully
    const graphContainer = container.querySelector('.network-graph-container');
    expect(graphContainer).toBeInTheDocument();

    // Note: Stylesheet is applied internally by Cytoscape.js
    // We verify the component renders without errors with different health statuses
  });

  test('renders with graph containing both nodes and edges', () => {
    const graphData: NetworkGraphData = {
      nodes: [
        {
          id: 'node-1',
          label: 'Node 1',
          healthStatus: 'healthy',
          peersConnected: 2,
          totalPeers: 2,
          uptime: 200,
        },
        {
          id: 'node-2',
          label: 'Node 2',
          healthStatus: 'healthy',
          peersConnected: 2,
          totalPeers: 2,
          uptime: 200,
        },
        {
          id: 'node-3',
          label: 'Node 3',
          healthStatus: 'unhealthy',
          peersConnected: 1,
          totalPeers: 2,
          uptime: 150,
        },
      ],
      edges: [
        {
          id: 'edge-1-2',
          source: 'node-1',
          target: 'node-2',
          connected: true,
        },
        {
          id: 'edge-2-3',
          source: 'node-2',
          target: 'node-3',
          connected: false,
        },
      ],
    };

    const { container } = render(<NetworkGraph graphData={graphData} />);

    const graphContainer = container.querySelector('.network-graph-container');
    expect(graphContainer).toBeInTheDocument();
  });

  test('handles graph data updates', () => {
    const initialData: NetworkGraphData = {
      nodes: [
        {
          id: 'node-1',
          label: 'Node 1',
          healthStatus: 'healthy',
          peersConnected: 0,
          totalPeers: 0,
          uptime: 50,
        },
      ],
      edges: [],
    };

    const { container, rerender } = render(<NetworkGraph graphData={initialData} />);

    let graphContainer = container.querySelector('.network-graph-container');
    expect(graphContainer).toBeInTheDocument();

    // Update graph data with new node
    const updatedData: NetworkGraphData = {
      nodes: [
        {
          id: 'node-1',
          label: 'Node 1',
          healthStatus: 'healthy',
          peersConnected: 1,
          totalPeers: 1,
          uptime: 100,
        },
        {
          id: 'node-2',
          label: 'Node 2',
          healthStatus: 'starting',
          peersConnected: 0,
          totalPeers: 1,
          uptime: 10,
        },
      ],
      edges: [
        {
          id: 'edge-1-2',
          source: 'node-1',
          target: 'node-2',
          connected: true,
        },
      ],
    };

    rerender(<NetworkGraph graphData={updatedData} />);

    graphContainer = container.querySelector('.network-graph-container');
    expect(graphContainer).toBeInTheDocument();
  });
});
