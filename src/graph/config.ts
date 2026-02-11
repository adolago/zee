/**
 * Graph Configuration Parser
 *
 * Parses configuration files and builds resource graphs.
 */

import type {
  Node,
  ResourceNode,
  DataNode,
  ProviderNode,
  ModuleNode,
  OutputNode,
  VariableNode,
  SourceLocation,
} from './types.js';
import { ResourceGraph, GraphError } from './graph.js';
import { Log } from '../../packages/zee/src/util/log';

const log = Log.create({ service: 'graph-config' });

// =============================================================================
// Configuration Types
// =============================================================================

/** Raw configuration file structure */
export interface ConfigFile {
  /** Variables */
  variable?: Record<string, VariableConfig>;
  /** Providers */
  provider?: Record<string, ProviderConfig | ProviderConfig[]>;
  /** Resources */
  resource?: Record<string, Record<string, ResourceConfig>>;
  /** Data sources */
  data?: Record<string, Record<string, DataConfig>>;
  /** Modules */
  module?: Record<string, ModuleConfig>;
  /** Outputs */
  output?: Record<string, OutputConfig>;
  /** Terraform settings */
  terraform?: TerraformConfig;
}

export interface VariableConfig {
  type?: string;
  default?: unknown;
  description?: string;
  sensitive?: boolean;
}

export interface ProviderConfig {
  alias?: string;
  version?: string;
  [key: string]: unknown;
}

export interface ResourceConfig {
  provider?: string;
  depends_on?: string[];
  lifecycle?: {
    prevent_destroy?: boolean;
    ignore_changes?: string[];
    replace_triggered_by?: string[];
    create_before_destroy?: boolean;
  };
  [key: string]: unknown;
}

export interface DataConfig {
  provider?: string;
  depends_on?: string[];
  [key: string]: unknown;
}

export interface ModuleConfig {
  source: string;
  version?: string;
  [key: string]: unknown;
}

export interface OutputConfig {
  value: unknown;
  sensitive?: boolean;
  description?: string;
}

export interface TerraformConfig {
  required_providers?: Record<string, {
    source?: string;
    version?: string;
  }>;
  backend?: {
    type: string;
    [key: string]: unknown;
  };
}

// =============================================================================
// Graph Builder
// =============================================================================

export class GraphBuilder {
  private graph = new ResourceGraph();
  private configFiles = new Map<string, ConfigFile>();

  /**
   * Add a configuration file to be parsed.
   */
  addConfig(path: string, config: ConfigFile): void {
    this.configFiles.set(path, config);
  }

  /**
   * Build the resource graph from all added configurations.
   */
  build(modulePath: string = ''): ResourceGraph {
    this.graph.clear();

    // Process each configuration file
    for (const [path, config] of this.configFiles) {
      this.processConfig(path, config, modulePath);
    }

    // Wire dependencies
    this.wireDependencies();

    log.info('Graph build complete', this.graph.getStats());
    return this.graph;
  }

  private processConfig(path: string, config: ConfigFile, modulePath: string): void {
    const source: SourceLocation = { file: path, line: 0, column: 0 };

    // Process variables
    if (config.variable) {
      for (const [name, varConfig] of Object.entries(config.variable)) {
        this.addVariable(name, varConfig, modulePath, source);
      }
    }

    // Process providers
    if (config.provider) {
      for (const [name, provConfig] of Object.entries(config.provider)) {
        const configs = Array.isArray(provConfig) ? provConfig : [provConfig];
        for (const pc of configs) {
          this.addProvider(name, pc, modulePath, source);
        }
      }
    }

    // Process resources
    if (config.resource) {
      for (const [type, resources] of Object.entries(config.resource)) {
        for (const [name, resConfig] of Object.entries(resources)) {
          this.addResource(type, name, resConfig, modulePath, source);
        }
      }
    }

    // Process data sources
    if (config.data) {
      for (const [type, dataSources] of Object.entries(config.data)) {
        for (const [name, dataConfig] of Object.entries(dataSources)) {
          this.addDataSource(type, name, dataConfig, modulePath, source);
        }
      }
    }

    // Process modules
    if (config.module) {
      for (const [name, modConfig] of Object.entries(config.module)) {
        this.addModule(name, modConfig, modulePath, source);
      }
    }

    // Process outputs
    if (config.output) {
      for (const [name, outConfig] of Object.entries(config.output)) {
        this.addOutput(name, outConfig, modulePath, source);
      }
    }
  }

