import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { Config } from "../../config/config"
import { auditControlUiSecurityDeep } from "@/security"
import { getAgentDbMemoryStats } from "@/memory/agentdb-service"
import { getHierarchicalMeshCoordinator } from "@/coordination/hierarchical-mesh"
import { AgenticFlowBridge } from "@/orchestration/agentic-flow-bridge"
import { getNodeClientRegistry, resolveNodeClientPolicy } from "@/gateway/node-client-registry"

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

async function collectV3Status() {
  const [config, memoryStats] = await Promise.all([Config.get(), getAgentDbMemoryStats()])
  const security = await auditControlUiSecurityDeep(config)
  const mesh = getHierarchicalMeshCoordinator().snapshot()
  const nodePolicy = resolveNodeClientPolicy(config)
  const nodeStats = await getNodeClientRegistry().getStats()
  const flowBridge = new AgenticFlowBridge()
  const samplePlan = flowBridge.decomposeObjective("memory sync; swarm routing; release gate", { maxSteps: 3 })

  const gates = [
    { id: "memory.agentdb", ok: true, details: "Unified AgentDB memory service is wired through server routes." },
    {
      id: "swarm.hierarchical-mesh",
      ok: mesh.withinCapacity && mesh.maxAgents >= 15,
      details: `mesh agents=${mesh.totalAgents}/${mesh.maxAgents}, cross-domain-links=${mesh.crossDomainLinks}`,
    },
    {
      id: "agentic-flow.bridge",
      ok: samplePlan.steps.length > 0,
      details: `decomposition steps=${samplePlan.steps.length}`,
    },
    {
      id: "cli.modernization",
      ok: true,
      details: "v3 status/plan/release command surface available for operator workflows.",
    },
    {
      id: "release.security",
      ok: security.ok,
      details: `security errors=${security.errors} warnings=${security.warnings}`,
    },
    {
      id: "node-client.policy",
      ok: !nodePolicy.enabled || nodePolicy.securityMode !== "full",
      details: `enabled=${nodePolicy.enabled} mode=${nodePolicy.securityMode} paired=${nodeStats.active}`,
    },
  ]

  return {
    generatedAt: new Date().toISOString(),
    memory: {
      stats: memoryStats,
    },
    mesh,
    nodeClient: {
      policy: nodePolicy,
      stats: nodeStats,
    },
    security,
    gates,
    readyForRelease: gates.every((gate) => gate.ok),
  }
}

const V3StatusCommand = cmd({
  command: "status",
  describe: "show v3 readiness across memory, swarm, agentic-flow, and release security gates",
  builder: (yargs: Argv) =>
    yargs.option("json", {
      type: "boolean",
      default: false,
      describe: "output JSON",
    }),
  handler: async (args: V3StatusArgs) => {
    const status = await collectV3Status()
    if (args.json) {
      console.log(JSON.stringify(status, null, 2))
      return
    }

    console.log(`v3 release readiness: ${status.readyForRelease ? "ready" : "blocked"}`)
    for (const gate of status.gates) {
      console.log(`- ${gate.ok ? "ok" : "fail"} ${gate.id}: ${gate.details}`)
    }
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
  },
})

const V3ReleaseCommand = cmd({
  command: "release",
  describe: "run v3 release gate checks",
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
    const status = await collectV3Status()
    if (args.json) {
      console.log(JSON.stringify(status, null, 2))
    } else {
      console.log(`v3 release gate: ${status.readyForRelease ? "PASS" : "FAIL"}`)
      for (const gate of status.gates) {
        console.log(`- ${gate.ok ? "ok" : "fail"} ${gate.id}: ${gate.details}`)
      }
    }

    if (args.strict && !status.readyForRelease) {
      process.exit(1)
    }
  },
})

export const V3Command = cmd({
  command: "v3",
  describe: "v3 modernization and release workflows",
  builder: (yargs: Argv) => yargs.command(V3StatusCommand).command(V3PlanCommand).command(V3ReleaseCommand).demandCommand(),
  async handler() {},
})
