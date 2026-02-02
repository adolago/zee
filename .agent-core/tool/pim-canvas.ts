/**
 * PIM Canvas Tools - Launch PIM tools in WezTerm panes
 *
 * Spawns interactive PIM applications (neomutt, ikhal, khard) in new WezTerm panes,
 * building on the canvas infrastructure.
 */

import { tool } from "@agent-core/plugin"
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

type PimApp = "email" | "calendar" | "contacts" | "sync"

type PimPaneState = {
  version: 1
  panes: Record<
    string,
    {
      paneId: string
      app: PimApp
      createdAt: number
    }
  >
}

const PIM_COMMANDS: Record<PimApp, { cmd: string; args: string[]; title: string }> = {
  email: { cmd: "neomutt", args: [], title: "Email - neomutt" },
  calendar: { cmd: "ikhal", args: ["-1"], title: "Calendar - ikhal" },
  contacts: { cmd: "khard", args: [], title: "Contacts - khard" },
  sync: { cmd: "pim-sync", args: [], title: "PIM Sync" },
}

function getStateDir(): string {
  const xdg = process.env.XDG_STATE_HOME?.trim()
  if (xdg) return path.join(xdg, "agent-core")
  return path.join(os.homedir(), ".local", "state", "agent-core")
}

function getPimStateDir(): string {
  return path.join(getStateDir(), "pim-canvas")
}

function getPimStatePath(): string {
  return path.join(getPimStateDir(), "state.json")
}

async function ensurePimStateDir(): Promise<void> {
  await mkdir(getPimStateDir(), { recursive: true })
}

async function loadPimState(): Promise<PimPaneState> {
  const statePath = getPimStatePath()
  if (!existsSync(statePath)) {
    return { version: 1, panes: {} }
  }
  try {
    const raw = await readFile(statePath, "utf-8")
    const parsed = JSON.parse(raw) as Partial<PimPaneState>
    if (parsed.version !== 1 || !parsed.panes) return { version: 1, panes: {} }
    return { version: 1, panes: parsed.panes }
  } catch {
    return { version: 1, panes: {} }
  }
}

async function savePimState(state: PimPaneState): Promise<void> {
  await ensurePimStateDir()
  await writeFile(getPimStatePath(), JSON.stringify(state, null, 2), "utf-8")
}

function getRuntimeDir(): string | undefined {
  const configured = process.env.XDG_RUNTIME_DIR?.trim()
  if (configured) return configured
  if (typeof process.getuid === "function") return `/run/user/${process.getuid()}`
  return undefined
}

async function resolveWeztermUnixSocket(): Promise<string | undefined> {
  const existing = process.env.WEZTERM_UNIX_SOCKET?.trim()
  if (existing) return existing

  const runtimeDir = getRuntimeDir()
  if (!runtimeDir) return undefined

  const weztermDir = path.join(runtimeDir, "wezterm")
  if (!existsSync(weztermDir)) return undefined

  try {
    const entries = await readdir(weztermDir, { withFileTypes: true })

    const wellKnown = entries.find((e) => e.isSymbolicLink() && e.name.endsWith("org.wezfurlong.wezterm"))
    if (wellKnown) return path.join(weztermDir, wellKnown.name)

    const guiSockets = entries
      .filter((e) => e.name.startsWith("gui-sock-"))
      .map((e) => path.join(weztermDir, e.name))

    let best: { p: string; mtimeMs: number } | undefined
    for (const p of guiSockets) {
      try {
        const s = await stat(p)
        const mtimeMs = s.mtimeMs ?? 0
        if (!best || mtimeMs > best.mtimeMs) best = { p, mtimeMs }
      } catch {
        // ignore
      }
    }

    return best?.p
  } catch {
    return undefined
  }
}

async function weztermEnv(): Promise<NodeJS.ProcessEnv> {
  const env = { ...process.env }

  const socket = await resolveWeztermUnixSocket()
  if (!socket) {
    throw new Error("WEZTERM_UNIX_SOCKET not set and no WezTerm GUI socket found")
  }
  env.WEZTERM_UNIX_SOCKET = socket

  const runtimeDir = getRuntimeDir()
  if (runtimeDir && !env.XDG_RUNTIME_DIR) env.XDG_RUNTIME_DIR = runtimeDir

  return env
}

