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
import { syncBundledSkillsToMachine } from "../../skill/mirror"
import { Config } from "../../config/config"
import { GlobalBus } from "../../bus/global"
import { Flag } from "../../flag/flag"
import path from "path"
import { startRuntimeProcessGuard, type RuntimeProcessLimits } from "./runtime-process-guard"
import { DaemonServer } from "@root/daemon/ipc-server"
import { DEFAULT_SOCKET_PATH } from "@root/daemon/types"
import {
  TmuxVisualOrchestrationSink,
  type OrchestrationVisualMode,
  type VisualOrchestrationSink,
} from "@root/orchestration-visual"
import os from "os"

const log = Log.create({ service: "always-on" })

type MdnsOption = boolean | { enabled?: boolean; minimal?: boolean }

export interface AlwaysOnOptions {
  hostname: string
  port: number
  mdns?: MdnsOption
  mdnsDomain?: string
  cors?: string[]
  directory: string
  alwaysOnProfile?: boolean
  skipSetupCheck?: boolean
  gateway?: boolean
  gatewayForce?: boolean
  visualMode?: OrchestrationVisualMode
  visualBackend?: string
  /** @deprecated no-op; visual orchestration now uses terminal-agnostic event mode. */
  wezterm?: boolean
  /** @deprecated no-op; visual orchestration now uses terminal-agnostic event mode. */
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

function parseVisualMode(raw?: string): OrchestrationVisualMode {
  return raw?.toLowerCase() === "external" ? "external" : "events"
}

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return undefined
  return Math.floor(value)
}

function parseBoolean(raw: string | undefined): boolean | undefined {
  if (!raw) return undefined
  const normalized = raw.toLowerCase()
  if (["1", "true", "yes", "on"].includes(normalized)) return true
  if (["0", "false", "no", "off"].includes(normalized)) return false
  return undefined
}

type HeartbeatDeliveryChannel = "telegram" | "whatsapp"

type HeartbeatDeliveryTarget = {
  channel?: HeartbeatDeliveryChannel
  to?: string
}

function normalizeDeliveryTarget(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value))
  }
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (trimmed) return trimmed
  }
  return undefined
}

function firstDeliveryTarget(values: unknown): string | undefined {
  if (!Array.isArray(values)) return undefined
  for (const value of values) {
    const normalized = normalizeDeliveryTarget(value)
    if (normalized) return normalized
  }
  return undefined
}

function firstCsvValue(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  for (const item of raw.split(",")) {
    const normalized = normalizeDeliveryTarget(item)
    if (normalized) return normalized
  }
  return undefined
}

function resolveHeartbeatDeliveryTarget(config: Config.Info): HeartbeatDeliveryTarget {
  const telegramTo =
    normalizeDeliveryTarget(process.env.ZEE_TELEGRAM_HEARTBEAT_TO) ||
    normalizeDeliveryTarget(process.env.ZEE_TELEGRAM_UPDATE_TO) ||
    firstCsvValue(process.env.ZEE_TELEGRAM_ALLOWED_CHAT_IDS) ||
    firstDeliveryTarget(config.experimental?.surfaces?.telegram?.operators) ||
    firstDeliveryTarget(config.experimental?.surfaces?.telegram?.allowedChatIds) ||
    firstDeliveryTarget(config.experimental?.surfaces?.telegram?.allowedSenders)

  const whatsappTo =
    normalizeDeliveryTarget(process.env.ZEE_WHATSAPP_HEARTBEAT_TO) ||
    normalizeDeliveryTarget(process.env.ZEE_WA_UPDATE_TO) ||
    firstDeliveryTarget(config.experimental?.surfaces?.whatsapp?.operators) ||
    firstDeliveryTarget(config.experimental?.surfaces?.whatsapp?.allowedNumbers)

  const explicitChannelRaw = process.env.ZEE_HEARTBEAT_DELIVERY_CHANNEL?.trim().toLowerCase()
  const explicitChannel: HeartbeatDeliveryChannel | undefined =
    explicitChannelRaw === "telegram" || explicitChannelRaw === "whatsapp" ? explicitChannelRaw : undefined
  const explicitTo = normalizeDeliveryTarget(process.env.ZEE_HEARTBEAT_DELIVERY_TO)

  if (explicitChannel) {
    return {
      channel: explicitChannel,
      to: explicitTo ?? (explicitChannel === "telegram" ? telegramTo : whatsappTo),
    }
  }

  const telegramEnabledByConfig = config.experimental?.surfaces?.telegram?.enabled === true
  const telegramAvailable = telegramEnabledByConfig || Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim())
  if (telegramAvailable && telegramTo) {
    return { channel: "telegram", to: telegramTo }
  }

  const whatsappEnabledByConfig = config.experimental?.surfaces?.whatsapp?.enabled === true
  if (whatsappEnabledByConfig && whatsappTo) {
    return { channel: "whatsapp", to: whatsappTo }
  }

  return {}
}

