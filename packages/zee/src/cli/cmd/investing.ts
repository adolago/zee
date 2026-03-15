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
import {
  INVESTING_THESIS_CONVICTIONS,
  INVESTING_THESIS_POSTURES,
  INVESTING_THESIS_RECORD_STATUSES,
  getInvestingThesisLedgerStatus,
  type InvestingThesisConviction,
  type InvestingThesisPosture,
  type InvestingThesisRecordStatus,
} from "@root/domain/investing/thesis"
import {
  INVESTING_THESIS_PORTFOLIO_ROLLUP_AUDIENCES,
  buildInvestingThesisPortfolioRollup,
  diffInvestingThesisHistory,
  getInvestingThesisHistory,
  queryInvestingThesisRecord,
  queryInvestingTheses,
  type InvestingThesisPortfolioRollupAudience,
} from "@root/domain/investing/thesis-queries"
import {
  INVESTING_PORTFOLIO_BRIEFING_KINDS,
  createInvestingPortfolioBriefing,
  getInvestingPortfolioBriefing,
  listInvestingPortfolioBriefings,
  type InvestingPortfolioBriefingAudience,
  type InvestingPortfolioBriefingKind,
} from "@root/domain/investing/briefings"
import {
  createInvestingEarningsPacket,
  exportInvestingEarningsPacket,
  getInvestingEarningsPacket,
  INVESTING_EARNINGS_PACKET_WORKFLOWS,
  listInvestingEarningsPackets,
  type InvestingEarningsPacketWorkflow,
} from "@root/domain/investing/earnings-packets"
import {
  createInvestingOpsSchedule,
  getInvestingOpsDeliveryRecord,
  getInvestingOpsSchedule,
  INVESTING_OPS_DELIVERY_TARGETS,
  INVESTING_OPS_FORMATS,
  INVESTING_OPS_WORKFLOWS,
  listInvestingOpsDeliveryRecords,
  listInvestingOpsSchedules,
  runInvestingOpsSchedule,
  updateInvestingOpsSchedule,
  type InvestingOpsWorkflow,
} from "@root/domain/investing/ops-automation"
import { getInvestingResearchExecution } from "@root/domain/investing/executor"
import { getInvestingResearchPlan } from "@root/domain/investing/planner"

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
      const lastRun = connector.lastFinishedAt > 0 ? new Date(connector.lastFinishedAt).toISOString() : "never"
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
    const results = args.connector
      ? [await runInvestingConnector(args.connector)]
      : await runEnabledInvestingConnectors()
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
    console.log(
      `- materiality=${event.materiality.band} score=${event.materiality.score} audience=${event.entityLinks.audience}`,
    )
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
    yargs
      .command(InvestingEventStatusCommand)
      .command(InvestingEventListCommand)
      .command(InvestingEventReadCommand)
      .demandCommand(),
  async handler() {},
})

function thesisLookup(value: string): string {
  return value.startsWith("thesis:") ? value : value.toUpperCase()
}

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

const InvestingThesisReadCommand = cmd({
  command: "read <thesis>",
  describe: "read one persisted thesis record by thesis key or symbol",
  builder: (yargs: Argv) =>
    yargs
      .positional("thesis", {
        type: "string",
        demandOption: true,
        describe: "thesis key such as thesis:nvda or a symbol such as NVDA",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "output as JSON",
      }),
  handler: async (args: { thesis?: string; json?: boolean }) => {
    if (!args.thesis) {
      throw new Error("thesis is required")
    }
    const thesis = queryInvestingThesisRecord(args.thesis)
    const payload = thesis ?? { error: `Thesis not found: ${args.thesis}` }
    if (args.json || !thesis) {
      console.log(JSON.stringify(payload, null, 2))
      return
    }

    console.log(`${thesis.id}`)
    console.log(`- symbol=${thesis.symbol} status=${thesis.status} version=${thesis.currentVersion}`)
    console.log(`- conviction=${thesis.conviction} posture=${thesis.posture}`)
    console.log(`- summary=${thesis.summary}`)
    console.log(`- updatedAt=${thesis.updatedAt} revisions=${thesis.revisions.length}`)
    console.log(
      `- valuationCaseId=${thesis.valuation?.valuationCaseId ?? "n/a"} signal=${thesis.valuation?.signal ?? "n/a"}`,
    )
  },
})

