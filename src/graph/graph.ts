/**
 * Resource Graph
 *
 * Directed acyclic graph (DAG) for resource dependencies.
 * Implements topological sorting with stable ordering.
 */

import type {
  Node,
  GraphEdge,
  GraphVisitor,
  WalkOptions,
  SourceLocation,
} from './types.js';
import { Log } from '../../packages/zee/src/util/log';

const log = Log.create({ service: 'resource-graph' });

// =============================================================================
// Graph Error
// =============================================================================

export class GraphError extends Error {
  constructor(
    message: string,
    public readonly code: 'CYCLE' | 'MISSING_NODE' | 'DUPLICATE_NODE' | 'INVALID_EDGE'
  ) {
    super(message);
    this.name = 'GraphError';
  }
}

// =============================================================================
// Resource Graph
// =============================================================================

export class ResourceGraph {
  private nodes = new Map<string, Node>();
  private edges = new Map<string, Set<string>>();
  private reverseEdges = new Map<string, Set<string>>();
  private sortedCache: string[] | null = null;

  /**
   * Add a node to the graph.
   */
  addNode(node: Node): void {
    if (this.nodes.has(node.id)) {
      throw new GraphError(
        `Node with id '${node.id}' already exists`,
        'DUPLICATE_NODE'
      );
    }

    this.nodes.set(node.id, node);
    this.edges.set(node.id, new Set());
    this.reverseEdges.set(node.id, new Set());
    this.sortedCache = null; // Invalidate cache

    log.debug('Added node to graph', { nodeId: node.id, type: node.type });
  }

  /**
   * Remove a node and all its edges from the graph.
   */
  removeNode(nodeId: string): boolean {
    const node = this.nodes.get(nodeId);
    if (!node) return false;

    // Remove outgoing edges
    const outgoing = this.edges.get(nodeId);
    if (outgoing) {
      for (const target of outgoing) {
        this.reverseEdges.get(target)?.delete(nodeId);
      }
    }

    // Remove incoming edges
    const incoming = this.reverseEdges.get(nodeId);
    if (incoming) {
      for (const source of incoming) {
        this.edges.get(source)?.delete(nodeId);
      }
    }

    this.nodes.delete(nodeId);
    this.edges.delete(nodeId);
    this.reverseEdges.delete(nodeId);
    this.sortedCache = null;

    log.debug('Removed node from graph', { nodeId });
    return true;
  }

  /**
   * Add an edge between two nodes.
   */
  addEdge(from: string, to: string): void {
    // Validate nodes exist
    if (!this.nodes.has(from)) {
      throw new GraphError(`Source node '${from}' not found`, 'MISSING_NODE');
    }
    if (!this.nodes.has(to)) {
      throw new GraphError(`Target node '${to}' not found`, 'MISSING_NODE');
    }

    // Check for self-reference
    if (from === to) {
      throw new GraphError(`Self-reference detected for node '${from}'`, 'CYCLE');
    }

    // Check for immediate cycle
    if (this.edges.get(to)?.has(from)) {
      throw new GraphError(
        `Cycle detected: '${to}' already depends on '${from}'`,
        'CYCLE'
      );
    }

    // Add edge
    this.edges.get(from)?.add(to);
    this.reverseEdges.get(to)?.add(from);
    this.sortedCache = null;

    log.debug('Added edge', { from, to });
  }

  /**
   * Remove an edge between two nodes.
   */
  removeEdge(from: string, to: string): boolean {
    const removed = this.edges.get(from)?.delete(to) ?? false;
    this.reverseEdges.get(to)?.delete(from);
    if (removed) {
      this.sortedCache = null;
    }
    return removed;
  }

  /**
   * Get a node by ID.
   */
  getNode(nodeId: string): Node | undefined {
    return this.nodes.get(nodeId);
  }

  /**
   * Get all nodes in the graph.
   */
  getAllNodes(): Node[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Get nodes of a specific type.
   */
  getNodesByType<T extends Node['type']>(type: T): Extract<Node, { type: T }>[] {
    return this.getAllNodes().filter((n): n is Extract<Node, { type: T }> => n.type === type);
  }

  /**
   * Check if a node exists.
   */
  hasNode(nodeId: string): boolean {
    return this.nodes.has(nodeId);
  }

  /**
   * Get outgoing edges from a node.
   */
  getOutgoing(nodeId: string): string[] {
    return Array.from(this.edges.get(nodeId) ?? []);
  }

  /**
   * Get incoming edges to a node.
   */
  getIncoming(nodeId: string): string[] {
    return Array.from(this.reverseEdges.get(nodeId) ?? []);
  }

  /**
   * Get direct dependencies of a node.
   */
  getDependencies(nodeId: string): Node[] {
    return this.getIncoming(nodeId)
      .map((id) => this.nodes.get(id))
      .filter((n): n is Node => n !== undefined);
  }

  /**
   * Get nodes that depend on a given node.
   */
  getDependents(nodeId: string): Node[] {
    return this.getOutgoing(nodeId)
      .map((id) => this.nodes.get(id))
      .filter((n): n is Node => n !== undefined);
  }

  /**
   * Get all ancestors (transitive dependencies) of a node.
   */
  getAncestors(nodeId: string): Node[] {
    const ancestors = new Set<string>();
    const queue = [nodeId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const parent of this.getIncoming(current)) {
        if (!ancestors.has(parent)) {
          ancestors.add(parent);
          queue.push(parent);
        }
      }
    }

    return Array.from(ancestors)
      .map((id) => this.nodes.get(id))
      .filter((n): n is Node => n !== undefined);
  }

