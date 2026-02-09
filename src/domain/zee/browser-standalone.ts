/**
 * Zee Standalone Browser Tool
 *
 * Direct browser automation by spawning Chromium via shell commands.
 * Does NOT require Zee gateway - uses Playwright installed in zee.
 * This is the "kernel.sh" approach to browsing.
 */

import { z } from "zod";
import type { ToolDefinition, ToolExecutionResult } from "../../mcp/types";
import { Log } from "../../../packages/zee-core/src/util/log";
import { spawn } from "child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Socket } from "net";
import net from "net";
import WebSocket from "ws";

const log = Log.create({ service: "zee-browser-standalone" });

// State management for spawned browsers
interface BrowserInstance {
  pid: number;
  cdpPort: number;
  userDataDir: string;
  profile: string;
  launchedAt: Date;
}

const activeBrowsers = new Map<string, BrowserInstance>();
const SCREENSHOT_DIR = join(process.cwd(), ".zee", "screenshots");

// =============================================================================
// Helper Functions
// =============================================================================

function getAvailablePort(): number {
  // Simple port selection from a range
  const basePort = 19200;
  const maxAttempts = 100;
  
  for (let i = 0; i < maxAttempts; i++) {
    const port = basePort + i;
    // Check if port is already in use by one of our browsers
    let inUse = false;
    for (const browser of activeBrowsers.values()) {
      if (browser.cdpPort === port) {
        inUse = true;
        break;
      }
    }
    if (!inUse) return port;
  }
  throw new Error("No available ports found");
}

function createUserDataDir(): string {
  return mkdtempSync(join(tmpdir(), "zee-chrome-"));
}

async function isPortReachable(port: number, timeout = 5000): Promise<boolean> {
  const net = await import("net");
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeout);

    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });

    socket.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });

    socket.connect(port, "127.0.0.1");
  });
}

async function cdpRequest(port: number, path: string, method = "GET", body?: unknown): Promise<unknown> {
  const url = `http://127.0.0.1:${port}${path}`;
  
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    throw new Error(`CDP request failed: ${response.status} ${await response.text()}`);
  }

  return await response.json();
}

function findChromeExecutable(): string {
  const platform = process.platform;
  const possiblePaths: string[] = [];

  if (platform === "linux") {
    possiblePaths.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/snap/bin/chromium",
      "/usr/local/bin/chrome"
    );
  } else if (platform === "darwin") {
    possiblePaths.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/usr/local/bin/chrome"
    );
  } else if (platform === "win32") {
    possiblePaths.push(
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      "chrome"
    );
  }

  for (const path of possiblePaths) {
    if (existsSync(path)) return path;
  }

  // Fallback to trying chrome in PATH
  return "google-chrome-stable";
}

// =============================================================================
// Browser Actions
// =============================================================================