const InvestingThesisListCommand = cmd({
  command: "list",
  describe: "list persisted thesis records",
  builder: (yargs: Argv) =>
    yargs
      .option("symbol", {
        type: "string",
        describe: "optional symbol filter",
      })
      .option("status", {
        type: "string",
        choices: [...INVESTING_THESIS_RECORD_STATUSES],
        describe: "optional thesis status filter",
      })
      .option("conviction", {
        type: "string",
        choices: [...INVESTING_THESIS_CONVICTIONS],
        describe: "optional conviction filter",
      })
      .option("posture", {
        type: "string",
        choices: [...INVESTING_THESIS_POSTURES],
        describe: "optional posture filter",
      })
      .option("limit", {
        type: "number",
        default: 20,
        describe: "maximum number of thesis records to return",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "output as JSON",
      }),
  handler: async (args: {
    symbol?: string
    status?: string
    conviction?: string
    posture?: string
    limit?: number
    json?: boolean
  }) => {
    const theses = queryInvestingTheses({
      symbol: args.symbol,
      status: args.status as InvestingThesisRecordStatus | undefined,
      conviction: args.conviction as InvestingThesisConviction | undefined,
      posture: args.posture as InvestingThesisPosture | undefined,
      limit: args.limit,
    })
    if (args.json) {
      console.log(JSON.stringify({ theses, count: theses.length }, null, 2))
      return
    }
    for (const thesis of theses) {
      console.log(
        `- ${thesis.id}: symbol=${thesis.symbol} status=${thesis.status} version=${thesis.currentVersion} conviction=${thesis.conviction} posture=${thesis.posture} summary=${thesis.summary}`,
      )
    }
  },
})

const InvestingThesisHistoryCommand = cmd({
  command: "history <thesis>",
  describe: "list revision history for one thesis key or symbol",
  builder: (yargs: Argv) =>
    yargs
      .positional("thesis", {
        type: "string",
        demandOption: true,
        describe: "thesis key such as thesis:nvda or a symbol such as NVDA",
      })
      .option("limit", {
        type: "number",
        default: 10,
        describe: "maximum number of revisions to return",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "output as JSON",
      }),
  handler: async (args: { thesis?: string; limit?: number; json?: boolean }) => {
    if (!args.thesis) {
      throw new Error("thesis is required")
    }
    const history = getInvestingThesisHistory({
      thesis: args.thesis,
      limit: args.limit,
    })
    const payload = history ?? { error: `Thesis not found: ${args.thesis}` }
    if (args.json || !history) {
      console.log(JSON.stringify(payload, null, 2))
      return
    }

    console.log(`${history.thesisKey}`)
    console.log(
      `- symbol=${history.symbol} currentVersion=${history.currentVersion} revisions=${history.revisionCount}`,
    )
    for (const revision of history.revisions) {
      console.log(
        `- v${revision.version}: changeType=${revision.changeType} conviction=${revision.conviction} posture=${revision.posture} evidence=${revision.evidence.length} summary=${revision.summary}`,
      )
    }
  },
})

const InvestingThesisDiffCommand = cmd({
  command: "diff <thesis>",
  describe: "diff two thesis versions for one thesis key or symbol",
  builder: (yargs: Argv) =>
    yargs
      .positional("thesis", {
        type: "string",
        demandOption: true,
        describe: "thesis key such as thesis:nvda or a symbol such as NVDA",
      })
      .option("from-version", {
        type: "number",
        describe: "prior version, defaults to the previous revision",
      })
      .option("to-version", {
        type: "number",
        describe: "target version, defaults to the latest revision",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "output as JSON",
      }),
  handler: async (args: { thesis?: string; fromVersion?: number; toVersion?: number; json?: boolean }) => {
    if (!args.thesis) {
      throw new Error("thesis is required")
    }
    try {
      const diff = diffInvestingThesisHistory({
        thesis: args.thesis,
        fromVersion: args.fromVersion,
        toVersion: args.toVersion,
      })
      const payload = diff ?? { error: `Thesis not found: ${args.thesis}` }
      if (args.json || !diff) {
        console.log(JSON.stringify(payload, null, 2))
        return
      }

      console.log(`${thesisLookup(args.thesis)} diff`)
      console.log(`- ${diff.summary}`)
      console.log(`- from=v${diff.fromRevision.version} to=v${diff.toRevision.version}`)
      console.log(`- changedFields=${diff.changedFields.join(", ") || "none"}`)
      console.log(
        `- conviction=${diff.changes.conviction.from}->${diff.changes.conviction.to} posture=${diff.changes.posture.from}->${diff.changes.posture.to}`,
      )
      console.log(
        `- watchpoints added=${diff.changes.watchpoints.added.length} removed=${diff.changes.watchpoints.removed.length} evidence added=${diff.changes.evidence.added.length} removed=${diff.changes.evidence.removed.length}`,
      )
    } catch (error) {
      console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2))
    }
  },
})

