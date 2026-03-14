import fs from "node:fs/promises"
import path from "node:path"
import type { Subprocess } from "bun"
import {
  appendText,
  copyIfExists,
  ensureDir,
  listZeeProcesses,
  runCommand,
  sanitizeFileName,
  sleep,
  stringifyCommand,
  tryRead,
  waitForHttpJson,
  writeText,
} from "./helpers"
import { collectPlatformSnapshots, detectPlatformInfo } from "./platform"
import {
  RELIABILITY_REPORT_VERSION,
  type ReliabilityReportV1,
  type ReliabilityRunOptions,
  type ReliabilityStage,
  type ReliabilityStageContext,
  type ReliabilityStageReport,
  type ReliabilitySnapshotArtifact,
  type ReliabilityStageRunOutput,
} from "./types"

const DEFAULT_ALPHA_SOAK_MS = 45 * 60_000
const DEFAULT_DIAG_SOAK_MS = 5 * 60_000
const DEFAULT_DAEMON_PORT_BASE = 33_210
const DEFAULT_GATEWAY_PORT_BASE = 28_789

type InternalRuntime = {
  runId: string
  runtimeStateDir: string
  commandLogPath: string
  distBinaryPath: string
}

type DaemonHandle = {
  proc: Subprocess
  command: string[]
  port: number
  stdoutPath: string
  stderrPath: string
  outputDone: Promise<void>
}

type StageInternalContext = ReliabilityStageContext & {
  runtime: InternalRuntime
  stageLogPath: string
}

const activeDaemonHandles = new Set<DaemonHandle>()
let daemonCleanupInFlight: Promise<void> | null = null

function nowTag(): string {
  return new Date().toISOString().replace(/[:.]/g, "-")
}

function longSoakMs(options: ReliabilityRunOptions): number {
  if (typeof options.longSoakDurationMs === "number" && options.longSoakDurationMs > 0) {
    return Math.floor(options.longSoakDurationMs)
  }
  return options.profile === "alpha" ? DEFAULT_ALPHA_SOAK_MS : DEFAULT_DIAG_SOAK_MS
}

async function findRepoRoot(): Promise<string> {
  let current = path.resolve(process.cwd())
  for (;;) {
    const candidate = path.join(current, "packages", "zee", "package.json")
    try {
      // eslint-disable-next-line no-await-in-loop
      await fs.access(candidate)
      return current
    } catch {
      // continue walking up
    }

    const parent = path.dirname(current)
    if (parent === current) {
      throw new Error("Could not locate repo root (expected packages/zee/package.json)")
    }
    current = parent
  }
}

function buildRuntimeStateDir(artifactDir: string): string {
  return path.join(artifactDir, "runtime-state")
}

function buildRuntimeEnv(runtimeStateDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ZEE_STATE_DIR: runtimeStateDir,
    ZEE_HEADLESS: "1",
    NODE_ENV: process.env.NODE_ENV || "production",
  }

  if (!env.GEMINI_API_KEY && env.GOOGLE_API_KEY) {
    env.GEMINI_API_KEY = env.GOOGLE_API_KEY
  }
  if (!env.GOOGLE_API_KEY && env.GEMINI_API_KEY) {
    env.GOOGLE_API_KEY = env.GEMINI_API_KEY
  }

  return env
}

async function seedRuntimeConfig(runtimeStateDir: string): Promise<string[]> {
  const copied: string[] = []
  const home = process.env.HOME || process.env.USERPROFILE || ""
  const srcConfigDir = path.join(home, ".config", "zee")
  const dstConfigDir = path.join(runtimeStateDir, "config")

  const candidates = [
    [path.join(srcConfigDir, "daemon.env"), path.join(dstConfigDir, "daemon.env")],
    [path.join(srcConfigDir, "zee.jsonc"), path.join(dstConfigDir, "zee.jsonc")],
    [path.join(home, ".local", "state", "zee", "zee_gateway_token"), path.join(runtimeStateDir, "zee_gateway_token")],
  ] as const

  for (const [source, destination] of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await copyIfExists(source, destination)
    if (ok) copied.push(`${source} -> ${destination}`)
  }

  return copied
}

async function resolveDistBinaryPath(packageRoot: string): Promise<string> {
  const extension = process.platform === "win32" ? ".exe" : ""
  const preferred = path.join(packageRoot, "dist", "@adolago")
  const platformName = process.platform === "win32" ? "windows" : process.platform
  const hostSegment = `zee-${platformName}-${process.arch}`
  const glob = new Bun.Glob(`zee-*/bin/zee${extension}`)
  const candidates = await Array.fromAsync(
    glob.scan({
      cwd: preferred,
      absolute: true,
    }),
  )

  if (candidates.length === 0) {
    throw new Error(`No dist binary found in ${preferred}. Run build first.`)
  }

  const exactMatch = candidates.find((candidate) => candidate.includes(`${hostSegment}${path.sep}`))
  if (exactMatch) {
    return exactMatch
  }

  const fallbackMatch = candidates.find((candidate) => candidate.includes(hostSegment))
  if (fallbackMatch) {
    return fallbackMatch
  }

  throw new Error(
    `No dist binary found for host target ${hostSegment} in ${preferred}. Found: ${candidates
      .map((candidate) => path.relative(preferred, candidate))
      .join(", ")}`,
  )
}

async function createVerificationSymlink(binaryPath: string, runtimeStateDir: string): Promise<string> {
  const verifyDir = path.join(runtimeStateDir, "verify-bin")
  const verifyLink = path.join(verifyDir, "zee")
  await ensureDir(verifyDir)
  await fs.rm(verifyLink, { force: true })
  await fs.symlink(binaryPath, verifyLink)
  return verifyLink
}

async function writeStageLogHeader(
  stageLogPath: string,
  stage: Pick<ReliabilityStage<any>, "id" | "name" | "description">,
): Promise<void> {
  const header = [
    `Stage: ${stage.id}`,
    `Name: ${stage.name}`,
    `Description: ${stage.description}`,
    `Started: ${new Date().toISOString()}`,
    "",
  ].join("\n")
  await writeText(stageLogPath, header)
}

