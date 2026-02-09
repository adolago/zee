/**
 * Diff Engine
 *
 * Compares desired and actual state to produce resource changes.
 */

import type {
  ResourceState,
  ResourceChange,
  AttributeChange,
  ChangeType,
  Plan,
} from './types.js';
import { Log } from '../../packages/zee-core/src/util/log';

const log = Log.create({ service: 'graph-diff' });

// =============================================================================
// Diff Options
// =============================================================================

export interface DiffOptions {
  /** Ignore computed attributes */
  ignoreComputed?: boolean;
  /** Ignore sensitive attributes in comparison */
  ignoreSensitive?: boolean;
  /** Attributes that trigger replacement */
  forceNewAttributes?: string[];
  /** Custom attribute comparators */
  comparators?: Record<string, (a: unknown, b: unknown) => boolean>;
}

// =============================================================================
// Diff Engine
// =============================================================================

export class DiffEngine {
  private options: DiffOptions;

  constructor(options: DiffOptions = {}) {
    this.options = {
      ignoreComputed: true,
      ignoreSensitive: false,
      forceNewAttributes: [],
      ...options,
    };
  }

  /**
   * Compare desired state with actual state to produce a plan.
   */
  diff(
    desired: Map<string, ResourceState>,
    actual: Map<string, ResourceState>
  ): Plan {
    const changes: ResourceChange[] = [];

    // Find resources to create or update
    for (const [address, desiredState] of desired) {
      const actualState = actual.get(address);

      if (!actualState) {
        // Resource doesn't exist - create
        changes.push(this.createChange(address, desiredState));
      } else {
        // Resource exists - check for updates
        const change = this.updateChange(address, desiredState, actualState);
        if (change) {
          changes.push(change);
        }
      }
    }

    // Find resources to delete
    for (const [address, actualState] of actual) {
      if (!desired.has(address)) {
        changes.push(this.deleteChange(address, actualState));
      }
    }

    // Sort changes by dependency order (create before delete for replacements)
    const sortedChanges = this.sortChanges(changes);

    return {
      version: 1,
      changes: sortedChanges,
      outputs: {},
      variables: {},
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Compare a single resource's desired and actual state.
   */
  diffResource(
    address: string,
    desired: ResourceState | null,
    actual: ResourceState | null
  ): ResourceChange | null {
    if (!desired && !actual) {
      return null;
    }

    if (!desired) {
      return this.deleteChange(address, actual!);
    }

    if (!actual) {
      return this.createChange(address, desired);
    }

    return this.updateChange(address, desired, actual);
  }

  private createChange(address: string, desired: ResourceState): ResourceChange {
    return {
      address,
      action: 'create',
      before: null,
      after: desired,
      changes: Object.entries(desired.attributes).map(([path, value]) => ({
        path,
        old: undefined,
        new: value,
        computed: false,
      })),
      requiresReplace: false,
    };
  }

  private deleteChange(address: string, actual: ResourceState): ResourceChange {
    return {
      address,
      action: 'delete',
      before: actual,
      after: null,
      changes: Object.keys(actual.attributes).map((path) => ({
        path,
        old: actual.attributes[path],
        new: undefined,
        computed: false,
      })),
      requiresReplace: false,
    };
  }

  private updateChange(
    address: string,
    desired: ResourceState,
    actual: ResourceState
  ): ResourceChange | null {
    const changes = this.compareAttributes(
      desired.attributes,
      actual.attributes,
      ''
    );

    if (changes.length === 0) {
      // No changes - resource is up to date
      return null;
    }

    // Check if any changes require replacement
    const requiresReplace = this.requiresReplace(changes, desired);
    const action: ChangeType = requiresReplace ? 'replace' : 'update';

    return {
      address,
      action,
      before: actual,
      after: desired,
      changes,
      requiresReplace,
      replaceReason: requiresReplace
        ? this.getReplaceReason(changes)
        : undefined,
    };
  }

  private compareAttributes(
    desired: Record<string, unknown>,
    actual: Record<string, unknown>,
    prefix: string
  ): AttributeChange[] {
    const changes: AttributeChange[] = [];
    const allKeys = new Set([...Object.keys(desired), ...Object.keys(actual)]);

    for (const key of allKeys) {
      const path = prefix ? `${prefix}.${key}` : key;
      const desiredValue = desired[key];
      const actualValue = actual[key];

      // Skip if both are undefined/null
      if (desiredValue == null && actualValue == null) {
        continue;
      }

      // Handle nested objects
      if (
        typeof desiredValue === 'object' &&
        desiredValue !== null &&
        !Array.isArray(desiredValue) &&
        typeof actualValue === 'object' &&
        actualValue !== null &&
        !Array.isArray(actualValue)
      ) {
        changes.push(
          ...this.compareAttributes(
            desiredValue as Record<string, unknown>,
            actualValue as Record<string, unknown>,
            path
          )
        );
        continue;
      }

      // Handle arrays
      if (Array.isArray(desiredValue) || Array.isArray(actualValue)) {
        if (!this.arraysEqual(desiredValue, actualValue)) {
          changes.push({
            path,
            old: actualValue,
            new: desiredValue,
            computed: false,
          });
        }
        continue;
      }

      // Handle primitive values
      if (!this.valuesEqual(desiredValue, actualValue, path)) {
        changes.push({
          path,
          old: actualValue,
          new: desiredValue,
          computed: this.isComputed(desiredValue),
        });
      }
    }

    return changes;
  }

  private valuesEqual(
    a: unknown,
    b: unknown,
    path: string
  ): boolean {
    // Use custom comparator if provided
    const comparator = this.options.comparators?.[path];
    if (comparator) {
      return comparator(a, b);
    }

    // Handle null/undefined
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;

    // Strict equality for primitives
    return a === b;
  }

  private arraysEqual(a: unknown[] | undefined, b: unknown[] | undefined): boolean {
    if (!a && !b) return true;
    if (!a || !b) return false;
    if (a.length !== b.length) return false;

    for (let i = 0; i < a.length; i++) {
      if (!this.valuesEqual(a[i], b[i], '')) {
        return false;
      }
    }
    return true;
  }

  private isComputed(value: unknown): boolean {
    // Check if value is a computed placeholder
    return (
      typeof value === 'string' &&
      (value.startsWith('(known after apply)') ||
        value.startsWith('${') ||
        value === 'computed')
    );
  }

  private requiresReplace(
    changes: AttributeChange[],
    desired: ResourceState
  ): boolean {
    // Check if any changed attribute triggers replacement
    for (const change of changes) {
      if (this.options.forceNewAttributes?.includes(change.path)) {
        return true;
      }

      // Check resource lifecycle
      if (desired.meta?.replaceTriggeredBy?.includes(change.path)) {
        return true;
      }
    }

    return false;
  }

  private getReplaceReason(changes: AttributeChange[]): string {
    const triggerPaths = changes
      .filter(
        (c) =>
          this.options.forceNewAttributes?.includes(c.path) ||
          c.computed
      )
      .map((c) => c.path);

    if (triggerPaths.length === 0) {
      return 'Resource requires replacement';
    }

    return `Changes to ${triggerPaths.join(', ')} require replacement`;
  }

  private sortChanges(changes: ResourceChange[]): ResourceChange[] {
    // Sort by action: create first, then update, then replace, then delete
    const actionOrder: Record<ChangeType, number> = {
      create: 0,
      update: 1,
      replace: 2,
      delete: 3,
      noop: 4,
    };

    return changes.sort((a, b) => {
      const orderDiff = actionOrder[a.action] - actionOrder[b.action];
      if (orderDiff !== 0) return orderDiff;

      // Within same action, sort alphabetically by address
      return a.address.localeCompare(b.address);
    });
  }

  /**
   * Format a plan as human-readable text.
   */
  formatPlan(plan: Plan): string {
    const lines: string[] = [];

    lines.push('Terraform will perform the following actions:');
    lines.push('');

    for (const change of plan.changes) {
      lines.push(...this.formatChange(change));
      lines.push('');
    }

    // Summary
    const counts = this.summarizeChanges(plan.changes);
    lines.push('Plan: ' + this.formatSummary(counts));

    return lines.join('\n');
  }

  private formatChange(change: ResourceChange): string[] {
    const lines: string[] = [];
    const actionSymbol = this.getActionSymbol(change.action);

    lines.push(`${actionSymbol} ${change.address}`);

    if (change.action === 'create') {
      lines.push('  + resource "' + change.after?.type + '" "' + change.after?.name + '" {');
      for (const attr of change.changes) {
        lines.push(`      + ${attr.path} = ${this.formatValue(attr.new)}`);
      }
      lines.push('  }');
    } else if (change.action === 'delete') {
      lines.push('  - resource "' + change.before?.type + '" "' + change.before?.name + '" {');
      for (const attr of change.changes) {
        lines.push(`      - ${attr.path} = ${this.formatValue(attr.old)}`);
      }
      lines.push('  }');
    } else if (change.action === 'update') {
      lines.push('  ~ resource "' + change.after?.type + '" "' + change.after?.name + '" {');
      for (const attr of change.changes) {
        lines.push(`      ~ ${attr.path} = ${this.formatValue(attr.old)} -> ${this.formatValue(attr.new)}`);
      }
      lines.push('  }');
    } else if (change.action === 'replace') {
      lines.push('  -/+ resource "' + change.after?.type + '" "' + change.after?.name + '" {');
      lines.push(`      # ${change.replaceReason}`);
      for (const attr of change.changes) {
        lines.push(`      ~ ${attr.path} = ${this.formatValue(attr.old)} -> ${this.formatValue(attr.new)}`);
      }
      lines.push('  }');
    }

    return lines;
  }

  private getActionSymbol(action: ChangeType): string {
    switch (action) {
      case 'create':
        return '+';
      case 'delete':
        return '-';
      case 'update':
        return '~';
      case 'replace':
        return '-/+';
      case 'noop':
        return ' ';
    }
  }

  private formatValue(value: unknown): string {
    if (value === undefined) return 'null';
    if (value === null) return 'null';
    if (typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) {
      if (value.length === 0) return '[]';
      return '[\n        ' + value.map((v) => this.formatValue(v)).join(',\n        ') + '\n      ]';
    }
    if (typeof value === 'object') {
      return JSON.stringify(value, null, 2).replace(/\n/g, '\n        ');
    }
    return String(value);
  }

  private summarizeChanges(changes: ResourceChange[]): Record<ChangeType, number> {
    const counts: Record<ChangeType, number> = {
      create: 0,
      update: 0,
      delete: 0,
      replace: 0,
      noop: 0,
    };

    for (const change of changes) {
      counts[change.action]++;
    }

    return counts;
  }

  private formatSummary(counts: Record<ChangeType, number>): string {
    const parts: string[] = [];

    if (counts.create > 0) parts.push(`${counts.create} to add`);
    if (counts.update > 0) parts.push(`${counts.update} to change`);
    if (counts.delete > 0) parts.push(`${counts.delete} to destroy`);
    if (counts.replace > 0) parts.push(`${counts.replace} to replace`);

    if (parts.length === 0) return 'No changes';
    return parts.join(', ');
  }
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Quick diff between two resource maps.
 */
export function diffResources(
  desired: Map<string, ResourceState>,
  actual: Map<string, ResourceState>,
  options?: DiffOptions
): Plan {
  const engine = new DiffEngine(options);
  return engine.diff(desired, actual);
}

/**
 * Check if there are any changes between desired and actual state.
 */
export function hasChanges(
  desired: Map<string, ResourceState>,
  actual: Map<string, ResourceState>
): boolean {
  const plan = diffResources(desired, actual);
  return plan.changes.length > 0;
}