const InvestingThesisRollupCommand = cmd({
  command: "rollup",
  describe: "build a portfolio-level thesis rollup view",
  builder: (yargs: Argv) =>
    yargs
      .option("audience", {
        type: "string",
        choices: [...INVESTING_THESIS_PORTFOLIO_ROLLUP_AUDIENCES],
        default: "all",
        describe: "roll up all tracked names, holdings only, or watchlist only",
      })
      .option("conviction", {
        type: "string",
        choices: [...INVESTING_THESIS_CONVICTIONS],
        describe: "optional conviction filter",
      })
      .option("posture", {
        type: "string",
        choices: [...INVESTING_THESIS_POSTURES],
        describe: "optional posture filter",
      })
      .option("limit", {
        type: "number",
        default: 50,
        describe: "maximum number of rollup entries to return",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "output as JSON",
      }),
  handler: async (args: {
    audience?: string
    conviction?: string
    posture?: string
    limit?: number
    json?: boolean
  }) => {
    const rollup = buildInvestingThesisPortfolioRollup({
      audience: args.audience as InvestingThesisPortfolioRollupAudience | undefined,
      conviction: args.conviction as InvestingThesisConviction | undefined,
      posture: args.posture as InvestingThesisPosture | undefined,
      limit: args.limit,
    })
    if (args.json) {
      console.log(JSON.stringify(rollup, null, 2))
      return
    }

    console.log(rollup.summary)
    console.log(`- by posture: ${JSON.stringify(rollup.countsByPosture)}`)
    console.log(`- by conviction: ${JSON.stringify(rollup.countsByConviction)}`)
    for (const entry of rollup.entries) {
      if (!entry.thesis) {
        console.log(`- ${entry.symbol} [${entry.audience}]: missing thesis record`)
        continue
      }
      console.log(
        `- ${entry.symbol} [${entry.audience}]: version=${entry.thesis.currentVersion} conviction=${entry.thesis.conviction} posture=${entry.thesis.posture} summary=${entry.thesis.summary}`,
      )
    }
  },
})

const InvestingThesisCommand = cmd({
  command: "thesis",
  describe: "persisted thesis ledger, diffs, and portfolio rollup views",
  builder: (yargs: Argv) =>
    yargs
      .command(InvestingThesisStatusCommand)
      .command(InvestingThesisReadCommand)
      .command(InvestingThesisListCommand)
      .command(InvestingThesisHistoryCommand)
      .command(InvestingThesisDiffCommand)
      .command(InvestingThesisRollupCommand)
      .demandCommand(),
  async handler() {},
})

const InvestingEarningsPacketCreateCommand = cmd({
  command: "create <executionId>",
  describe: "create a persisted pre or post earnings packet from a research execution",
  builder: (yargs: Argv) =>
    yargs
      .positional("executionId", {
        type: "string",
        demandOption: true,
        describe: "persisted research execution identifier",
      })
      .option("overwrite", {
        type: "boolean",
        default: false,
        describe: "regenerate the packet even if one already exists",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "output as JSON",
      }),
  handler: async (args: { executionId?: string; overwrite?: boolean; json?: boolean }) => {
    if (!args.executionId) {
      throw new Error("executionId is required")
    }
    const execution = getInvestingResearchExecution(args.executionId)
    if (!execution) {
      console.log(JSON.stringify({ error: `Research execution not found: ${args.executionId}` }, null, 2))
      return
    }

    const plan = getInvestingResearchPlan(execution.planId)
    const task = plan?.tasks.find((entry) => entry.id === execution.taskId)
    if (!plan || !task) {
      console.log(
        JSON.stringify({ error: `Research plan context not found for execution: ${args.executionId}` }, null, 2),
      )
      return
    }

    const packet = await createInvestingEarningsPacket({
      execution,
      plan,
      task,
      overwrite: args.overwrite,
    })
    if (args.json) {
      console.log(JSON.stringify(packet, null, 2))
      return
    }

    console.log(`${packet.id}`)
    console.log(`- workflow=${packet.workflow} symbol=${packet.symbol} status=${packet.status}`)
    console.log(`- summary=${packet.summary}`)
    console.log(
      `- coverage catalysts=${packet.catalysts.length} risks=${packet.risks.length} citations=${packet.citations.length}`,
    )
  },
})

