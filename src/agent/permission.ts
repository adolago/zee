/**
 * Permission Module - Permission evaluation and management
 *
 * This module handles permission checking for agent operations:
 * - File editing
 * - Bash commands (with pattern matching)
 * - Skill invocation
 * - MCP tool usage
 * - Web fetching
 * - External directory access
 */

import { z } from "zod";
import { Permission, PermissionConfig } from "./agent";
import { Bus } from "../../packages/zee/src/bus";
import { BusEvent } from "../../packages/zee/src/bus/bus-event";

/**
 * Permission events for UI integration
 */
export namespace PermissionEvents {
  /** Emitted when a permission is requested and pending user response */
  export const Requested = BusEvent.define(
    "permission.manager.requested",
    z.object({
      id: z.string(),
      sessionID: z.string(),
      type: z.string(),
      pattern: z.union([z.string(), z.array(z.string())]).optional(),
      title: z.string().optional(),
      metadata: z.record(z.string(), z.any()).optional(),
      createdAt: z.number(),
    })
  );

  /** Emitted when a permission response is received */
  export const Responded = BusEvent.define(
    "permission.manager.responded",
    z.object({
      sessionID: z.string(),
      permissionID: z.string(),
      response: z.enum(["once", "always", "reject"]),
    })
  );
}

/**
 * Permission request context
 */
export const PermissionContext = z.object({
  /** Type of permission being requested */
  type: z.enum([
    "edit",
    "bash",
    "skill",
    "mcp",
    "webfetch",
    "external_directory",
    "doom_loop",
  ]),

  /** Pattern(s) being matched (for bash, skill, mcp) */
  pattern: z.union([z.string(), z.array(z.string())]).optional(),

  /** Session ID for tracking */
  sessionID: z.string(),

  /** Message ID for tracking */
  messageID: z.string(),

  /** Tool call ID if applicable */
  callID: z.string().optional(),

  /** Title for permission prompt */
  title: z.string().optional(),

  /** Additional metadata */
  metadata: z.record(z.string(), z.any()).optional(),
});
export type PermissionContext = z.infer<typeof PermissionContext>;

/**
 * Permission evaluation result
 */
export const PermissionResult = z.object({
  /** Whether the operation is allowed */
  allowed: z.boolean(),

  /** Whether user confirmation is required */
  requiresAsk: z.boolean(),

  /** The rule pattern that matched */
  matchedRule: z.string().optional(),

  /** Reason for denial (if denied) */
  reason: z.string().optional(),
});
export type PermissionResult = z.infer<typeof PermissionResult>;

/**
 * Pending permission request
 */
export interface PendingPermission {
  id: string;
  context: PermissionContext;
  createdAt: number;
  resolve: () => void;
  reject: (error: Error) => void;
}

/**
 * Permission response options
 */
export const PermissionResponse = z.enum(["once", "always", "reject"]);
export type PermissionResponse = z.infer<typeof PermissionResponse>;

/**
 * Permission rejection error
 */
export class PermissionRejectedError extends Error {
  constructor(
    public readonly sessionID: string,
    public readonly permissionID: string,
    public readonly context: PermissionContext,
    public readonly reason?: string
  ) {
    super(
      reason ??
        "The user rejected permission for this operation. You may try again with different parameters."
    );
    this.name = "PermissionRejectedError";
  }
}

/**
 * Permission evaluator namespace
 */
export namespace PermissionEvaluator {
  /**
   * Evaluate permission for a given context
   */
  export function evaluate(
    config: PermissionConfig,
    context: PermissionContext
  ): PermissionResult {
    const { type, pattern } = context;

    // Get the permission rule for this type
    const rule = config[type as keyof PermissionConfig];

    if (rule === undefined) {
      return { allowed: true, requiresAsk: false };
    }

    // Simple permission value (string)
    if (typeof rule === "string") {
      return evaluateSimple(rule as Permission);
    }

    // Pattern-based permission (object with patterns)
    if (typeof rule === "object" && pattern) {
      return evaluatePattern(rule, pattern);
    }

    // Pattern-based but no pattern provided - use default
    if (typeof rule === "object") {
      const defaultRule = (rule as Record<string, Permission>)["*"];
      if (defaultRule) {
        return evaluateSimple(defaultRule);
      }
    }

    return { allowed: true, requiresAsk: false };
  }

  /**
   * Evaluate a simple permission value
   */
  function evaluateSimple(permission: Permission): PermissionResult {
    switch (permission) {
      case "allow":
        return { allowed: true, requiresAsk: false };
      case "ask":
        return { allowed: false, requiresAsk: true };
      case "deny":
        return {
          allowed: false,
          requiresAsk: false,
          reason: "Permission denied by configuration",
        };
    }
  }

