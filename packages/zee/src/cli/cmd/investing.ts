import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { getInvestingEntityCatalogStatus } from "@/investing/entities"
import {
  INVESTING_EVENT_CLASSIFICATIONS,
  INVESTING_EVENT_CONNECTORS,
  INVESTING_EVENT_DIRECTIONS,
  INVESTING_EVENT_MATERIALITY_BANDS,
  getInvestingEvent,
  getInvestingEventCatalogStatus,
  listInvestingEvents,
  type InvestingEventClassification,
  type InvestingEventConnector,
  type InvestingEventDirection,
  type InvestingEventMaterialityBand,
} from "@/investing/events"
import {
  INVESTING_CONNECTOR_KINDS,
  getInvestingIngestionStatus,
  registerInvestingIngestionScheduler,
  runInvestingConnectorBackfill,
  runEnabledInvestingConnectors,
  runInvestingConnector,
  type InvestingConnectorKind,
} from "@/investing/ingestion"
import { getInvestingThesisLedgerStatus } from "@root/domain/investing/thesis"

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
        `- ${connector.connector}: enabled=${connector.enabled} every=${connector.scheduleMinutes}m freshness=${connector.freshnessStatus} slo=${connector.freshnessSloMinutes}m lastStatus=${connector.lastStatus} items=${connector.itemCount} requests=${connector.requestCount} normalized=${connector.normalizedEntityCount} lastRun=${lastRun}`,
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

