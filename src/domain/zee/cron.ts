/**
 * Cron Scheduling Tools
 *
 * Provides recurring task automation via Zee gateway:
 * - Schedule jobs with cron expressions, intervals, or one-time runs
 * - Manage job lifecycle (enable, disable, update, remove)
 * - Execute jobs manually for testing
 * - Wake the agent with text prompts
 */

import { z } from "zod";
import type { ToolDefinition, ToolExecutionResult } from "../../mcp/types.js";
import { Log } from "../../../packages/zee/src/util/log.js";

const log = Log.create({ service: "zee-cron" });

// =============================================================================
// Types
// =============================================================================

// Schedule types
const CronScheduleAtSchema = z.object({
  kind: z.literal("at"),
  atMs: z.number().describe("Unix timestamp in milliseconds for one-time run"),
});

const CronScheduleEverySchema = z.object({
  kind: z.literal("every"),
  everyMs: z.number().describe("Interval in milliseconds"),
  anchorMs: z.number().optional().describe("Anchor timestamp for interval alignment"),
});

const CronScheduleCronSchema = z.object({
  kind: z.literal("cron"),
  expr: z.string().describe("Cron expression (e.g., '0 9 * * *' for 9am daily)"),
  tz: z.string().optional().describe("Timezone (e.g., 'America/New_York')"),
});

const CronScheduleSchema = z.union([
  CronScheduleAtSchema,
  CronScheduleEverySchema,
  CronScheduleCronSchema,
]);

// Payload types
const CronPayloadSystemEventSchema = z.object({
  kind: z.literal("systemEvent"),
  text: z.string().describe("Event text to inject into agent context"),
});

const CronPayloadAgentTurnSchema = z.object({
  kind: z.literal("agentTurn"),
  message: z.string().describe("Message for agent to process"),
  model: z.string().optional().describe("Model override (provider/model or alias)"),
  thinking: z.string().optional().describe("Thinking mode"),
  timeoutSeconds: z.number().optional().describe("Timeout for agent turn"),
  deliver: z.boolean().optional().describe("Whether to deliver response to channel"),
  channel: z.string().optional().describe("Delivery channel ID or 'last'"),
  to: z.string().optional().describe("Recipient for delivery"),
  bestEffortDeliver: z.boolean().optional().describe("Silently fail delivery if channel unavailable"),
});

const CronPayloadSchema = z.union([
  CronPayloadSystemEventSchema,
  CronPayloadAgentTurnSchema,
]);

// Throttle config
const CronThrottleSchema = z.object({
  dedupWindowMs: z.number().optional()
    .describe("Suppress duplicate notifications within this window (ms)"),
  maxPerWindow: z.number().optional()
    .describe("Max notifications per window; excess are dropped with a summary"),
});

// Job definition
const CronJobSchema = z.object({
  name: z.string().describe("Job name"),
  description: z.string().optional().describe("Job description"),
  enabled: z.boolean().default(true).describe("Whether job is active"),
  deleteAfterRun: z.boolean().optional().describe("Delete job after first run"),
  schedule: CronScheduleSchema,
  sessionTarget: z.enum(["main", "isolated"]).default("main")
    .describe("Session mode: 'main' for current session, 'isolated' for dedicated session"),
  wakeMode: z.enum(["next-heartbeat", "now"]).default("next-heartbeat")
    .describe("When to execute: 'now' immediately, 'next-heartbeat' at next agent wake"),
  payload: CronPayloadSchema,
  agentId: z.string().optional().describe("Optional agent ID to associate with job"),
  isolation: z.object({
    postToMainPrefix: z.string().optional(),
    postToMainMode: z.enum(["summary", "full"]).optional(),
    postToMainMaxChars: z.number().optional(),
  }).optional().describe("Isolation settings for isolated sessions"),
  maxConcurrentRuns: z.number().int().min(1).optional()
    .describe("Max concurrent runs for this job (default: 1)"),
  throttle: CronThrottleSchema.optional()
    .describe("Notification throttle/dedup settings"),
});

// Actions
const CRON_ACTIONS = ["status", "list", "add", "update", "remove", "run", "runs", "wake"] as const;
const CRON_WAKE_MODES = ["now", "next-heartbeat"] as const;

// =============================================================================
// Gateway Client
// =============================================================================

const DEFAULT_GATEWAY_URL = "ws://127.0.0.1:18789";
const DEFAULT_TIMEOUT_MS = 10_000;

interface GatewayCallOptions {
  gatewayUrl?: string;
  gatewayToken?: string;
  timeoutMs?: number;
}