async function logCommandExecution(
  stageLogPath: string,
  label: string,
  command: string[],
  cwd: string,
  output: { stdout: string; stderr: string; exitCode: number; durationMs: number; timedOut: boolean },
): Promise<void> {
  const block = [
    `### ${label}`,
    `$ ${stringifyCommand(command)}`,
    `cwd: ${cwd}`,
    `exitCode: ${output.exitCode}`,
    `durationMs: ${output.durationMs}`,
    output.timedOut ? `timedOut: true` : "",
    "stdout:",
    output.stdout || "<empty>",
    "stderr:",
    output.stderr || "<empty>",
    "",
  ]
    .filter(Boolean)
    .join("\n")

  await appendText(stageLogPath, block)
}

function stagePort(base: number, stageIndex: number, offset = 0): number {
  return base + stageIndex * 10 + offset
}

function extractMajorMinor(raw: string): string | null {
  const match = raw.match(/(\d+\.\d+)/)
  return match?.[1] ?? null
}

async function startStreamPump(stream: ReadableStream<Uint8Array> | null, filepath: string): Promise<void> {
  if (!stream) {
    await writeText(filepath, "")
    return
  }

  await ensureDir(path.dirname(filepath))
  const writer = Bun.file(filepath).writer()
  try {
    const reader = stream.getReader()
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const chunk = await reader.read()
      if (chunk.done) break
      writer.write(chunk.value)
      writer.flush()
    }
  } finally {
    writer.end()
  }
}

async function spawnDaemon(args: {
  command: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  stageArtifactDir: string
  stageId: string
  suffix: string
  port: number
}): Promise<DaemonHandle> {
  const stdoutPath = path.join(args.stageArtifactDir, `${sanitizeFileName(args.stageId)}-${args.suffix}.stdout.log`)
  const stderrPath = path.join(args.stageArtifactDir, `${sanitizeFileName(args.stageId)}-${args.suffix}.stderr.log`)

  const proc = Bun.spawn({
    cmd: args.command,
    cwd: args.cwd,
    env: args.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })

  const outputDone = Promise.all([
    startStreamPump(proc.stdout, stdoutPath),
    startStreamPump(proc.stderr, stderrPath),
  ]).then(() => undefined)

  const handle: DaemonHandle = {
    proc,
    command: args.command,
    port: args.port,
    stdoutPath,
    stderrPath,
    outputDone,
  }

  activeDaemonHandles.add(handle)
  return handle
}

async function stopDaemon(handle: DaemonHandle): Promise<void> {
  if (!handle) return

  try {
    try {
      handle.proc.kill("SIGTERM")
    } catch {
      // noop
    }

    const exitedGracefully = await Promise.race([handle.proc.exited.then(() => true), sleep(10_000).then(() => false)])

    if (!exitedGracefully) {
      try {
        handle.proc.kill("SIGKILL")
      } catch {
        // noop
      }
      await Promise.race([handle.proc.exited.catch(() => 0), sleep(5_000)])
    }

    await handle.outputDone.catch(() => undefined)
  } finally {
    activeDaemonHandles.delete(handle)
  }
}

async function stopAllTrackedDaemons(): Promise<void> {
  if (activeDaemonHandles.size === 0) return
  if (daemonCleanupInFlight) {
    await daemonCleanupInFlight
    return
  }

  daemonCleanupInFlight = Promise.all(
    Array.from(activeDaemonHandles).map(async (handle) => {
      await stopDaemon(handle).catch(() => undefined)
    }),
  ).then(() => undefined)

  try {
    await daemonCleanupInFlight
  } finally {
    daemonCleanupInFlight = null
  }
}

async function waitForDaemonHealth(port: number, timeoutMs: number): Promise<any> {
  const url = `http://127.0.0.1:${port}/global/health/live`
  return await waitForHttpJson(url, timeoutMs, 500, 2_000)
}

async function withDaemon(
  ctx: StageInternalContext,
  args: {
    command: string[]
    port: number
    suffix: string
    timeoutMs?: number
    stageId: string
  },
  fn: (handle: DaemonHandle, health: any) => Promise<void>,
): Promise<ReliabilitySnapshotArtifact[]> {
  const handle = await spawnDaemon({
    command: args.command,
    cwd: ctx.packageRoot,
    env: ctx.runtimeEnv,
    stageArtifactDir: ctx.stageArtifactDir,
    stageId: args.stageId,
    suffix: args.suffix,
    port: args.port,
  })

  let health: any
  try {
    health = await waitForDaemonHealth(args.port, args.timeoutMs ?? 30_000)
    await fn(handle, health)
  } finally {
    await stopDaemon(handle)
  }

  return [
    {
      name: `${args.suffix}-stdout`,
      path: handle.stdoutPath,
      command: args.command,
      exitCode: 0,
    },
    {
      name: `${args.suffix}-stderr`,
      path: handle.stderrPath,
      command: args.command,
      exitCode: 0,
    },
  ]
}

async function runStageCommand(
  ctx: StageInternalContext,
  label: string,
  command: string[],
  options: {
    cwd?: string
    env?: NodeJS.ProcessEnv
    timeoutMs?: number
    expectedExitCodes?: number[]
  } = {},
) {
  try {
    const output = await runCommand(command, {
      cwd: options.cwd ?? ctx.repoRoot,
      env: options.env,
      timeoutMs: options.timeoutMs,
      expectedExitCodes: options.expectedExitCodes,
    })

    await logCommandExecution(ctx.stageLogPath, label, command, options.cwd ?? ctx.repoRoot, {
      stdout: output.stdout,
      stderr: output.stderr,
      exitCode: output.exitCode,
      durationMs: output.durationMs,
      timedOut: output.timedOut,
    })
    await appendText(
      ctx.runtime.commandLogPath,
      [
        `## Stage ${ctx.stageIndex + 1} - ${label}`,
        `$ ${stringifyCommand(command)}`,
        `cwd: ${options.cwd ?? ctx.repoRoot}`,
        `exitCode: ${output.exitCode}`,
        `durationMs: ${output.durationMs}`,
        "",
      ].join("\n"),
    )

    return output
  } catch (error) {
    await appendText(
      ctx.stageLogPath,
      [
        `### ${label}`,
        `$ ${stringifyCommand(command)}`,
        `cwd: ${options.cwd ?? ctx.repoRoot}`,
        `error: ${error instanceof Error ? error.message : String(error)}`,
        "",
      ].join("\n"),
    )
    await appendText(
      ctx.runtime.commandLogPath,
      [
        `## Stage ${ctx.stageIndex + 1} - ${label}`,
        `$ ${stringifyCommand(command)}`,
        `cwd: ${options.cwd ?? ctx.repoRoot}`,
        `error: ${error instanceof Error ? error.message : String(error)}`,
        "",
      ].join("\n"),
    )
    throw error
  }
}

