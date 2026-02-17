import path from "node:path"
import fs from "node:fs/promises"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { Log } from "@/util/log"

const log = Log.create({ service: "pods-manager" })

export type VllmProfile = "release" | "nightly" | "gpt-oss" | "custom"

export type PodDefinition = {
  name: string
  ssh: string
  mount?: string
  modelsPath?: string
  profile: VllmProfile
  createdAt: number
  updatedAt: number
}

export type ModelProcess = {
  name: string
  pod: string
  model: string
  port: number
  pid?: number
  logFile: string
  extraArgs: string[]
  startedAt: number
}

type PodsState = {
  activePod?: string
  pods: Record<string, PodDefinition>
  models: Record<string, ModelProcess>
}

function stateFilepath() {
  return path.join(Global.Path.state, "pods.json")
}

async function readState(): Promise<PodsState> {
  const txt = await fs.readFile(stateFilepath(), "utf-8").catch(() => "")
  if (!txt) {
    return { pods: {}, models: {} }
  }
  try {
    const parsed = JSON.parse(txt) as PodsState
    return {
      activePod: parsed.activePod,
      pods: parsed.pods ?? {},
      models: parsed.models ?? {},
    }
  } catch {
    return { pods: {}, models: {} }
  }
}

async function writeState(state: PodsState) {
  const filepath = stateFilepath()
  await fs.mkdir(path.dirname(filepath), { recursive: true })
  await Bun.write(filepath, JSON.stringify(state, null, 2))
}

function singleQuote(input: string): string {
  return `'${input.replace(/'/g, `'\"'\"'`)}'`
}

function commandForPod(pod: PodDefinition, remoteCommand?: string): string {
  if (!remoteCommand) return pod.ssh
  return `${pod.ssh} ${singleQuote(remoteCommand)}`
}

async function runCommand(cmd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bash", "-lc", cmd], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  })
  const [stdoutText, stderrText, code] = await Promise.all([
    proc.stdout ? new Response(proc.stdout).text() : Promise.resolve(""),
    proc.stderr ? new Response(proc.stderr).text() : Promise.resolve(""),
    proc.exited,
  ])
  return {
    code,
    stdout: stdoutText.trim(),
    stderr: stderrText.trim(),
  }
}