  private addVariable(
    name: string,
    config: VariableConfig,
    modulePath: string,
    source: SourceLocation
  ): void {
    const id = this.makeId('var', name, modulePath);
    const node: VariableNode = {
      id,
      type: 'variable',
      name,
      module: modulePath,
      source,
      default: config.default,
      varType: config.type,
      description: config.description,
      sensitive: config.sensitive ?? false,
    };
    this.graph.addNode(node);
  }

  private addProvider(
    name: string,
    config: ProviderConfig,
    modulePath: string,
    source: SourceLocation
  ): void {
    const alias = config.alias ?? 'default';
    const id = this.makeId('provider', `${name}.${alias}`, modulePath);

    // Extract config without metadata fields
    const { alias: _, version, ...providerConfig } = config;

    const node: ProviderNode = {
      id,
      type: 'provider',
      name: `${name}.${alias}`,
      module: modulePath,
      source,
      providerName: name,
      alias,
      config: providerConfig,
      version,
    };
    this.graph.addNode(node);
  }

  private addResource(
    type: string,
    name: string,
    config: ResourceConfig,
    modulePath: string,
    source: SourceLocation
  ): void {
    const id = this.makeId('resource', `${type}.${name}`, modulePath);

    // Extract config without metadata fields
    const { provider, depends_on, lifecycle, ...resourceConfig } = config;

    const node: ResourceNode = {
      id,
      type: 'resource',
      name,
      module: modulePath,
      source,
      resourceType: type,
      config: resourceConfig,
      dependsOn: depends_on ?? [],
      provider: provider ?? type.split('_')[0],
      lifecycle: lifecycle ? {
        preventDestroy: lifecycle.prevent_destroy,
        ignoreChanges: lifecycle.ignore_changes,
        replaceTriggeredBy: lifecycle.replace_triggered_by,
        createBeforeDestroy: lifecycle.create_before_destroy,
      } : undefined,
    };
    this.graph.addNode(node);
  }

  private addDataSource(
    type: string,
    name: string,
    config: DataConfig,
    modulePath: string,
    source: SourceLocation
  ): void {
    const id = this.makeId('data', `${type}.${name}`, modulePath);

    // Extract config without metadata fields
    const { provider, depends_on, ...dataConfig } = config;

    const node: DataNode = {
      id,
      type: 'data',
      name,
      module: modulePath,
      source,
      dataType: type,
      config: dataConfig,
      dependsOn: depends_on ?? [],
      provider: provider ?? type.split('_')[0],
    };
    this.graph.addNode(node);
  }

  private addModule(
    name: string,
    config: ModuleConfig,
    modulePath: string,
    source: SourceLocation
  ): void {
    const id = this.makeId('module', name, modulePath);

    // Extract config without metadata fields
    const { source: modSource, version, ...inputs } = config;

    const node: ModuleNode = {
      id,
      type: 'module',
      name,
      module: modulePath,
      source,
      source: modSource,
      inputs,
      version,
    };
    this.graph.addNode(node);
  }

  private addOutput(
    name: string,
    config: OutputConfig,
    modulePath: string,
    source: SourceLocation
  ): void {
    const id = this.makeId('output', name, modulePath);
    const node: OutputNode = {
      id,
      type: 'output',
      name,
      module: modulePath,
      source,
      value: config.value,
      sensitive: config.sensitive ?? false,
      description: config.description,
    };
    this.graph.addNode(node);
  }

  private makeId(type: string, name: string, modulePath: string): string {
    if (modulePath) {
      return `${modulePath}.${type}.${name}`;
    }
    return `${type}.${name}`;
  }

  private wireDependencies(): void {
    const nodes = this.graph.getAllNodes();

    for (const node of nodes) {
      if (node.type === 'resource') {
        this.wireResourceDependencies(node);
      } else if (node.type === 'data') {
        this.wireDataDependencies(node);
      } else if (node.type === 'output') {
        this.wireOutputDependencies(node);
      } else if (node.type === 'module') {
        this.wireModuleDependencies(node);
      }
    }
  }

  private wireResourceDependencies(node: ResourceNode): void {
    // Wire explicit dependencies
    for (const dep of node.dependsOn) {
      const depId = this.resolveReference(dep, node.module);
      if (depId && this.graph.hasNode(depId)) {
        this.graph.addEdge(node.id, depId);
      }
    }

    // Wire provider dependency
    const providerId = this.findProvider(node.provider, node.module);
    if (providerId) {
      this.graph.addEdge(node.id, providerId);
    }

    // Wire implicit dependencies from configuration references
    const refs = this.extractReferences(node.config);
    for (const ref of refs) {
      const refId = this.resolveReference(ref, node.module);
      if (refId && refId !== node.id && this.graph.hasNode(refId)) {
        this.graph.addEdge(node.id, refId);
      }
    }
  }