const InvestingEarningsPacketReadCommand = cmd({
  command: "read <packetId>",
  describe: "read one persisted earnings packet",
  builder: (yargs: Argv) =>
    yargs
      .positional("packetId", {
        type: "string",
        demandOption: true,
        describe: "persisted earnings packet identifier",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "output as JSON",
      }),
  handler: async (args: { packetId?: string; json?: boolean }) => {
    if (!args.packetId) {
      throw new Error("packetId is required")
    }
    const packet = getInvestingEarningsPacket(args.packetId)
    const payload = packet ?? { error: `Earnings packet not found: ${args.packetId}` }
    if (args.json || !packet) {
      console.log(JSON.stringify(payload, null, 2))
      return
    }

    console.log(`${packet.id}`)
    console.log(`- workflow=${packet.workflow} symbol=${packet.symbol} status=${packet.status}`)
    console.log(`- summary=${packet.summary}`)
    for (const section of packet.sections) {
      console.log(`\n${section.title}`)
      console.log(section.body)
    }
  },
})

const InvestingEarningsPacketListCommand = cmd({
  command: "list",
  describe: "list persisted earnings packets",
  builder: (yargs: Argv) =>
    yargs
      .option("symbol", {
        type: "string",
        describe: "optional symbol filter",
      })
      .option("workflow", {
        type: "string",
        choices: [...INVESTING_EARNINGS_PACKET_WORKFLOWS],
        describe: "optional workflow filter",
      })
      .option("execution-id", {
        type: "string",
        describe: "optional execution filter",
      })
      .option("limit", {
        type: "number",
        default: 10,
        describe: "maximum number of packets to return",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "output as JSON",
      }),
  handler: async (args: {
    symbol?: string
    workflow?: string
    executionId?: string
    limit?: number
    json?: boolean
  }) => {
    const packets = listInvestingEarningsPackets({
      symbol: args.symbol,
      workflow: args.workflow as InvestingEarningsPacketWorkflow | undefined,
      executionId: args.executionId,
      limit: args.limit,
    })
    if (args.json) {
      console.log(JSON.stringify({ packets, count: packets.length }, null, 2))
      return
    }
    for (const packet of packets) {
      console.log(
        `- ${packet.id}: workflow=${packet.workflow} symbol=${packet.symbol} status=${packet.status} catalysts=${packet.catalysts.length} risks=${packet.risks.length} summary=${packet.summary}`,
      )
    }
  },
})

const InvestingEarningsPacketExportCommand = cmd({
  command: "export <packetId>",
  describe: "export one persisted earnings packet",
  builder: (yargs: Argv) =>
    yargs
      .positional("packetId", {
        type: "string",
        demandOption: true,
        describe: "persisted earnings packet identifier",
      })
      .option("format", {
        type: "string",
        choices: ["json", "markdown"],
        default: "json",
        describe: "export format",
      }),
  handler: async (args: { packetId?: string; format?: string }) => {
    if (!args.packetId) {
      throw new Error("packetId is required")
    }
    const exported = exportInvestingEarningsPacket({
      packetId: args.packetId,
      format: (args.format as "json" | "markdown" | undefined) ?? "json",
    })
    console.log(exported.content)
  },
})

const InvestingEarningsPacketCommand = cmd({
  command: "earnings-packet",
  describe: "persisted pre and post earnings research packets",
  builder: (yargs: Argv) =>
    yargs
      .command(InvestingEarningsPacketCreateCommand)
      .command(InvestingEarningsPacketReadCommand)
      .command(InvestingEarningsPacketListCommand)
      .command(InvestingEarningsPacketExportCommand)
      .demandCommand(),
  async handler() {},
})

