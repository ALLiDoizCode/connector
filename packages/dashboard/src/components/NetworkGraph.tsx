/**
 * NetworkGraph component - Cytoscape.js network topology visualization
 * Displays ILP connector nodes and BTP connections with interactive graph
 */

import React, { useRef, useMemo, useEffect, useCallback } from 'react';
import CytoscapeComponent from 'react-cytoscapejs';
import { NetworkGraphData } from '../types/network';
import Cytoscape from 'cytoscape';

export interface NetworkGraphProps {
  graphData: NetworkGraphData;
  onCyReady?: (cy: Cytoscape.Core) => void;
  onNodeClick?: (nodeId: string) => void;
}

/**
 * NetworkGraph component renders network topology using Cytoscape.js
 * Features: interactive zoom/pan/drag, health status color coding, automatic layout
 * Optimized with React.memo to prevent unnecessary re-renders
 */
const NetworkGraphComponent = ({
  graphData,
  onCyReady,
  onNodeClick,
}: NetworkGraphProps): JSX.Element => {
  const cyRef = useRef<Cytoscape.Core | null>(null);

  // Convert NetworkGraphData to Cytoscape element format
  const elements = useMemo(() => {
    const nodeElements = graphData.nodes.map((node) => ({
      data: {
        id: node.id,
        label: node.label,
        healthStatus: node.healthStatus,
        type: 'connector', // Mark as connector node for click handling
      },
    }));

    const edgeElements = graphData.edges.map((edge) => ({
      data: {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        connected: edge.connected,
      },
    }));

    return [...nodeElements, ...edgeElements];
  }, [graphData]);

  // Cytoscape stylesheet for nodes and edges
  const stylesheet: Cytoscape.StylesheetStyle[] = useMemo(
    () => [
      {
        selector: 'node',
        style: {
          'background-color': (ele: Cytoscape.NodeSingular) => {
            const status = ele.data('healthStatus');
            return status === 'healthy'
              ? '#10b981'
              : status === 'unhealthy'
                ? '#ef4444'
                : '#f59e0b';
          },
          label: 'data(label)',
          width: 60,
          height: 60,
          'font-family': 'Courier New, monospace',
          'font-size': '12px',
          color: '#f3f4f6',
          'text-valign': 'bottom',
          'text-halign': 'center',
          'text-margin-y': 5,
          'border-width': 2,
          'border-color': '#1f2937',
        },
      },
      {
        selector: 'node[type="connector"]:active',
        style: {
          'border-width': 3,
          'border-color': '#3b82f6',
        },
      },
      {
        selector: 'edge',
        style: {
          'line-color': '#6b7280',
          width: 2,
          'target-arrow-shape': 'triangle',
          'target-arrow-color': '#6b7280',
          'curve-style': 'bezier',
        },
      },
      {
        selector: 'edge[connected = false]',
        style: {
          'line-style': 'dashed',
          opacity: 0.3,
        },
      },
    ],
    []
  );

  // Layout algorithm configuration (force-directed for arbitrary topologies)
  // Using 'cose' (Compound Spring Embedder) layout for dynamic, flexible positioning
  // Supports any topology: linear, mesh, hub-and-spoke, hierarchical, etc.
  const layout = useMemo(
    () =>
      ({
        name: 'cose',
        animate: true,
        animationDuration: 500,
        idealEdgeLength: 100,
        nodeOverlap: 20,
        refresh: 20,
        fit: true,
        padding: 30,
        randomize: false,
        componentSpacing: 100,
        nodeRepulsion: 400000,
        edgeElasticity: 100,
        nestingFactor: 5,
        gravity: 80,
        numIter: 1000,
        initialTemp: 200,
        coolingFactor: 0.95,
        minTemp: 1.0,
      }) as Cytoscape.LayoutOptions,
    []
  );

  // Fit graph to viewport on initial load and re-run layout on topology changes
  useEffect(() => {
    if (cyRef.current && elements.length > 0) {
      // Re-run layout when new nodes are added (use cose for dynamic layout)
      const layout = cyRef.current.layout({
        name: 'cose',
        animate: true,
        animationDuration: 500,
        idealEdgeLength: 100,
        nodeOverlap: 20,
        nodeRepulsion: 400000,
        gravity: 80,
      } as Cytoscape.LayoutOptions);
      layout.run();

      // Fit to viewport after layout completes
      setTimeout(() => {
        if (cyRef.current) {
          cyRef.current.fit();
        }
      }, 350);
    }
  }, [elements.length]); // Trigger on element count change

  // Animate node color changes on health status update
  useEffect(() => {
    if (cyRef.current) {
      graphData.nodes.forEach((node) => {
        const cyNode = cyRef.current?.getElementById(node.id);
        if (cyNode) {
          const currentStatus = cyNode.data('healthStatus');
          if (currentStatus !== node.healthStatus) {
            // Update health status and trigger animation
            cyNode.data('healthStatus', node.healthStatus);
            cyNode.animate({
              style: {
                'background-color':
                  node.healthStatus === 'healthy'
                    ? '#10b981'
                    : node.healthStatus === 'unhealthy'
                      ? '#ef4444'
                      : '#f59e0b',
              },
              duration: 300,
            });
          }
        }
      });

      // Animate edge opacity changes on connection state change
      graphData.edges.forEach((edge) => {
        const cyEdge = cyRef.current?.getElementById(edge.id);
        if (cyEdge) {
          const currentConnected = cyEdge.data('connected');
          if (currentConnected !== edge.connected) {
            cyEdge.data('connected', edge.connected);
            cyEdge.animate({
              style: {
                opacity: edge.connected ? 1 : 0.3,
              },
              duration: 300,
            });
          }
        }
      });
    }
  }, [graphData]);

  // Handle Cytoscape instance initialization
  const handleCyInit = useCallback(
    (cy: Cytoscape.Core) => {
      cyRef.current = cy;

      // Fit to viewport on initialization
      cy.fit();

      // Enable performance optimizations
      cy.ready(() => {
        cy.fit();
      });

      // Add double-click to reset layout
      cy.on('dblclick', (event) => {
        if (event.target === cy) {
          // Double-click on background resets layout
          cy.layout(layout).run();
        }
      });

      // Add node click handling
      if (onNodeClick) {
        cy.on('tap', 'node[type="connector"]', (event) => {
          const nodeId = event.target.id();
          onNodeClick(nodeId);
        });

        // Add cursor pointer on hover for connector nodes
        cy.on('mouseover', 'node[type="connector"]', () => {
          document.body.style.cursor = 'pointer';
        });

        cy.on('mouseout', 'node[type="connector"]', () => {
          document.body.style.cursor = 'default';
        });
      }

      // Notify parent component that Cytoscape instance is ready
      if (onCyReady) {
        onCyReady(cy);
      }
    },
    [layout, onCyReady, onNodeClick]
  );

  return (
    <div className="network-graph-container">
      <CytoscapeComponent
        elements={elements}
        stylesheet={stylesheet}
        layout={layout}
        style={{
          width: '100%',
          height: '600px',
          backgroundColor: '#111827',
        }}
        cy={handleCyInit}
        userZoomingEnabled={true}
        userPanningEnabled={true}
        boxSelectionEnabled={false}
        autoungrabify={false}
        minZoom={0.5}
        maxZoom={2.0}
        wheelSensitivity={0.2}
      />
    </div>
  );
};

NetworkGraphComponent.displayName = 'NetworkGraph';

export const NetworkGraph = React.memo(NetworkGraphComponent);
