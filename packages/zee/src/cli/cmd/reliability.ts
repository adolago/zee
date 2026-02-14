import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { formatReliabilitySummary, runReliabilitySuite, type ReliabilityProfile } from "@/reliability"

type ReliabilityRunArgs = {
  profile?: string
  json?: boolean
  "artifact-dir"?: string
  "fail-fast"?: boolean
  "long-soak-minutes"?: number
}

const ReliabilityRunCommand = cmd({
  command: "run",
  describe: "Run reliability hardening suite",
  builder: (yargs: Argv) =>
    yargs
      .option("profile", {
        type: "string",
        choices: ["alpha", "diag"],
        default: "alpha",
        describe: "Reliability profile",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "Print machine-readable JSON report",
      })
      .option("artifact-dir", {
        type: "string",
        describe: "Artifact output directory (defaults to artifacts/reliability/<timestamp>)",
      })
      .option("fail-fast", {
        type: "boolean",
        default: true,
        describe: "Stop immediately on first required stage failure",
      })
      .option("long-soak-minutes", {
        type: "number",
        describe: "Override long-soak duration in minutes",
      }),
  handler: async (args: ReliabilityRunArgs) => {
    const profile = (args.profile ?? "alpha") as ReliabilityProfile
    const report = await runReliabilitySuite({
      profile,
      artifactDir: args["artifact-dir"],
      failFast: args["fail-fast"] ?? true,
      json: args.json,
      longSoakDurationMs:
        typeof args["long-soak-minutes"] === "number"
          ? Math.max(1, Math.floor(args["long-soak-minutes"])) * 60_000
          : undefined,
    })

    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
    } else {
      console.log(formatReliabilitySummary(report))
    }

    if (report.summary.failed > 0) {
      process.exit(1)
    }
  },
})

export const ReliabilityCommand = cmd({
  command: "reliability",
  describe: "Reliability hardening and alpha readiness gates",
  builder: (yargs: Argv) => yargs.command(ReliabilityRunCommand).demandCommand(),
  async handler() {},
})