const InvestingOpsScheduleCreateCommand = cmd({
  command: "create",
  describe: "create a persisted research ops schedule",
  builder: (yargs: Argv) =>
    yargs
      .option("workflow", {
        type: "string",
        choices: [...INVESTING_OPS_WORKFLOWS],
        demandOption: true,
        describe: "automation workflow to schedule",
      })
      .option("schedule-minutes", {
        type: "number",
        demandOption: true,
        describe: "recurring cadence in minutes",
      })
      .option("enabled", {
        type: "boolean",
        describe: "whether the schedule should be active",
      })
      .option("symbol", {
        type: "string",
        describe: "required symbol for earnings workflows",
      })
      .option("watchlist-symbol", {
        type: "array",
        string: true,
        describe: "optional watchlist override for daily portfolio briefs",
      })
      .option("format", {
        type: "string",
        choices: [...INVESTING_OPS_FORMATS],
        default: "markdown",
        describe: "delivery format",
      })
      .option("delivery-target", {
        type: "string",
        choices: [...INVESTING_OPS_DELIVERY_TARGETS],
        default: "audit-log",
        describe: "delivery destination",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "output as JSON",
      }),
  handler: async (args: {
    workflow?: string
    scheduleMinutes?: number
    enabled?: boolean
    symbol?: string
    watchlistSymbol?: string[]
    format?: string
    deliveryTarget?: string
    json?: boolean
  }) => {
    if (!args.workflow || !args.scheduleMinutes) {
      throw new Error("workflow and scheduleMinutes are required")
    }
    const schedule = createInvestingOpsSchedule({
      workflow: args.workflow as InvestingOpsWorkflow,
      scheduleMinutes: args.scheduleMinutes,
      enabled: args.enabled,
      symbol: args.symbol,
      watchlistSymbols: args.watchlistSymbol,
      format: (args.format as "json" | "markdown" | undefined) ?? "markdown",
      deliveryTarget: (args.deliveryTarget as "audit-log" | undefined) ?? "audit-log",
    })
    if (args.json) {
      console.log(JSON.stringify(schedule, null, 2))
      return
    }

    console.log(`${schedule.id}`)
    console.log(`- workflow=${schedule.workflow} every=${schedule.scheduleMinutes}m enabled=${schedule.enabled}`)
    console.log(`- symbol=${schedule.symbol ?? "n/a"} format=${schedule.format} target=${schedule.deliveryTarget}`)
  },
})

const InvestingOpsScheduleReadCommand = cmd({
  command: "read <scheduleId>",
  describe: "read one persisted research ops schedule",
  builder: (yargs: Argv) =>
    yargs
      .positional("scheduleId", {
        type: "string",
        demandOption: true,
        describe: "persisted ops schedule identifier",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "output as JSON",
      }),
  handler: async (args: { scheduleId?: string; json?: boolean }) => {
    if (!args.scheduleId) {
      throw new Error("scheduleId is required")
    }
    const schedule = getInvestingOpsSchedule(args.scheduleId)
    const payload = schedule ?? { error: `Ops schedule not found: ${args.scheduleId}` }
    if (args.json || !schedule) {
      console.log(JSON.stringify(payload, null, 2))
      return
    }

    console.log(`${schedule.id}`)
    console.log(`- workflow=${schedule.workflow} every=${schedule.scheduleMinutes}m enabled=${schedule.enabled}`)
    console.log(`- symbol=${schedule.symbol ?? "n/a"} format=${schedule.format} target=${schedule.deliveryTarget}`)
    console.log(`- lastStatus=${schedule.audit.lastStatus ?? "never"} lastRunAt=${schedule.audit.lastRunAt ?? "n/a"}`)
  },
})

