import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { AgenticFlowBridge } from "@/orchestration/agentic-flow-bridge"
import {
  collectV3ReleaseReport,
  summarizeV3ReleaseReport,
} from "@/runtime/v3-release"
import {
  applyV3RolloutStage,
  getV3RolloutReport,
  rollbackV3Rollout,
  summarizeV3RolloutReport,
  V3_ROLLOUT_STAGES,
  type V3RolloutStage,
} from "@/runtime/v3-rollout"

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

type V3RolloutStatusArgs = {
  json?: boolean
}

type V3RolloutApplyArgs = {
  stage?: V3RolloutStage
  actor?: string
  reason?: string
  json?: boolean
}

type V3RolloutRollbackArgs = {
  actor?: string
  reason?: string
  json?: boolean
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

const V3RolloutStatusCommand = cmd({
  command: "status",
  describe: "show the current staged rollout plan and managed daemon env settings",
  builder: (yargs: Argv) =>
    yargs.option("json", {
      type: "boolean",
      default: false,
      describe: "output JSON",
    }),
  handler: async (args: V3RolloutStatusArgs) => {
    await bootstrap(process.cwd(), async () => {
      const report = await getV3RolloutReport({ emitTelemetry: true })
      if (args.json) {
        console.log(JSON.stringify(report, null, 2))
        return
      }
      console.log(summarizeV3RolloutReport(report))
    })
  },
})

const V3RolloutApplyCommand = cmd({
  command: "apply <stage>",
  describe: "apply the next rollout stage and write managed runtime flags into daemon.env",
  builder: (yargs: Argv) =>
    yargs
      .positional("stage", {
        type: "string",
        demandOption: true,
        choices: [...V3_ROLLOUT_STAGES],
        describe: "rollout stage to apply",
      })
      .option("actor", {
        type: "string",
        demandOption: true,
        describe: "operator or owner applying the stage",
      })
      .option("reason", {
        type: "string",
        demandOption: true,
        describe: "reason for the rollout change",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "output JSON",
      }),
  handler: async (args: V3RolloutApplyArgs) => {
    if (!args.stage || !args.actor || !args.reason) {
      throw new Error("stage, actor, and reason are required")
    }
    const stage = args.stage
    const actor = args.actor
    const reason = args.reason
    await bootstrap(process.cwd(), async () => {
      const report = await applyV3RolloutStage({
        stage,
        actor,
        reason,
      })
      if (args.json) {
        console.log(JSON.stringify(report, null, 2))
        return
      }
      console.log(summarizeV3RolloutReport(report))
    })
  },
})

const V3RolloutRollbackCommand = cmd({
  command: "rollback",
  describe: "roll back to the paused stage and pin all tracked surfaces to legacy",
  builder: (yargs: Argv) =>
    yargs
      .option("actor", {
        type: "string",
        demandOption: true,
        describe: "operator or owner triggering rollback",
      })
      .option("reason", {
        type: "string",
        demandOption: true,
        describe: "reason for the rollback",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "output JSON",
      }),
  handler: async (args: V3RolloutRollbackArgs) => {
    if (!args.actor || !args.reason) {
      throw new Error("actor and reason are required")
    }
    const actor = args.actor
    const reason = args.reason
    await bootstrap(process.cwd(), async () => {
      const report = await rollbackV3Rollout({
        actor,
        reason,
      })
      if (args.json) {
        console.log(JSON.stringify(report, null, 2))
        return
      }
      console.log(summarizeV3RolloutReport(report))
    })
  },
})

const V3RolloutCommand = cmd({
  command: "rollout",
  describe: "manage staged rollout progression and rollback automation for v3 launch",
  builder: (yargs: Argv) =>
    yargs.command(V3RolloutStatusCommand).command(V3RolloutApplyCommand).command(V3RolloutRollbackCommand).demandCommand(),
  async handler() {},
})

export const V3Command = cmd({
  command: "v3",
  describe: "v3 modernization and release workflows",
  builder: (yargs: Argv) =>
    yargs.command(V3StatusCommand).command(V3PlanCommand).command(V3ReleaseCommand).command(V3RolloutCommand).demandCommand(),
  async handler() {},
})