async function stageBuildAndVerify(ctx: StageInternalContext): Promise<ReliabilityStageRunOutput> {
  const details: string[] = []
  const buildCommand = ["bun", "run", "script/build.ts", "--single"]

  await runStageCommand(ctx, "Build", buildCommand, {
    cwd: ctx.packageRoot,
    env: ctx.runtimeEnv,
    timeoutMs: 20 * 60_000,
  })

  ctx.runtime.distBinaryPath = await resolveDistBinaryPath(ctx.packageRoot)

  if (process.platform !== "win32") {
    const verifyLink = await createVerificationSymlink(ctx.runtime.distBinaryPath, ctx.runtime.runtimeStateDir)
    await runStageCommand(ctx, "verify-binary", ["bash", "-lc", "./script/verify-binary.sh"], {
      cwd: ctx.repoRoot,
      env: {
        ...ctx.runtimeEnv,
        BUN_BIN: verifyLink,
      },
      timeoutMs: 60_000,
    })
    details.push(`verify-binary.sh passed via ${verifyLink}`)
  } else {
    details.push("verify-binary.sh skipped on Windows")
  }

  const version = await runStageCommand(ctx, "dist-version", [ctx.runtime.distBinaryPath, "--version"], {
    cwd: ctx.packageRoot,
    env: ctx.runtimeEnv,
    timeoutMs: 20_000,
  })

  details.push(`dist version: ${version.stdout.trim() || "<empty>"}`)

  return {
    summary: "Build + binary integrity passed",
    details,
    metrics: {
      distBinary: ctx.runtime.distBinaryPath,
    },
  }
}

async function stageSourceVsDistParity(ctx: StageInternalContext): Promise<ReliabilityStageRunOutput> {
  const sourceVersion = await runStageCommand(ctx, "source-version", ["bun", "run", "src/index.ts", "--version"], {
    cwd: ctx.packageRoot,
    env: ctx.runtimeEnv,
    timeoutMs: 30_000,
  })

  const distVersion = await runStageCommand(ctx, "dist-version", [ctx.runtime.distBinaryPath, "--version"], {
    cwd: ctx.packageRoot,
    env: ctx.runtimeEnv,
    timeoutMs: 30_000,
  })

  const sourceV = sourceVersion.stdout.trim()
  const distV = distVersion.stdout.trim()
  const sourceMajorMinor = extractMajorMinor(sourceV)
  const distMajorMinor = extractMajorMinor(distV)
  if (!sourceV || !distV) {
    throw new Error(`source/dist version output missing: source=${sourceV || "<empty>"} dist=${distV || "<empty>"}`)
  }
  if (!sourceMajorMinor || !distMajorMinor || sourceMajorMinor !== distMajorMinor) {
    throw new Error(`source/dist major.minor mismatch: source=${sourceV || "<empty>"} dist=${distV || "<empty>"}`)
  }

  const sourcePort = stagePort(ctx.daemonPortBase, ctx.stageIndex, 1)
  const distPort = stagePort(ctx.daemonPortBase, ctx.stageIndex, 2)
  const gatewayPort = stagePort(ctx.gatewayPortBase, ctx.stageIndex, 1)

  const sourceEnv = { ...ctx.runtimeEnv, ZEE_GATEWAY_PORT: String(gatewayPort) }
  const distEnv = { ...ctx.runtimeEnv, ZEE_GATEWAY_PORT: String(gatewayPort + 1) }

  const artifacts: ReliabilitySnapshotArtifact[] = []
  let sourceHealth: any = null
  let distHealth: any = null
  let sourceChannels: any = null
  let distChannels: any = null

  const sourceCommand = [
    "bun",
    "run",
    "src/index.ts",
    "daemon",
    "--skip-setup-check",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(sourcePort),
    "--directory",
    ctx.repoRoot,
  ]

  artifacts.push(
    ...(await withDaemon(
      { ...ctx, runtimeEnv: sourceEnv },
      {
        command: sourceCommand,
        port: sourcePort,
        suffix: "source-daemon",
        stageId: "source-vs-dist",
        timeoutMs: 60_000,
      },
      async () => {
        sourceHealth = await waitForHttpJson(`http://127.0.0.1:${sourcePort}/global/health`, 15_000, 500, 8_000)
        sourceChannels = await waitForHttpJson(`http://127.0.0.1:${sourcePort}/gateway/channels/status`, 20_000)
      },
    )),
  )

  const distCommand = [
    ctx.runtime.distBinaryPath,
    "daemon",
    "--skip-setup-check",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(distPort),
    "--directory",
    ctx.repoRoot,
  ]

  artifacts.push(
    ...(await withDaemon(
      { ...ctx, runtimeEnv: distEnv },
      {
        command: distCommand,
        port: distPort,
        suffix: "dist-daemon",
        stageId: "source-vs-dist",
        timeoutMs: 60_000,
      },
      async () => {
        distHealth = await waitForHttpJson(`http://127.0.0.1:${distPort}/global/health`, 15_000, 500, 8_000)
        distChannels = await waitForHttpJson(`http://127.0.0.1:${distPort}/gateway/channels/status`, 20_000)
      },
    )),
  )

  if (!sourceHealth || !distHealth) {
    throw new Error(`health payload missing: source=${JSON.stringify(sourceHealth)} dist=${JSON.stringify(distHealth)}`)
  }

  if (sourceHealth.mode !== "source" || distHealth.mode !== "binary") {
    throw new Error(`health mode mismatch: source=${JSON.stringify(sourceHealth)} dist=${JSON.stringify(distHealth)}`)
  }

  const sourceMemoryStatus = String(sourceHealth.memory?.status ?? "unknown")
  const distMemoryStatus = String(distHealth.memory?.status ?? "unknown")
  if (sourceMemoryStatus !== distMemoryStatus) {
    throw new Error(
      `memory status mismatch: source=${JSON.stringify(sourceHealth.memory)} dist=${JSON.stringify(distHealth.memory)}`,
    )
  }

  if (!sourceChannels?.success || !distChannels?.success) {
    throw new Error(
      `gateway channels.status mismatch: source=${JSON.stringify(sourceChannels)} dist=${JSON.stringify(distChannels)}`,
    )
  }

  const sourceChannelIds = Object.keys(sourceChannels?.data?.channelAccounts ?? {}).sort()
  const distChannelIds = Object.keys(distChannels?.data?.channelAccounts ?? {}).sort()
  const missingInDist = sourceChannelIds.filter((id) => !distChannelIds.includes(id))

  if (missingInDist.length > 0) {
    throw new Error(
      `dist channel parity failed: missing channels in dist=${JSON.stringify(missingInDist)} source=${JSON.stringify(sourceChannelIds)} dist=${JSON.stringify(distChannelIds)}`,
    )
  }

  return {
    summary: "Source and dist runtime parity validated",
    details: [
      `version: ${sourceV}`,
      `source health mode: ${String(sourceHealth.mode ?? "unknown")}`,
      `dist health mode: ${String(distHealth.mode ?? "unknown")}`,
      `source memory status: ${sourceMemoryStatus}`,
      `dist memory status: ${distMemoryStatus}`,
      `source channels: ${sourceChannelIds.join(",") || "<none>"}`,
      `dist channels: ${distChannelIds.join(",") || "<none>"}`,
    ],
    artifacts,
  }
}