function resolveGatewayUrl(): string {
  // Check environment for gateway URL
  const envUrl = process.env.ZEE_GATEWAY_URL || process.env.GATEWAY_URL;
  if (envUrl) return envUrl;

  // Check for daemon port configuration
  const port = process.env.ZEE_GATEWAY_PORT || "18789";
  return `ws://127.0.0.1:${port}`;
}

function resolveGatewayHttpUrl(): string {
  // Convert WebSocket URL to HTTP URL for RPC calls
  const wsUrl = resolveGatewayUrl();
  return wsUrl.replace(/^ws:/, "http:").replace(/^wss:/, "https:");
}

async function callGatewayRpc<T = unknown>(
  method: string,
  params: Record<string, unknown>,
  options?: GatewayCallOptions,
): Promise<T> {
  const baseUrl = options?.gatewayUrl || resolveGatewayHttpUrl();
  const timeout = options?.timeoutMs || DEFAULT_TIMEOUT_MS;

  // Use JSON-RPC style endpoint
  const url = `${baseUrl}/rpc`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(options?.gatewayToken ? { "Authorization": `Bearer ${options.gatewayToken}` } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method,
        params,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Gateway error: ${response.status} ${text}`);
    }

    const result = await response.json() as { result?: T; error?: { message: string } };

    if (result.error) {
      throw new Error(result.error.message);
    }

    return result.result as T;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Gateway request timed out after ${timeout}ms`);
    }
    throw error;
  }
}

// =============================================================================
// Cron Status Tool
// =============================================================================

const CronStatusParams = z.object({
  gatewayUrl: z.string().optional().describe("Override gateway URL"),
  timeoutMs: z.number().optional().describe("Request timeout in ms"),
});

export const cronStatusTool: ToolDefinition = {
  id: "zee:cron-status",
  category: "domain",
  init: async () => ({
    description: `Check cron scheduler status and configuration.

Returns:
- enabled: Whether cron is enabled
- running: Whether scheduler is active
- jobCount: Number of configured jobs
- nextRunAtMs: Next scheduled job time

Example:
- { }`,
    parameters: CronStatusParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      ctx.metadata({ title: "Cron Status" });

      try {
        const result = await callGatewayRpc<{
          enabled: boolean;
          running: boolean;
          jobCount: number;
          nextRunAtMs?: number;
          storePath?: string;
        }>("cron.status", {}, {
          gatewayUrl: args.gatewayUrl,
          timeoutMs: args.timeoutMs,
        });

        const nextRun = result.nextRunAtMs
          ? new Date(result.nextRunAtMs).toLocaleString()
          : "No scheduled jobs";

        return {
          title: "Cron Status",
          metadata: result,
          output: `Cron Scheduler Status:
- Enabled: ${result.enabled ? "Yes" : "No"}
- Running: ${result.running ? "Active" : "Stopped"}
- Jobs: ${result.jobCount}
- Next Run: ${nextRun}
${result.storePath ? `- Store: ${result.storePath}` : ""}`,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        if (errorMsg.includes("ECONNREFUSED") || errorMsg.includes("fetch failed")) {
          return {
            title: "Cron Unavailable",
            metadata: { error: "connection_failed" },
            output: `Could not connect to Zee gateway.

Ensure zee daemon is running with gateway enabled:
  zee daemon --gateway

Error: ${errorMsg}`,
          };
        }

        return {
          title: "Cron Status Error",
          metadata: { error: errorMsg },
          output: `Failed to get cron status: ${errorMsg}`,
        };
      }
    },
  }),
};

// =============================================================================
// Cron List Tool
// =============================================================================

const CronListParams = z.object({
  includeDisabled: z.boolean().default(false).describe("Include disabled jobs"),
  gatewayUrl: z.string().optional(),
  timeoutMs: z.number().optional(),
});