async function launchBrowser(profile: string, headless = false): Promise<BrowserInstance> {
  const existing = activeBrowsers.get(profile);
  if (existing) {
    const reachable = await isPortReachable(existing.cdpPort, 1000);
    if (reachable) return existing;
    // Clean up dead browser
    activeBrowsers.delete(profile);
  }

  const cdpPort = getAvailablePort();
  const userDataDir = createUserDataDir();
  const chromePath = findChromeExecutable();

  const args = [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-default-apps",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-features=TranslateUI",
    "--disable-component-extensions-with-background-pages",
    "--disable-background-networking",
    "--enable-automation",
    "--password-store=basic",
    "--use-mock-keychain",
    "--force-color-profile=srgb",
  ];

  const isWaylandSession =
    process.platform === "linux" &&
    (process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === "wayland");
  if (!headless && isWaylandSession) {
    args.push("--ozone-platform-hint=auto", "--enable-features=UseOzonePlatform");
  }

  if (headless) {
    args.push("--headless=new");
  }

  if (process.platform === "linux") {
    args.push("--no-sandbox", "--disable-setuid-sandbox");
  }

  log.info("Launching Chrome", { chromePath, cdpPort, profile });

  const proc = spawn(chromePath, args, {
    detached: false,
    stdio: ["ignore", "ignore", "ignore"],
  });

  if (!proc.pid) {
    throw new Error("Failed to launch Chrome - no PID obtained");
  }

  // Wait for Chrome to start accepting connections
  let attempts = 0;
  const maxAttempts = 50;
  while (attempts < maxAttempts) {
    await new Promise(r => setTimeout(r, 100));
    const reachable = await isPortReachable(cdpPort, 500);
    if (reachable) break;
    attempts++;
  }

  if (attempts >= maxAttempts) {
    proc.kill();
    throw new Error("Chrome failed to start within timeout");
  }

  const instance: BrowserInstance = {
    pid: proc.pid,
    cdpPort,
    userDataDir,
    profile,
    launchedAt: new Date(),
  };

  activeBrowsers.set(profile, instance);

  // Handle process exit
  proc.on("exit", (code) => {
    log.info("Chrome process exited", { pid: proc.pid, code });
    activeBrowsers.delete(profile);
    // Cleanup user data dir
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  return instance;
}

async function stopBrowser(profile: string): Promise<void> {
  const browser = activeBrowsers.get(profile);
  if (!browser) {
    throw new Error(`No browser running for profile: ${profile}`);
  }

  try {
    process.kill(browser.pid, "SIGTERM");
  } catch (error) {
    log.warn("Failed to kill browser process", { pid: browser.pid, error });
  }

  activeBrowsers.delete(profile);

  // Cleanup
  try {
    rmSync(browser.userDataDir, { recursive: true, force: true });
  } catch {
    // Ignore
  }
}

async function getTabs(cdpPort: number): Promise<Array<{ id: string; url: string; title: string }>> {
  try {
    const pages = await cdpRequest(cdpPort, "/json/list") as Array<{
      id: string;
      url: string;
      title: string;
      type: string;
    }>;
    return pages.filter(p => p.type === "page").map(p => ({
      id: p.id,
      url: p.url,
      title: p.title,
    }));
  } catch {
    return [];
  }
}

async function navigateTo(cdpPort: number, url: string): Promise<void> {
  // Get the first tab and navigate
  const tabs = await getTabs(cdpPort);
  if (tabs.length === 0) {
    throw new Error("No tabs available");
  }

  const tab = tabs[0];
  const wsUrl = `ws://127.0.0.1:${cdpPort}/devtools/page/${tab.id}`;
  
  // Use CDP to navigate
  const ws = new WebSocket(wsUrl);

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("Navigation timeout"));
    }, 30000);

    ws.once("open", () => {
      ws.send(JSON.stringify({
        id: 1,
        method: "Page.navigate",
        params: { url },
      }));
    });

    ws.on("message", (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === 1) {
        clearTimeout(timeout);
        ws.close();
        resolve();
      }
    });

    ws.on("error", (err: Error) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function takeScreenshot(cdpPort: number, fullPage = false): Promise<string> {
  const tabs = await getTabs(cdpPort);
  if (tabs.length === 0) {
    throw new Error("No tabs available");
  }

  const tab = tabs[0];
  const screenshotUrl = `http://127.0.0.1:${cdpPort}/devtools/page/${tab.id}`;
  
  // Get screenshot via CDP
  const ws = new WebSocket(`ws://127.0.0.1:${cdpPort}/devtools/page/${tab.id}`);

  const screenshot = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("Screenshot timeout"));
    }, 30000);

    ws.once("open", () => {
      // Enable page domain
      ws.send(JSON.stringify({ id: 1, method: "Page.enable" }));
    });

    let pageEnabled = false;

    ws.on("message", (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      
      if (msg.id === 1) {
        pageEnabled = true;
        // Capture screenshot
        ws.send(JSON.stringify({
          id: 2,
          method: "Page.captureScreenshot",
          params: { format: "png", fromSurface: true },
        }));
      }

      if (msg.id === 2 && msg.result?.data) {
        clearTimeout(timeout);
        ws.close();
        resolve(msg.result.data as string);
      }

      if (msg.error) {
        clearTimeout(timeout);
        ws.close();
        reject(new Error(msg.error.message));
      }
    });

    ws.on("error", (err: Error) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  // Save to file
  const timestamp = Date.now();
  const filename = join(SCREENSHOT_DIR, `screenshot-${timestamp}.png`);
  
  // Ensure directory exists
  const { mkdirSync } = await import("fs");
  try {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
  } catch {
    // Ignore
  }

  writeFileSync(filename, Buffer.from(screenshot, "base64"));
  return filename;
}

