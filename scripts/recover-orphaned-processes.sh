#!/usr/bin/env bash
# Scan for likely orphaned Zee-related subprocesses after daemon/gateway restarts.
#
# Usage:
#   ./scripts/recover-orphaned-processes.sh
#
# Output:
#   JSON object with `orphaned` array and `ts` timestamp.

set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: recover-orphaned-processes.sh

Scans for likely orphaned Zee-related subprocesses and prints JSON.
USAGE
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  usage
  exit 0
fi

if [ "$#" -gt 0 ]; then
  usage >&2
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  ts="unknown"
  if command -v date >/dev/null 2>&1; then
    ts="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)"
  fi
  printf '{"error":"node not found on PATH","orphaned":[],"ts":"%s"}\n' "$ts"
  exit 0
fi

node <<'NODE'
const { execFileSync } = require("node:child_process")
const fs = require("node:fs")

let username = process.env.USER || process.env.LOGNAME || ""
if (username && !/^[a-zA-Z0-9._-]+$/.test(username)) {
  username = ""
}

function runFile(file, args) {
  try {
    return execFileSync(file, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
  } catch (error) {
    if (error && typeof error.stdout === "string") return error.stdout
    if (error && error.stdout && Buffer.isBuffer(error.stdout)) return error.stdout.toString("utf8")
    return ""
  }
}

function parsePositiveInt(raw) {
  if (typeof raw !== "string") return undefined
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return undefined
  const parsed = Number.parseInt(trimmed, 10)
  if (!Number.isFinite(parsed) || parsed <= 1) return undefined
  return parsed
}

function isTruthy(raw) {
  if (typeof raw !== "string") return false
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase())
}

function resolveStarted(pid) {
  const started = runFile("ps", ["-o", "lstart=", "-p", String(pid)]).trim()
  return started.length > 0 ? started : "unknown"
}

function resolvePpid(pid) {
  const value = runFile("ps", ["-o", "ppid=", "-p", String(pid)]).trim()
  return parsePositiveInt(value)
}

function resolveCwd(pid) {
  if (process.platform === "linux") {
    try {
      return fs.readlinkSync(`/proc/${pid}/cwd`)
    } catch {
      return "unknown"
    }
  }
  const lsof = runFile("lsof", ["-a", "-d", "cwd", "-p", String(pid), "-Fn"])
  const match = lsof.match(/^n(.+)$/m)
  return match ? match[1] : "unknown"
}

function readProcEnv(pid) {
  try {
    const raw = fs.readFileSync(`/proc/${pid}/environ`)
    const env = {}
    for (const entry of raw.toString("utf8").split("\u0000")) {
      if (!entry) continue
      const idx = entry.indexOf("=")
      if (idx <= 0) continue
      env[entry.slice(0, idx)] = entry.slice(idx + 1)
    }
    return env
  } catch {
    return {}
  }
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error && error.code === "EPERM"
  }
}

function sanitizeCommand(cmd) {
  return cmd
    .replace(/(--(?:token|api[-_]?key|password|secret|authorization)\s+)([^\s]+)/gi, "$1<redacted>")
    .replace(/((?:token|api[-_]?key|password|secret|authorization)=)([^\s]+)/gi, "$1<redacted>")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/g, "$1<redacted>")
}

let pgrepUnavailable = false
const pgrepResult = (() => {
  const args = username.length > 0 ? ["-u", username, "-f", "zee|codex|claude"] : ["-f", "zee|codex|claude"]
  try {
    return execFileSync("pgrep", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
  } catch (error) {
    if (error && error.code === "ENOENT") {
      pgrepUnavailable = true
      return ""
    }
    if (error && typeof error.stdout === "string") return error.stdout
    return ""
  }
})()

const candidatePids = pgrepResult
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => /^\d+$/.test(line))

let lines
if (candidatePids.length > 0) {
  lines = runFile("ps", ["-o", "pid=,command=", "-p", candidatePids.join(",")]).split("\n")
} else if (pgrepUnavailable && username.length > 0) {
  lines = runFile("ps", ["-U", username, "-o", "pid=,command="]).split("\n")
} else if (pgrepUnavailable) {
  lines = runFile("ps", ["-axo", "pid=,command="]).split("\n")
} else {
  lines = []
}

const includePattern = /zee|codex|claude/i
const excludePatterns = [/recover-orphaned-processes\.sh/i, /\bpgrep\b/i]
const orphaned = []

for (const rawLine of lines) {
  const line = rawLine.trim()
  if (!line) continue

  const match = line.match(/^(\d+)\s+(.+)$/)
  if (!match) continue

  const pid = Number.parseInt(match[1], 10)
  const cmd = match[2]
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) continue
  if (!includePattern.test(cmd)) continue
  if (excludePatterns.some((pattern) => pattern.test(cmd))) continue

  const ppid = resolvePpid(pid)
  const env = readProcEnv(pid)
  const taggedParentPid = parsePositiveInt(env.ZEE_PARENT_PID)
  const taggedSubagent = isTruthy(env.ZEE_IS_SUBAGENT) || Number.isInteger(taggedParentPid)
  const zeeLikeCommand = /\bzee\b/i.test(cmd)

  if (!taggedSubagent && !zeeLikeCommand) continue

  const expectedParent = taggedParentPid ?? ppid
  const parentAlive = expectedParent ? isPidAlive(expectedParent) : false

  let reason = ""
  if (!expectedParent || expectedParent <= 1) {
    reason = "missing-parent"
  } else if (!parentAlive) {
    reason = taggedParentPid ? "tagged-parent-missing" : "ppid-missing"
  } else if (taggedParentPid && ppid && taggedParentPid !== ppid && !isPidAlive(ppid)) {
    reason = "ppid-mismatch-parent-missing"
  }

  if (!reason) continue

  orphaned.push({
    pid,
    ppid: ppid ?? null,
    taggedParentPid: taggedParentPid ?? null,
    reason,
    cmd: sanitizeCommand(cmd),
    cwd: resolveCwd(pid),
    started: resolveStarted(pid),
  })
}

process.stdout.write(
  JSON.stringify({
    orphaned,
    ts: new Date().toISOString(),
  }) + "\n",
)
NODE