async function runInteractive(cmd: string): Promise<number> {
  const proc = Bun.spawn(["bash", "-lc", cmd], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  return proc.exited
}

function requirePod(state: PodsState, name?: string): PodDefinition {
  const resolvedName = name ?? state.activePod
  if (!resolvedName) {
    throw new Error("No pod selected. Set an active pod with `zee pods active <name>`.")
  }
  const pod = state.pods[resolvedName]
  if (!pod) {
    throw new Error(`Pod not found: ${resolvedName}`)
  }
  return pod
}

export async function setupPod(input: {
  name: string
  ssh: string
  mount?: string
  modelsPath?: string
  profile?: VllmProfile
  setActive?: boolean
}) {
  const state = await readState()
  const now = Date.now()
  const existing = state.pods[input.name]
  state.pods[input.name] = {
    name: input.name,
    ssh: input.ssh,
    mount: input.mount,
    modelsPath: input.modelsPath,
    profile: input.profile ?? "release",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  if (input.setActive !== false || !state.activePod) {
    state.activePod = input.name
  }
  await writeState(state)
  return state.pods[input.name]
}

export async function listPods() {
  const state = await readState()
  return {
    activePod: state.activePod,
    pods: Object.values(state.pods).sort((a, b) => a.name.localeCompare(b.name)),
  }
}

export async function setActivePod(name: string) {
  const state = await readState()
  if (!state.pods[name]) throw new Error(`Pod not found: ${name}`)
  state.activePod = name
  await writeState(state)
  return state.pods[name]
}

export async function removePod(name: string) {
  const state = await readState()
  const existing = state.pods[name]
  if (!existing) return undefined
  delete state.pods[name]
  if (state.activePod === name) {
    state.activePod = Object.keys(state.pods)[0]
  }

  // Remove model entries bound to the pod as they are stale after removal.
  for (const [modelName, model] of Object.entries(state.models)) {
    if (model.pod === name) delete state.models[modelName]
  }

  await writeState(state)
  return existing
}

export async function openPodShell(name?: string) {
  const state = await readState()
  const pod = requirePod(state, name)
  return runInteractive(commandForPod(pod))
}

export async function runPodSsh(input: { name?: string; command: string }) {
  const state = await readState()
  const pod = requirePod(state, input.name)
  return runCommand(commandForPod(pod, input.command))
}

export async function startModel(input: {
  model: string
  name: string
  pod?: string
  port?: number
  logFile?: string
  extraArgs?: string[]
}) {
  const state = await readState()
  const pod = requirePod(state, input.pod)
  const port = input.port ?? 8000
  const logFile = input.logFile ?? `~/zee-vllm-${input.name}.log`
  const extraArgs = input.extraArgs ?? []
  const extraArgsText = extraArgs.map((arg) => singleQuote(arg)).join(" ")

  const remote = [
    "nohup",
    "vllm",
    "serve",
    singleQuote(input.model),
    "--host",
    singleQuote("0.0.0.0"),
    "--port",
    String(port),
    extraArgsText,
    ">",
    singleQuote(logFile),
    "2>&1",
    "&",
    "echo $!",
  ]
    .filter(Boolean)
    .join(" ")

  const result = await runCommand(commandForPod(pod, remote))
  if (result.code !== 0) {
    throw new Error(result.stderr || "Failed to start model process")
  }

  const pid = Number.parseInt(result.stdout, 10)
  const record: ModelProcess = {
    name: input.name,
    pod: pod.name,
    model: input.model,
    port,
    pid: Number.isFinite(pid) ? pid : undefined,
    logFile,
    extraArgs,
    startedAt: Date.now(),
  }
  state.models[input.name] = record
  await writeState(state)
  return record
}

export async function stopModel(name: string) {
  const state = await readState()
  const model = state.models[name]
  if (!model) return undefined
  const pod = requirePod(state, model.pod)

  const remote = model.pid ? `kill ${model.pid}` : `pkill -f ${singleQuote(`vllm serve ${model.model}`)}`

  const result = await runCommand(commandForPod(pod, remote))
  if (result.code !== 0 && !/No such process/i.test(result.stderr)) {
    throw new Error(result.stderr || "Failed to stop model process")
  }

  delete state.models[name]
  await writeState(state)
  return model
}

export async function listModels() {
  const state = await readState()
  const models = Object.values(state.models).sort((a, b) => a.name.localeCompare(b.name))
  const withStatus = await Promise.all(
    models.map(async (model) => {
      let status: "running" | "stopped" | "unknown" = "unknown"
      if (model.pid) {
        try {
          const probe = await runPodSsh({
            name: model.pod,
            command: `kill -0 ${model.pid} >/dev/null 2>&1 && echo running || echo stopped`,
          })
          if (probe.stdout.includes("running")) status = "running"
          else if (probe.stdout.includes("stopped")) status = "stopped"
        } catch {
          status = "unknown"
        }
      }
      return { ...model, status }
    }),
  )
  return withStatus
}

export async function streamModelLogs(input: { name: string; follow?: boolean; lines?: number }) {
  const state = await readState()
  const model = state.models[input.name]
  if (!model) throw new Error(`Model process not found: ${input.name}`)
  const pod = requirePod(state, model.pod)
  const lines = Math.max(1, input.lines ?? 200)
  const follow = input.follow !== false
  const tailCmd = `tail -n ${lines} ${follow ? "-f " : ""}${singleQuote(model.logFile)}`
  return runInteractive(commandForPod(pod, tailCmd))
}

export async function inspectPodsConfig() {
  const state = await readState()
  return {
    stateFile: stateFilepath(),
    activePod: state.activePod,
    pods: Object.values(state.pods),
    models: Object.values(state.models),
  }
}

export async function stateFileExists() {
  return Filesystem.exists(stateFilepath())
}

log.info("pods manager loaded")