const InvestingOpsScheduleListCommand = cmd({
  command: "list",
  describe: "list persisted research ops schedules",
  builder: (yargs: Argv) =>
    yargs
      .option("workflow", {
        type: "string",
        choices: [...INVESTING_OPS_WORKFLOWS],
        describe: "optional workflow filter",
      })
      .option("enabled", {
        type: "boolean",
        describe: "optional enabled filter",
      })
      .option("symbol", {
        type: "string",
        describe: "optional symbol filter",
      })
      .option("limit", {
        type: "number",
        default: 10,
        describe: "maximum number of schedules to return",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "output as JSON",
      }),
  handler: async (args: { workflow?: string; enabled?: boolean; symbol?: string; limit?: number; json?: boolean }) => {
    const schedules = listInvestingOpsSchedules({
      workflow: args.workflow as InvestingOpsWorkflow | undefined,
      enabled: args.enabled,
      symbol: args.symbol,
      limit: args.limit,
    })
    if (args.json) {
      console.log(JSON.stringify({ schedules, count: schedules.length }, null, 2))
      return
    }
    for (const schedule of schedules) {
      console.log(
        `- ${schedule.id}: workflow=${schedule.workflow} every=${schedule.scheduleMinutes}m enabled=${schedule.enabled} symbol=${schedule.symbol ?? "n/a"} target=${schedule.deliveryTarget} format=${schedule.format}`,
      )
    }
  },
})

const InvestingOpsScheduleUpdateCommand = cmd({
  command: "update <scheduleId>",
  describe: "update a persisted research ops schedule",
  builder: (yargs: Argv) =>
    yargs
      .positional("scheduleId", {
        type: "string",
        demandOption: true,
        describe: "persisted ops schedule identifier",
      })
      .option("enabled", {
        type: "boolean",
        describe: "updated enabled state",
      })
      .option("schedule-minutes", {
        type: "number",
        describe: "updated recurring cadence in minutes",
      })
      .option("symbol", {
        type: "string",
        describe: "updated symbol for earnings workflows",
      })
      .option("watchlist-symbol", {
        type: "array",
        string: true,
        describe: "updated watchlist override for daily briefs",
      })
      .option("format", {
        type: "string",
        choices: [...INVESTING_OPS_FORMATS],
        describe: "updated delivery format",
      })
      .option("delivery-target", {
        type: "string",
        choices: [...INVESTING_OPS_DELIVERY_TARGETS],
        describe: "updated delivery destination",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "output as JSON",
      }),
  handler: async (args: {
    scheduleId?: string
    enabled?: boolean
    scheduleMinutes?: number
    symbol?: string
    watchlistSymbol?: string[]
    format?: string
    deliveryTarget?: string
    json?: boolean
  }) => {
    if (!args.scheduleId) {
      throw new Error("scheduleId is required")
    }
    const schedule = updateInvestingOpsSchedule({
      scheduleId: args.scheduleId,
      enabled: args.enabled,
      scheduleMinutes: args.scheduleMinutes,
      symbol: args.symbol,
      watchlistSymbols: args.watchlistSymbol,
      format: args.format as "json" | "markdown" | undefined,
      deliveryTarget: args.deliveryTarget as "audit-log" | undefined,
    })
    if (args.json) {
      console.log(JSON.stringify(schedule, null, 2))
      return
    }

    console.log(`${schedule.id}`)
    console.log(`- workflow=${schedule.workflow} every=${schedule.scheduleMinutes}m enabled=${schedule.enabled}`)
    console.log(`- symbol=${schedule.symbol ?? "n/a"} format=${schedule.format} target=${schedule.deliveryTarget}`)
  },
})

const InvestingOpsScheduleRunCommand = cmd({
  command: "run <scheduleId>",
  describe: "run one persisted research ops schedule immediately",
  builder: (yargs: Argv) =>
    yargs
      .positional("scheduleId", {
        type: "string",
        demandOption: true,
        describe: "persisted ops schedule identifier",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "output as JSON",
      }),
  handler: async (args: { scheduleId?: string; json?: boolean }) => {
    if (!args.scheduleId) {
      throw new Error("scheduleId is required")
    }
    const delivery = await runInvestingOpsSchedule({
      scheduleId: args.scheduleId,
    })
    if (args.json) {
      console.log(JSON.stringify(delivery, null, 2))
      return
    }

    console.log(`${delivery.id}`)
    console.log(`- workflow=${delivery.workflow} status=${delivery.status} target=${delivery.deliveryTarget}`)
    console.log(
      `- artifact=${delivery.artifactKind}:${delivery.artifactId ?? "n/a"} symbol=${delivery.symbol ?? "n/a"}`,
    )
    console.log(`- summary=${delivery.summary}`)
    if (delivery.content) {
      console.log(`\n${delivery.content}`)
    }
  },
})

