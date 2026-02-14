// Unified always-on process startup.
// Extracts the daemon initialization sequence into a reusable function
// that can be called from both the daemon command and the TUI default command.

import { Server } from "../../server/server"
import { Log } from "../../util/log"
import { Session } from "../../session"
import { Todo } from "../../session/todo"
import { Persistence } from "../../session/persistence"
import { Instance } from "../../project/instance"
import { LifecycleHooks } from "../../hooks/lifecycle"
import { WeztermOrchestration } from "../../orchestration/wezterm"
import { initPersonas } from "../../bootstrap/personas"
import { initSurfaces, shutdownSurfaces } from "../../bootstrap/surface"
import { CircuitBreaker } from "../../provider/circuit-breaker"
import * as UsageTracker from "../../usage/tracker"
import { initWorkStealing, getWorkStealingService, initConsensus, getConsensusGate } from "../../coordination"
import { Output } from "../output"
import { Daemon, GatewaySupervisor } from "./daemon"
import { validateSetup } from "../setup-check"
import { CronService } from "../../cron/service"
import type { CronServiceDeps } from "../../cron/service"
import { setCronService } from "../../server/route/cron"
import { runIsolatedAgentJob } from "../../cron/isolated-agent"
import { resolveCronStorePath } from "../../cron/store"
import { HeartbeatRunner } from "../../heartbeat/runner"
import { setHeartbeatRunner } from "../../server/route/heartbeat"
import { startSkillWatcher, stopSkillWatcher } from "../../skill/watcher"
import { Config } from "../../config/config"
import { GlobalBus } from "../../bus/global"
import type { RuntimeProcessLimits } from "./runtime-process-guard"
import path from "path"

const log = Log.create({ service: "always-on" })

export interface AlwaysOnOptions {
  hostname: string
  port: number
  directory: string
  gateway?: boolean
  gatewayForce?: boolean
  wezterm?: boolean
  weztermLayout?: "horizontal" | "vertical" | "grid"
  restoreSessions?: boolean
  runtimeGuard?: boolean
  runtimeGuardIntervalMs?: number
  runtimeLimits?: Partial<RuntimeProcessLimits>
}

export interface AlwaysOnProcess {
  url: string
  port: number
  hostname: string
  cleanup: (signal?: NodeJS.Signals, error?: Error) => Promise<void>
}