async function stageDaemonSingletonAndLocking(ctx: StageInternalContext): Promise<ReliabilityStageRunOutput> {
  const port = stagePort(ctx.daemonPortBase, ctx.stageIndex, 0)
  const gatewayPort = stagePort(ctx.gatewayPortBase, ctx.stageIndex, 0)
  const env = { ...ctx.runtimeEnv, ZEE_GATEWAY_PORT: String(gatewayPort) }

  const command = [
    ctx.runtime.distBinaryPath,
    "daemon",
    "--skip-setup-check",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
    "--directory",
    ctx.repoRoot,
  ]

  const handle = await spawnDaemon({
    command,
    cwd: ctx.packageRoot,
    env,
    stageArtifactDir: ctx.stageArtifactDir,
    stageId: "daemon-singleton",
    suffix: "primary",
    port,
  })

  let secondStartExit = -1
  try {
    await waitForDaemonHealth(port, 40_000)

    const second = await runStageCommand({ ...ctx, runtimeEnv: env }, "second-daemon-start", command, {
      cwd: ctx.packageRoot,
      env,
      timeoutMs: 15_000,
      expectedExitCodes: [1, 100],
    })
    secondStartExit = second.exitCode
  } finally {
    await stopDaemon(handle)
  }

  const stateDir = path.join(ctx.runtime.runtimeStateDir, "daemon")
  const pidPath = path.join(stateDir, "daemon.pid")
  const lockPath = path.join(stateDir, "daemon.lock")

  const pid = await tryRead(pidPath)
  const lock = await tryRead(lockPath)

  if (pid || lock) {
    throw new Error(`daemon lock/pid files still present after shutdown: pid=${Boolean(pid)} lock=${Boolean(lock)}`)
  }

  return {
    summary: "Daemon singleton and lock lifecycle validated",
    details: [`second start exit code: ${secondStartExit}`],
    artifacts: [
      {
        name: "primary-daemon-stdout",
        path: handle.stdoutPath,
        command,
        exitCode: 0,
      },
      {
        name: "primary-daemon-stderr",
        path: handle.stderrPath,
        command,
        exitCode: 0,
      },
    ],
  }
}

async function stageDaemonRecoveryAndRestart(ctx: StageInternalContext): Promise<ReliabilityStageRunOutput> {
  const port = stagePort(ctx.daemonPortBase, ctx.stageIndex, 0)
  const gatewayPort = stagePort(ctx.gatewayPortBase, ctx.stageIndex, 0)
  const env = { ...ctx.runtimeEnv, ZEE_GATEWAY_PORT: String(gatewayPort) }

  const command = [
    ctx.runtime.distBinaryPath,
    "daemon",
    "--skip-setup-check",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
    "--directory",
    ctx.repoRoot,
  ]

  const first = await spawnDaemon({
    command,
    cwd: ctx.packageRoot,
    env,
    stageArtifactDir: ctx.stageArtifactDir,
    stageId: "daemon-recovery",
    suffix: "first",
    port,
  })

  try {
    await waitForDaemonHealth(port, 45_000)

    try {
      first.proc.kill("SIGKILL")
    } catch {
      // noop
    }
    await Promise.race([first.proc.exited.catch(() => 0), sleep(10_000)])
  } finally {
    await first.outputDone.catch(() => undefined)
  }

  const restarted = await spawnDaemon({
    command,
    cwd: ctx.packageRoot,
    env,
    stageArtifactDir: ctx.stageArtifactDir,
    stageId: "daemon-recovery",
    suffix: "restart",
    port,
  })

  try {
    await waitForDaemonHealth(port, 45_000)
  } finally {
    await stopDaemon(restarted)
  }

  return {
    summary: "Daemon recovered cleanly after hard kill",
    artifacts: [
      {
        name: "first-stdout",
        path: first.stdoutPath,
        command,
        exitCode: 0,
      },
      {
        name: "first-stderr",
        path: first.stderrPath,
        command,
        exitCode: 0,
      },
      {
        name: "restart-stdout",
        path: restarted.stdoutPath,
        command,
        exitCode: 0,
      },
      {
        name: "restart-stderr",
        path: restarted.stderrPath,
        command,
        exitCode: 0,
      },
    ],
  }
}

async function occupyPort(port: number): Promise<() => Promise<void>> {
  const server = Bun.serve({
    port,
    fetch() {
      return new Response("occupied", { status: 200 })
    },
  })

  return async () => {
    server.stop(true)
    await sleep(200)
  }
}

