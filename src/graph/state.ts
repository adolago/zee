/**
 * State Management
 *
 * Handles state snapshots, backends, and locking.
 */

import type {
  StateSnapshot,
  ResourceState,
  BackendConfig,
  LocalBackendConfig,
  S3BackendConfig,
  HTTPBackendConfig,
} from './types.js';
import { Log } from '../../packages/zee/src/util/log';
import fs from 'fs/promises';
import path from 'path';

const log = Log.create({ service: 'graph-state' });

// Current state format version
const STATE_VERSION = 1;

// =============================================================================
// State Manager
// =============================================================================

export class StateManager {
  private backend: StateBackend;
  private currentState: StateSnapshot | null = null;
  private lock: StateLock | null = null;

  constructor(backend: StateBackend) {
    this.backend = backend;
  }

  /**
   * Initialize the state manager.
   */
  async init(): Promise<void> {
    await this.backend.init();
    log.debug('State manager initialized');
  }

  /**
   * Load state from backend.
   */
  async load(): Promise<StateSnapshot> {
    try {
      this.currentState = await this.backend.load();
      log.debug('State loaded', {
        version: this.currentState.version,
        serial: this.currentState.serial,
        resources: this.currentState.resources.length,
      });
      return this.currentState;
    } catch (error) {
      // If no state exists, return empty state
      if ((error as Error).message?.includes('not found')) {
        this.currentState = createEmptyState();
        return this.currentState;
      }
      throw error;
    }
  }

  /**
   * Save state to backend.
   */
  async save(state: StateSnapshot): Promise<void> {
    // Increment serial
    const newState = {
      ...state,
      serial: state.serial + 1,
    };

    await this.backend.save(newState);
    this.currentState = newState;

    log.debug('State saved', {
      serial: newState.serial,
      resources: newState.resources.length,
    });
  }

  /**
   * Get a resource from current state.
   */
  getResource(address: string): ResourceState | undefined {
    return this.currentState?.resources.find((r) => r.address === address);
  }

  /**
   * Add or update a resource in current state.
   */
  async upsertResource(resource: ResourceState): Promise<void> {
    if (!this.currentState) {
      this.currentState = createEmptyState();
    }

    const index = this.currentState.resources.findIndex(
      (r) => r.address === resource.address
    );

    if (index >= 0) {
      this.currentState.resources[index] = resource;
    } else {
      this.currentState.resources.push(resource);
    }

    await this.save(this.currentState);
  }

  /**
   * Remove a resource from current state.
   */
  async removeResource(address: string): Promise<void> {
    if (!this.currentState) return;

    this.currentState.resources = this.currentState.resources.filter(
      (r) => r.address !== address
    );

    await this.save(this.currentState);
  }

  /**
   * Set an output value.
   */
  async setOutput(name: string, value: unknown, sensitive: boolean = false): Promise<void> {
    if (!this.currentState) {
      this.currentState = createEmptyState();
    }

    this.currentState.outputs[name] = {
      value,
      type: typeof value,
      sensitive,
    };

    await this.save(this.currentState);
  }

  /**
   * Acquire lock for state modification.
   */
  async lock(info: LockInfo): Promise<boolean> {
    if (this.lock) {
      return false; // Already locked
    }

    const acquired = await this.backend.lock(info);
    if (acquired) {
      this.lock = { info, acquiredAt: Date.now() };
      log.debug('State lock acquired', { id: info.id });
    }

    return acquired;
  }

  /**
   * Release state lock.
   */
  async unlock(): Promise<void> {
    if (!this.lock) return;

    await this.backend.unlock();
    log.debug('State lock released', { id: this.lock.info.id });
    this.lock = null;
  }

  /**
   * Check if state is locked.
   */
  isLocked(): boolean {
    return this.lock !== null;
  }

  /**
   * Get current state snapshot.
   */
  getCurrentState(): StateSnapshot | null {
    return this.currentState;
  }

  /**
   * Create a fresh empty state.
   */
  createFreshState(): StateSnapshot {
    return createEmptyState();
  }
}

// =============================================================================
// Lock Types
// =============================================================================

interface LockInfo {
  id: string;
  operation: string;
  who: string;
  version: string;
  created: string;
}

interface StateLock {
  info: LockInfo;
  acquiredAt: number;
}

// =============================================================================
// State Backend Interface
// =============================================================================

export interface StateBackend {
  init(): Promise<void>;
  load(): Promise<StateSnapshot>;
  save(state: StateSnapshot): Promise<void>;
  lock(info: LockInfo): Promise<boolean>;
  unlock(): Promise<void>;
  getLockInfo(): Promise<LockInfo | null>;
}

// =============================================================================
// Local File Backend
// =============================================================================

export class LocalStateBackend implements StateBackend {
  private statePath: string;
  private lockPath: string;

  constructor(config: LocalBackendConfig) {
    this.statePath = config.path;
    this.lockPath = config.path + '.lock';
  }

  async init(): Promise<void> {
    // Ensure directory exists
    const dir = path.dirname(this.statePath);
    await fs.mkdir(dir, { recursive: true });
  }

