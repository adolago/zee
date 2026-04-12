import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { buildOpenCodeRuntimeContractReport, summarizeOpenCodeRuntimeContract } from "@/runtime/opencode-contract"
import { buildPiMonoCompatReport, summarizePiMonoCompatReport } from "@/runtime/pimono-compat"
import { buildOpenCodeRuntimeRolloutReport, summarizeOpenCodeRuntimeRollout } from "@/runtime/opencode-rollout"
import { Session } from "../../session"
import { SessionStatus } from "../../session/status"
import { collectRuntimeSnapshot } from "./runtime-process-guard"

type InspectStateArgs = {
  json?: boolean
}

type InspectOpsArgs = {
  json?: boolean
}

type InspectRuntimeContractArgs = {
  json?: boolean
}

type InspectShimBoundariesArgs = {
  json?: boolean
}

type InspectRuntimeRolloutArgs = {
  json?: boolean
}

type SessionQueueSnapshot = {
  sessions: {
    total: number
    roots: number
    children: number
  }
  queue: {
    totalTracked: number
    busy: number
    retry: number
  }
}

async function gatherSessionQueueSnapshot(): Promise<SessionQueueSnapshot> {
  const sessions = [] as Session.Info[]
  for await (const session of Session.list()) {
    sessions.push(session)
  }

  const statusBySession = SessionStatus.list()
  const statusSummary = {
    totalTracked: Object.keys(statusBySession).length,
    busy: Object.values(statusBySession).filter((status) => status.type === "busy").length,
    retry: Object.values(statusBySession).filter((status) => status.type === "retry").length,
  }

  return {
    sessions: {
      total: sessions.length,
      roots: sessions.filter((session) => !session.parentID).length,
      children: sessions.filter((session) => Boolean(session.parentID)).length,
    },
    queue: statusSummary,
  }
}

const InspectStateCommand = cmd({
  command: "state",
  describe: "print a machine-readable runtime/session snapshot",
  builder: (yargs: Argv) =>
    yargs.option("json", {
      type: "boolean",
      default: true,
      describe: "output as JSON",
    }),
  handler: async (args: InspectStateArgs) => {
    const runtime = await collectRuntimeSnapshot()

    await bootstrap(process.cwd(), async () => {
      const sessionQueue = await gatherSessionQueueSnapshot()

      const payload = {
        generatedAt: new Date().toISOString(),
        runtime,
        sessions: sessionQueue.sessions,
        queue: sessionQueue.queue,
      }

      if (args.json !== false) {
        console.log(JSON.stringify(payload, null, 2))
        return
      }

      console.log(
        `runtime total=${runtime.counts.total} mcp=${runtime.counts.mcpServers} clients=${runtime.counts.clients}`,
      )
      console.log(
        `sessions total=${payload.sessions.total} roots=${payload.sessions.roots} children=${payload.sessions.children}`,
      )
      console.log(`queue tracked=${payload.queue.totalTracked} busy=${payload.queue.busy} retry=${payload.queue.retry}`)
      if (runtime.violations.length > 0) {
        console.log("violations:")
        for (const violation of runtime.violations) {
          console.log(`- ${violation}`)
        }
      }
    })
  },
})

const InspectOpsCommand = cmd({
  command: "ops",
  describe: "print consolidated ops report (runtime, sessions, queue)",
  builder: (yargs: Argv) =>
    yargs.option("json", {
      type: "boolean",
      default: true,
      describe: "output as JSON",
    }),
  handler: async (args: InspectOpsArgs) => {
    const runtime = await collectRuntimeSnapshot()

    await bootstrap(process.cwd(), async () => {
      const sessionQueue = await gatherSessionQueueSnapshot()

      const payload = {
        generatedAt: new Date().toISOString(),
        runtime,
        sessions: sessionQueue.sessions,
        queue: sessionQueue.queue,
      }

      if (args.json !== false) {
        console.log(JSON.stringify(payload, null, 2))
        return
      }

      console.log(
        `runtime total=${runtime.counts.total} mcp=${runtime.counts.mcpServers} clients=${runtime.counts.clients}`,
      )
      console.log(
        `sessions total=${payload.sessions.total} roots=${payload.sessions.roots} children=${payload.sessions.children}`,
      )
      console.log(`queue tracked=${payload.queue.totalTracked} busy=${payload.queue.busy} retry=${payload.queue.retry}`)

      if (runtime.violations.length > 0) {
        console.log("violations:")
        for (const violation of runtime.violations) {
          console.log(`- ${violation}`)
        }
      }
    })
  },
})

const InspectRuntimeContractCommand = cmd({
  command: "runtime-contract",
  describe: "print the OpenCode runtime inventory and adapter contract for CLI, orchestration, and gateway flows",
  builder: (yargs: Argv) =>
    yargs.option("json", {
      type: "boolean",
      default: true,
      describe: "output as JSON",
    }),
  handler: async (args: InspectRuntimeContractArgs) => {
    await bootstrap(process.cwd(), async () => {
      const report = buildOpenCodeRuntimeContractReport()

      if (args.json !== false) {
        console.log(JSON.stringify(report, null, 2))
        return
      }

      console.log(summarizeOpenCodeRuntimeContract(report))
    })
  },
})

const InspectShimBoundariesCommand = cmd({
  command: "shim-boundaries",
  describe: "print the pi-mono compatibility shim inventory and deprecation boundaries",
  builder: (yargs: Argv) =>
    yargs.option("json", {
      type: "boolean",
      default: true,
      describe: "output as JSON",
    }),
  handler: async (args: InspectShimBoundariesArgs) => {
    await bootstrap(process.cwd(), async () => {
      const report = buildPiMonoCompatReport()

      if (args.json !== false) {
        console.log(JSON.stringify(report, null, 2))
        return
      }

      console.log(summarizePiMonoCompatReport(report))
    })
  },
})

const InspectRuntimeRolloutCommand = cmd({
  command: "runtime-rollout",
  describe: "print the OpenCode primary runtime rollout status and fallback controls",
  builder: (yargs: Argv) =>
    yargs.option("json", {
      type: "boolean",
      default: true,
      describe: "output as JSON",
    }),
  handler: async (args: InspectRuntimeRolloutArgs) => {
    await bootstrap(process.cwd(), async () => {
      const report = buildOpenCodeRuntimeRolloutReport()

      if (args.json !== false) {
        console.log(JSON.stringify(report, null, 2))
        return
      }

      console.log(summarizeOpenCodeRuntimeRollout(report))
    })
  },
})

export const InspectCommand = cmd({
  command: "inspect",
  describe: "inspect runtime state",
  builder: (yargs: Argv) =>
    yargs
      .command(InspectStateCommand)
      .command(InspectOpsCommand)
      .command(InspectRuntimeContractCommand)
      .command(InspectRuntimeRolloutCommand)
      .command(InspectShimBoundariesCommand)
      .demandCommand(),
  async handler() {},
})