async function stageGatewayPreflightConflict(ctx: StageInternalContext): Promise<ReliabilityStageRunOutput> {
  const daemonPort = stagePort(ctx.daemonPortBase, ctx.stageIndex, 0)
  const gatewayPort = stagePort(ctx.gatewayPortBase, ctx.stageIndex, 0)
  const env = { ...ctx.runtimeEnv, ZEE_GATEWAY_PORT: String(gatewayPort) }

  const release = await occupyPort(gatewayPort)

  const command = [
    ctx.runtime.distBinaryPath,
    "daemon",
    "--skip-setup-check",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(daemonPort),
    "--directory",
    ctx.repoRoot,
  ]

  const conflictHandle = await spawnDaemon({
    command,
    cwd: ctx.packageRoot,
    env,
    stageArtifactDir: ctx.stageArtifactDir,
    stageId: "gateway-preflight",
    suffix: "conflict",
    port: daemonPort,
  })

  let conflictHealth: any = null
  try {
    conflictHealth = await waitForDaemonHealth(daemonPort, 45_000)
  } finally {
    await stopDaemon(conflictHandle)
    await release()
  }

  const gatewayState = conflictHealth?.gateway ?? {}
  if (gatewayState.running === true) {
    throw new Error("Gateway started even though gateway port was pre-occupied")
  }

  const freeHandle = await spawnDaemon({
    command,
    cwd: ctx.packageRoot,
    env,
    stageArtifactDir: ctx.stageArtifactDir,
    stageId: "gateway-preflight",
    suffix: "free",
    port: daemonPort,
  })

  let channelsResponse: any = null
  try {
    await waitForDaemonHealth(daemonPort, 45_000)
    channelsResponse = await waitForHttpJson(`http://127.0.0.1:${daemonPort}/gateway/channels/status`, 20_000)
  } finally {
    await stopDaemon(freeHandle)
  }

  if (!channelsResponse || channelsResponse.success !== true) {
    throw new Error(`Gateway channels.status failed after port release: ${JSON.stringify(channelsResponse)}`)
  }

  return {
    summary: "Gateway preflight correctly handles occupied and released ports",
    details: [
      `conflict gateway.running=${String(gatewayState.running)}`,
      "channels.status succeeded after releasing port",
    ],
    artifacts: [
      {
        name: "conflict-stdout",
        path: conflictHandle.stdoutPath,
        command,
        exitCode: 0,
      },
      {
        name: "conflict-stderr",
        path: conflictHandle.stderrPath,
        command,
        exitCode: 0,
      },
      {
        name: "free-stdout",
        path: freeHandle.stdoutPath,
        command,
        exitCode: 0,
      },
      {
        name: "free-stderr",
        path: freeHandle.stderrPath,
        command,
        exitCode: 0,
      },
    ],
  }
}

async function stageGatewayChannelLiveChecks(ctx: StageInternalContext): Promise<ReliabilityStageRunOutput> {
  const daemonPort = stagePort(ctx.daemonPortBase, ctx.stageIndex, 0)
  const gatewayPort = stagePort(ctx.gatewayPortBase, ctx.stageIndex, 0)
  const env = { ...ctx.runtimeEnv, ZEE_GATEWAY_PORT: String(gatewayPort) }

  const command = [
    ctx.runtime.distBinaryPath,
    "daemon",
    "--skip-setup-check",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(daemonPort),
    "--directory",
    ctx.repoRoot,
  ]

  const handle = await spawnDaemon({
    command,
    cwd: ctx.packageRoot,
    env,
    stageArtifactDir: ctx.stageArtifactDir,
    stageId: "gateway-live",
    suffix: "run",
    port: daemonPort,
  })

  let channels: any = null
  try {
    await waitForDaemonHealth(daemonPort, 45_000)
    channels = await waitForHttpJson(`http://127.0.0.1:${daemonPort}/gateway/channels/status`, 20_000)
  } finally {
    await stopDaemon(handle)
  }

  if (!channels?.success) {
    throw new Error(`channels.status returned non-success payload: ${JSON.stringify(channels)}`)
  }

  const whatsappAccounts = channels?.data?.channelAccounts?.whatsapp
  const accountList = Array.isArray(whatsappAccounts) ? whatsappAccounts : []
  const unhealthy = accountList.filter((account) => {
    if (!account || typeof account !== "object") return false
    if (account.enabled === false) return false
    if (account.configured === false) return false
    if (account.linked === false) return false
    return account.running !== true || account.connected !== true
  })

  if (unhealthy.length > 0) {
    throw new Error(`Gateway channel accounts are unhealthy: ${JSON.stringify(unhealthy)}`)
  }

  return {
    summary: "Gateway channel live checks passed",
    details: [`whatsappAccounts=${accountList.length}`],
    artifacts: [
      {
        name: "gateway-live-stdout",
        path: handle.stdoutPath,
        command,
        exitCode: 0,
      },
      {
        name: "gateway-live-stderr",
        path: handle.stderrPath,
        command,
        exitCode: 0,
      },
    ],
    metrics: {
      whatsappAccounts: accountList.length,
      unhealthyAccounts: unhealthy.length,
    },
  }
}

async function stageTuiLifecycleNoOrphans(ctx: StageInternalContext): Promise<ReliabilityStageRunOutput> {
  const baseline = await listZeeProcesses()
  const cycles = ctx.profile === "alpha" ? 6 : 2

  const command =
    process.platform === "win32"
      ? ["powershell", "-NoProfile", "-Command", `& '${ctx.runtime.distBinaryPath}' --help`]
      : [ctx.runtime.distBinaryPath, "--help"]

  for (let i = 0; i < cycles; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await runStageCommand(ctx, `tui-lifecycle-cycle-${i + 1}`, command, {
      cwd: ctx.packageRoot,
      env: ctx.runtimeEnv,
      timeoutMs: 20_000,
    })
  }

  await sleep(1_000)
  const after = await listZeeProcesses()

  const baselineIds = new Set(baseline.map((item) => item.pid))
  const leaked = after.filter((item) => !baselineIds.has(item.pid) && item.pid !== process.pid)

  if (leaked.length > 0) {
    throw new Error(`Detected leaked Zee processes after lifecycle test: ${JSON.stringify(leaked)}`)
  }

  return {
    summary: "No orphan Zee processes detected after repeated command lifecycle",
    details: [`cycles=${cycles}`],
    metrics: {
      baselineProcesses: baseline.length,
      postProcesses: after.length,
      leaked: leaked.length,
    },
  }
}