const InvestingIngestBackfillCommand = cmd({
  command: "backfill <connector>",
  describe: "run a controlled connector backfill with operator-specified overrides",
  builder: (yargs: Argv) =>
    yargs
      .positional("connector", {
        type: "string",
        choices: [...INVESTING_CONNECTOR_KINDS],
        demandOption: true,
        describe: "connector to backfill",
      })
      .option("symbol", {
        type: "array",
        string: true,
        describe: "optional symbol override for symbol-scoped connectors",
      })
      .option("lookback-days", {
        type: "number",
        describe: "historical lookback window for transcripts/news",
      })
      .option("quarters", {
        type: "number",
        describe: "historical quarter window for earnings backfills",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "output as JSON",
      }),
  handler: async (args) => {
    if (!args.connector) {
      throw new Error("connector is required")
    }
    const result = await runInvestingConnectorBackfill({
      connector: args.connector,
      symbols: args.symbol?.map(String),
      lookbackDays: args.lookbackDays,
      quarters: args.quarters,
    })
    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    console.log(
      `- ${result.connector}: status=${result.status} items=${result.itemCount} normalized=${result.normalizedEntityCount} retryAttempts=${result.retryAttempts} lookbackDays=${result.lookbackDays ?? "n/a"} quarters=${result.quarters ?? "n/a"}`,
    )
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

const InvestingEventStatusCommand = cmd({
  command: "status",
  describe: "show classified investing event intelligence status",
  builder: (yargs: Argv) =>
    yargs.option("json", {
      type: "boolean",
      default: false,
      describe: "output as JSON",
    }),
  handler: async (args: { json?: boolean }) => {
    const status = await getInvestingEventCatalogStatus()
    if (args.json) {
      console.log(JSON.stringify(status, null, 2))
      return
    }

    const updatedAt = status.updatedAt > 0 ? new Date(status.updatedAt).toISOString() : "never"
    console.log(`events: total=${status.totalEvents} updatedAt=${updatedAt}`)
    console.log(`- by connector: ${JSON.stringify(status.countsByConnector)}`)
    console.log(`- by classification: ${JSON.stringify(status.countsByClassification)}`)
    console.log(`- by direction: ${JSON.stringify(status.countsByDirection)}`)
    console.log(`- by materiality: ${JSON.stringify(status.countsByMaterialityBand)}`)
    console.log(`- linked coverage: holdings=${status.holdingLinkedCount} watchlist=${status.watchlistLinkedCount}`)
  },
})

const InvestingEventListCommand = cmd({
  command: "list",
  describe: "list classified earnings and news events",
  builder: (yargs: Argv) =>
    yargs
      .option("connector", {
        type: "string",
        choices: [...INVESTING_EVENT_CONNECTORS],
        describe: "optional connector filter",
      })
      .option("classification", {
        type: "string",
        choices: [...INVESTING_EVENT_CLASSIFICATIONS],
        describe: "optional classification filter",
      })
      .option("direction", {
        type: "string",
        choices: [...INVESTING_EVENT_DIRECTIONS],
        describe: "optional direction filter",
      })
      .option("materiality-band", {
        type: "string",
        choices: [...INVESTING_EVENT_MATERIALITY_BANDS],
        describe: "optional materiality band filter",
      })
      .option("symbol", {
        type: "string",
        describe: "optional symbol filter",
      })
      .option("holding", {
        type: "boolean",
        default: false,
        describe: "only include events linked to holdings",
      })
      .option("watchlist", {
        type: "boolean",
        default: false,
        describe: "only include events linked to watchlist symbols",
      })
      .option("limit", {
        type: "number",
        default: 10,
        describe: "maximum number of events to return",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "output as JSON",
      }),
  handler: async (args: {
    connector?: InvestingEventConnector
    classification?: InvestingEventClassification
    direction?: InvestingEventDirection
    materialityBand?: InvestingEventMaterialityBand
    symbol?: string
    holding?: boolean
    watchlist?: boolean
    limit?: number
    json?: boolean
  }) => {
    const events = await listInvestingEvents({
      connector: args.connector,
      classification: args.classification,
      direction: args.direction,
      materialityBand: args.materialityBand,
      symbol: args.symbol,
      holdingOnly: args.holding,
      watchlistOnly: args.watchlist,
      limit: args.limit,
    })
    if (args.json) {
      console.log(JSON.stringify({ events, count: events.length }, null, 2))
      return
    }
    for (const event of events) {
      console.log(
        `- ${event.id}: ${event.classification} connector=${event.connector} direction=${event.direction} materiality=${event.materiality.band}:${event.materiality.score} audience=${event.entityLinks.audience} confidence=${event.confidence.toFixed(2)} symbol=${event.symbol ?? "n/a"} asOf=${event.asOf} title=${event.title}`,
      )
    }
  },
})

const InvestingEventReadCommand = cmd({
  command: "read <eventId>",
  describe: "read one classified event record",
  builder: (yargs: Argv) =>
    yargs
      .positional("eventId", {
        type: "string",
        demandOption: true,
        describe: "classified event identifier",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "output as JSON",
      }),
  handler: async (args: { eventId?: string; json?: boolean }) => {
    if (!args.eventId) {
      throw new Error("eventId is required")
    }
    const event = await getInvestingEvent(args.eventId)
    const payload = event ?? { error: `Event not found: ${args.eventId}` }
    if (args.json || !event) {
      console.log(JSON.stringify(payload, null, 2))
      return
    }

    console.log(`${event.id}`)
    console.log(`- classification=${event.classification} connector=${event.connector} direction=${event.direction}`)
    console.log(`- materiality=${event.materiality.band} score=${event.materiality.score} audience=${event.entityLinks.audience}`)
    console.log(`- confidence=${event.confidence.toFixed(2)} symbol=${event.symbol ?? "n/a"} asOf=${event.asOf}`)
    console.log(`- sectors=${event.entityLinks.sectorLabels.join(", ") || "n/a"}`)
    console.log(`- holding=${event.entityLinks.holdingId ?? "n/a"} watchlist=${event.entityLinks.watchlistId ?? "n/a"}`)
    console.log(`- title=${event.title}`)
    console.log(`- summary=${event.summary}`)
    console.log(`- reasons=${event.reasons.join("; ") || "n/a"}`)
    console.log(`- materiality-reasons=${event.materiality.reasons.join("; ") || "n/a"}`)
  },
})

const InvestingEventCommand = cmd({
  command: "event",
  describe: "classified news and earnings event intelligence",
  builder: (yargs: Argv) =>
    yargs.command(InvestingEventStatusCommand).command(InvestingEventListCommand).command(InvestingEventReadCommand).demandCommand(),
  async handler() {},
})

const InvestingThesisStatusCommand = cmd({
  command: "status",
  describe: "show persisted thesis ledger status",
  builder: (yargs: Argv) =>
    yargs.option("json", {
      type: "boolean",
      default: false,
      describe: "output as JSON",
    }),
  handler: async (args: { json?: boolean }) => {
    const status = getInvestingThesisLedgerStatus()
    if (args.json) {
      console.log(JSON.stringify(status, null, 2))
      return
    }

    const updatedAt = status.updatedAt > 0 ? new Date(status.updatedAt).toISOString() : "never"
    console.log(`theses: total=${status.totalTheses} revisions=${status.totalRevisions} updatedAt=${updatedAt}`)
    console.log(`- by status: ${JSON.stringify(status.countsByStatus)}`)
    console.log(`- by conviction: ${JSON.stringify(status.countsByConviction)}`)
  },
})

const InvestingThesisCommand = cmd({
  command: "thesis",
  describe: "persisted thesis ledger and version history",
  builder: (yargs: Argv) => yargs.command(InvestingThesisStatusCommand).demandCommand(),
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
    yargs
      .command(InvestingIngestStatusCommand)
      .command(InvestingIngestRunCommand)
      .command(InvestingIngestScheduleCommand)
      .command(InvestingIngestBackfillCommand)
      .demandCommand(),
  async handler() {},
})

export const InvestingCommand = cmd({
  command: "investing",
  describe: "investing platform operations",
  builder: (yargs: Argv) =>
    yargs
      .command(InvestingIngestCommand)
      .command(InvestingEntityCommand)
      .command(InvestingEventCommand)
      .command(InvestingThesisCommand)
      .demandCommand(),
  async handler() {},
})