  async load(): Promise<StateSnapshot> {
    try {
      const content = await fs.readFile(this.statePath, 'utf-8');
      const state = JSON.parse(content) as StateSnapshot;

      // Validate version
      if (state.version !== STATE_VERSION) {
        throw new Error(`Unsupported state version: ${state.version}`);
      }

      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error('State file not found');
      }
      throw error;
    }
  }

  async save(state: StateSnapshot): Promise<void> {
    const content = JSON.stringify(state, null, 2);

    // Write to temp file first for atomicity
    const tempPath = this.statePath + '.tmp';
    await fs.writeFile(tempPath, content, 'utf-8');
    await fs.rename(tempPath, this.statePath);
  }

  async lock(info: LockInfo): Promise<boolean> {
    try {
      // Check if lock exists
      await fs.access(this.lockPath);
      // Lock exists, check if stale
      const lockContent = await fs.readFile(this.lockPath, 'utf-8');
      const existingLock = JSON.parse(lockContent) as LockInfo;
      
      // Lock is stale if older than 10 minutes
      const lockTime = new Date(existingLock.created).getTime();
      if (Date.now() - lockTime > 10 * 60 * 1000) {
        log.warn('Removing stale lock', { id: existingLock.id });
      } else {
        return false; // Lock is held by someone else
      }
    } catch {
      // Lock file doesn't exist, we can proceed
    }

    // Create lock file
    await fs.writeFile(this.lockPath, JSON.stringify(info, null, 2));
    return true;
  }

  async unlock(): Promise<void> {
    try {
      await fs.unlink(this.lockPath);
    } catch {
      // Ignore if lock doesn't exist
    }
  }

  async getLockInfo(): Promise<LockInfo | null> {
    try {
      const content = await fs.readFile(this.lockPath, 'utf-8');
      return JSON.parse(content) as LockInfo;
    } catch {
      return null;
    }
  }
}

// =============================================================================
// In-Memory Backend (for testing)
// =============================================================================

export class MemoryStateBackend implements StateBackend {
  private state: StateSnapshot | null = null;
  private lockInfo: LockInfo | null = null;

  async init(): Promise<void> {
    // Nothing to do
  }

  async load(): Promise<StateSnapshot> {
    if (!this.state) {
      throw new Error('State not found');
    }
    return this.state;
  }

  async save(state: StateSnapshot): Promise<void> {
    this.state = state;
  }

  async lock(info: LockInfo): Promise<boolean> {
    if (this.lockInfo) {
      return false;
    }
    this.lockInfo = info;
    return true;
  }

  async unlock(): Promise<void> {
    this.lockInfo = null;
  }

  async getLockInfo(): Promise<LockInfo | null> {
    return this.lockInfo;
  }
}

// =============================================================================
// Backend Factory
// =============================================================================

export function createStateBackend(config: BackendConfig): StateBackend {
  switch (config.type) {
    case 'local':
      return new LocalStateBackend(config);
    case 's3':
      return new S3StateBackend(config);
    case 'http':
      return new HTTPStateBackend(config);
    default:
      throw new Error(`Unknown backend type: ${(config as any).type}`);
  }
}

// =============================================================================
// Placeholder Backends (to be implemented)
// =============================================================================

class S3StateBackend implements StateBackend {
  constructor(private config: S3BackendConfig) {}

  async init(): Promise<void> {
    throw new Error('S3 backend not yet implemented');
  }

  async load(): Promise<StateSnapshot> {
    throw new Error('S3 backend not yet implemented');
  }

  async save(_state: StateSnapshot): Promise<void> {
    throw new Error('S3 backend not yet implemented');
  }

  async lock(_info: LockInfo): Promise<boolean> {
    throw new Error('S3 backend not yet implemented');
  }

  async unlock(): Promise<void> {
    throw new Error('S3 backend not yet implemented');
  }

  async getLockInfo(): Promise<LockInfo | null> {
    throw new Error('S3 backend not yet implemented');
  }
}

class HTTPStateBackend implements StateBackend {
  constructor(private config: HTTPBackendConfig) {}

  async init(): Promise<void> {
    throw new Error('HTTP backend not yet implemented');
  }

  async load(): Promise<StateSnapshot> {
    throw new Error('HTTP backend not yet implemented');
  }

  async save(_state: StateSnapshot): Promise<void> {
    throw new Error('HTTP backend not yet implemented');
  }

  async lock(_info: LockInfo): Promise<boolean> {
    throw new Error('HTTP backend not yet implemented');
  }

  async unlock(): Promise<void> {
    throw new Error('HTTP backend not yet implemented');
  }

  async getLockInfo(): Promise<LockInfo | null> {
    throw new Error('HTTP backend not yet implemented');
  }
}

// =============================================================================
// Utilities
// =============================================================================

function createEmptyState(): StateSnapshot {
  return {
    version: STATE_VERSION,
    serial: 0,
    terraformVersion: '1.0.0', // For compatibility
    resources: [],
    outputs: {},
  };
}

/**
 * Create a resource state from configuration.
 */
export function createResourceState(
  address: string,
  type: string,
  name: string,
  attributes: Record<string, unknown>,
  provider: string,
  dependencies: string[] = []
): ResourceState {
  const now = new Date().toISOString();
  return {
    address,
    type,
    name,
    attributes,
    provider,
    dependencies,
    createdAt: now,
    updatedAt: now,
  };
}
