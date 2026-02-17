#!/usr/bin/env bun
import { formatReliabilitySummary, runReliabilitySuite, type ReliabilityProfile } from "../../src/reliability"

type ParsedArgs = {
  profile: ReliabilityProfile
  json: boolean
  artifactDir?: string
  failFast: boolean
  longSoakMinutes?: number
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    profile: "alpha",
    json: false,
    failFast: true,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]

    if (arg === "--json") {
      parsed.json = true
      continue
    }
    if (arg === "--no-fail-fast") {
      parsed.failFast = false
      continue
    }
    if (arg === "--fail-fast") {
      parsed.failFast = true
      continue
    }
    if (arg === "--profile" && argv[i + 1]) {
      const next = argv[i + 1]
      if (next === "alpha" || next === "diag") {
        parsed.profile = next
      }
      i += 1
      continue
    }
    if (arg.startsWith("--profile=")) {
      const value = arg.split("=")[1]
      if (value === "alpha" || value === "diag") {
        parsed.profile = value
      }
      continue
    }
    if (arg === "--artifact-dir" && argv[i + 1]) {
      parsed.artifactDir = argv[i + 1]
      i += 1
      continue
    }
    if (arg.startsWith("--artifact-dir=")) {
      parsed.artifactDir = arg.split("=")[1]
      continue
    }
    if (arg === "--long-soak-minutes" && argv[i + 1]) {
      const minutes = Number(argv[i + 1])
      if (Number.isFinite(minutes) && minutes > 0) {
        parsed.longSoakMinutes = Math.floor(minutes)
      }
      i += 1
      continue
    }
    if (arg.startsWith("--long-soak-minutes=")) {
      const minutes = Number(arg.split("=")[1])
      if (Number.isFinite(minutes) && minutes > 0) {
        parsed.longSoakMinutes = Math.floor(minutes)
      }
      continue
    }
  }

  return parsed
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const report = await runReliabilitySuite({
    profile: args.profile,
    artifactDir: args.artifactDir,
    failFast: args.failFast,
    json: args.json,
    longSoakDurationMs: typeof args.longSoakMinutes === "number" ? args.longSoakMinutes * 60_000 : undefined,
  })

  if (args.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(formatReliabilitySummary(report))
  }

  process.exit(report.summary.failed > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
