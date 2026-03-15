import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { AgenticFlowBridge } from "@/orchestration/agentic-flow-bridge"
import {
  collectV3ReleaseReport,
  summarizeV3ReleaseReport,
} from "@/runtime/v3-release"

type V3StatusArgs = {
  json?: boolean
}

type V3PlanArgs = {
  objective: string
  steps?: number
  execute?: boolean
  json?: boolean
}

type V3ReleaseArgs = {
  json?: boolean
  strict?: boolean
}

const V3StatusCommand = cmd({
  command: "status",
  describe: "show the consolidated v3 readiness report across reliability, security, performance, and docs gates",
  builder: (yargs: Argv) =>
    yargs.option("json", {
      type: "boolean",
      default: false,
      describe: "output JSON",
    }),
  handler: async (args: V3StatusArgs) => {
    await bootstrap(process.cwd(), async () => {
      const status = await collectV3ReleaseReport()
      if (args.json) {
        console.log(JSON.stringify(status, null, 2))
        return
      }
      console.log(summarizeV3ReleaseReport(status))
    })
  },
})

const V3PlanCommand = cmd({
  command: "plan <objective>",
  describe: "decompose an objective into an agentic-flow plan; optionally submit to orchestration",
  builder: (yargs: Argv) =>
    yargs
      .positional("objective", {
        type: "string",
        demandOption: true,
        describe: "objective to decompose and orchestrate",
      })
      .option("steps", {
        type: "number",
        default: 6,
        describe: "maximum decomposition steps",
      })
      .option("execute", {
        type: "boolean",
        default: false,
        describe: "submit generated plan steps to orchestrator",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "output JSON",
      }),
  handler: async (args: V3PlanArgs) => {
    await bootstrap(process.cwd(), async () => {
      const bridge = new AgenticFlowBridge()
      const plan = bridge.decomposeObjective(args.objective, { maxSteps: args.steps })
      const result = args.execute ? await bridge.runPlan(plan) : undefined

      if (args.json) {
        console.log(JSON.stringify({ plan, result }, null, 2))
        return
      }

      console.log(`flow: ${plan.id}`)
      for (const step of plan.steps) {
        console.log(`- ${step.id}: ${step.prompt}`)
      }
      if (result) {
        console.log(`submitted: ${result.submitted.length} step(s)`)
      }
    })
  },
})

const V3ReleaseCommand = cmd({
  command: "release",
  describe: "run the consolidated v3 release gate checks",
  builder: (yargs: Argv) =>
    yargs
      .option("json", {
        type: "boolean",
        default: false,
        describe: "output JSON",
      })
      .option("strict", {
        type: "boolean",
        default: false,
        describe: "exit 1 when release is blocked",
      }),
  handler: async (args: V3ReleaseArgs) => {
    await bootstrap(process.cwd(), async () => {
      const status = await collectV3ReleaseReport({ emitTelemetry: true })
      if (args.json) {
        console.log(JSON.stringify(status, null, 2))
      } else {
        console.log(summarizeV3ReleaseReport(status))
      }

      if (args.strict && !status.readyForRelease) {
        process.exit(1)
      }
    })
  },
})

export const V3Command = cmd({
  command: "v3",
  describe: "v3 modernization and release workflows",
  builder: (yargs: Argv) => yargs.command(V3StatusCommand).command(V3PlanCommand).command(V3ReleaseCommand).demandCommand(),
  async handler() {},
})
