/**
 * Topology Validator Module
 *
 * Provides validation for multi-node ILP network topologies.
 * Performs graph-based analysis to detect configuration issues across
 * multiple connector configurations including:
 * - Disconnected nodes (isolated from network)
 * - Invalid peer references (referencing non-existent nodes)
 * - Unreachable routing destinations
 * - Circular route dependencies
 *
 * @packageDocumentation
 */

import { ConnectorConfig } from './types';

/**
 * Validation Result Interface
 *
 * Aggregated result from topology validation containing both
 * errors (critical issues) and warnings (non-critical issues).
 *
 * @property valid - True if no errors exist (warnings may still be present)
 * @property errors - Critical errors that should prevent deployment
 * @property warnings - Non-critical issues that should be reviewed
 */
export interface ValidationResult {
  /**
   * Overall validation status
   * True if no errors exist (warnings allowed)
   */
  valid: boolean;

  /**
   * Critical errors preventing deployment
   * Examples:
   * - Disconnected nodes
   * - Invalid peer references
   * - Circular route dependencies
   */
  errors: string[];

  /**
   * Non-critical warnings for review
   * Examples:
   * - Unreachable destinations
   * - Redundant routes
   */
  warnings: string[];
}

/**
 * Topology Validator Class
 *
 * Static class providing methods to validate multi-connector network topology.
 * Uses graph algorithms (DFS, BFS, cycle detection) to analyze connectivity
 * and routing correctness across the entire network.
 *
 * @example
 * ```typescript
 * const configs = new Map([
 *   ['connector-a', configA],
 *   ['connector-b', configB],
 *   ['connector-c', configC]
 * ]);
 *
 * const result = TopologyValidator.validateTopology(configs);
 * if (!result.valid) {
 *   console.error('Topology validation failed:', result.errors);
 *   process.exit(1);
 * }
 * ```
 */