export const cronListTool: ToolDefinition = {
  id: "zee:cron-list",
  category: "domain",
  init: async () => ({
    description: `List all cron jobs.

Returns job details including:
- id, name, description
- enabled status
- schedule (cron expression, interval, or one-time)
- next run time
- last run status

Examples:
- List all: { }
- Include disabled: { includeDisabled: true }`,
    parameters: CronListParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      ctx.metadata({ title: "Cron Jobs" });

      try {
        const result = await callGatewayRpc<{
          jobs: Array<{
            id: string;
            name: string;
            description?: string;
            enabled: boolean;
            schedule: { kind: string; expr?: string; everyMs?: number; atMs?: number };
            state: {
              nextRunAtMs?: number;
              lastRunAtMs?: number;
              lastStatus?: string;
              lastError?: string;
            };
          }>;
        }>("cron.list", { includeDisabled: args.includeDisabled }, {
          gatewayUrl: args.gatewayUrl,
          timeoutMs: args.timeoutMs,
        });

        if (result.jobs.length === 0) {
          return {
            title: "No Cron Jobs",
            metadata: { count: 0 },
            output: `No cron jobs configured.

Create one with zee:cron-add:
{ job: { name: "Daily reminder", schedule: { kind: "cron", expr: "0 9 * * *" }, payload: { kind: "systemEvent", text: "Morning check-in" } } }`,
          };
        }

        const jobsList = result.jobs.map((job, i) => {
          const scheduleStr = job.schedule.kind === "cron"
            ? `cron: ${job.schedule.expr}`
            : job.schedule.kind === "every"
              ? `every ${Math.round((job.schedule.everyMs || 0) / 60000)}m`
              : `at ${new Date(job.schedule.atMs || 0).toLocaleString()}`;
          const nextRun = job.state.nextRunAtMs
            ? new Date(job.state.nextRunAtMs).toLocaleString()
            : "Not scheduled";
          const status = job.enabled ? "enabled" : "disabled";
          const lastRun = job.state.lastRunAtMs
            ? `${job.state.lastStatus || "ok"} at ${new Date(job.state.lastRunAtMs).toLocaleString()}`
            : "Never run";

          return `${i + 1}. ${job.name} [${status}]
   ID: ${job.id}
   Schedule: ${scheduleStr}
   Next: ${nextRun}
   Last: ${lastRun}${job.description ? `\n   ${job.description}` : ""}`;
        }).join("\n\n");

        return {
          title: `${result.jobs.length} Cron Job(s)`,
          metadata: { count: result.jobs.length },
          output: `Cron Jobs:

${jobsList}`,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          title: "Cron List Error",
          metadata: { error: errorMsg },
          output: `Failed to list cron jobs: ${errorMsg}`,
        };
      }
    },
  }),
};

// =============================================================================
// Cron Add Tool
// =============================================================================

const CronAddParams = z.object({
  job: CronJobSchema.describe("Job definition"),
  contextMessages: z.number().min(0).max(10).optional()
    .describe("Include N recent messages as context in job text"),
  gatewayUrl: z.string().optional(),
  timeoutMs: z.number().optional(),
});

export const cronAddTool: ToolDefinition = {
  id: "zee:cron-add",
  category: "domain",
  init: async () => ({
    description: `Create a new cron job.

Schedule Types:
- **cron**: Standard cron expression (e.g., "0 9 * * *" for 9am daily)
- **every**: Interval in milliseconds (e.g., 3600000 for hourly)
- **at**: One-time run at specific timestamp

Payload Types:
- **systemEvent**: Inject text into agent context
- **agentTurn**: Run agent with specific message

Examples:
- Daily 9am reminder:
  { job: { name: "Morning standup", schedule: { kind: "cron", expr: "0 9 * * *" }, payload: { kind: "systemEvent", text: "Time for morning standup" } } }

- Hourly check:
  { job: { name: "Health check", schedule: { kind: "every", everyMs: 3600000 }, payload: { kind: "agentTurn", message: "Run health check" } } }

- One-time tomorrow at noon:
  { job: { name: "Lunch reminder", schedule: { kind: "at", atMs: 1706104800000 }, payload: { kind: "systemEvent", text: "Lunch time!" }, deleteAfterRun: true } }`,
    parameters: CronAddParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      ctx.metadata({ title: `Add: ${args.job.name}` });

      try {
        const result = await callGatewayRpc<{
          id: string;
          name: string;
          enabled: boolean;
          schedule: { kind: string };
        }>("cron.add", args.job, {
          gatewayUrl: args.gatewayUrl,
          timeoutMs: args.timeoutMs,
        });

        return {
          title: "Cron Job Created",
          metadata: { id: result.id, name: result.name },
          output: `Created cron job: ${result.name}

ID: ${result.id}
Enabled: ${result.enabled}
Schedule: ${result.schedule.kind}

Use zee:cron-list to see all jobs.
Use zee:cron-run with jobId "${result.id}" to test it now.`,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          title: "Cron Add Error",
          metadata: { error: errorMsg },
          output: `Failed to create cron job: ${errorMsg}`,
        };
      }
    },
  }),
};

// =============================================================================
// Cron Update Tool
// =============================================================================