async function stageModeSwitchStress(ctx: StageInternalContext): Promise<ReliabilityStageRunOutput> {
  const cycles = ctx.profile === "alpha" ? 50 : 10
  let daemonChecks = 0

  for (let i = 0; i < cycles; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await runStageCommand(ctx, `source-version-cycle-${i + 1}`, ["bun", "run", "src/index.ts", "--version"], {
      cwd: ctx.packageRoot,
      env: ctx.runtimeEnv,
      timeoutMs: 20_000,
    })

    // eslint-disable-next-line no-await-in-loop
    await runStageCommand(ctx, `dist-version-cycle-${i + 1}`, [ctx.runtime.distBinaryPath, "--version"], {
      cwd: ctx.packageRoot,
      env: ctx.runtimeEnv,
      timeoutMs: 20_000,
    })

    if ((i + 1) % 10 === 0) {
      const daemonPort = stagePort(ctx.daemonPortBase, ctx.stageIndex, i + 1)
      const gatewayPort = stagePort(ctx.gatewayPortBase, ctx.stageIndex, i + 1)
      const env = { ...ctx.runtimeEnv, ZEE_GATEWAY_PORT: String(gatewayPort) }
      const daemonCommand = [
        ctx.runtime.distBinaryPath,
        "daemon",
        "--skip-setup-check",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(daemonPort),
        "--directory",
        ctx.repoRoot,
      ]

      // eslint-disable-next-line no-await-in-loop
      const handle = await spawnDaemon({
        command: daemonCommand,
        cwd: ctx.packageRoot,
        env,
        stageArtifactDir: ctx.stageArtifactDir,
        stageId: "mode-switch",
        suffix: `daemon-${i + 1}`,
        port: daemonPort,
      })

      try {
        // eslint-disable-next-line no-await-in-loop
        await waitForDaemonHealth(daemonPort, 30_000)
        daemonChecks += 1
      } finally {
        // eslint-disable-next-line no-await-in-loop
        await stopDaemon(handle)
      }
    }
  }

  return {
    summary: "Source/dist switch stress completed without command failures",
    details: [`cycles=${cycles}`, `daemonChecks=${daemonChecks}`],
    metrics: {
      cycles,
      daemonChecks,
    },
  }
}

async function stageProviderHealthLive(ctx: StageInternalContext): Promise<ReliabilityStageRunOutput> {
  await runStageCommand(
    ctx,
    "provider-health-check",
    ["bun", "run", "script/provider-health-check.ts", "--errors-only", "--critical-only", "--json"],
    {
      cwd: ctx.packageRoot,
      env: ctx.runtimeEnv,
      timeoutMs: 20 * 60_000,
    },
  )

  return {
    summary: "Provider live health checks passed",
  }
}

async function stageMemoryHealthLive(ctx: StageInternalContext): Promise<ReliabilityStageRunOutput> {
  await runStageCommand(ctx, "memory-health-check", ["bun", "run", "script/memory-health-check.ts"], {
    cwd: ctx.packageRoot,
    env: ctx.runtimeEnv,
    timeoutMs: 5 * 60_000,
  })

  return {
    summary: "Memory live health check passed",
  }
}