export async function startAlwaysOnProcess(opts: AlwaysOnOptions): Promise<AlwaysOnProcess> {
  const {
    hostname,
    port,
    mdns,
    mdnsDomain,
    cors,
    directory,
    alwaysOnProfile = false,
    skipSetupCheck = false,
    gateway = true,
    gatewayForce = false,
    visualMode,
    visualBackend,
    restoreSessions = true,
    runtimeGuard = true,
    runtimeGuardIntervalMs = 30_000,
    runtimeLimits,
  } = opts
  const enforceAlwaysOn = alwaysOnProfile || process.env.ZEE_ENFORCE_ALWAYS_ON === "1"
  const effectiveRuntimeGuard = enforceAlwaysOn ? true : runtimeGuard
  let setupOk = true

  // Run setup check unless explicitly skipped.
  if (!skipSetupCheck) {
    const setupResult = await validateSetup({ exitOnFail: false, verbose: true })
    setupOk = setupResult.ok
    if (!setupResult.ok) {
      log.error("setup validation failed; refusing to start", {
        errors: setupResult.errors,
        warnings: setupResult.warnings,
        qdrantAvailable: setupResult.qdrant.available,
        googleApiKeyAvailable: setupResult.googleApiKey.available,
      })
      throw new Error(`Startup blocked: required dependencies missing.\n${setupResult.errors.join("\n")}`)
    }
  } else {
    log.warn("setup validation skipped via skipSetupCheck")
  }

  log.info("starting always-on process", {
    directory,
    hostname,
    port,
    mdns,
    mdnsDomain,
    cors,
    setupOk,
  })
  if (opts.wezterm !== undefined || opts.weztermLayout !== undefined) {
    log.warn("Deprecated WezTerm startup options are ignored; using event-stream visual orchestration.")
  }

  // Start the server
  const server = Server.listen({ hostname, port, mdns, mdnsDomain, cors })
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
  let gatewayStarted = false
  let cronService: CronService | null = null
  let heartbeatRunner: HeartbeatRunner | null = null
  let stopRuntimeGuard: (() => void) | undefined
  let visualSink: VisualOrchestrationSink | undefined
  let resolvedVisualMode: OrchestrationVisualMode = "events"
  let resolvedVisualBackend: string | undefined
  let ipcServer: DaemonServer | null = null
  let daemonConfig: Config.Info

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

  // Initialize surfaces (needs Instance context for Config.get())
  try {
    await Instance.provide({
      directory,
      async fn() {
        await initSurfaces()
      },
    })
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

  resolvedVisualMode = parseVisualMode(visualMode ?? process.env.ZEE_ORCH_VISUAL_MODE)
  resolvedVisualBackend = (visualBackend ?? process.env.ZEE_ORCH_VISUAL_BACKEND)?.trim().toLowerCase()

  if (resolvedVisualMode === "external") {
    if (resolvedVisualBackend === "tmux") {
      const keepSession = parseBoolean(process.env.ZEE_ORCH_TMUX_KEEP_SESSION) ?? false
      const tmuxSink = new TmuxVisualOrchestrationSink({
        socketPath: process.env.ZEE_ORCH_TMUX_SOCKET,
        sessionName: process.env.ZEE_ORCH_TMUX_SESSION,
        baseDir: process.env.ZEE_ORCH_TMUX_BASE_DIR,
        maxWorkerPanes: parsePositiveInt(process.env.ZEE_ORCH_TMUX_MAX_PANES),
        cleanupSessionOnClose: !keepSession,
      })
      visualSink = tmuxSink
      Output.log(
        `Visual:     External mode (backend=tmux, socket=${tmuxSink.socketPath}, session=${tmuxSink.sessionName})`,
      )
    } else {
      log.warn("Unknown external visual backend; falling back to event stream mode", {
        backend: resolvedVisualBackend,
      })
      resolvedVisualMode = "events"
      resolvedVisualBackend = undefined
      Output.log("Visual:     Event stream mode (terminal-agnostic)")
    }
  } else {
    resolvedVisualBackend = undefined
    Output.log("Visual:     Event stream mode (terminal-agnostic)")
  }

  // Load config once for cron + heartbeat + feature gating.
  try {
    daemonConfig = await Instance.provide({
      directory,
      async fn() {
        return await Config.get()
      },
    })
  } catch (error) {
    log.error("Failed to load daemon runtime config", {
      error: error instanceof Error ? error.message : String(error),
    })
    daemonConfig = {} as Config.Info
  }

  // Mirror bundled curated skills into machine-level config path on daemon startup.
  try {
    const mirrorResult = await syncBundledSkillsToMachine({ reason: "daemon-startup" })
    if (mirrorResult.status === "synced") {
      Output.log(`Skills:     Curated bundle synced (${mirrorResult.skillCount})`)
    } else if (mirrorResult.status === "failed") {
      log.warn("curated skill mirror failed", { reason: mirrorResult.reason })
      Output.log(`Skills:     Curated bundle sync failed (${mirrorResult.reason ?? "unknown"})`)
    }
  } catch (error) {
    log.warn("curated skill mirror threw during startup", {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  // Start skill watcher
  try {
    const hotReloadEnabled = enforceAlwaysOn ? true : daemonConfig.experimental?.surfaces?.hotReload?.enabled !== false
    if (hotReloadEnabled) {
      startSkillWatcher({ directory })
      if (enforceAlwaysOn) {
        Output.log("Skills:     Hot-reload watcher forced on (always-on profile)")
      } else {
        Output.log("Skills:     Hot-reload watcher started")
      }
    } else {
      Output.log(
        enforceAlwaysOn
          ? "Skills:     Hot-reload watcher forced on (always-on profile)"
          : "Skills:     Hot-reload watcher disabled by config",
      )
    }
  } catch (error) {
    log.debug("Skill watcher initialization failed", {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  // Start heartbeat runner (before cron, since cron may request heartbeats)
  try {
    const heartbeatEnabled = enforceAlwaysOn ? true : daemonConfig.heartbeat?.enabled !== false
    if (heartbeatEnabled) {
      const delivery = resolveHeartbeatDeliveryTarget(daemonConfig)
      heartbeatRunner = new HeartbeatRunner({
        directory,
        serverUrl: daemonUrl,
        config: daemonConfig.heartbeat,
        deliveryChannel: delivery.channel,
        deliveryTo: delivery.to,
      })
      heartbeatRunner.start()
      setHeartbeatRunner(heartbeatRunner)
      if (enforceAlwaysOn) {
        Output.log("Heartbeat:  Active (forced always-on profile)")
      } else {
        Output.log(`Heartbeat:  Active (every ${daemonConfig.heartbeat?.every ?? "30m"})`)
      }
      if (delivery.channel && delivery.to) {
        Output.log(`Heartbeat:  Delivery -> ${delivery.channel}:${delivery.to}`)
      } else if (delivery.channel) {
        Output.log(`Heartbeat:  Delivery channel set (${delivery.channel}), recipient unresolved`)
      }
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
    const cronEnabled = enforceAlwaysOn ? true : daemonConfig.cron?.enabled !== false
    if (cronEnabled) {
      const cronLog = Log.create({ service: "cron" })
      const storePath = resolveCronStorePath(daemonConfig.cron?.storeDir)
      const cronDeps: CronServiceDeps = {
        directory,
        log: cronLog,
        storePath,
        cronEnabled: true,
        enqueueSystemEvent: (text, opts) => {
          const message = text.trim()
          if (!message) {
            return
          }

          // Post system event into a dedicated cron session.
          void (async () => {
            try {
              const createRes = await fetch(`${daemonUrl}/session`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: "cron:system-event" }),
              })
              if (!createRes.ok) {
                const body = await createRes.text().catch(() => "")
                log.warn("cron: failed to create system-event session", {
                  status: createRes.status,
                  body: body.slice(0, 200),
                })
                return
              }

              const session = (await createRes.json()) as { id?: string }
              if (!session?.id) {
                log.warn("cron: session create response missing id", { response: session })
                return
              }

              const promptBody: Record<string, unknown> = {
                parts: [{ type: "text", text: message }],
                options: { senderId: "cron" },
              }
              if (opts?.agentId?.trim()) {
                promptBody.agent = opts.agentId.trim()
              }

              const msgRes = await fetch(`${daemonUrl}/session/${session.id}/message`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(promptBody),
              })
              if (!msgRes.ok) {
                const body = await msgRes.text().catch(() => "")
                log.warn("cron: failed to enqueue system-event message", {
                  sessionID: session.id,
                  status: msgRes.status,
                  body: body.slice(0, 200),
                })
              }
            } catch (err) {
              log.warn("cron: enqueueSystemEvent failed", {
                error: err instanceof Error ? err.message : String(err),
              })
            }
          })()
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
      if (enforceAlwaysOn) {
        Output.log("Cron:       Scheduler started (forced always-on profile)")
      } else {
        Output.log("Cron:       Scheduler started")
      }

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
      if (gatewayState.fatal) {
        throw new Error(`Gateway preflight failed: ${reason}`)
      }
      Output.log(`Gateway:    Disabled (${reason})`)
    }
  }

  if (effectiveRuntimeGuard) {
    stopRuntimeGuard = startRuntimeProcessGuard({
      intervalMs: runtimeGuardIntervalMs,
      limits: runtimeLimits,
      currentPid: process.pid,
      reason: "daemon-runtime-guard",
    })
    Output.log(`Runtime:    Process guard enabled (${Math.round(runtimeGuardIntervalMs / 1000)}s cadence)`)
  }

  // Start orchestration IPC server (worker pool for drones/background tasks)
  try {
    const cores = (() => {
      try {
        return typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length
      } catch {
        return 2
      }
    })()
    const maxWorkers = Math.max(2, Math.min(8, cores - 1))

    ipcServer = new DaemonServer({
      socketPath: process.env.ZEE_IPC_SOCKET || DEFAULT_SOCKET_PATH,
      orchestration: {
        maxWorkers,
        visual: {
          enabled: true,
          mode: resolvedVisualMode,
          backend: resolvedVisualBackend,
        },
        visualSink,
        queue: {
          cap: 20,
          dropPolicy: "summarize",
          dedupeMode: "task-id",
        },
      },
    })
    await ipcServer.start()
    Output.log(
      `Orchestration: Worker pool started (workers=${maxWorkers}, socket=${process.env.ZEE_IPC_SOCKET || DEFAULT_SOCKET_PATH})`,
    )
  } catch (error) {
    log.error("Failed to start orchestration IPC server", {
      error: error instanceof Error ? error.message : String(error),
    })
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

    // Stop orchestration IPC server
    if (ipcServer) {
      await ipcServer.stop().catch((e) => log.error("IPC server shutdown error", { error: String(e) }))
      ipcServer = null
    }

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

    if (stopRuntimeGuard) {
      stopRuntimeGuard()
      stopRuntimeGuard = undefined
    }

    if (visualSink?.close) {
      await visualSink.close().catch((e) => log.error("Visual sink shutdown error", { error: String(e) }))
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
      orchestration: ipcServer !== null,
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
  const jobs = await cron.list({ includeDisabled: true })
  const existing = jobs.find((j) => j.name === "zee-banner-refresh")

  // In hardened daemon mode we disable project config loading, which also
  // disables custom tools from `<project>/.zee/tool`. In that mode, make sure
  // the auto-wired banner refresh cron job is disabled instead of repeatedly failing.
  if (Flag.ZEE_DISABLE_PROJECT_CONFIG) {
    if (existing?.enabled) {
      await cron.update(existing.id, { enabled: false })
    }
    return
  }

  const toolPathTs = path.join(directory, ".zee", "tool", "zee-banner-refresh.ts")
  const toolPathJs = path.join(directory, ".zee", "tool", "zee-banner-refresh.js")
  const hasTool = (await Bun.file(toolPathTs).exists()) || (await Bun.file(toolPathJs).exists())
  if (!hasTool) {
    return
  }
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
