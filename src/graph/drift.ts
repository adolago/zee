/**
 * Drift Detection
 *
 * Detects differences between desired state and actual infrastructure.
 */

import type {
  ResourceState,
  DriftReport,
  DriftedResource,
  AttributeChange,
} from './types.js';
import { Log } from '../../packages/zee-core/src/util/log';

const log = Log.create({ service: 'graph-drift' });

// =============================================================================
// Provider Interface
// =============================================================================

/**
 * Interface for providers to implement real resource inspection.
 */
export interface DriftProvider {
  /** Provider name */
  readonly name: string;

  /**
   * Read actual state of a resource from the provider.
   */
  readResource(state: ResourceState): Promise<Record<string, unknown> | null>;

  /**
   * List all resources of a given type.
   */
  listResources?(type: string): Promise<string[]>;
}

// =============================================================================
// Drift Detector
// =============================================================================

export interface DriftOptions {
  /** Providers to use for drift detection */
  providers: DriftProvider[];
  /** Attributes to ignore in comparison */
  ignoreAttributes?: string[];
  /** Whether to include computed attributes */
  includeComputed?: boolean;
}

export class DriftDetector {
  private options: DriftOptions;

  constructor(options: DriftOptions) {
    this.options = {
      ignoreAttributes: [],
      includeComputed: false,
      ...options,
    };
  }

  /**
   * Detect drift between desired state and actual infrastructure.
   */
  async detect(expectedResources: ResourceState[]): Promise<DriftReport> {
    const drifted: DriftedResource[] = [];
    const missing: string[] = [];

    log.info('Starting drift detection', { resourceCount: expectedResources.length });

    for (const expected of expectedResources) {
      try {
        const actual = await this.readActualState(expected);

        if (actual === null) {
          // Resource doesn't exist in real world
          missing.push(expected.address);
          log.warn('Resource missing from infrastructure', { address: expected.address });
          continue;
        }

        const differences = this.compareAttributes(expected.attributes, actual);

        if (differences.length > 0) {
          drifted.push({
            address: expected.address,
            expected: expected.attributes,
            actual,
            differences,
          });
          log.info('Drift detected', {
            address: expected.address,
            diffCount: differences.length,
          });
        }
      } catch (error) {
        log.error('Error checking resource', {
          address: expected.address,
          error: error instanceof Error ? error.message : String(error),
        });
        // Treat as missing if we can't read it
        missing.push(expected.address);
      }
    }

    // Check for orphaned resources (in actual but not in expected)
    const orphaned = await this.findOrphanedResources(expectedResources);

    const report: DriftReport = {
      timestamp: new Date().toISOString(),
      drifted,
      missing,
      orphaned,
    };

    log.info('Drift detection complete', {
      drifted: drifted.length,
      missing: missing.length,
      orphaned: orphaned.length,
    });

    return report;
  }

  /**
   * Read actual state from provider.
   */
  private async readActualState(
    expected: ResourceState
  ): Promise<Record<string, unknown> | null> {
    const provider = this.findProvider(expected.provider);

    if (!provider) {
      throw new Error(`No provider found for ${expected.provider}`);
    }

    return await provider.readResource(expected);
  }

  /**
   * Find the appropriate provider for a resource.
   */
  private findProvider(providerName: string): DriftProvider | undefined {
    return this.options.providers.find((p) =>
      providerName.startsWith(p.name)
    );
  }

  /**
   * Compare expected and actual attributes.
   */
  private compareAttributes(
    expected: Record<string, unknown>,
    actual: Record<string, unknown>
  ): AttributeChange[] {
    const differences: AttributeChange[] = [];
    const allKeys = new Set([
      ...Object.keys(expected),
      ...Object.keys(actual),
    ]);

    for (const key of allKeys) {
      // Skip ignored attributes
      if (this.options.ignoreAttributes?.includes(key)) {
        continue;
      }

      const expectedValue = expected[key];
      const actualValue = actual[key];

      // Handle nested objects recursively
      if (
        typeof expectedValue === 'object' &&
        expectedValue !== null &&
        !Array.isArray(expectedValue) &&
        typeof actualValue === 'object' &&
        actualValue !== null &&
        !Array.isArray(actualValue)
      ) {
        const nestedDiffs = this.compareAttributes(
          expectedValue as Record<string, unknown>,
          actualValue as Record<string, unknown>
        );
        for (const diff of nestedDiffs) {
          differences.push({
            path: `${key}.${diff.path}`,
            old: diff.old,
            new: diff.new,
            computed: diff.computed,
          });
        }
        continue;
      }

      // Compare values
      if (!this.valuesEqual(expectedValue, actualValue)) {
        differences.push({
          path: key,
          old: actualValue,
          new: expectedValue,
          computed: this.isComputed(expectedValue),
        });
      }
    }

    return differences;
  }