const InvestingOpsScheduleCommand = cmd({
  command: "schedule",
  describe: "persisted research ops schedules",
  builder: (yargs: Argv) =>
    yargs
      .command(InvestingOpsScheduleCreateCommand)
      .command(InvestingOpsScheduleReadCommand)
      .command(InvestingOpsScheduleListCommand)
      .command(InvestingOpsScheduleUpdateCommand)
      .command(InvestingOpsScheduleRunCommand)
      .demandCommand(),
  async handler() {},
})

const InvestingOpsDeliveryReadCommand = cmd({
  command: "read <deliveryId>",
  describe: "read one research ops delivery record",
  builder: (yargs: Argv) =>
    yargs
      .positional("deliveryId", {
        type: "string",
        demandOption: true,
        describe: "persisted ops delivery identifier",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "output as JSON",
      }),
  handler: async (args: { deliveryId?: string; json?: boolean }) => {
    if (!args.deliveryId) {
      throw new Error("deliveryId is required")
    }
    const delivery = getInvestingOpsDeliveryRecord(args.deliveryId)
    const payload = delivery ?? { error: `Ops delivery not found: ${args.deliveryId}` }
    if (args.json || !delivery) {
      console.log(JSON.stringify(payload, null, 2))
      return
    }

    console.log(`${delivery.id}`)
    console.log(`- workflow=${delivery.workflow} status=${delivery.status} target=${delivery.deliveryTarget}`)
    console.log(
      `- artifact=${delivery.artifactKind}:${delivery.artifactId ?? "n/a"} symbol=${delivery.symbol ?? "n/a"}`,
    )
    console.log(`- summary=${delivery.summary}`)
    if (delivery.error) {
      console.log(`- error=${delivery.error}`)
    }
    if (delivery.content) {
      console.log(`\n${delivery.content}`)
    }
  },
})

const InvestingOpsDeliveryListCommand = cmd({
  command: "list",
  describe: "list research ops delivery records",
  builder: (yargs: Argv) =>
    yargs
      .option("schedule-id", {
        type: "string",
        describe: "optional schedule filter",
      })
      .option("workflow", {
        type: "string",
        choices: [...INVESTING_OPS_WORKFLOWS],
        describe: "optional workflow filter",
      })
      .option("status", {
        type: "string",
        choices: ["ok", "error"],
        describe: "optional run status filter",
      })
      .option("symbol", {
        type: "string",
        describe: "optional symbol filter",
      })
      .option("limit", {
        type: "number",
        default: 10,
        describe: "maximum number of delivery records to return",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "output as JSON",
      }),
  handler: async (args: {
    scheduleId?: string
    workflow?: string
    status?: string
    symbol?: string
    limit?: number
    json?: boolean
  }) => {
    const deliveries = listInvestingOpsDeliveryRecords({
      scheduleId: args.scheduleId,
      workflow: args.workflow as InvestingOpsWorkflow | undefined,
      status: args.status as "ok" | "error" | undefined,
      symbol: args.symbol,
      limit: args.limit,
    })
    if (args.json) {
      console.log(JSON.stringify({ deliveries, count: deliveries.length }, null, 2))
      return
    }
    for (const delivery of deliveries) {
      console.log(
        `- ${delivery.id}: workflow=${delivery.workflow} status=${delivery.status} artifact=${delivery.artifactKind}:${delivery.artifactId ?? "n/a"} symbol=${delivery.symbol ?? "n/a"} summary=${delivery.summary}`,
      )
    }
  },
})

const InvestingOpsDeliveryCommand = cmd({
  command: "delivery",
  describe: "research ops delivery audit trail",
  builder: (yargs: Argv) =>
    yargs.command(InvestingOpsDeliveryReadCommand).command(InvestingOpsDeliveryListCommand).demandCommand(),
  async handler() {},
})

const InvestingOpsCommand = cmd({
  command: "ops",
  describe: "unattended research ops schedules and delivery audit trail",
  builder: (yargs: Argv) =>
    yargs.command(InvestingOpsScheduleCommand).command(InvestingOpsDeliveryCommand).demandCommand(),
  async handler() {},
})

