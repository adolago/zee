import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { getInvestingEntityCatalogStatus } from "@/investing/entities"
import {
  INVESTING_CONNECTOR_KINDS,
  getInvestingIngestionStatus,
  registerInvestingIngestionScheduler,
  runEnabledInvestingConnectors,
  runInvestingConnector,
  type InvestingConnectorKind,
} from "@/investing/ingestion"

const InvestingIngestStatusCommand = cmd({
  command: "status",
  describe: "show research data connector status",
  builder: (yargs: Argv) =>
    yargs.option("json", {
      type: "boolean",
      default: false,
      describe: "output as JSON",
    }),
  handler: async (args: { json?: boolean }) => {
    const status = await getInvestingIngestionStatus()
    if (args.json) {
      console.log(JSON.stringify(status, null, 2))
      return
    }

    console.log(`ingestion: enabled=${status.enabled}`)
    for (const connector of status.connectors) {
      const lastRun =
        connector.lastFinishedAt > 0
          ? new Date(connector.lastFinishedAt).toISOString()
          : "never"
      console.log(
        `- ${connector.connector}: enabled=${connector.enabled} every=${connector.scheduleMinutes}m lastStatus=${connector.lastStatus} items=${connector.itemCount} requests=${connector.requestCount} normalized=${connector.normalizedEntityCount} lastRun=${lastRun}`,
      )
    }
  },
})

const InvestingIngestRunCommand = cmd({
  command: "run [connector]",
  describe: "run one connector or all enabled connectors immediately",
  builder: (yargs: Argv) =>
    yargs
      .positional("connector", {
        type: "string",
        choices: [...INVESTING_CONNECTOR_KINDS],
        describe: "connector to run",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "output as JSON",
      }),
  handler: async (args: { connector?: InvestingConnectorKind; json?: boolean }) => {
    const results = args.connector ? [await runInvestingConnector(args.connector)] : await runEnabledInvestingConnectors()
    if (args.json) {
      console.log(JSON.stringify(results, null, 2))
      return
    }
    for (const result of results) {
      console.log(
        `- ${result.connector}: status=${result.lastStatus} items=${result.itemCount} requests=${result.requestCount} normalized=${result.normalizedEntityCount} durationMs=${result.lastDurationMs}${result.error ? ` error=${result.error}` : ""}`,
      )
    }
  },
})

const InvestingEntityStatusCommand = cmd({
  command: "status",
  describe: "show normalized investing entity catalog status",
  builder: (yargs: Argv) =>
    yargs.option("json", {
      type: "boolean",
      default: false,
      describe: "output as JSON",
    }),
  handler: async (args: { json?: boolean }) => {
    const status = await getInvestingEntityCatalogStatus()
    if (args.json) {
      console.log(JSON.stringify(status, null, 2))
      return
    }

    const updatedAt = status.updatedAt > 0 ? new Date(status.updatedAt).toISOString() : "never"
    console.log(`entities: total=${status.totalEntities} updatedAt=${updatedAt}`)
    console.log(`- by kind: ${JSON.stringify(status.countsByKind)}`)
    console.log(`- by lineage source: ${JSON.stringify(status.countsByLineageSource)}`)
  },
})

const InvestingEntityCommand = cmd({
  command: "entity",
  describe: "normalized financial entity catalog",
  builder: (yargs: Argv) => yargs.command(InvestingEntityStatusCommand).demandCommand(),
  async handler() {},
})

const InvestingIngestScheduleCommand = cmd({
  command: "schedule",
  describe: "register connector schedules in the current always-on process",
  builder: (yargs: Argv) =>
    yargs.option("json", {
      type: "boolean",
      default: false,
      describe: "output as JSON",
    }),
  handler: async (args: { json?: boolean }) => {
    const registrations = await registerInvestingIngestionScheduler()
    if (args.json) {
      console.log(JSON.stringify(registrations, null, 2))
      return
    }
    if (registrations.length === 0) {
      console.log("investing ingestion scheduler disabled")
      return
    }
    for (const registration of registrations) {
      console.log(`- ${registration.connector}: task=${registration.taskId} every=${registration.scheduleMinutes}m`)
    }
  },
})

const InvestingIngestCommand = cmd({
  command: "ingest",
  describe: "research data ingestion connectors and schedules",
  builder: (yargs: Argv) =>
    yargs.command(InvestingIngestStatusCommand).command(InvestingIngestRunCommand).command(InvestingIngestScheduleCommand).demandCommand(),
  async handler() {},
})

export const InvestingCommand = cmd({
  command: "investing",
  describe: "investing platform operations",
  builder: (yargs: Argv) => yargs.command(InvestingIngestCommand).command(InvestingEntityCommand).demandCommand(),
  async handler() {},
})