const CronUpdateParams = z.object({
  jobId: z.string().describe("Job ID to update"),
  patch: z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    enabled: z.boolean().optional(),
    schedule: CronScheduleSchema.optional(),
    sessionTarget: z.enum(["main", "isolated"]).optional(),
    wakeMode: z.enum(["next-heartbeat", "now"]).optional(),
    payload: CronPayloadSchema.optional(),
    maxConcurrentRuns: z.number().int().min(1).optional()
      .describe("Max concurrent runs for this job (default: 1)"),
    throttle: CronThrottleSchema.optional()
      .describe("Notification throttle/dedup settings"),
  }).describe("Fields to update"),
  gatewayUrl: z.string().optional(),
  timeoutMs: z.number().optional(),
});

export const cronUpdateTool: ToolDefinition = {
  id: "zee:cron-update",
  category: "domain",
  init: async () => ({
    description: `Update an existing cron job.

Update any field: name, description, enabled, schedule, payload, etc.

Examples:
- Disable job: { jobId: "abc123", patch: { enabled: false } }
- Change schedule: { jobId: "abc123", patch: { schedule: { kind: "cron", expr: "0 10 * * *" } } }
- Update message: { jobId: "abc123", patch: { payload: { kind: "systemEvent", text: "New message" } } }`,
    parameters: CronUpdateParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      ctx.metadata({ title: `Update: ${args.jobId.substring(0, 8)}...` });

      try {
        const result = await callGatewayRpc<{
          id: string;
          name: string;
          enabled: boolean;
        }>("cron.update", { id: args.jobId, patch: args.patch }, {
          gatewayUrl: args.gatewayUrl,
          timeoutMs: args.timeoutMs,
        });

        const changes = Object.keys(args.patch).join(", ");

        return {
          title: "Cron Job Updated",
          metadata: { id: result.id, changes },
          output: `Updated cron job: ${result.name}

ID: ${result.id}
Changed: ${changes}
Enabled: ${result.enabled}`,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          title: "Cron Update Error",
          metadata: { error: errorMsg },
          output: `Failed to update cron job: ${errorMsg}`,
        };
      }
    },
  }),
};

// =============================================================================
// Cron Remove Tool
// =============================================================================

const CronRemoveParams = z.object({
  jobId: z.string().describe("Job ID to remove"),
  gatewayUrl: z.string().optional(),
  timeoutMs: z.number().optional(),
});

export const cronRemoveTool: ToolDefinition = {
  id: "zee:cron-remove",
  category: "domain",
  init: async () => ({
    description: `Remove a cron job.

Example:
- { jobId: "abc123" }`,
    parameters: CronRemoveParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      ctx.metadata({ title: `Remove: ${args.jobId.substring(0, 8)}...` });

      try {
        await callGatewayRpc<{ success: boolean }>("cron.remove", { id: args.jobId }, {
          gatewayUrl: args.gatewayUrl,
          timeoutMs: args.timeoutMs,
        });

        return {
          title: "Cron Job Removed",
          metadata: { id: args.jobId },
          output: `Removed cron job: ${args.jobId}`,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          title: "Cron Remove Error",
          metadata: { error: errorMsg },
          output: `Failed to remove cron job: ${errorMsg}`,
        };
      }
    },
  }),
};

// =============================================================================
// Cron Run Tool
// =============================================================================

const CronRunParams = z.object({
  jobId: z.string().describe("Job ID to run immediately"),
  gatewayUrl: z.string().optional(),
  timeoutMs: z.number().optional(),
});

export const cronRunTool: ToolDefinition = {
  id: "zee:cron-run",
  category: "domain",
  init: async () => ({
    description: `Manually trigger a cron job to run immediately.

Useful for testing jobs before their scheduled time.

Example:
- { jobId: "abc123" }`,
    parameters: CronRunParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      ctx.metadata({ title: `Run: ${args.jobId.substring(0, 8)}...` });

      try {
        const result = await callGatewayRpc<{
          runId: string;
          startedAt: number;
        }>("cron.run", { id: args.jobId }, {
          gatewayUrl: args.gatewayUrl,
          timeoutMs: args.timeoutMs,
        });

        return {
          title: "Cron Job Triggered",
          metadata: { jobId: args.jobId, runId: result.runId },
          output: `Triggered cron job: ${args.jobId}

Run ID: ${result.runId}
Started: ${new Date(result.startedAt).toLocaleString()}

Use zee:cron-runs with jobId "${args.jobId}" to check status.`,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          title: "Cron Run Error",
          metadata: { error: errorMsg },
          output: `Failed to run cron job: ${errorMsg}`,
        };
      }
    },
  }),
};

// =============================================================================
// Cron Runs Tool (History)
// =============================================================================