async function getPageContent(cdpPort: number): Promise<string> {
  const tabs = await getTabs(cdpPort);
  if (tabs.length === 0) {
    throw new Error("No tabs available");
  }

  const tab = tabs[0];
  const ws = new WebSocket(`ws://127.0.0.1:${cdpPort}/devtools/page/${tab.id}`);

  const content = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("Content extraction timeout"));
    }, 30000);

    ws.once("open", () => {
      ws.send(JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: {
          expression: "document.documentElement.outerHTML",
          returnByValue: true,
        },
      }));
    });

    ws.on("message", (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      
      if (msg.id === 1 && msg.result?.result?.value) {
        clearTimeout(timeout);
        ws.close();
        resolve(msg.result.result.value as string);
      }

      if (msg.error) {
        clearTimeout(timeout);
        ws.close();
        reject(new Error(msg.error.message));
      }
    });

    ws.on("error", (err: Error) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  return content;
}

// =============================================================================
// Tool Schema
// =============================================================================

const StandaloneBrowserParams = z.object({
  action: z.enum([
    "launch",
    "stop",
    "status",
    "navigate",
    "screenshot",
    "content",
    "tabs",
  ]).describe("Browser action to perform"),
  
  profile: z.string().default("default")
    .describe("Browser profile name (for isolated sessions)"),
  
  url: z.string().optional()
    .describe("URL for navigate action"),
  
  headless: z.boolean().default(false)
    .describe("Run browser in headless mode (no GUI)"),
  
  fullPage: z.boolean().default(false)
    .describe("Capture full page in screenshot"),
});

// =============================================================================
// Tool Definition
// =============================================================================