  /**
   * Evaluate pattern-based permission rules
   */
  function evaluatePattern(
    rules: Record<string, Permission>,
    pattern: string | string[]
  ): PermissionResult {
    const patterns = Array.isArray(pattern) ? pattern : [pattern];

    for (const pat of patterns) {
      // Check exact match first
      if (rules[pat]) {
        return { ...evaluateSimple(rules[pat]), matchedRule: pat };
      }

      // Check wildcard patterns (most specific first)
      const sortedRules = Object.entries(rules)
        .filter(([p]) => p !== "*")
        .sort(([a], [b]) => b.length - a.length);

      for (const [rulePattern, permission] of sortedRules) {
        if (wildcardMatch(pat, rulePattern)) {
          return { ...evaluateSimple(permission), matchedRule: rulePattern };
        }
      }
    }

    // Default to wildcard rule or allow
    const defaultRule = rules["*"];
    if (defaultRule) {
      return { ...evaluateSimple(defaultRule), matchedRule: "*" };
    }

    return { allowed: true, requiresAsk: false };
  }

  /**
   * Match a value against a wildcard pattern
   * Supports:
   * - "*" for universal match
   * - "prefix*" for prefix matching
   * - "*suffix" for suffix matching
   * - "prefix*suffix" for prefix AND suffix matching
   * - Multiple wildcards are converted to regex (e.g., "a*b*c")
   */
  function wildcardMatch(value: string, pattern: string): boolean {
    // Universal wildcard
    if (pattern === "*") {
      return true;
    }

    // Check for multiple wildcards - use regex approach
    const wildcardCount = (pattern.match(/\*/g) || []).length;
    if (wildcardCount > 1) {
      // Convert pattern to regex: escape special chars, replace * with .*
      const escaped = pattern
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*");
      const regex = new RegExp(`^${escaped}$`);
      return regex.test(value);
    }

    // Single trailing wildcard (prefix match)
    if (pattern.endsWith("*")) {
      const prefix = pattern.slice(0, -1);
      return value.startsWith(prefix);
    }

    // Single leading wildcard (suffix match)
    if (pattern.startsWith("*")) {
      const suffix = pattern.slice(1);
      return value.endsWith(suffix);
    }

    // Mid-string single wildcard (prefix AND suffix match)
    const wildcardIndex = pattern.indexOf("*");
    if (wildcardIndex !== -1) {
      const prefix = pattern.slice(0, wildcardIndex);
      const suffix = pattern.slice(wildcardIndex + 1);
      return value.startsWith(prefix) && value.endsWith(suffix) && value.length >= prefix.length + suffix.length;
    }

    // Exact match
    return value === pattern;
  }

  /**
   * Check if all patterns are covered by approved patterns
   */
  export function isCovered(
    patterns: string[],
    approved: Record<string, boolean>
  ): boolean {
    const approvedPatterns = Object.keys(approved);
    return patterns.every((p) =>
      approvedPatterns.some((ap) => wildcardMatch(p, ap))
    );
  }

  /**
   * Merge base and override permission configurations
   */
  export function merge(
    base: PermissionConfig,
    override: Partial<PermissionConfig>
  ): PermissionConfig {
    const result: PermissionConfig = { ...base };

    for (const [key, value] of Object.entries(override)) {
      if (value === undefined) continue;

      const baseValue = base[key as keyof PermissionConfig];

      // Normalize pattern-based permissions to object form
      if (key === "bash" || key === "skill" || key === "mcp") {
        const baseObj =
          typeof baseValue === "string"
            ? { "*": baseValue as Permission }
            : ((baseValue as Record<string, Permission>) ?? {});

        const overrideObj =
          typeof value === "string"
            ? { "*": value as Permission }
            : ((value as Record<string, Permission>) ?? {});

        (result as any)[key] = { ...baseObj, ...overrideObj };
      } else {
        (result as any)[key] = value;
      }
    }

    return result;
  }

  /**
   * Create a permission config that allows only read operations
   */
  export function readOnly(): PermissionConfig {
    return {
      edit: "deny",
      bash: {
        // Safe read-only commands
        "cat *": "allow",
        "cut *": "allow",
        "diff *": "allow",
        "du *": "allow",
        "file *": "allow",
        "find *": "allow",
        "grep *": "allow",
        "head *": "allow",
        "less *": "allow",
        "ls *": "allow",
        "more *": "allow",
        "pwd": "allow",
        "rg *": "allow",
        "sort *": "allow",
        "stat *": "allow",
        "tail *": "allow",
        "tree *": "allow",
        "uniq *": "allow",
        "wc *": "allow",
        "which *": "allow",
        "whereis *": "allow",
        // Git read operations
        "git branch": "allow",
        "git branch -v": "allow",
        "git diff *": "allow",
        "git log *": "allow",
        "git show *": "allow",
        "git status *": "allow",
        // Deny everything else by default
        "*": "deny",
      },
      skill: "ask",
      mcp: "ask",
      webfetch: "allow",
      external_directory: "deny",
      doom_loop: "ask",
    };
  }

  /**
   * Create a permission config that allows all operations
   */
  export function allowAll(): PermissionConfig {
    return {
      edit: "allow",
      bash: { "*": "allow" },
      skill: { "*": "allow" },
      mcp: { "*": "allow" },
      webfetch: "allow",
      external_directory: "allow",
      doom_loop: "allow",
    };
  }