const InvestingBriefingCreateCommand = cmd({
  command: "create",
  describe: "create a persisted daily portfolio briefing",
  builder: (yargs: Argv) =>
    yargs
      .option("kind", {
        type: "string",
        choices: [...INVESTING_PORTFOLIO_BRIEFING_KINDS],
        default: "daily-portfolio-brief",
        describe: "briefing kind to create",
      })
      .option("watchlist-symbol", {
        type: "array",
        string: true,
        describe: "optional explicit watchlist symbol override",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "output as JSON",
      }),
  handler: async (args: { kind?: string; watchlistSymbol?: string[]; json?: boolean }) => {
    const briefing = await createInvestingPortfolioBriefing({
      watchlistSymbols: args.watchlistSymbol,
    })
    if (args.json) {
      console.log(JSON.stringify(briefing, null, 2))
      return
    }

    console.log(`${briefing.id}`)
    console.log(`- kind=${briefing.kind} createdAt=${briefing.createdAt}`)
    console.log(`- summary=${briefing.summary}`)
    console.log(
      `- coverage holdings=${briefing.coverage.holdingsCount} watchlist=${briefing.coverage.watchlistCount} theses=${briefing.coverage.thesisTrackedCount} deltas=${briefing.coverage.eventDeltaCount}`,
    )
  },
})

const InvestingBriefingReadCommand = cmd({
  command: "read <briefingId>",
  describe: "read one persisted portfolio briefing",
  builder: (yargs: Argv) =>
    yargs
      .positional("briefingId", {
        type: "string",
        demandOption: true,
        describe: "portfolio briefing identifier",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "output as JSON",
      }),
  handler: async (args: { briefingId?: string; json?: boolean }) => {
    if (!args.briefingId) {
      throw new Error("briefingId is required")
    }
    const briefing = getInvestingPortfolioBriefing(args.briefingId)
    const payload = briefing ?? { error: `Portfolio briefing not found: ${args.briefingId}` }
    if (args.json || !briefing) {
      console.log(JSON.stringify(payload, null, 2))
      return
    }

    console.log(`${briefing.id}`)
    console.log(`- kind=${briefing.kind} createdAt=${briefing.createdAt}`)
    console.log(`- summary=${briefing.summary}`)
    for (const section of briefing.sections) {
      console.log(`\n${section.title}`)
      console.log(section.body)
    }
  },
})

const InvestingBriefingListCommand = cmd({
  command: "list",
  describe: "list persisted portfolio briefings",
  builder: (yargs: Argv) =>
    yargs
      .option("kind", {
        type: "string",
        choices: [...INVESTING_PORTFOLIO_BRIEFING_KINDS],
        describe: "optional briefing kind filter",
      })
      .option("symbol", {
        type: "string",
        describe: "optional symbol filter",
      })
      .option("audience", {
        type: "string",
        choices: ["holding", "watchlist"],
        describe: "optional audience filter",
      })
      .option("limit", {
        type: "number",
        default: 10,
        describe: "maximum number of briefings to return",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "output as JSON",
      }),
  handler: async (args: { kind?: string; symbol?: string; audience?: string; limit?: number; json?: boolean }) => {
    const briefings = listInvestingPortfolioBriefings({
      kind: args.kind as InvestingPortfolioBriefingKind | undefined,
      symbol: args.symbol,
      audience: args.audience as InvestingPortfolioBriefingAudience | undefined,
      limit: args.limit,
    })
    if (args.json) {
      console.log(JSON.stringify({ briefings, count: briefings.length }, null, 2))
      return
    }
    for (const briefing of briefings) {
      console.log(
        `- ${briefing.id}: kind=${briefing.kind} holdings=${briefing.coverage.holdingsCount} watchlist=${briefing.coverage.watchlistCount} theses=${briefing.coverage.thesisTrackedCount} deltas=${briefing.coverage.eventDeltaCount} summary=${briefing.summary}`,
      )
    }
  },
})

const InvestingBriefingCommand = cmd({
  command: "briefing",
  describe: "persisted daily portfolio briefings",
  builder: (yargs: Argv) =>
    yargs
      .command(InvestingBriefingCreateCommand)
      .command(InvestingBriefingReadCommand)
      .command(InvestingBriefingListCommand)
      .demandCommand(),
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
      .command(InvestingEarningsPacketCommand)
      .command(InvestingOpsCommand)
      .command(InvestingBriefingCommand)
      .demandCommand(),
  async handler() {},
})