  /**
   * Check if two values are equal.
   */
  private valuesEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;

    // Handle arrays
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((val, idx) => this.valuesEqual(val, b[idx]));
    }

    // Handle objects
    if (typeof a === 'object' && typeof b === 'object') {
      const keysA = Object.keys(a);
      const keysB = Object.keys(b);
      if (keysA.length !== keysB.length) return false;

      for (const key of keysA) {
        if (!(key in b)) return false;
        if (!this.valuesEqual((a as any)[key], (b as any)[key])) {
          return false;
        }
      }
      return true;
    }

    return false;
  }

  /**
   * Check if a value is computed (placeholder).
   */
  private isComputed(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    return (
      value.startsWith('(known after apply)') ||
      value.startsWith('${') ||
      value === 'computed'
    );
  }

  /**
   * Find orphaned resources (exist in real world but not in state).
   */
  private async findOrphanedResources(
    expectedResources: ResourceState[]
  ): Promise<string[]> {
    const orphaned: string[] = [];
    const expectedAddresses = new Set(expectedResources.map((r) => r.address));

    // Group resources by type for efficient listing
    const resourcesByType = this.groupByType(expectedResources);

    for (const [type, resources] of resourcesByType) {
      for (const provider of this.options.providers) {
        if (!provider.listResources) continue;

        try {
          const actualIds = await provider.listResources(type);
          const expectedIds = new Set(resources.map((r) => r.name));

          for (const id of actualIds) {
            const address = `${type}.${id}`;
            if (!expectedAddresses.has(address) && !expectedIds.has(id)) {
              orphaned.push(address);
            }
          }
        } catch (error) {
          log.debug('Provider does not support listing', {
            provider: provider.name,
            type,
          });
        }
      }
    }

    return orphaned;
  }

  private groupByType(
    resources: ResourceState[]
  ): Map<string, ResourceState[]> {
    const groups = new Map<string, ResourceState[]>();

    for (const resource of resources) {
      const list = groups.get(resource.type) || [];
      list.push(resource);
      groups.set(resource.type, list);
    }

    return groups;
  }

  /**
   * Format drift report as human-readable text.
   */
  formatReport(report: DriftReport): string {
    const lines: string[] = [];

    lines.push('Drift Detection Report');
    lines.push('======================');
    lines.push(`Timestamp: ${report.timestamp}`);
    lines.push('');

    if (report.drifted.length > 0) {
      lines.push(`Drifted Resources (${report.drifted.length}):`);
      lines.push('');

      for (const resource of report.drifted) {
        lines.push(`  ! ${resource.address}`);
        for (const diff of resource.differences) {
          lines.push(`      ~ ${diff.path}:`);
          lines.push(`          expected: ${this.formatValue(diff.new)}`);
          lines.push(`          actual:   ${this.formatValue(diff.old)}`);
        }
        lines.push('');
      }
    }

    if (report.missing.length > 0) {
      lines.push(`Missing Resources (${report.missing.length}):`);
      for (const address of report.missing) {
        lines.push(`  - ${address}`);
      }
      lines.push('');
    }

    if (report.orphaned.length > 0) {
      lines.push(`Orphaned Resources (${report.orphaned.length}):`);
      for (const address of report.orphaned) {
        lines.push(`  + ${address}`);
      }
      lines.push('');
    }

    if (
      report.drifted.length === 0 &&
      report.missing.length === 0 &&
      report.orphaned.length === 0
    ) {
      lines.push('No drift detected. Infrastructure matches configuration.');
    }

    return lines.join('\n');
  }

  private formatValue(value: unknown): string {
    if (value === undefined) return 'null';
    if (value === null) return 'null';
    if (typeof value === 'string') return `"${value}"`;
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value);
  }
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Quick drift detection.
 */
export async function detectDrift(
  expectedResources: ResourceState[],
  providers: DriftProvider[]
): Promise<DriftReport> {
  const detector = new DriftDetector({ providers });
  return await detector.detect(expectedResources);
}
