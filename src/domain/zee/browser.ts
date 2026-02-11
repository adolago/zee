/**
 * Zee Browser Tool
 *
 * Provides browser automation via Zee's browser control server.
 * The browser control runs on port 18791 (default) and provides
 * Playwright-based automation with Chrome/Chromium.
 */

import { z } from "zod";
import type { ToolDefinition, ToolExecutionResult } from "../../mcp/types";
import { Log } from "../../../packages/zee/src/util/log";

const log = Log.create({ service: "zee-browser" });

// Default browser control port (18791 = gateway port 18789 + 2)
const DEFAULT_BROWSER_CONTROL_PORT = 18791;
const DEFAULT_BROWSER_HOST = "127.0.0.1";

function resolveBrowserBaseUrl(): string {
  const port = parseInt(process.env.ZEE_BROWSER_PORT || "", 10) || DEFAULT_BROWSER_CONTROL_PORT;
  const host = process.env.ZEE_BROWSER_HOST || DEFAULT_BROWSER_HOST;
  return `http://${host}:${port}`;
}

// Helper to make browser control API calls
async function browserApi(
  method: string,
  path: string,
  body?: unknown,
  query?: Record<string, string>
): Promise<unknown> {
  const baseUrl = resolveBrowserBaseUrl();
  let url = `${baseUrl}${path}`;
  
  if (query) {
    const params = new URLSearchParams(query);
    url += `?${params.toString()}`;
  }

  const options: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };

  if (body && method !== "GET") {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  
  if (!response.ok) {
    const text = await response.text().catch(() => "Unknown error");
    throw new Error(`Browser API error (${response.status}): ${text}`);
  }

  // Some endpoints return 204 or empty bodies
  const contentType = response.headers.get("content-type");
  if (contentType?.includes("application/json")) {
    return await response.json();
  }
  return { ok: true };
}

// =============================================================================
// Browser Tool Schema
// =============================================================================

const BrowserParams = z.object({
  action: z.enum([
    "status",
    "start",
    "stop",
    "profiles",
    "tabs",
    "open",
    "close",
    "focus",
    "snapshot",
    "click",
    "type",
    "press",
    "navigate",
    "screenshot",
  ]).describe("Browser action to perform"),
  
  // Profile selection
  profile: z.string().default("zee")
    .describe("Browser profile name. Defaults to the session's persona profile if available. Built-in: 'zee', 'chrome'"),

  // Persona context (auto-selects the persona's dedicated browser profile)
  persona: z.enum(["zee"]).optional()
    .describe("Persona context. Zee uses the dedicated Zee Chrome profile when set"),
  
  // URL for navigation
  url: z.string().optional()
    .describe("URL for navigate or open actions"),
  
  // Tab targeting
  targetId: z.string().optional()
    .describe("Tab target ID for actions on specific tabs"),
  
  // Element interaction
  ref: z.string().optional()
    .describe("Element reference from snapshot (e.g., 'e12', 'a5')"),
  
  // Text input
  text: z.string().optional()
    .describe("Text to type for 'type' action"),
  
  // Key press
  key: z.string().optional()
    .describe("Key to press for 'press' action (e.g., 'Enter', 'Escape')"),
  
  // Snapshot options
  format: z.enum(["aria", "ai"]).default("ai")
    .describe("Snapshot format: 'aria' (structured) or 'ai' (readable)"),
  maxChars: z.number().optional()
    .describe("Maximum characters for AI snapshot"),
  
  // Click options
  doubleClick: z.boolean().default(false)
    .describe("Double click for 'click' action"),
  button: z.enum(["left", "right", "middle"]).default("left")
    .describe("Mouse button for click action"),
  
  // Type options
  submit: z.boolean().default(false)
    .describe("Submit form after typing (press Enter)"),
  slowly: z.boolean().default(false)
    .describe("Type slowly (human-like)"),
  
  // Screenshot options
  fullPage: z.boolean().default(false)
    .describe("Capture full page screenshot"),
});

// =============================================================================
// Browser Tool
// =============================================================================