async function stageLongSoak(ctx: StageInternalContext): Promise<ReliabilityStageRunOutput> {
  const daemonPort = stagePort(ctx.daemonPortBase, ctx.stageIndex, 0)
  const gatewayPort = stagePort(ctx.gatewayPortBase, ctx.stageIndex, 0)
  const env = { ...ctx.runtimeEnv, ZEE_GATEWAY_PORT: String(gatewayPort) }

  const command = [
    ctx.runtime.distBinaryPath,
    "daemon",
    "--skip-setup-check",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(daemonPort),
    "--directory",
    ctx.repoRoot,
  ]

  const baselineProcesses = await listZeeProcesses()
  const baselineCount = baselineProcesses.length

  const durationMs = longSoakMs(ctx.options)
  const checkIntervalMs = 15_000
  const startedAt = Date.now()
  const failures: string[] = []
  let probes = 0

  const handle = await spawnDaemon({
    command,
    cwd: ctx.packageRoot,
    env,
    stageArtifactDir: ctx.stageArtifactDir,
    stageId: "long-soak",
    suffix: "daemon",
    port: daemonPort,
  })

  try {
    await waitForDaemonHealth(daemonPort, 45_000)

    while (Date.now() - startedAt < durationMs) {
      probes += 1

      try {
        // eslint-disable-next-line no-await-in-loop
        const live = await waitForHttpJson(`http://127.0.0.1:${daemonPort}/global/health/live`, 5_000, 500, 2_000)
        if (live?.alive !== true) {
          failures.push(`Probe ${probes}: daemon not alive payload=${JSON.stringify(live)}`)
        }
      } catch (error) {
        failures.push(
          `Probe ${probes}: global health live failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      }

      try {
        // eslint-disable-next-line no-await-in-loop
        const mem = await waitForHttpJson(`http://127.0.0.1:${daemonPort}/memory/health`, 5_000)
        if (mem?.available !== true) {
          failures.push(`Probe ${probes}: memory unavailable payload=${JSON.stringify(mem)}`)
        }
      } catch (error) {
        failures.push(
          `Probe ${probes}: memory health failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      }

      try {
        // eslint-disable-next-line no-await-in-loop
        const channels = await waitForHttpJson(`http://127.0.0.1:${daemonPort}/gateway/channels/status`, 5_000)
        if (channels?.success !== true) {
          failures.push(`Probe ${probes}: gateway channels status failed payload=${JSON.stringify(channels)}`)
        }
      } catch (error) {
        failures.push(
          `Probe ${probes}: gateway channels health failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      }

      // eslint-disable-next-line no-await-in-loop
      const current = await listZeeProcesses()
      if (current.length > baselineCount + 3) {
        failures.push(`Probe ${probes}: process growth detected baseline=${baselineCount} current=${current.length}`)
      }

      if (failures.length > 0) {
        throw new Error(failures.join("\n"))
      }

      // eslint-disable-next-line no-await-in-loop
      await sleep(checkIntervalMs)
    }
  } finally {
    await stopDaemon(handle)
  }

  return {
    summary: "Long soak completed without crash loops or health regressions",
    details: [`durationMs=${durationMs}`, `probes=${probes}`],
    metrics: {
      durationMs,
      probes,
      baselineProcessCount: baselineCount,
      failures: failures.length,
    },
    artifacts: [
      {
        name: "long-soak-stdout",
        path: handle.stdoutPath,
        command,
        exitCode: 0,
      },
      {
        name: "long-soak-stderr",
        path: handle.stderrPath,
        command,
        exitCode: 0,
      },
    ],
  }
}

async function stagePostmortemArtifacts(ctx: StageInternalContext): Promise<ReliabilityStageRunOutput> {
  const artifacts = await collectPlatformSnapshots(ctx.stageArtifactDir, "postmortem")
  return {
    summary: "Postmortem diagnostics captured",
    artifacts,
    metrics: {
      snapshots: artifacts.length,
    },
  }
}

function createStages(profile: "alpha" | "diag"): Array<ReliabilityStage<StageInternalContext>> {
  const soakTimeout = longSoakMs({ profile }) + 10 * 60_000

  return [
    {
      id: "R01_build_and_binary_integrity",
      name: "Build and Binary Integrity",
      description: "Build from source and verify binary linkage/integrity",
      required: true,
      timeoutMs: 30 * 60_000,
      run: stageBuildAndVerify,
    },
    {
      id: "R02_source_vs_dist_parity",
      name: "Source vs Dist Parity",
      description: "Validate source and dist runtime parity for version and health",
      required: true,
      timeoutMs: 20 * 60_000,
      run: stageSourceVsDistParity,
    },
    {
      id: "R03_daemon_singleton_and_locking",
      name: "Daemon Singleton and Locking",
      description: "Ensure daemon singleton semantics and lock lifecycle are correct",
      required: true,
      timeoutMs: 15 * 60_000,
      run: stageDaemonSingletonAndLocking,
    },
    {
      id: "R04_daemon_recovery_and_restart",
      name: "Daemon Recovery and Restart",
      description: "Force-kill daemon and validate clean restart",
      required: true,
      timeoutMs: 20 * 60_000,
      run: stageDaemonRecoveryAndRestart,
    },
    {
      id: "R05_gateway_preflight_and_conflict_handling",
      name: "Gateway Preflight and Conflict Handling",
      description: "Validate gateway conflict detection and post-conflict recovery",
      required: true,
      timeoutMs: 20 * 60_000,
      run: stageGatewayPreflightConflict,
    },
    {
      id: "R06_gateway_channel_live_checks",
      name: "Gateway Channel Live Checks",
      description: "Validate live gateway channel status and health",
      required: true,
      timeoutMs: 15 * 60_000,
      run: stageGatewayChannelLiveChecks,
    },
    {
      id: "R07_tui_lifecycle_no_orphans",
      name: "TUI Lifecycle and Orphan Detection",
      description: "Run lifecycle loops and ensure no orphan Zee processes remain",
      required: true,
      timeoutMs: 10 * 60_000,
      run: stageTuiLifecycleNoOrphans,
    },
    {
      id: "R08_mode_switch_stress",
      name: "Mode Switch Stress",
      description: "Stress source/dist switching across repeated cycles",
      required: true,
      timeoutMs: profile === "alpha" ? 35 * 60_000 : 12 * 60_000,
      run: stageModeSwitchStress,
    },
    {
      id: "R09_provider_health_live",
      name: "Provider Health (Live)",
      description: "Run live provider checks and fail on critical provider issues",
      required: true,
      timeoutMs: 30 * 60_000,
      run: stageProviderHealthLive,
    },
    {
      id: "R10_memory_health_live",
      name: "Memory Health (Live)",
      description: "Validate live memory backend health and embedding flow",
      required: true,
      timeoutMs: 10 * 60_000,
      run: stageMemoryHealthLive,
    },
    {
      id: "R11_long_soak",
      name: "Long Soak",
      description: "Run prolonged daemon/gateway soak with periodic health probes",
      required: true,
      timeoutMs: soakTimeout,
      run: stageLongSoak,
    },
    {
      id: "R12_postmortem_artifacts",
      name: "Postmortem Artifacts",
      description: "Capture final diagnostics snapshots for root-cause analysis",
      required: true,
      timeoutMs: 10 * 60_000,
      run: stagePostmortemArtifacts,
    },
  ]
}

async function initializeRuntime(options: ReliabilityRunOptions): Promise<{
  repoRoot: string
  packageRoot: string
  artifactDir: string
  runtime: InternalRuntime
  assumptions: string[]
  runtimeEnv: NodeJS.ProcessEnv
}> {
  const repoRoot = await findRepoRoot()
  const packageRoot = path.join(repoRoot, "packages", "zee")
  const runId = nowTag()
  const artifactDir = path.resolve(options.artifactDir ?? path.join(repoRoot, "artifacts", "reliability", runId))

  await ensureDir(artifactDir)

  const runtimeStateDir = buildRuntimeStateDir(artifactDir)
  await ensureDir(runtimeStateDir)
  const copiedConfig = await seedRuntimeConfig(runtimeStateDir)

  const runtimeEnv = buildRuntimeEnv(runtimeStateDir)
  let distBinaryPath = ""
  try {
    distBinaryPath = await resolveDistBinaryPath(packageRoot)
  } catch {
    const targetOS = process.platform === "win32" ? "windows" : process.platform
    const targetArch = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : process.arch
    const extension = process.platform === "win32" ? ".exe" : ""
    distBinaryPath = path.join(
      packageRoot,
      "dist",
      "@adolago",
      `zee-${targetOS}-${targetArch}`,
      "bin",
      `zee${extension}`,
    )
  }

  const commandLogPath = path.join(artifactDir, "command-log.md")
  await writeText(
    commandLogPath,
    [
      "# Reliability Command Log",
      `Generated: ${new Date().toISOString()}`,
      `Repo: ${repoRoot}`,
      `Package: ${packageRoot}`,
      `Dist binary: ${distBinaryPath}`,
      `Runtime state: ${runtimeStateDir}`,
      copiedConfig.length > 0
        ? `Copied config artifacts:\n${copiedConfig.map((line) => `- ${line}`).join("\n")}`
        : "Copied config artifacts: <none>",
      "",
    ].join("\n"),
  )

  const assumptions = [
    "Live external checks are required and fail hard by default.",
    "Reliability run uses an isolated runtime state directory under artifacts.",
    "Host config/env credentials are copied into isolated runtime when available.",
    `Long soak duration: ${longSoakMs(options)}ms`,
  ]

  return {
    repoRoot,
    packageRoot,
    artifactDir,
    runtime: {
      runId,
      runtimeStateDir,
      commandLogPath,
      distBinaryPath,
    },
    assumptions,
    runtimeEnv,
  }
}

async function runStageWithTimeout(
  stage: ReliabilityStage<StageInternalContext>,
  context: StageInternalContext,
): Promise<ReliabilityStageRunOutput> {
  return await Promise.race([
    stage.run(context),
    new Promise<ReliabilityStageRunOutput>((_, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Stage timed out after ${stage.timeoutMs}ms`))
      }, stage.timeoutMs)
      timeout.unref?.()
    }),
  ])
}