export const standaloneBrowserTool: ToolDefinition = {
  id: "zee:browser-standalone",
  category: "domain",
  init: async () => ({
    description: `Spawn and control Chromium directly via CDP (Chrome DevTools Protocol).

**IMPORTANT**: This tool spawns its OWN Chrome instance - does NOT require Zee gateway.
Uses "kernel.sh" approach (direct process spawning).

**Actions:**
- launch: Start a Chrome browser instance
- stop: Stop the browser
- status: Check browser status
- navigate: Navigate to a URL
- screenshot: Take a screenshot (saved to .zee/screenshots/)
- content: Get page HTML content
- tabs: List open tabs

**Features:**
- Each profile gets its own isolated browser
- Headed mode by default (set headless: true for no GUI)
- Direct CDP control (no Playwright dependency in zee)
- Auto-cleanup on process exit

**Examples:**
- { action: "launch", profile: "default" }
- { action: "navigate", url: "https://google.com" }
- { action: "screenshot", fullPage: true }
- { action: "content" }
- { action: "stop" }

**Requirements:**
- Chrome/Chromium must be installed
- Uses ports 19200+ for CDP`,
    parameters: StandaloneBrowserParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const { action, profile } = args;
      
      ctx.metadata({ title: `Browser: ${action}` });

      try {
        switch (action) {
          case "launch": {
            const browser = await launchBrowser(profile, args.headless);
            return {
              title: "Browser Launched",
              metadata: { 
                profile, 
                pid: browser.pid, 
                cdpPort: browser.cdpPort,
                headless: args.headless,
              },
              output: `Chrome launched for profile "${profile}"\nPID: ${browser.pid}\nCDP Port: ${browser.cdpPort}\nHeadless: ${args.headless}`,
            };
          }

          case "stop": {
            await stopBrowser(profile);
            return {
              title: "Browser Stopped",
              metadata: { profile },
              output: `Browser stopped for profile "${profile}"`,
            };
          }

          case "status": {
            const browser = activeBrowsers.get(profile);
            if (!browser) {
              return {
                title: "Browser Not Running",
                metadata: { profile, running: false },
                output: `No browser running for profile "${profile}"`,
              };
            }

            const reachable = await isPortReachable(browser.cdpPort, 1000);
            const tabs = reachable ? await getTabs(browser.cdpPort) : [];

            return {
              title: "Browser Status",
              metadata: { 
                profile, 
                running: reachable,
                pid: browser.pid,
                cdpPort: browser.cdpPort,
                launchedAt: browser.launchedAt,
                tabCount: tabs.length,
              },
              output: `Profile: ${profile}\nRunning: ${reachable ? "Yes" : "No (crashed?)"}\nPID: ${browser.pid}\nCDP Port: ${browser.cdpPort}\nTabs: ${tabs.length}\nLaunched: ${browser.launchedAt.toISOString()}`,
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

            const browser = activeBrowsers.get(profile);
            if (!browser) {
              // Auto-launch if not running
              await launchBrowser(profile, args.headless);
              const newBrowser = activeBrowsers.get(profile)!;
              await navigateTo(newBrowser.cdpPort, args.url);
            } else {
              await navigateTo(browser.cdpPort, args.url);
            }

            return {
              title: "Navigated",
              metadata: { profile, url: args.url },
              output: `Navigated to ${args.url}`,
            };
          }

          case "screenshot": {
            const browser = activeBrowsers.get(profile);
            if (!browser) {
              return {
                title: "Error: Browser Not Running",
                metadata: { error: "browser_not_running" },
                output: `No browser running for profile "${profile}". Launch first with { action: "launch" }`,
              };
            }

            const screenshotPath = await takeScreenshot(browser.cdpPort, args.fullPage);
            return {
              title: "Screenshot Taken",
              metadata: { profile, path: screenshotPath, fullPage: args.fullPage },
              output: `Screenshot saved to: ${screenshotPath}`,
            };
          }

          case "content": {
            const browser = activeBrowsers.get(profile);
            if (!browser) {
              return {
                title: "Error: Browser Not Running",
                metadata: { error: "browser_not_running" },
                output: `No browser running for profile "${profile}"`,
              };
            }

            const content = await getPageContent(browser.cdpPort);
            const truncated = content.length > 10000 ? content.substring(0, 10000) + "\n\n[truncated...]" : content;
            
            return {
              title: "Page Content",
              metadata: { profile, length: content.length },
              output: truncated,
            };
          }

          case "tabs": {
            const browser = activeBrowsers.get(profile);
            if (!browser) {
              return {
                title: "Browser Not Running",
                metadata: { profile, tabs: [] },
                output: `No browser running for profile "${profile}"`,
              };
            }

            const tabs = await getTabs(browser.cdpPort);
            const output = tabs.map((t, i) => `${i + 1}. ${t.title}\n   ${t.url}`).join("\n\n");

            return {
              title: "Browser Tabs",
              metadata: { profile, tabs },
              output: output || "No tabs",
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
        log.error("Browser action failed", { action, profile, error: errorMsg });
        
        return {
          title: "Browser Action Failed",
          metadata: { action, profile, error: errorMsg },
          output: `Error: ${errorMsg}\n\nMake sure Chrome/Chromium is installed:\n- Linux: google-chrome-stable or chromium\n- macOS: Google Chrome.app\n- Windows: chrome.exe`,
        };
      }
    },
  }),
};

export const ZEE_STANDALONE_BROWSER_TOOLS = [standaloneBrowserTool];