export const browserTool: ToolDefinition = {
  id: "zee:browser",
  category: "domain",
  init: async () => ({
    description: `Control a browser via Zee's browser automation server.

**Profiles:**
- "zee" (default): Isolated Zee-managed browser (Playwright)
- "chrome": Take over your existing Chrome via the Zee Browser Relay extension

**Actions:**
- status: Get browser status for a profile
- start: Start the browser
- stop: Stop the browser
- profiles: List all profiles
- tabs: List open tabs
- open: Open a new tab with URL
- close: Close a tab by targetId
- focus: Focus/switch to a tab
- snapshot: Get page content snapshot with interactive elements
- click: Click an element by ref
- type: Type text into an element
- press: Press a key
- navigate: Navigate to URL
- screenshot: Take a screenshot

**Using refs:**
After a snapshot, use the ref IDs (e.g., "e12", "a5") to interact with elements:
1. snapshot → get refs
2. click/type with ref → interact

**Examples:**
- { action: "start", profile: "zee" }
- { action: "open", url: "https://google.com" }
- { action: "snapshot", format: "ai" }
- { action: "click", ref: "e12" }
- { action: "type", ref: "e5", text: "hello", submit: true }`,
    parameters: BrowserParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const { action, persona } = args;
      // Resolve persona to its dedicated profile, or use explicit profile
      const PERSONA_PROFILES: Record<string, string> = { zee: "zee" };
      const profile = persona && PERSONA_PROFILES[persona] ? PERSONA_PROFILES[persona] : args.profile;

      ctx.metadata({ title: `Browser: ${action}` });

      try {
        let result: unknown;

        switch (action) {
          // Status and control
          case "status":
            result = await browserApi("GET", "/", undefined, { profile });
            return {
              title: "Browser Status",
              metadata: { profile, ...(result as Record<string, unknown>) },
              output: formatStatus(result),
            };

          case "start":
            result = await browserApi("POST", "/start", undefined, { profile });
            return {
              title: "Browser Started",
              metadata: { profile, ...(result as Record<string, unknown>) },
              output: `Browser started with profile "${profile}"`,
            };

          case "stop":
            result = await browserApi("POST", "/stop", undefined, { profile });
            return {
              title: "Browser Stopped",
              metadata: { profile, ...(result as Record<string, unknown>) },
              output: `Browser stopped for profile "${profile}"`,
            };

          case "profiles":
            result = await browserApi("GET", "/profiles");
            return {
              title: "Browser Profiles",
              metadata: result as Record<string, unknown>,
              output: formatProfiles(result),
            };

          // Tab management
          case "tabs":
            result = await browserApi("GET", "/tabs", undefined, { profile });
            return {
              title: "Browser Tabs",
              metadata: { profile, ...(result as Record<string, unknown>) },
              output: formatTabs(result),
            };

          case "open": {
            if (!args.url) {
              return {
                title: "Error: URL Required",
                metadata: { error: "missing_url" },
                output: "The 'open' action requires a 'url' parameter",
              };
            }
            result = await browserApi("POST", "/tabs/open", { url: args.url }, { profile });
            return {
              title: "Tab Opened",
              metadata: { profile, url: args.url, ...(result as Record<string, unknown>) },
              output: `Opened ${args.url}`,
            };
          }

          case "close": {
            if (!args.targetId) {
              return {
                title: "Error: targetId Required",
                metadata: { error: "missing_targetId" },
                output: "The 'close' action requires a 'targetId' parameter",
              };
            }
            result = await browserApi("DELETE", `/tabs/${args.targetId}`, undefined, { profile });
            return {
              title: "Tab Closed",
              metadata: { profile, targetId: args.targetId },
              output: `Closed tab ${args.targetId.substring(0, 20)}...`,
            };
          }

          case "focus": {
            if (!args.targetId) {
              return {
                title: "Error: targetId Required",
                metadata: { error: "missing_targetId" },
                output: "The 'focus' action requires a 'targetId' parameter",
              };
            }
            result = await browserApi("POST", "/tabs/focus", { targetId: args.targetId }, { profile });
            return {
              title: "Tab Focused",
              metadata: { profile, targetId: args.targetId },
              output: `Focused tab ${args.targetId.substring(0, 20)}...`,
            };
          }

          // Page interaction
          case "snapshot": {
            const snapshotBody: Record<string, unknown> = {
              format: args.format,
              targetId: args.targetId,
            };
            if (args.maxChars) snapshotBody.maxChars = args.maxChars;
            
            result = await browserApi("POST", "/snapshot", snapshotBody, { profile });
            return {
              title: "Page Snapshot",
              metadata: { profile, format: args.format },
              output: formatSnapshot(result),
            };
          }

          case "click": {
            if (!args.ref) {
              return {
                title: "Error: ref Required",
                metadata: { error: "missing_ref" },
                output: "The 'click' action requires a 'ref' parameter from snapshot",
              };
            }
            result = await browserApi("POST", "/act", {
              kind: "click",
              ref: args.ref,
              targetId: args.targetId,
              doubleClick: args.doubleClick,
              button: args.button,
            }, { profile });
            return {
              title: "Element Clicked",
              metadata: { profile, ref: args.ref },
              output: `Clicked ${args.doubleClick ? "double " : ""}${args.button} on ${args.ref}`,
            };
          }

          case "type": {
            if (!args.ref || args.text === undefined) {
              return {
                title: "Error: ref and text Required",
                metadata: { error: "missing_params" },
                output: "The 'type' action requires 'ref' and 'text' parameters",
              };
            }
            result = await browserApi("POST", "/act", {
              kind: "type",
              ref: args.ref,
              text: args.text,
              targetId: args.targetId,
              submit: args.submit,
              slowly: args.slowly,
            }, { profile });
            return {
              title: "Text Typed",
              metadata: { profile, ref: args.ref },
              output: `Typed "${args.text.substring(0, 50)}${args.text.length > 50 ? "..." : ""}"${args.submit ? " and submitted" : ""}`,
            };
          }

          case "press": {
            if (!args.key) {
              return {
                title: "Error: key Required",
                metadata: { error: "missing_key" },
                output: "The 'press' action requires a 'key' parameter",
              };
            }
            result = await browserApi("POST", "/act", {
              kind: "press",
              key: args.key,
              targetId: args.targetId,
            }, { profile });
            return {
              title: "Key Pressed",
              metadata: { profile, key: args.key },
              output: `Pressed ${args.key}`,
            };
          }

          case "navigate": {
            if (!args.url) {
              return {
                title: "Error: URL Required",
                metadata: { error: "missing_url" },
                output: "The 'navigate' action requires a 'url' parameter",
              };
            }
            result = await browserApi("POST", "/act", {
              kind: "navigate",
              url: args.url,
              targetId: args.targetId,
            }, { profile });
            return {
              title: "Navigated",
              metadata: { profile, url: args.url },
              output: `Navigated to ${args.url}`,
            };
          }

          case "screenshot": {
            const screenshotBody: Record<string, unknown> = {
              targetId: args.targetId,
              fullPage: args.fullPage,
            };
            result = await browserApi("POST", "/screenshot", screenshotBody, { profile });
            return {
              title: "Screenshot Taken",
              metadata: { profile, fullPage: args.fullPage, ...(result as Record<string, unknown>) },
              output: formatScreenshot(result),
            };
          }

          default:
            return {
              title: "Error: Unknown Action",
              metadata: { action, error: "unknown_action" },
              output: `Unknown browser action: ${action}`,
            };
        }

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        
        if (errorMsg.includes("ECONNREFUSED") || errorMsg.includes("fetch failed")) {
          return {
            title: "Browser Control Unavailable",
            metadata: { action, error: "connection_failed" },
            output: `Cannot connect to Zee browser control server.

Make sure:
1. Zee gateway is running (zee daemon --gateway)
2. Browser control is enabled in Zee config
3. Browser control port is accessible (default: 18791)

Error: ${errorMsg}`,
          };
        }

        return {
          title: "Browser Action Failed",
          metadata: { action, error: errorMsg },
          output: `Browser action failed: ${errorMsg}`,
        };
      }
    },
  }),
};

