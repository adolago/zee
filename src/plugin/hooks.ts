/**
 * Hook Management System
 *
 * Architecture Overview:
 * - HookManager is the central coordinator for all hook invocations
 * - Hooks are registered by plugins during initialization
 * - Hook execution follows a pipeline pattern with input/output transformation
 * - Priority system allows ordering of hook execution
 *
 * Design Decisions:
 * - Async-first design for non-blocking hook execution
 * - Error isolation prevents one hook from breaking others
 * - Hook chaining allows multiple plugins to transform data
 * - Event-based notification for cross-plugin coordination
 */

import { EventEmitter } from 'events';
import type {
  Hooks,
  HookHandler,
  PluginInstance,
  SystemEvent,
  PluginLogger,
} from './plugin';

// =============================================================================
// Hook Registration Types
// =============================================================================

/**
 * Registered hook with metadata
 */
export interface RegisteredHook<TInput = unknown, TOutput = unknown> {
  /** Source plugin name */
  pluginName: string;
  /** Hook handler function */
  handler: HookHandler<TInput, TOutput>;
  /** Priority (lower = earlier execution) */
  priority: number;
  /** Whether hook is currently enabled */
  enabled: boolean;
}

/**
 * Hook execution options
 */
export interface HookExecutionOptions {
  /** Timeout in milliseconds */
  timeout?: number;
  /** Whether to continue on error */
  continueOnError?: boolean;
  /** Custom error handler */
  onError?: (error: Error, pluginName: string) => void;
}

/**
 * Hook execution result
 */
export interface HookExecutionResult<TOutput> {
  output: TOutput;
  errors: Array<{ pluginName: string; error: Error }>;
  duration: number;
}

// =============================================================================
// Hook Manager
// =============================================================================

/**
 * Central hook management system
 */
export class HookManager {
  private hooks: Map<string, RegisteredHook[]> = new Map();
  private eventEmitter = new EventEmitter();
  private logger: PluginLogger;

  constructor(logger?: PluginLogger) {
    this.logger = logger || createDefaultLogger();
    // Increase max listeners for many plugins
    this.eventEmitter.setMaxListeners(100);
  }

  // ---------------------------------------------------------------------------
  // Hook Registration
  // ---------------------------------------------------------------------------

  /**
   * Register hooks from a plugin instance
   */
  registerPlugin(pluginName: string, instance: PluginInstance): void {
    if (!instance.hooks) return;

    for (const [hookName, handler] of Object.entries(instance.hooks)) {
      if (typeof handler !== 'function') continue;

      this.register(hookName as keyof Hooks, pluginName, handler);
    }

    this.logger.debug('Registered hooks from plugin', {
      plugin: pluginName,
      hooks: Object.keys(instance.hooks),
    });
  }

  /**
   * Register a single hook handler
   */
  register<K extends keyof Hooks>(
    hookName: K,
    pluginName: string,
    handler: Hooks[K],
    priority = 100
  ): () => void {
    const registered: RegisteredHook = {
      pluginName,
      handler: handler as HookHandler<unknown, unknown>,
      priority,
      enabled: true,
    };

    const existing = this.hooks.get(hookName) || [];
    existing.push(registered);
    // Sort by priority (lower first)
    existing.sort((a, b) => a.priority - b.priority);
    this.hooks.set(hookName, existing);

    // Return unregister function
    return () => {
      const hooks = this.hooks.get(hookName);
      if (hooks) {
        const index = hooks.indexOf(registered);
        if (index >= 0) {
          hooks.splice(index, 1);
        }
      }
    };
  }

  /**
   * Unregister all hooks from a plugin
   */
  unregisterPlugin(pluginName: string): void {
    for (const [hookName, hooks] of this.hooks.entries()) {
      const filtered = hooks.filter((h) => h.pluginName !== pluginName);
      this.hooks.set(hookName, filtered);
    }

    this.logger.debug('Unregistered hooks from plugin', { plugin: pluginName });
  }

  // ---------------------------------------------------------------------------
  // Hook Execution
  // ---------------------------------------------------------------------------