  /**
   * Create a permission config that asks for everything
   */
  export function askAll(): PermissionConfig {
    return {
      edit: "ask",
      bash: { "*": "ask" },
      skill: { "*": "ask" },
      mcp: { "*": "ask" },
      webfetch: "ask",
      external_directory: "ask",
      doom_loop: "ask",
    };
  }

  /**
   * Create a permission config that denies everything
   */
  export function denyAll(): PermissionConfig {
    return {
      edit: "deny",
      bash: { "*": "deny" },
      skill: { "*": "deny" },
      mcp: { "*": "deny" },
      webfetch: "deny",
      external_directory: "deny",
      doom_loop: "deny",
    };
  }
}

/**
 * Permission manager for handling permission requests
 */
export class PermissionManager {
  private pending: Map<string, Map<string, PendingPermission>> = new Map();
  private approved: Map<string, Set<string>> = new Map();

  /**
   * Check permission and potentially prompt user
   */
  async check(
    config: PermissionConfig,
    context: PermissionContext
  ): Promise<void> {
    const result = PermissionEvaluator.evaluate(config, context);

    // Allowed - no action needed
    if (result.allowed) {
      return;
    }

    // Denied - throw immediately
    if (!result.requiresAsk) {
      throw new PermissionRejectedError(
        context.sessionID,
        "denied",
        context,
        result.reason
      );
    }

    // Check if already approved for this session
    const patterns = Array.isArray(context.pattern)
      ? context.pattern
      : context.pattern
        ? [context.pattern]
        : [context.type];

    const sessionApproved = this.approved.get(context.sessionID);
    if (sessionApproved && PermissionEvaluator.isCovered(patterns, Object.fromEntries([...sessionApproved].map(p => [p, true])))) {
      return;
    }

    // Need to ask - create pending permission
    return this.requestPermission(context);
  }

  /**
   * Create a pending permission request
   */
  private requestPermission(context: PermissionContext): Promise<void> {
    const id = `perm_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    return new Promise((resolve, reject) => {
      const pending: PendingPermission = {
        id,
        context,
        createdAt: Date.now(),
        resolve,
        reject,
      };

      // Store pending permission
      if (!this.pending.has(context.sessionID)) {
        this.pending.set(context.sessionID, new Map());
      }
      this.pending.get(context.sessionID)!.set(id, pending);

      // Emit event for UI to handle
      Bus.publish(PermissionEvents.Requested, {
        id,
        sessionID: context.sessionID,
        type: context.type,
        pattern: context.pattern,
        title: context.title,
        metadata: context.metadata,
        createdAt: Date.now(),
      });
    });
  }

  /**
   * Respond to a pending permission request
   */
  respond(
    sessionID: string,
    permissionID: string,
    response: PermissionResponse
  ): void {
    const sessionPending = this.pending.get(sessionID);
    if (!sessionPending) return;

    const pending = sessionPending.get(permissionID);
    if (!pending) return;

    // Remove from pending
    sessionPending.delete(permissionID);

    // Emit response event
    Bus.publish(PermissionEvents.Responded, {
      sessionID,
      permissionID,
      response,
    });

    switch (response) {
      case "once":
        pending.resolve();
        break;

      case "always":
        // Add to approved patterns
        if (!this.approved.has(sessionID)) {
          this.approved.set(sessionID, new Set());
        }
        const patterns = Array.isArray(pending.context.pattern)
          ? pending.context.pattern
          : pending.context.pattern
            ? [pending.context.pattern]
            : [pending.context.type];
        for (const p of patterns) {
          this.approved.get(sessionID)!.add(p);
        }
        pending.resolve();

        // Also resolve any other pending permissions that are now covered
        for (const [id, other] of sessionPending) {
          const otherPatterns = Array.isArray(other.context.pattern)
            ? other.context.pattern
            : other.context.pattern
              ? [other.context.pattern]
              : [other.context.type];

          if (PermissionEvaluator.isCovered(otherPatterns, Object.fromEntries([...this.approved.get(sessionID)!].map(p => [p, true])))) {
            sessionPending.delete(id);
            other.resolve();
          }
        }
        break;

      case "reject":
        pending.reject(
          new PermissionRejectedError(
            sessionID,
            permissionID,
            pending.context
          )
        );
        break;
    }
  }

  /**
   * Get pending permissions for a session
   */
  getPending(sessionID: string): PendingPermission[] {
    const sessionPending = this.pending.get(sessionID);
    return sessionPending ? [...sessionPending.values()] : [];
  }

  /**
   * Clear all pending permissions for a session
   */
  clearSession(sessionID: string): void {
    const sessionPending = this.pending.get(sessionID);
    if (sessionPending) {
      for (const pending of sessionPending.values()) {
        pending.reject(
          new PermissionRejectedError(
            sessionID,
            pending.id,
            pending.context,
            "Session ended"
          )
        );
      }
      sessionPending.clear();
    }
    this.approved.delete(sessionID);
    this.pending.delete(sessionID);
  }

  /**
   * Reset approvals for a session (keep pending)
   */
  resetApprovals(sessionID: string): void {
    this.approved.delete(sessionID);
  }
}