// =============================================================================
// Formatting Helpers
// =============================================================================

function formatStatus(result: unknown): string {
  if (!result || typeof result !== "object") return "Status unavailable";
  const s = result as Record<string, unknown>;
  
  const lines: string[] = [];
  lines.push(`Profile: ${s.profile || "unknown"}`);
  lines.push(`Running: ${s.running ? "Yes" : "No"}`);
  lines.push(`CDP Ready: ${s.cdpReady ? "Yes" : "No"}`);
  
  if (s.pid) lines.push(`PID: ${s.pid}`);
  if (s.cdpPort) lines.push(`CDP Port: ${s.cdpPort}`);
  if (s.detectedBrowser) lines.push(`Browser: ${s.detectedBrowser}`);
  if (s.detectedExecutablePath) lines.push(`Executable: ${s.detectedExecutablePath}`);
  if (s.headless !== undefined) lines.push(`Headless: ${s.headless ? "Yes" : "No"}`);
  
  return lines.join("\n");
}

function formatProfiles(result: unknown): string {
  if (!result || typeof result !== "object") return "No profiles";
  const r = result as { profiles?: unknown[] };
  if (!Array.isArray(r.profiles) || r.profiles.length === 0) {
    return "No profiles configured";
  }
  
  return r.profiles.map((p: unknown) => {
    const profile = p as Record<string, unknown>;
    const name = profile.name || "unknown";
    const running = profile.running ? "●" : "○";
    const tabs = profile.tabCount ?? 0;
    const port = profile.cdpPort || "?";
    return `${running} ${name} (port ${port}, ${tabs} tabs)`;
  }).join("\n");
}