const CronRunsParams = z.object({
  jobId: z.string().describe("Job ID to get run history"),
  gatewayUrl: z.string().optional(),
  timeoutMs: z.number().optional(),
});

export const cronRunsTool: ToolDefinition = {
  id: "zee:cron-runs",
  category: "domain",
  init: async () => ({
    description: `Get run history for a cron job.

Shows recent executions including:
- Run time
- Duration
- Status (ok, error, skipped)
- Error messages (if any)

Example:
- { jobId: "abc123" }`,
    parameters: CronRunsParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      ctx.metadata({ title: `Runs: ${args.jobId.substring(0, 8)}...` });

      try {
        const result = await callGatewayRpc<{
          runs: Array<{
            runId: string;
            startedAt: number;
            completedAt?: number;
            status: "ok" | "error" | "skipped" | "throttled" | "running";
            error?: string;
            durationMs?: number;
          }>;
        }>("cron.runs", { id: args.jobId }, {
          gatewayUrl: args.gatewayUrl,
          timeoutMs: args.timeoutMs,
        });

        if (result.runs.length === 0) {
          return {
            title: "No Run History",
            metadata: { jobId: args.jobId, count: 0 },
            output: `No run history for job: ${args.jobId}

The job has never been executed.`,
          };
        }

        const runsList = result.runs.map((run, i) => {
          const startTime = new Date(run.startedAt).toLocaleString();
          const duration = run.durationMs ? `${run.durationMs}ms` : "running";
          const statusIcon = run.status === "ok" ? "done" : run.status === "error" ? "fail" : run.status;
          return `${i + 1}. [${statusIcon}] ${startTime} (${duration})${run.error ? `\n   Error: ${run.error}` : ""}`;
        }).join("\n");

        return {
          title: `${result.runs.length} Run(s)`,
          metadata: { jobId: args.jobId, count: result.runs.length },
          output: `Run history for job ${args.jobId}:

${runsList}`,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          title: "Cron Runs Error",
          metadata: { error: errorMsg },
          output: `Failed to get run history: ${errorMsg}`,
        };
      }
    },
  }),
};

// =============================================================================
// Cron Wake Tool
// =============================================================================

const CronWakeParams = z.object({
  text: z.string().describe("Wake event text to inject"),
  mode: z.enum(["now", "next-heartbeat"]).default("next-heartbeat")
    .describe("When to wake: 'now' immediately, 'next-heartbeat' at next agent cycle"),
  gatewayUrl: z.string().optional(),
  timeoutMs: z.number().optional(),
});

export const cronWakeTool: ToolDefinition = {
  id: "zee:cron-wake",
  category: "domain",
  init: async () => ({
    description: `Send a wake event to the agent.

Wake modes:
- **now**: Immediately wake the agent and inject the text
- **next-heartbeat**: Wait for next agent cycle (default, less disruptive)

This is useful for:
- Triggering immediate agent attention
- Injecting context without a full cron job
- Testing agent wake behavior

Examples:
- Immediate wake: { text: "Check inbox now", mode: "now" }
- Deferred wake: { text: "Remember to follow up", mode: "next-heartbeat" }`,
    parameters: CronWakeParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      ctx.metadata({ title: `Wake: ${args.mode}` });

      try {
        await callGatewayRpc<{ queued: boolean }>("wake", {
          text: args.text,
          mode: args.mode,
        }, {
          gatewayUrl: args.gatewayUrl,
          timeoutMs: args.timeoutMs,
        });

        return {
          title: "Wake Event Sent",
          metadata: { mode: args.mode, textLength: args.text.length },
          output: `Wake event ${args.mode === "now" ? "triggered" : "queued"}.

Mode: ${args.mode}
Text: "${args.text.substring(0, 100)}${args.text.length > 100 ? "..." : ""}"

${args.mode === "now"
  ? "The agent will process this immediately."
  : "The agent will process this at the next heartbeat cycle."}`,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          title: "Wake Error",
          metadata: { error: errorMsg },
          output: `Failed to send wake event: ${errorMsg}`,
        };
      }
    },
  }),
};

// =============================================================================
// Exports
// =============================================================================

export const CRON_TOOLS = [
  cronStatusTool,
  cronListTool,
  cronAddTool,
  cronUpdateTool,
  cronRemoveTool,
  cronRunTool,
  cronRunsTool,
  cronWakeTool,
];

export function registerCronTools(registry: { register: (tool: ToolDefinition, options: { source: string }) => void }): void {
  for (const tool of CRON_TOOLS) {
    registry.register(tool, { source: "domain" });
  }
}