  /**
   * Execute a hook with input/output transformation
   */
  async trigger<K extends keyof Hooks>(
    hookName: K,
    input: Parameters<NonNullable<Hooks[K]>>[0],
    output: Parameters<NonNullable<Hooks[K]>>[1],
    options: HookExecutionOptions = {}
  ): Promise<HookExecutionResult<typeof output>> {
    const startTime = Date.now();
    const errors: Array<{ pluginName: string; error: Error }> = [];
    const hooks = this.hooks.get(hookName) || [];

    let currentOutput = output;

    for (const registered of hooks) {
      if (!registered.enabled) continue;

      try {
        const result = await this.executeWithTimeout(
          async () => registered.handler(input, currentOutput),
          options.timeout
        );

        // If handler returns a value, use it as new output
        if (result !== undefined) {
          currentOutput = result as typeof output;
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        errors.push({ pluginName: registered.pluginName, error: err });

        this.logger.error(`Hook ${hookName} error in plugin ${registered.pluginName}`, {
          error: err.message,
        });

        if (options.onError) {
          options.onError(err, registered.pluginName);
        }

        if (!options.continueOnError) {
          break;
        }
      }
    }

    return {
      output: currentOutput,
      errors,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Execute hook without transforming output (just notifications)
   */
  async notify<K extends keyof Hooks>(
    hookName: K,
    input: Parameters<NonNullable<Hooks[K]>>[0],
    output: Parameters<NonNullable<Hooks[K]>>[1]
  ): Promise<void> {
    await this.trigger(hookName, input, output, { continueOnError: true });
  }

  /**
   * Execute with timeout wrapper
   */
  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeout?: number
  ): Promise<T> {
    if (!timeout) {
      return fn();
    }

    return Promise.race([
      fn(),
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('Hook execution timeout')), timeout)
      ),
    ]);
  }

  // ---------------------------------------------------------------------------
  // Event System
  // ---------------------------------------------------------------------------

  /**
   * Emit a system event to all plugins
   */
  async emitEvent(event: SystemEvent): Promise<void> {
    // Trigger event hook
    const hooks = this.hooks.get('event') || [];
    for (const registered of hooks) {
      try {
        await registered.handler({ event }, {});
      } catch (error) {
        this.logger.error(`Event handler error in plugin ${registered.pluginName}`, {
          event: event.type,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Also emit to EventEmitter for internal use
    this.eventEmitter.emit(event.type, event.data);
  }

  /**
   * Subscribe to events
   */
  on(event: string, handler: (data: unknown) => void): () => void {
    this.eventEmitter.on(event, handler);
    return () => this.eventEmitter.off(event, handler);
  }

  /**
   * Subscribe to event once
   */
  once(event: string, handler: (data: unknown) => void): () => void {
    this.eventEmitter.once(event, handler);
    return () => this.eventEmitter.off(event, handler);
  }

  // ---------------------------------------------------------------------------
  // Utility Methods
  // ---------------------------------------------------------------------------

  /**
   * Get all registered hooks for a hook name
   */
  getHooks(hookName: keyof Hooks): RegisteredHook[] {
    return [...(this.hooks.get(hookName) || [])];
  }

  /**
   * Get all registered hook names
   */
  getRegisteredHookNames(): string[] {
    return [...this.hooks.keys()];
  }

  /**
   * Get hooks registered by a specific plugin
   */
  getPluginHooks(pluginName: string): Array<{ hookName: string; priority: number }> {
    const result: Array<{ hookName: string; priority: number }> = [];

    for (const [hookName, hooks] of this.hooks.entries()) {
      for (const hook of hooks) {
        if (hook.pluginName === pluginName) {
          result.push({ hookName, priority: hook.priority });
        }
      }
    }

    return result;
  }

  /**
   * Enable/disable a specific hook
   */
  setHookEnabled(hookName: string, pluginName: string, enabled: boolean): void {
    const hooks = this.hooks.get(hookName);
    if (!hooks) return;

    for (const hook of hooks) {
      if (hook.pluginName === pluginName) {
        hook.enabled = enabled;
      }
    }
  }

  /**
   * Clear all hooks
   */
  clear(): void {
    this.hooks.clear();
    this.eventEmitter.removeAllListeners();
  }
}

// =============================================================================
// Hook Type Helpers
// =============================================================================

/**
 * Standard hook types used in the system
 */
export const HOOK_TYPES = {
  // Session lifecycle
  SESSION_START: 'session.start',
  SESSION_END: 'session.end',
  SESSION_RESTORE: 'session.restore',

  // Task lifecycle
  PRE_TASK: 'pre-task',
  POST_TASK: 'post-task',

  // File operations
  PRE_EDIT: 'pre-edit',
  POST_EDIT: 'post-edit',

  // Chat/messaging
  CHAT_MESSAGE: 'chat.message',
  CHAT_PARAMS: 'chat.params',
  CHAT_RESPONSE: 'chat.response',

  // Tool execution
  TOOL_BEFORE: 'tool.execute.before',
  TOOL_AFTER: 'tool.execute.after',

  // Permissions
  PERMISSION_ASK: 'permission.ask',

  // Memory
  MEMORY_UPDATE: 'memory.update',
  MEMORY_RETRIEVE: 'memory.retrieve',

  // Config
  CONFIG_LOADED: 'config.loaded',
  CONFIG_SAVING: 'config.saving',
} as const;

export type HookType = (typeof HOOK_TYPES)[keyof typeof HOOK_TYPES];

// =============================================================================
// Hook Decorators (for class-based plugins)
// =============================================================================

/**
 * Metadata storage for decorated methods
 */
const hookMetadata = new WeakMap<object, Map<string, { priority?: number }>>();

/**
 * Decorator for marking methods as hook handlers
 */
export function Hook(hookName: keyof Hooks, priority?: number): MethodDecorator {
  return function (
    target: object,
    propertyKey: string | symbol,
    _descriptor: PropertyDescriptor
  ): void {
    let metadata = hookMetadata.get(target);
    if (!metadata) {
      metadata = new Map();
      hookMetadata.set(target, metadata);
    }
    metadata.set(String(propertyKey), { priority });
    // Store hook name on the prototype for later extraction
    const proto = target as Record<string, unknown>;
    const hookMethods = (proto.__hooks__ as Record<string, string>) || {};
    hookMethods[String(propertyKey)] = hookName;
    proto.__hooks__ = hookMethods;
  };
}

/**
 * Extract hooks from a class instance with @Hook decorators
 */
export function extractHooksFromClass(instance: object): Partial<Hooks> {
  const proto = Object.getPrototypeOf(instance);
  const hookMethods = (proto.__hooks__ as Record<string, keyof Hooks>) || {};
  const hooks: Partial<Hooks> = {};

  for (const [methodName, hookName] of Object.entries(hookMethods)) {
    const method = (instance as Record<string, unknown>)[methodName];
    if (typeof method === 'function') {
      (hooks as Record<string, unknown>)[hookName] = method.bind(instance);
    }
  }

  return hooks;
}

// =============================================================================
// Default Logger
// =============================================================================

function createDefaultLogger(): PluginLogger {
  return {
    debug: (message, data) => console.debug(`[plugin] ${message}`, data || ''),
    info: (message, data) => console.info(`[plugin] ${message}`, data || ''),
    warn: (message, data) => console.warn(`[plugin] ${message}`, data || ''),
    error: (message, data) => console.error(`[plugin] ${message}`, data || ''),
  };
}