async function finalizeReportArtifact(report: ReliabilityReportV1): Promise<void> {
  const filepath = path.join(report.artifactDir, "report.json")
  await writeText(filepath, JSON.stringify(report, null, 2))
}

function stageFailed(report: ReliabilityStageReport): boolean {
  return report.status === "fail" && report.required
}

export async function runReliabilitySuite(options: ReliabilityRunOptions): Promise<ReliabilityReportV1> {
  const normalizedOptions: ReliabilityRunOptions = {
    profile: options.profile,
    failFast: options.failFast ?? true,
    artifactDir: options.artifactDir,
    json: options.json,
    longSoakDurationMs: options.longSoakDurationMs,
  }

  let interruptedSignal: NodeJS.Signals | undefined
  const signalHandlers: Array<{ signal: NodeJS.Signals; handler: () => void }> = []

  const registerSignalHandler = (signal: NodeJS.Signals) => {
    const handler = () => {
      interruptedSignal = interruptedSignal ?? signal
      void stopAllTrackedDaemons()
    }
    process.once(signal, handler)
    signalHandlers.push({ signal, handler })
  }

  registerSignalHandler("SIGINT")
  registerSignalHandler("SIGTERM")

  try {
    const init = await initializeRuntime(normalizedOptions)
    const platform = await detectPlatformInfo()
    const stages = createStages(normalizedOptions.profile)
    const stageReports: ReliabilityStageReport[] = []

    for (let index = 0; index < stages.length; index += 1) {
      const stage = stages[index]
      const stageStartedAt = Date.now()
      const stageArtifactDir = path.join(
        init.artifactDir,
        `${String(index + 1).padStart(2, "0")}-${sanitizeFileName(stage.id)}`,
      )
      await ensureDir(stageArtifactDir)

      const stageLogPath = path.join(stageArtifactDir, "stage.log")
      await writeStageLogHeader(stageLogPath, stage)

      const context: StageInternalContext = {
        options: normalizedOptions,
        repoRoot: init.repoRoot,
        packageRoot: init.packageRoot,
        artifactDir: init.artifactDir,
        stageArtifactDir,
        profile: normalizedOptions.profile,
        runtimeEnv: init.runtimeEnv,
        daemonPortBase: DEFAULT_DAEMON_PORT_BASE,
        gatewayPortBase: DEFAULT_GATEWAY_PORT_BASE,
        distBinaryPath: init.runtime.distBinaryPath,
        stageIndex: index,
        runtime: init.runtime,
        stageLogPath,
      }

      const stageArtifacts: ReliabilitySnapshotArtifact[] = []
      let status: "pass" | "fail" | "skip" = "pass"
      let summary = ""
      let details: string[] = []
      let metrics: Record<string, number | string | boolean | null> = {}
      let errorText = ""

      try {
        const result = await runStageWithTimeout(stage, context)
        summary = result.summary
        details = result.details ?? []
        metrics = result.metrics ?? {}
        if (result.artifacts) stageArtifacts.push(...result.artifacts)
        await appendText(stageLogPath, `\nStage result: PASS\nSummary: ${summary}\n`)
      } catch (error) {
        status = "fail"
        errorText = error instanceof Error ? error.message : String(error)
        summary = "Stage failed"
        details = [errorText]
        await appendText(stageLogPath, `\nStage result: FAIL\nError: ${errorText}\n`)

        const snapshotArtifacts = await collectPlatformSnapshots(stageArtifactDir, "failure-snapshot")
        stageArtifacts.push(...snapshotArtifacts)
      }

      const completedAt = Date.now()
      stageReports.push({
        id: stage.id,
        name: stage.name,
        description: stage.description,
        required: stage.required,
        startedAt: new Date(stageStartedAt).toISOString(),
        completedAt: new Date(completedAt).toISOString(),
        durationMs: completedAt - stageStartedAt,
        status,
        summary,
        details,
        artifacts: stageArtifacts,
        metrics,
        error: errorText || undefined,
      })

      const reportDraft: ReliabilityReportV1 = {
        version: RELIABILITY_REPORT_VERSION,
        generatedAt: new Date().toISOString(),
        profile: normalizedOptions.profile,
        repoRoot: init.repoRoot,
        artifactDir: init.artifactDir,
        platform: process.platform,
        summary: {
          total: stageReports.length,
          passed: stageReports.filter((item) => item.status === "pass").length,
          failed: stageReports.filter((item) => item.status === "fail").length,
          skipped: stageReports.filter((item) => item.status === "skip").length,
        },
        stages: stageReports,
        assumptions: [...init.assumptions, ...platform.notes],
      }

      await finalizeReportArtifact(reportDraft)

      if (interruptedSignal) {
        throw new Error(`Reliability run interrupted by ${interruptedSignal}`)
      }

      if (stageFailed(stageReports[stageReports.length - 1]) && normalizedOptions.failFast) {
        return reportDraft
      }
    }

    const report: ReliabilityReportV1 = {
      version: RELIABILITY_REPORT_VERSION,
      generatedAt: new Date().toISOString(),
      profile: normalizedOptions.profile,
      repoRoot: init.repoRoot,
      artifactDir: init.artifactDir,
      platform: process.platform,
      summary: {
        total: stageReports.length,
        passed: stageReports.filter((item) => item.status === "pass").length,
        failed: stageReports.filter((item) => item.status === "fail").length,
        skipped: stageReports.filter((item) => item.status === "skip").length,
      },
      stages: stageReports,
      assumptions: [...init.assumptions, ...platform.notes],
    }

    await finalizeReportArtifact(report)
    return report
  } finally {
    for (const entry of signalHandlers) {
      process.off(entry.signal, entry.handler)
    }
    await stopAllTrackedDaemons()
  }
}

export function formatReliabilitySummary(report: ReliabilityReportV1): string {
  const lines = [
    `Reliability profile: ${report.profile}`,
    `Artifact dir: ${report.artifactDir}`,
    `Summary: total=${report.summary.total} passed=${report.summary.passed} failed=${report.summary.failed} skipped=${report.summary.skipped}`,
    "",
  ]

  for (const stage of report.stages) {
    lines.push(`[${stage.status.toUpperCase()}] ${stage.id} (${stage.durationMs}ms) - ${stage.summary}`)
    if (stage.error) {
      lines.push(`  error: ${stage.error}`)
    }
  }

  return lines.join("\n")
}