export async function startAlwaysOnProcess(opts: AlwaysOnOptions): Promise<AlwaysOnProcess> {
  const {
    hostname,
    port,
    directory,
    gateway = true,
    gatewayForce = false,
    wezterm = true,
    weztermLayout = "horizontal",
    restoreSessions = true,
  } = opts

  // Run setup check
  const setupResult = await validateSetup({ exitOnFail: false, verbose: true })

  log.info("starting always-on process", {
    directory,
    hostname,
    port,
    setupOk: setupResult.ok,
  })

  // Start the server
  const server = Server.listen({ hostname, port })
  const serverHost = server.hostname ?? hostname
  const daemonHost = serverHost === "0.0.0.0" ? "127.0.0.1" : serverHost
  const daemonPort = server.port ?? port
  const daemonUrl = `http://${daemonHost}:${daemonPort}`

  // Write PID file
  const state: Daemon.DaemonState = {
    pid: process.pid,
    port: daemonPort,
    hostname: serverHost,
    startTime: Date.now(),
    directory,
  }
  await Daemon.writePidFile(state)

  // Emit daemon.start hook
  await LifecycleHooks.emitDaemonStart({
    pid: process.pid,
    port: state.port,
    hostname: state.hostname,
    directory,
    startTime: state.startTime,
  })

  // Track what was initialized for cleanup
  let persistenceEnabled = false
  let surfacesEnabled = false
  let usageEnabled = false
  let workStealingEnabled = false
  let consensusEnabled = false
  let weztermEnabled = false
  let gatewayStarted = false
  let cronService: CronService | null = null
  let heartbeatRunner: HeartbeatRunner | null = null

  // Initialize session persistence
  try {
    await Instance.provide({
      directory,
      async fn() {
        await Persistence.init({
          checkpointInterval: 5 * 60 * 1000,
          maxCheckpoints: 3,
          enableWAL: true,
        })
        persistenceEnabled = true
      },
    })
    Output.log("Persistence: Enabled (checkpoints + WAL)")
  } catch (error) {
    log.error("Failed to initialize persistence", {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  // Initialize circuit breaker
  try {
    await CircuitBreaker.init()
    Output.log("Circuit Breaker: Initialized")
  } catch (error) {
    log.error("Failed to initialize circuit breaker", {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  // Initialize persona hooks
  try {
    await initPersonas()
    Output.log("Personas:   Hooks initialized")
  } catch (error) {
    log.debug("Personas initialization skipped", {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  // Initialize surfaces
  try {
    await initSurfaces()
    surfacesEnabled = true
    Output.log("Surfaces:   Multi-surface support enabled")
  } catch (error) {
    log.debug("Surface initialization skipped", {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  // Initialize usage tracking
  try {
    await UsageTracker.init()
    usageEnabled = true
    Output.log("Usage:      Tracking enabled")
  } catch (error) {
    log.error("Failed to initialize usage tracking", {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  // Initialize work stealing
  try {
    const workStealingService = await initWorkStealing()
    workStealingEnabled = workStealingService.getStats().enabled
    if (workStealingEnabled) {
      Output.log("WorkSteal:  Load balancing enabled")
    }
  } catch (error) {
    log.debug("Work stealing initialization skipped", {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  // Initialize consensus gate
  try {
    const consensusGate = await initConsensus()
    consensusEnabled = consensusGate.getStats().enabled
    if (consensusEnabled) {
      Output.log("Consensus:  Approval gate enabled")
    }
  } catch (error) {
    log.debug("Consensus gate initialization skipped", {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  // Initialize WezTerm orchestration
  if (wezterm) {
    try {
      weztermEnabled = await WeztermOrchestration.init({
        enabled: true,
        layout: weztermLayout,
        showStatusPane: true,
        statusPanePercent: 20,
        statusRefreshInterval: 5000,
      })
      if (weztermEnabled) {
        Output.log("WezTerm:    Visual orchestration enabled")
      }
    } catch (error) {
      log.debug("WezTerm initialization failed", {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // Start skill watcher
  try {
    startSkillWatcher({ directory })
    Output.log("Skills:     Hot-reload watcher started")
  } catch (error) {
    log.debug("Skill watcher initialization failed", {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  // Load config once for cron + heartbeat
  const config = await Config.get().catch(() => ({}) as Config.Info)

  // Start heartbeat runner (before cron, since cron may request heartbeats)
  try {
    const heartbeatEnabled = config.heartbeat?.enabled !== false
    if (heartbeatEnabled) {
      heartbeatRunner = new HeartbeatRunner({
        directory,
        serverUrl: daemonUrl,
        config: config.heartbeat,
      })
      heartbeatRunner.start()
      setHeartbeatRunner(heartbeatRunner)
      Output.log(`Heartbeat:  Active (every ${config.heartbeat?.every ?? "30m"})`)
    } else {
      Output.log("Heartbeat:  Disabled by config")
    }
  } catch (error) {
    log.error("Failed to initialize heartbeat runner", {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  // Start cron service
  try {
    const cronEnabled = config.cron?.enabled !== false
    if (cronEnabled) {
      const cronLog = Log.create({ service: "cron" })
      const storePath = resolveCronStorePath(config.cron?.storeDir)
      const cronDeps: CronServiceDeps = {
        directory,
        log: cronLog,
        storePath,
        cronEnabled: true,
        enqueueSystemEvent: (text, opts) => {
          // Post system event to the main session via HTTP
          fetch(`${daemonUrl}/session`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: `cron:system-event` }),
          })
            .then((res) => res.json())
            .then((session: any) => {
              if (session?.id) {
                fetch(`${daemonUrl}/session/${session.id}/message`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ content: text }),
                }).catch(() => {})
              }
            })
            .catch(() => {})
        },
        requestHeartbeatNow: (opts) => {
          heartbeatRunner?.requestNow(opts)
        },
        runHeartbeatOnce: heartbeatRunner
          ? async (opts) => {
              const result = await heartbeatRunner!.runOnce(opts)
              return result
            }
          : undefined,
        runIsolatedAgentJob: async (params) => {
          return await runIsolatedAgentJob({
            ...params,
            serverUrl: daemonUrl,
          })
        },
        onEvent: (evt) => {
          GlobalBus.emit("event", {
            payload: { type: "cron.event", properties: evt },
          })
        },
      }
      cronService = new CronService(cronDeps)
      await cronService.start()
      setCronService(cronService)
      Output.log("Cron:       Scheduler started")

      // Ensure Zee banner refresh is wired to cron so the rotating TUI banner stays current.
      try {
        await ensureZeeBannerRefreshJob(cronService, directory)
      } catch (err) {
        log.warn("Failed to ensure Zee banner refresh cron job", {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    } else {
      Output.log("Cron:       Disabled by config")
    }
  } catch (error) {
    log.error("Failed to initialize cron service", {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  // Start gateway
  if (gateway) {
    gatewayStarted = await GatewaySupervisor.start({
      force: gatewayForce,
      daemonUrl,
    })
    const gatewayState = GatewaySupervisor.getState()
    if (gatewayStarted) {
      Output.log("Gateway:    Messaging gateway started")
    } else {
      const reason = gatewayState.error ?? "Not available"
      Output.log(`Gateway:    Disabled (${reason})`)
    }
  }

  // Cleanup function
  const cleanup = async (signal?: NodeJS.Signals, error?: Error) => {
    log.info("always-on process shutting down", { signal, error: error?.message })

    const shutdownReason: "signal" | "error" | "manual" = error ? "error" : signal ? "signal" : "manual"

    await LifecycleHooks.emitDaemonShutdown({
      pid: process.pid,
      reason: shutdownReason,
      signal,
      error: error?.message,
    })

    // Stop heartbeat
    if (heartbeatRunner) {
      heartbeatRunner.stop()
    }

    // Stop cron
    if (cronService) {
      cronService.stop()
    }

    // Stop skill watcher
    await stopSkillWatcher()

    // Shutdown WezTerm
    if (weztermEnabled) {
      await WeztermOrchestration.shutdown()
    }

    // Shutdown usage tracking
    if (usageEnabled) {
      await UsageTracker.shutdown()
    }

    // Shutdown gateway
    if (GatewaySupervisor.isEnabled()) {
      await GatewaySupervisor.stop()
    }

    // Shutdown persistence
    if (persistenceEnabled) {
      await Instance.provide({
        directory,
        async fn() {
          await Persistence.shutdown()
        },
      }).catch((e) => log.error("Persistence shutdown error", { error: String(e) }))
    }

    // Circuit breaker
    await CircuitBreaker.shutdown().catch((e) => log.error("Circuit breaker shutdown error", { error: String(e) }))

    // Work stealing
    try {
      getWorkStealingService().shutdown()
    } catch {
      // not initialized
    }

    // Consensus
    try {
      getConsensusGate().shutdown()
    } catch {
      // not initialized
    }

    // Surfaces
    if (surfacesEnabled) {
      await shutdownSurfaces()
    }

    await Daemon.removePidFile()
    await Daemon.releaseLock()
    await server.stop()
  }

  // Restore sessions with todos
  if (restoreSessions) {
    await Instance.provide({
      directory,
      async fn() {
        const count = await restoreSessionsWithTodos(directory)
        if (count > 0) {
          Output.log(`Found ${count} session(s) with incomplete todos ready for continuation.`)
        }
      },
    }).catch(() => {})
  }

  // Emit daemon.ready hook
  await LifecycleHooks.emitDaemonReady({
    pid: process.pid,
    port: state.port,
    services: {
      persistence: persistenceEnabled,
      whatsapp: false,
    },
    sessionsWithIncompleteTodos: 0,
  })

  Output.log(`
Zee Started
===========
PID:       ${process.pid}
Port:      ${daemonPort}
Hostname:  ${serverHost}
Directory: ${directory}
URL:       ${daemonUrl}
`)

  return {
    url: daemonUrl,
    port: daemonPort,
    hostname: serverHost,
    cleanup,
  }
}

async function ensureZeeBannerRefreshJob(cron: CronService, directory: string) {
  const toolPathTs = path.join(directory, ".zee", "tool", "zee-banner-refresh.ts")
  const toolPathJs = path.join(directory, ".zee", "tool", "zee-banner-refresh.js")
  const hasTool = (await Bun.file(toolPathTs).exists()) || (await Bun.file(toolPathJs).exists())
  if (!hasTool) {
    return
  }

  const jobs = await cron.list({ includeDisabled: true })
  const existing = jobs.find((j) => j.name === "zee-banner-refresh")
  const now = Date.now()

  const desired = {
    name: "zee-banner-refresh",
    description: "Auto-refresh Zee banner for Zee TUI",
    enabled: true,
    schedule: { kind: "every", everyMs: 900000, anchorMs: now - 900000 } as const,
    sessionTarget: "isolated" as const,
    wakeMode: "next-heartbeat" as const,
    payload: {
      kind: "toolInvoke" as const,
      tool: "zee-banner-refresh",
      args: { autoSave: true },
    },
  }

  if (!existing) {
    const job = await cron.add({
      ...desired,
      state: {},
    })
    void cron.run(job.id, "force").catch(() => {})
    return
  }

  // Keep user edits if the job looks compatible; otherwise, patch it to the safe/default spec.
  const compatible =
    existing.sessionTarget === "isolated" &&
    existing.payload.kind === "toolInvoke" &&
    existing.payload.tool === desired.payload.tool

  if (compatible && existing.enabled) {
    const ranRecently = typeof existing.state.lastRunAtMs === "number" && now - existing.state.lastRunAtMs < 5 * 60_000
    if (!ranRecently) {
      void cron.run(existing.id, "force").catch(() => {})
    }
    return
  }

  await cron.update(existing.id, {
    enabled: true,
    description: desired.description,
    sessionTarget: desired.sessionTarget,
    wakeMode: desired.wakeMode,
    schedule: desired.schedule,
    payload: desired.payload,
  })
  void cron.run(existing.id, "force").catch(() => {})
}

async function restoreSessionsWithTodos(directory: string): Promise<number> {
  const sessions: Session.Info[] = []
  for await (const session of Session.list()) {
    sessions.push(session)
  }

  let restoredCount = 0
  for (const session of sessions) {
    const todos = await Todo.get(session.id)
    const incompleteTodos = todos.filter((t) => t.status !== "completed" && t.status !== "cancelled")
    if (incompleteTodos.length > 0) {
      restoredCount++
    }
  }
  return restoredCount
}