  private wireDataDependencies(node: DataNode): void {
    // Wire explicit dependencies
    for (const dep of node.dependsOn) {
      const depId = this.resolveReference(dep, node.module);
      if (depId && this.graph.hasNode(depId)) {
        this.graph.addEdge(node.id, depId);
      }
    }

    // Wire provider dependency
    const providerId = this.findProvider(node.provider, node.module);
    if (providerId) {
      this.graph.addEdge(node.id, providerId);
    }
  }

  private wireOutputDependencies(node: OutputNode): void {
    const refs = this.extractReferences(node.value);
    for (const ref of refs) {
      const refId = this.resolveReference(ref, node.module);
      if (refId && this.graph.hasNode(refId)) {
        this.graph.addEdge(node.id, refId);
      }
    }
  }

  private wireModuleDependencies(node: ModuleNode): void {
    const refs = this.extractReferences(node.inputs);
    for (const ref of refs) {
      const refId = this.resolveReference(ref, node.module);
      if (refId && this.graph.hasNode(refId)) {
        this.graph.addEdge(node.id, refId);
      }
    }
  }

  private findProvider(name: string, modulePath: string): string | null {
    // Try module-local provider first
    if (modulePath) {
      const localId = `${modulePath}.provider.${name}.default`;
      if (this.graph.hasNode(localId)) {
        return localId;
      }
    }

    // Try root provider
    const rootId = `provider.${name}.default`;
    if (this.graph.hasNode(rootId)) {
      return rootId;
    }

    return null;
  }

  private resolveReference(ref: string, modulePath: string): string | null {
    // Handle different reference types
    // var.x -> variable.x
    // aws_instance.x -> resource.aws_instance.x
    // module.x -> module.x
    // data.aws_ami.x -> data.aws_ami.x

    if (ref.startsWith('var.')) {
      const varName = ref.slice(4);
      return modulePath
        ? `${modulePath}.var.${varName}`
        : `var.${varName}`;
    }

    if (ref.startsWith('module.')) {
      const modPath = ref.slice(7);
      return modulePath
        ? `${modulePath}.module.${modPath}`
        : `module.${modPath}`;
    }

    if (ref.startsWith('data.')) {
      const parts = ref.split('.');
      if (parts.length >= 3) {
        const dataType = parts[1];
        const dataName = parts[2];
        return modulePath
          ? `${modulePath}.data.${dataType}.${dataName}`
          : `data.${dataType}.${dataName}`;
      }
    }

    // Assume it's a resource reference
    const parts = ref.split('.');
    if (parts.length >= 2) {
      const resType = parts[0];
      const resName = parts[1];
      return modulePath
        ? `${modulePath}.resource.${resType}.${resName}`
        : `resource.${resType}.${resName}`;
    }

    return null;
  }

  private extractReferences(value: unknown): string[] {
    const refs: string[] = [];
    const seen = new Set<unknown>();

    const traverse = (v: unknown): void => {
      if (seen.has(v)) return;
      seen.add(v);

      if (typeof v === 'string') {
        // Look for interpolation syntax: ${...}
        const matches = v.match(/\$\{([^}]+)\}/g);
        if (matches) {
          for (const match of matches) {
            const ref = match.slice(2, -1); // Remove ${ and }
            refs.push(ref);
          }
        }
      } else if (Array.isArray(v)) {
        for (const item of v) {
          traverse(item);
        }
      } else if (typeof v === 'object' && v !== null) {
        for (const val of Object.values(v)) {
          traverse(val);
        }
      }
    };

    traverse(value);
    return [...new Set(refs)]; // Deduplicate
  }
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Build a resource graph from a configuration file.
 */
export function buildGraph(config: ConfigFile, modulePath: string = ''): ResourceGraph {
  const builder = new GraphBuilder();
  builder.addConfig('main.tf', config);
  return builder.build(modulePath);
}

/**
 * Validate that a configuration produces a valid graph.
 */
export function validateConfig(config: ConfigFile): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  try {
    const graph = buildGraph(config);

    // Check for cycles
    const cycles = graph.detectCycles();
    if (cycles.length > 0) {
      for (const cycle of cycles) {
        errors.push(`Cycle detected: ${cycle.join(' -> ')}`);
      }
    }
  } catch (error) {
    if (error instanceof GraphError) {
      errors.push(error.message);
    } else {
      errors.push(String(error));
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