async function weztermCli(args: string[], options: { timeoutMs?: number } = {}): Promise<{ stdout: string; stderr: string }> {
  const timeoutMs = options.timeoutMs ?? 5000
  const { stdout, stderr } = await execFileAsync("wezterm", ["cli", ...args], {
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
    env: await weztermEnv(),
  })
  return { stdout: String(stdout ?? ""), stderr: String(stderr ?? "") }
}

type WeztermListEntry = {
  pane_id?: number
  paneId?: number
  paneID?: number
  pane?: number
  tab_id?: number
  is_active?: boolean
  cwd?: string
}

async function getWeztermList(): Promise<WeztermListEntry[]> {
  const { stdout } = await weztermCli(["list", "--format", "json"], { timeoutMs: 2500 })
  const data = JSON.parse(stdout) as unknown
  if (!Array.isArray(data)) return []
  return data as WeztermListEntry[]
}

async function getWeztermPaneIds(): Promise<Set<string>> {
  const data = await getWeztermList()
  const ids = new Set<string>()
  for (const entry of data) {
    const paneId = entry?.pane_id ?? entry?.paneId ?? entry?.paneID ?? entry?.pane
    if (paneId === undefined || paneId === null) continue
    ids.add(String(paneId))
  }
  return ids
}

function weztermEnabled(): boolean {
  const raw = process.env.AGENT_CORE_CANVAS_WEZTERM?.trim().toLowerCase()
  if (!raw) return true
  return !["0", "false", "off", "no"].includes(raw)
}

async function weztermAvailable(): Promise<boolean> {
  if (!weztermEnabled()) return false
  try {
    await getWeztermPaneIds()
    return true
  } catch {
    return false
  }
}

async function paneExists(paneId: string): Promise<boolean> {
  try {
    const ids = await getWeztermPaneIds()
    return ids.has(paneId)
  } catch {
    return false
  }
}

function getPaneId(entry: WeztermListEntry): string | undefined {
  const paneId = entry?.pane_id ?? entry?.paneId ?? entry?.paneID ?? entry?.pane
  return paneId === undefined || paneId === null ? undefined : String(paneId)
}

async function resolveTargetPaneId(): Promise<string | undefined> {
  const configured = process.env.AGENT_CORE_CANVAS_PANE_ID?.trim()
  if (configured) return configured

  const envPane = process.env.WEZTERM_PANE?.trim()
  if (envPane) return envPane

  const list = await getWeztermList()
  const active = list.find((x) => x.is_active) ?? list[0]
  return getPaneId(active)
}

async function commandExists(cmd: string): Promise<boolean> {
  try {
    await execFileAsync("which", [cmd], { timeout: 2000 })
    return true
  } catch {
    return false
  }
}

async function spawnPimPane(app: PimApp, newWindow: boolean): Promise<{ paneId: string; created: boolean }> {
  const state = await loadPimState()
  const existing = state.panes[app]
  if (existing && (await paneExists(existing.paneId))) {
    // Focus the existing pane
    try {
      await weztermCli(["activate-pane", "--pane-id", existing.paneId], { timeoutMs: 2500 })
    } catch {
      // ignore
    }
    return { paneId: existing.paneId, created: false }
  }

  const config = PIM_COMMANDS[app]
  const cmdExists = await commandExists(config.cmd)
  if (!cmdExists) {
    throw new Error(`Command '${config.cmd}' not found. Install it first.`)
  }

  const fullCmd = [config.cmd, ...config.args].join(" ")

  let paneId: string

  if (newWindow) {
    // Spawn a new window with the command
    const { stdout } = await weztermCli(
      ["spawn", "--new-window", "--", "sh", "-c", fullCmd],
      { timeoutMs: 10000 }
    )
    paneId = stdout.trim()
  } else {
    // Split the current pane
    const targetPaneId = await resolveTargetPaneId()
    const splitArgs = ["split-pane", "--right", "--percent", "50"]
    if (targetPaneId) splitArgs.push("--pane-id", targetPaneId)
    splitArgs.push("--", "sh", "-c", fullCmd)
    const { stdout } = await weztermCli(splitArgs, { timeoutMs: 10000 })
    paneId = stdout.trim()

    // Return focus to original pane
    if (targetPaneId) {
      try {
        await weztermCli(["activate-pane", "--pane-id", targetPaneId], { timeoutMs: 2500 })
      } catch {
        // ignore
      }
    }
  }

  if (!paneId) throw new Error("wezterm did not return a pane id")

  // Set pane title
  try {
    const escapeSequence = `\x1b]0;${config.title}\x07`
    await weztermCli(["send-text", "--pane-id", paneId, "--no-paste", escapeSequence], { timeoutMs: 2500 })
  } catch {
    // ignore title setting errors
  }

  state.panes[app] = { paneId, app, createdAt: Date.now() }
  await savePimState(state)

  return { paneId, created: true }
}