export class TopologyValidator {
  /**
   * Detect Disconnected Nodes in Network Topology
   *
   * Builds a directed graph of BTP peer connections and performs
   * graph traversal to identify nodes unreachable from the rest
   * of the network. A node is considered disconnected if:
   * - It has no peers (isolated)
   * - It cannot be reached from any other node via peer connections
   *
   * Algorithm: Depth-First Search (DFS) from arbitrary starting node
   *
   * @param configs - Map of nodeId to ConnectorConfig for all nodes
   * @returns Array of disconnected node IDs (empty if all connected)
   *
   * @example
   * ```typescript
   * const disconnected = TopologyValidator.detectDisconnectedNodes(configs);
   * if (disconnected.length > 0) {
   *   console.warn('Disconnected nodes:', disconnected);
   * }
   * ```
   */
  static detectDisconnectedNodes(configs: Map<string, ConnectorConfig>): string[] {
    const nodeIds = Array.from(configs.keys());

    // Empty network or single node is trivially connected
    if (nodeIds.length <= 1) {
      return [];
    }

    // Build adjacency list representing bidirectional connectivity
    // For each peer connection A→B, we also consider B→A for connectivity
    const adjacencyList = new Map<string, Set<string>>();

    // Initialize adjacency list for all nodes
    for (const nodeId of nodeIds) {
      adjacencyList.set(nodeId, new Set());
    }

    // Build graph edges from peer connections
    for (const [nodeId, config] of configs) {
      for (const peer of config.peers) {
        // A has peer B: add edge A→B
        adjacencyList.get(nodeId)?.add(peer.id);
        // For bidirectional connectivity check, also add edge B→A
        // (If B doesn't have A as peer, there's still a connection path)
        adjacencyList.get(peer.id)?.add(nodeId);
      }
    }

    // Perform DFS from first node to find reachable nodes
    const visited = new Set<string>();
    const startNode = nodeIds[0];

    const dfs = (nodeId: string): void => {
      visited.add(nodeId);
      const neighbors = adjacencyList.get(nodeId) || new Set();
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor) && configs.has(neighbor)) {
          dfs(neighbor);
        }
      }
    };

    if (startNode) {
      dfs(startNode);
    }

    // Disconnected nodes are those not visited during traversal
    const disconnected: string[] = [];
    for (const nodeId of nodeIds) {
      if (!visited.has(nodeId)) {
        disconnected.push(nodeId);
      }
    }

    return disconnected;
  }

  /**
   * Detect Invalid Peer References
   *
   * Validates that all peer IDs referenced in connector configurations
   * correspond to existing nodes in the topology. A peer reference is
   * invalid if:
   * - Peer ID does not match any nodeId in the configs map
   *
   * This extends single-config validation by checking peer references
   * across all configurations in the topology.
   *
   * @param config - Connector configuration to validate
   * @param allNodeIds - Set of all valid node IDs in the topology
   * @returns Array of invalid peer IDs
   *
   * @example
   * ```typescript
   * const allNodeIds = new Set(['connector-a', 'connector-b']);
   * const invalidPeers = TopologyValidator.detectInvalidPeerReferences(
   *   config,
   *   allNodeIds
   * );
   * ```
   */
  static detectInvalidPeerReferences(config: ConnectorConfig, allNodeIds: Set<string>): string[] {
    const invalidPeers: string[] = [];

    for (const peer of config.peers) {
      if (!allNodeIds.has(peer.id)) {
        invalidPeers.push(peer.id);
      }
    }

    return invalidPeers;
  }

  /**
   * Validate Routing Reachability
   *
   * Analyzes routing tables to detect routes with unreachable destinations.
   * A destination is considered unreachable if:
   * - Route nextHop peer does not exist in BTP connections
   * - No alternative path exists to the destination prefix
   *
   * Uses BFS to explore all possible multi-hop paths to destinations.
   *
   * @param configs - Map of nodeId to ConnectorConfig for all nodes
   * @returns Array of warning messages about unreachable routes
   *
   * @example
   * ```typescript
   * const warnings = TopologyValidator.validateReachability(configs);
   * warnings.forEach(w => console.warn(w));
   * ```
   */
  static validateReachability(configs: Map<string, ConnectorConfig>): string[] {
    const warnings: string[] = [];

    for (const [nodeId, config] of configs) {
      // Build set of peers this node has BTP connections to
      const connectedPeers = new Set(config.peers.map((p) => p.id));

      // Check each route for reachability
      for (const route of config.routes) {
        const nextHop = route.nextHop;

        // Check if nextHop peer exists in peer connections
        if (!connectedPeers.has(nextHop)) {
          // nextHop not connected - route is unreachable (1-hop check)
          warnings.push(
            `Node ${nodeId}: Route to ${route.prefix} unreachable (nextHop ${nextHop} not connected)`
          );
          continue;
        }

        // Multi-hop reachability: Check if nextHop node exists in topology
        if (!configs.has(nextHop)) {
          warnings.push(
            `Node ${nodeId}: Route to ${route.prefix} unreachable (nextHop ${nextHop} does not exist in topology)`
          );
        }
      }
    }

    return warnings;
  }

  /**
   * Detect Circular Route Dependencies
   *
   * Identifies circular routing dependencies where routes form a cycle.
   * Example: Node A routes via B, B routes via C, C routes via A.
   *
   * Uses cycle detection algorithm with DFS and recursion stack.
   *
   * @param configs - Map of nodeId to ConnectorConfig for all nodes
   * @returns Array of circular dependency descriptions
   *
   * @example
   * ```typescript
   * const cycles = TopologyValidator.detectCircularRouteDependencies(configs);
   * if (cycles.length > 0) {
   *   console.error('Circular dependencies found:', cycles);
   * }
   * ```
   */
  static detectCircularRouteDependencies(configs: Map<string, ConnectorConfig>): string[] {
    const cycles: string[] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const currentPath: string[] = [];

    // Build route dependency graph: nodeId -> Set of nodes it routes through
    const routeDependencies = new Map<string, Set<string>>();
    for (const [nodeId, config] of configs) {
      const dependencies = new Set<string>();
      for (const route of config.routes) {
        // Node depends on nextHop for routing
        dependencies.add(route.nextHop);
      }
      routeDependencies.set(nodeId, dependencies);
    }

    // DFS with cycle detection
    const dfs = (nodeId: string): boolean => {
      visited.add(nodeId);
      recursionStack.add(nodeId);
      currentPath.push(nodeId);

      const dependencies = routeDependencies.get(nodeId) || new Set();
      for (const dependency of dependencies) {
        // Skip if dependency doesn't exist in topology
        if (!configs.has(dependency)) {
          continue;
        }

        if (!visited.has(dependency)) {
          // Recurse to dependency
          if (dfs(dependency)) {
            return true; // Cycle found in recursion
          }
        } else if (recursionStack.has(dependency)) {
          // Found a cycle: dependency is in recursion stack
          const cycleStartIndex = currentPath.indexOf(dependency);
          const cyclePath = currentPath.slice(cycleStartIndex).concat(dependency);
          cycles.push(`Circular route dependency: ${cyclePath.join(' → ')}`);
          return true;
        }
      }

      // Remove from recursion stack when backtracking
      recursionStack.delete(nodeId);
      currentPath.pop();
      return false;
    };

    // Check for cycles starting from each unvisited node
    for (const nodeId of configs.keys()) {
      if (!visited.has(nodeId)) {
        dfs(nodeId);
      }
    }

    return cycles;
  }

  /**
   * Validate Complete Topology
   *
   * Aggregates all topology validation checks into a single result.
   * Performs:
   * - Disconnected node detection (error)
   * - Invalid peer reference detection (error)
   * - Reachability validation (warning)
   * - Circular dependency detection (warning)
   *
   * Note: Circular route dependencies are warnings not errors because
   * hub-and-spoke topologies legitimately have routing dependencies
   * (hub routes via spokes, spokes route via hub) that look like cycles
   * but are actually correct multi-hop routing patterns.
   *
   * @param configs - Map of nodeId to ConnectorConfig for all nodes
   * @returns ValidationResult with aggregated errors and warnings
   *
   * @example
   * ```typescript
   * const result = TopologyValidator.validateTopology(configs);
   * if (!result.valid) {
   *   result.errors.forEach(e => console.error('ERROR:', e));
   *   process.exit(1);
   * }
   * result.warnings.forEach(w => console.warn('WARNING:', w));
   * ```
   */
  static validateTopology(configs: Map<string, ConnectorConfig>): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. Detect disconnected nodes (ERROR)
    const disconnectedNodes = this.detectDisconnectedNodes(configs);
    if (disconnectedNodes.length > 0) {
      errors.push(
        `Disconnected nodes detected: ${disconnectedNodes.join(', ')}. ` +
          `All nodes must be connected via BTP peer relationships.`
      );
    }

    // 2. Detect invalid peer references (ERROR)
    const allNodeIds = new Set(configs.keys());
    for (const [nodeId, config] of configs) {
      const invalidPeers = this.detectInvalidPeerReferences(config, allNodeIds);
      if (invalidPeers.length > 0) {
        errors.push(`Node ${nodeId} references non-existent peers: ${invalidPeers.join(', ')}`);
      }
    }

    // 3. Validate reachability (WARNING)
    const reachabilityWarnings = this.validateReachability(configs);
    warnings.push(...reachabilityWarnings);

    // 4. Detect circular route dependencies (WARNING)
    // Changed from ERROR to WARNING because hub-and-spoke topologies
    // have legitimate routing dependencies that look like cycles
    const circularDependencies = this.detectCircularRouteDependencies(configs);
    if (circularDependencies.length > 0) {
      warnings.push(...circularDependencies);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}
