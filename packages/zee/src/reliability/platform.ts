import type { ReliabilitySnapshotArtifact } from "./types"
import { runCommand, writeText } from "./helpers"

export type ReliabilityServiceMode = "systemd-user" | "launchctl" | "windows-service" | "local-process"

export interface ReliabilityPlatformInfo {
  platform: NodeJS.Platform
  mode: ReliabilityServiceMode
  notes: string[]
}

export async function detectPlatformInfo(): Promise<ReliabilityPlatformInfo> {
  const notes: string[] = []

  if (process.platform === "linux") {
    const hasSystemctl = await commandExists("systemctl")
    if (hasSystemctl) {
      const hasUserUnit = await systemdUserUnitExists("zee.service")
      if (hasUserUnit) {
        notes.push("Detected systemd user unit zee.service")
        return { platform: process.platform, mode: "systemd-user", notes }
      }
      notes.push("systemctl exists but zee.service user unit is not installed")
    } else {
      notes.push("systemctl not found")
    }
    return { platform: process.platform, mode: "local-process", notes }
  }

  if (process.platform === "darwin") {
    const hasLaunchctl = await commandExists("launchctl")
    if (hasLaunchctl) {
      notes.push("launchctl available; using local-process parity checks")
      return { platform: process.platform, mode: "launchctl", notes }
    }
    notes.push("launchctl not found; using local-process parity checks")
    return { platform: process.platform, mode: "local-process", notes }
  }

  if (process.platform === "win32") {
    const hasSc = await commandExists("sc")
    if (hasSc) {
      notes.push("Windows service tooling available; using local-process parity checks")
      return { platform: process.platform, mode: "windows-service", notes }
    }
    notes.push("Service controller unavailable; using local-process parity checks")
    return { platform: process.platform, mode: "local-process", notes }
  }

  notes.push("Unsupported platform for service-manager checks; using local-process parity checks")
  return { platform: process.platform, mode: "local-process", notes }
}

async function commandExists(command: string): Promise<boolean> {
  if (process.platform === "win32") {
    const out = await runCommand(["where", command], {
      expectedExitCodes: [0, 1],
      timeoutMs: 5_000,
    })
    return out.exitCode === 0
  }

  const out = await runCommand(["which", command], {
    expectedExitCodes: [0, 1],
    timeoutMs: 5_000,
  })
  return out.exitCode === 0
}

export async function systemdUserUnitExists(unit: string): Promise<boolean> {
  if (process.platform !== "linux") return false
  const out = await runCommand(
    [
      "systemctl",
      "--user",
      "list-unit-files",
      "--type=service",
      "--no-legend",
      "--no-pager",
    ],
    {
      expectedExitCodes: [0],
      timeoutMs: 10_000,
    },
  )

  return out.stdout
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/)[0] ?? "")
    .includes(unit)
}

export async function collectPlatformSnapshots(
  artifactDir: string,
  prefix: string,
): Promise<ReliabilitySnapshotArtifact[]> {
  const artifacts: ReliabilitySnapshotArtifact[] = []
  const plan: Array<{ name: string; command: string[] }> = []

  if (process.platform === "win32") {
    plan.push(
      { name: "tasklist", command: ["tasklist"] },
      { name: "netstat", command: ["netstat", "-ano"] },
      { name: "sc-query", command: ["sc", "query", "type=", "service", "state=", "all"] },
    )
  } else {
    plan.push(
      { name: "ps", command: ["ps", "-ef"] },
      { name: "netstat", command: ["sh", "-lc", "ss -tulpn || netstat -an"] },
    )
    if (process.platform === "linux") {
      plan.push(
        { name: "systemd-user-status", command: ["systemctl", "--user", "status", "zee", "--no-pager"] },
        { name: "systemd-user-orch-status", command: ["systemctl", "--user", "status", "zee-orch", "--no-pager"] },
        { name: "journal-zee", command: ["journalctl", "--user", "-u", "zee", "--since", "10 min ago", "--no-pager"] },
      )
    }
  }

  for (const item of plan) {
    // eslint-disable-next-line no-await-in-loop
    const output = await runCommand(item.command, {
      expectedExitCodes: [0, 1, 3, 4],
      timeoutMs: 20_000,
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      return {
        command: item.command,
        cwd: process.cwd(),
        exitCode: -1,
        stdout: "",
        stderr: message,
        durationMs: 0,
        timedOut: false,
      }
    })

    const filepath = `${artifactDir}/${prefix}-${item.name}.log`
    // eslint-disable-next-line no-await-in-loop
    await writeText(
      filepath,
      [`$ ${item.command.join(" ")}`, "", output.stdout, output.stderr].filter(Boolean).join("\n"),
    )
    artifacts.push({
      name: item.name,
      path: filepath,
      command: item.command,
      exitCode: output.exitCode,
    })
  }

  return artifacts
}