// PIM Open tool - open email, calendar, or contacts
export const pimOpen = tool({
  description: `Open PIM (Personal Information Manager) tools in WezTerm panes.

Available apps:
- email: Opens neomutt for email management
- calendar: Opens ikhal for calendar view
- contacts: Opens khard for contacts management
- sync: Runs pim-sync to sync all PIM data

Options:
- newWindow: If true, opens in a new WezTerm window instead of splitting current pane

Examples:
- Open email: { app: "email" }
- Open calendar in new window: { app: "calendar", newWindow: true }
- Sync all PIM data: { app: "sync" }`,
  args: {
    app: tool.schema
      .enum(["email", "calendar", "contacts", "sync"])
      .describe("Which PIM app to open"),
    newWindow: tool.schema
      .boolean()
      .optional()
      .describe("Open in new window instead of splitting pane (default: true)"),
  },
  async execute(args) {
    const app = args.app as PimApp
    const newWindow = args.newWindow !== false // default to true

    if (!(await weztermAvailable())) {
      return `WezTerm not available. Cannot open ${app}.

To use manually, run:
- email: neomutt
- calendar: ikhal -1
- contacts: khard
- sync: pim-sync`
    }

    try {
      const { paneId, created } = await spawnPimPane(app, newWindow)
      const config = PIM_COMMANDS[app]
      if (created) {
        return `Opened ${config.title} in ${newWindow ? "new window" : "split pane"} (pane ${paneId}).`
      } else {
        return `${config.title} is already open (pane ${paneId}). Focused existing pane.`
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return `Failed to open ${app}: ${msg}`
    }
  },
})

// PIM Close tool - close a PIM pane
export const pimClose = tool({
  description: `Close a PIM app pane.`,
  args: {
    app: tool.schema
      .enum(["email", "calendar", "contacts", "sync"])
      .describe("Which PIM app to close"),
  },
  async execute(args) {
    const app = args.app as PimApp

    if (!(await weztermAvailable())) {
      return `WezTerm not available.`
    }

    const state = await loadPimState()
    const existing = state.panes[app]
    if (!existing) return `${app} is not open.`

    try {
      await weztermCli(["kill-pane", "--pane-id", existing.paneId], { timeoutMs: 5000 })
    } catch {
      // pane may already be closed
    }

    delete state.panes[app]
    await savePimState(state)
    return `Closed ${app} pane.`
  },
})

// PIM List tool - list open PIM panes
export const pimList = tool({
  description: `List all open PIM app panes.`,
  args: {},
  async execute() {
    const state = await loadPimState()
    const apps = Object.keys(state.panes) as PimApp[]
    if (apps.length === 0) return "No PIM apps open."

    const live: Array<{ app: PimApp; paneId: string }> = []
    for (const app of apps) {
      const pane = state.panes[app]
      if (!pane) continue
      if (await paneExists(pane.paneId)) {
        live.push({ app, paneId: pane.paneId })
      } else {
        delete state.panes[app]
      }
    }
    await savePimState(state)

    if (live.length === 0) return "No PIM apps open."

    const lines = live.map((p) => {
      const config = PIM_COMMANDS[p.app]
      return `- ${config.title} (pane ${p.paneId})`
    })

    return `${live.length} PIM app(s) open:\n${lines.join("\n")}`
  },
})

// PIM Focus tool - focus a PIM pane
export const pimFocus = tool({
  description: `Focus (bring to front) a PIM app pane.`,
  args: {
    app: tool.schema
      .enum(["email", "calendar", "contacts", "sync"])
      .describe("Which PIM app to focus"),
  },
  async execute(args) {
    const app = args.app as PimApp

    if (!(await weztermAvailable())) {
      return `WezTerm not available.`
    }

    const state = await loadPimState()
    const existing = state.panes[app]
    if (!existing) return `${app} is not open. Use pimOpen first.`

    if (!(await paneExists(existing.paneId))) {
      delete state.panes[app]
      await savePimState(state)
      return `${app} pane no longer exists. Use pimOpen to reopen.`
    }

    try {
      await weztermCli(["activate-pane", "--pane-id", existing.paneId], { timeoutMs: 2500 })
      return `Focused ${PIM_COMMANDS[app].title} (pane ${existing.paneId}).`
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return `Failed to focus ${app}: ${msg}`
    }
  },
})

// PIM Dashboard - open all PIM tools at once
export const pimDashboard = tool({
  description: `Open a full PIM dashboard with email, calendar, and contacts in separate WezTerm panes.

This creates a new window with three panes arranged for PIM work:
- Left: Email (neomutt)
- Top-right: Calendar (ikhal)
- Bottom-right: Contacts (khard)`,
  args: {},
  async execute() {
    if (!(await weztermAvailable())) {
      return `WezTerm not available. Cannot open PIM dashboard.

To use manually:
- neomutt (email)
- ikhal -1 (calendar)
- khard (contacts)
- pim-sync (sync all)`
    }

    const results: string[] = []

    // Open email in new window first
    try {
      const { paneId: emailPaneId, created: emailCreated } = await spawnPimPane("email", true)
      results.push(emailCreated ? `Email opened in new window (pane ${emailPaneId})` : `Email already open (pane ${emailPaneId})`)

      // Wait a moment for window to be ready
      await new Promise((r) => setTimeout(r, 500))

      // Now split for calendar (right side)
      const state = await loadPimState()
      const emailPane = state.panes.email
      if (emailPane) {
        // Split right for calendar
        const calendarCmd = [PIM_COMMANDS.calendar.cmd, ...PIM_COMMANDS.calendar.args].join(" ")
        const { stdout: calPaneId } = await weztermCli(
          ["split-pane", "--right", "--percent", "50", "--pane-id", emailPane.paneId, "--", "sh", "-c", calendarCmd],
          { timeoutMs: 10000 }
        )
        if (calPaneId.trim()) {
          state.panes.calendar = { paneId: calPaneId.trim(), app: "calendar", createdAt: Date.now() }
          results.push(`Calendar opened (pane ${calPaneId.trim()})`)

          // Split calendar pane bottom for contacts
          const contactsCmd = [PIM_COMMANDS.contacts.cmd, ...PIM_COMMANDS.contacts.args].join(" ")
          const { stdout: contactsPaneId } = await weztermCli(
            ["split-pane", "--bottom", "--percent", "50", "--pane-id", calPaneId.trim(), "--", "sh", "-c", contactsCmd],
            { timeoutMs: 10000 }
          )
          if (contactsPaneId.trim()) {
            state.panes.contacts = { paneId: contactsPaneId.trim(), app: "contacts", createdAt: Date.now() }
            results.push(`Contacts opened (pane ${contactsPaneId.trim()})`)
          }
        }
        await savePimState(state)

        // Focus back to email
        await weztermCli(["activate-pane", "--pane-id", emailPane.paneId], { timeoutMs: 2500 })
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      results.push(`Error: ${msg}`)
    }

    return `PIM Dashboard:\n${results.join("\n")}`
  },
})
