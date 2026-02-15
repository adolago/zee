/**
 * Stanley Daemon Lifecycle Manager
 *
 * Manages the Stanley FastAPI server process:
 * - Auto-start if not running
 * - Health polling during startup
 * - Auto-restart on crash
 * - Graceful shutdown
 */

import type { DaemonConfig } from "./config";
import { StanleyDaemonError, StanleyNotRunningError } from "./errors";
import type { Subprocess } from "bun";

export class StanleyDaemon {
  private process: Subprocess | null = null;
  private running = false;
  private baseUrl: string;

  constructor(private config: DaemonConfig) {
    this.baseUrl = `http://${config.host}:${config.port}`;
  }

  /** Ensure Stanley API is running. Start if needed. */
  async ensureRunning(): Promise<void> {
    if (await this.isHealthy()) {
      this.running = true;
      return;
    }

    if (!this.config.autoStart) {
      throw new StanleyNotRunningError(this.baseUrl);
    }

    await this.start();
  }

  /** Start the Stanley API server */
  async start(): Promise<void> {
    if (this.process) {
      throw new StanleyDaemonError("Daemon already started");
    }

    const pythonPath = this.config.pythonPath;
    const args = [
      "-m", "uvicorn",
      "stanley.api.main_new:app",
      "--host", this.config.host,
      "--port", String(this.config.port),
    ];

    const env: Record<string, string> = { ...process.env as Record<string, string> };

    // Set working directory to Stanley repo if specified
    const cwd = this.config.repoPath;

    try {
      this.process = Bun.spawn([pythonPath, ...args], {
        cwd,
        env,
        stdout: "pipe",
        stderr: "pipe",
      });

      // Monitor for unexpected exit
      this.monitorProcess();

      // Wait for healthy
      await this.waitForHealthy();
      this.running = true;
    } catch (error) {
      this.process = null;
      throw new StanleyDaemonError(
        `Failed to start Stanley API: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /** Stop the Stanley API server */
  async stop(): Promise<void> {
    if (!this.process) return;

    try {
      this.process.kill("SIGTERM");

      // Wait up to 5s for graceful shutdown
      const gracefulTimeout = setTimeout(() => {
        if (this.process) {
          this.process.kill("SIGKILL");
        }
      }, 5_000);

      await this.process.exited;
      clearTimeout(gracefulTimeout);
    } catch {
      // Best effort
    } finally {
      this.process = null;
      this.running = false;
    }
  }

  /** Check if API is healthy */
  async isHealthy(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3_000);

      const response = await fetch(`${this.baseUrl}/api/health`, {
        signal: controller.signal,
      });

      clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  }

  /** Whether daemon is running */
  get isRunning(): boolean {
    return this.running;
  }

  /** Get the base URL */
  get url(): string {
    return this.baseUrl;
  }

  /** Get process PID if running */
  get pid(): number | null {
    return this.process?.pid ?? null;
  }

  private async waitForHealthy(): Promise<void> {
    const startTime = Date.now();
    const { startupTimeoutMs, healthPollIntervalMs } = this.config;

    while (Date.now() - startTime < startupTimeoutMs) {
      if (await this.isHealthy()) return;
      await sleep(healthPollIntervalMs);

      // Check if process exited during startup
      if (this.process && this.process.exitCode !== null) {
        throw new StanleyDaemonError(
          `Stanley API exited during startup with code ${this.process.exitCode}`,
        );
      }
    }

    // Timeout — kill the process
    await this.stop();
    throw new StanleyDaemonError(
      `Stanley API failed to become healthy within ${startupTimeoutMs}ms`,
    );
  }

  private monitorProcess(): void {
    if (!this.process) return;

    // Background monitoring for unexpected exit
    this.process.exited.then(async (exitCode) => {
      if (!this.running) return; // Expected shutdown

      this.process = null;
      this.running = false;

      if (this.config.autoRestart) {
        try {
          await sleep(1_000); // Brief cooldown
          await this.start();
        } catch {
          // Auto-restart failed, stay stopped
        }
      }
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