  /**
   * Get all descendants (transitive dependents) of a node.
   */
  getDescendants(nodeId: string): Node[] {
    const descendants = new Set<string>();
    const queue = [nodeId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const child of this.getOutgoing(current)) {
        if (!descendants.has(child)) {
          descendants.add(child);
          queue.push(child);
        }
      }
    }

    return Array.from(descendants)
      .map((id) => this.nodes.get(id))
      .filter((n): n is Node => n !== undefined);
  }

  /**
   * Perform topological sort with stable ordering.
   *
   * Uses Kahn's algorithm with alphabetical tie-breaking for determinism.
   * Returns nodes in dependency order (dependencies before dependents).
   */
  topologicalSort(): string[] {
    // Return cached result if available
    if (this.sortedCache) {
      return [...this.sortedCache];
    }

    // Calculate in-degrees
    const inDegree = new Map<string, number>();
    for (const [nodeId, edges] of this.edges) {
      inDegree.set(nodeId, edges.size);
    }

    // Find all nodes with no incoming edges
    const queue: string[] = [];
    for (const [nodeId, degree] of inDegree) {
      if (degree === 0) {
        queue.push(nodeId);
      }
    }

    // Sort queue alphabetically for stable ordering
    queue.sort();

    const sorted: string[] = [];

    while (queue.length > 0) {
      // Take first alphabetically
      const current = queue.shift()!;
      sorted.push(current);

      // Update in-degrees of neighbors
      const neighbors = this.getOutgoing(current);
      neighbors.sort(); // Stable ordering

      for (const neighbor of neighbors) {
        const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDegree);

        if (newDegree === 0) {
          // Insert in sorted position to maintain alphabetical order
          const insertIndex = queue.findIndex((id) => id > neighbor);
          if (insertIndex === -1) {
            queue.push(neighbor);
          } else {
            queue.splice(insertIndex, 0, neighbor);
          }
        }
      }
    }

    // Check for cycles
    if (sorted.length !== this.nodes.size) {
      // Find nodes in cycle
      const remaining = Array.from(this.nodes.keys()).filter((id) => !sorted.includes(id));
      throw new GraphError(
        `Cycle detected in graph. Remaining nodes: ${remaining.join(', ')}`,
        'CYCLE'
      );
    }

    // Reverse to get dependency-first order (dependencies before dependents)
    // The algorithm gives us dependents-first, so we reverse
    const result = sorted.reverse();

    // Cache result
    this.sortedCache = result;

    log.debug('Topological sort completed', { nodeCount: result.length });
    return [...result];
  }

  /**
   * Walk the graph in topological order.
   */
  async walk(visitor: GraphVisitor, options: WalkOptions = { direction: 'forward' }): Promise<void> {
    const sorted = this.topologicalSort();
    const order = options.direction === 'reverse' ? sorted : [...sorted].reverse();

    if (options.parallel) {
      await this.walkParallel(order, visitor, options);
    } else {
      await this.walkSequential(order, visitor, options);
    }
  }

  private async walkSequential(
    order: string[],
    visitor: GraphVisitor,
    options: WalkOptions
  ): Promise<void> {
    for (const nodeId of order) {
      const node = this.nodes.get(nodeId);
      if (!node) continue;

      try {
        await visitor(node);
      } catch (error) {
        if (options.onError) {
          options.onError(node, error as Error);
        } else {
          throw error;
        }
      }
    }
  }

  private async walkParallel(
    order: string[],
    visitor: GraphVisitor,
    options: WalkOptions
  ): Promise<void> {
    const maxParallel = options.maxParallel ?? 4;
    const completed = new Set<string>();
    const inProgress = new Set<string>();
    const errors: Error[] = [];

    const canVisit = (nodeId: string): boolean => {
      // Check all dependencies are completed
      const dependencies = this.getIncoming(nodeId);
      return dependencies.every((dep) => completed.has(dep));
    };

    const visitNode = async (nodeId: string): Promise<void> => {
      const node = this.nodes.get(nodeId);
      if (!node || completed.has(nodeId) || inProgress.has(nodeId)) return;

      inProgress.add(nodeId);

      try {
        await visitor(node);
        completed.add(nodeId);
      } catch (error) {
        if (options.onError) {
          options.onError(node, error as Error);
        } else {
          errors.push(error as Error);
        }
      } finally {
        inProgress.delete(nodeId);
      }
    };

    const processBatch = async (): Promise<void> => {
      const batch: string[] = [];

      for (const nodeId of order) {
        if (completed.has(nodeId) || inProgress.has(nodeId)) continue;
        if (canVisit(nodeId)) {
          batch.push(nodeId);
          if (batch.length >= maxParallel) break;
        }
      }

      if (batch.length === 0) return;

      await Promise.all(batch.map(visitNode));

      if (errors.length > 0) {
        throw errors[0];
      }

      // Continue processing
      await processBatch();
    };

    await processBatch();
  }

  /**
   * Detect cycles in the graph.
   */
  detectCycles(): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (nodeId: string, path: string[]): void => {
      visited.add(nodeId);
      recursionStack.add(nodeId);

      for (const neighbor of this.getOutgoing(nodeId)) {
        if (!visited.has(neighbor)) {
          dfs(neighbor, [...path, neighbor]);
        } else if (recursionStack.has(neighbor)) {
          // Found cycle
          const cycleStart = path.indexOf(neighbor);
          const cycle = path.slice(cycleStart);
          cycles.push(cycle);
        }
      }

      recursionStack.delete(nodeId);
    };

    for (const nodeId of this.nodes.keys()) {
      if (!visited.has(nodeId)) {
        dfs(nodeId, [nodeId]);
      }
    }

    return cycles;
  }

  /**
   * Get the transitive reduction of the graph.
   * Removes redundant edges while preserving reachability.
   */
  transitiveReduction(): ResourceGraph {
    const reduced = new ResourceGraph();

    // Copy all nodes
    for (const node of this.nodes.values()) {
      reduced.addNode(node);
    }

    // Copy only non-redundant edges
    for (const [from, toSet] of this.edges) {
      for (const to of toSet) {
        // Check if there's an indirect path
        const hasIndirectPath = this.hasIndirectPath(from, to, new Set([from, to]));
        if (!hasIndirectPath) {
          reduced.addEdge(from, to);
        }
      }
    }

    return reduced;
  }

  private hasIndirectPath(from: string, to: string, visited: Set<string>): boolean {
    for (const neighbor of this.getOutgoing(from)) {
      if (neighbor === to) continue; // Skip direct edge
      if (visited.has(neighbor)) continue;

      if (neighbor === to) return true;

      visited.add(neighbor);
      if (this.hasIndirectPath(neighbor, to, visited)) {
        return true;
      }
      visited.delete(neighbor);
    }
    return false;
  }

  /**
   * Create a subgraph containing only the specified nodes and their dependencies.
   */
  subgraph(nodeIds: string[]): ResourceGraph {
    const subgraph = new ResourceGraph();
    const included = new Set<string>();

    // Include all specified nodes and their dependencies
    const queue = [...nodeIds];
    for (const id of queue) {
      if (included.has(id)) continue;

      const node = this.nodes.get(id);
      if (!node) continue;

      included.add(id);
      subgraph.addNode(node);

      // Add dependencies
      for (const dep of this.getIncoming(id)) {
        if (!included.has(dep)) {
          queue.push(dep);
        }
      }
    }

    // Add edges between included nodes
    for (const from of included) {
      for (const to of this.getOutgoing(from)) {
        if (included.has(to)) {
          subgraph.addEdge(from, to);
        }
      }
    }

    return subgraph;
  }

  /**
   * Clear the graph.
   */
  clear(): void {
    this.nodes.clear();
    this.edges.clear();
    this.reverseEdges.clear();
    this.sortedCache = null;
  }

  /**
   * Get graph statistics.
   */
  getStats(): { nodes: number; edges: number } {
    let edgeCount = 0;
    for (const edges of this.edges.values()) {
      edgeCount += edges.size;
    }
    return {
      nodes: this.nodes.size,
      edges: edgeCount,
    };
  }

  /**
   * Serialize graph to DOT format for visualization.
   */
  toDOT(): string {
    const lines = ['digraph resource_graph {'];

    // Add nodes
    for (const [id, node] of this.nodes) {
      const label = `${node.type}:${node.name}`;
      lines.push(`  "${id}" [label="${label}"];`);
    }

    // Add edges
    for (const [from, toSet] of this.edges) {
      for (const to of toSet) {
        lines.push(`  "${from}" -> "${to}";`);
      }
    }

    lines.push('}');
    return lines.join('\n');
  }
}