function formatTabs(result: unknown): string {
  if (!result || typeof result !== "object") return "No tabs";
  const r = result as { tabs?: unknown[]; running?: boolean };
  
  if (!r.running) return "Browser not running";
  if (!Array.isArray(r.tabs) || r.tabs.length === 0) {
    return "No tabs open";
  }
  
  return r.tabs.map((t: unknown, i: number) => {
    const tab = t as Record<string, unknown>;
    const title = tab.title || "Untitled";
    const url = tab.url || "";
    const targetId = (tab.targetId as string)?.substring(0, 12) || "?";
    return `${i + 1}. ${title}\n   ${url}\n   [${targetId}...]`;
  }).join("\n\n");
}

function formatSnapshot(result: unknown): string {
  if (!result || typeof result !== "object") return "Snapshot unavailable";
  const s = result as Record<string, unknown>;
  
  if (s.format === "aria" && Array.isArray(s.nodes)) {
    const nodes = s.nodes as Array<{ ref: string; role: string; name: string }>;
    const lines = nodes.map(n => `[${n.ref}] ${n.role}: ${n.name}`);
    return lines.join("\n");
  }
  
  if (s.format === "ai" && typeof s.snapshot === "string") {
    let output = s.snapshot;
    if (s.truncated) output += "\n\n[Snapshot truncated]";
    if (s.stats) {
      const stats = s.stats as Record<string, number>;
      output += `\n\n[Stats: ${stats.chars} chars, ${stats.refs} refs, ${stats.interactive} interactive]`;
    }
    return output;
  }
  
  return "Unexpected snapshot format";
}

function formatScreenshot(result: unknown): string {
  if (!result || typeof result !== "object") return "Screenshot unavailable";
  const r = result as Record<string, unknown>;
  
  const lines: string[] = [];
  if (r.path) lines.push(`Saved to: ${r.path}`);
  if (r.url) lines.push(`URL: ${r.url}`);
  if (r.width && r.height) {
    lines.push(`Dimensions: ${r.width}x${r.height}`);
  }
  if (r.fullPage) lines.push("Full page: Yes");
  
  return lines.join("\n") || "Screenshot captured";
}

// Export for registration
export const ZEE_BROWSER_TOOLS = [browserTool];
