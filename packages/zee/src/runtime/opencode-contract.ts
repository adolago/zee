import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Log } from "@/util/log"
import z from "zod"

const log = Log.create({ service: "runtime:opencode-contract" })

export type RuntimeContractSurface = "cli" | "orchestration" | "gateway"
export type RuntimeContractTransport = "in_process" | "http" | "ipc_socket" | "sdk_http" | "websocket"

export type RuntimeCodeReference = {
  file: string
  symbol: string
}

export type RuntimeEntryPoint = {
  id: string
  surface: RuntimeContractSurface
  name: string
  command?: string
  description: string
  transport: RuntimeContractTransport
  references: RuntimeCodeReference[]
}

export type RuntimeContractRequirement = {
  id: string
  requirement: string
  references: RuntimeCodeReference[]
}

export type RuntimeSurfaceContract = {
  surface: RuntimeContractSurface
  objective: string
  currentRuntime: string
  targetRuntime: string
  entryPoints: RuntimeEntryPoint[]
  invariants: RuntimeContractRequirement[]
  adapterCapabilities: RuntimeContractRequirement[]
}

export type RuntimeContractTelemetry = {
  eventType: string
  metricNames: string[]
  metrics: {
    surfaceCount: number
    entryPointCount: number
    invariantCount: number
    capabilityCount: number
    transportCount: number
    gatewayPresent: boolean
    orchestrationPresent: boolean
  }
}

export type OpenCodeRuntimeContractReport = {
  contractId: "opencode-runtime-core"
  contractVersion: 1
  generatedAt: string
  roadmapIssue: number
  upstreamTarget: "sst/opencode"
  rolloutPhase: "inventory"
  defaultRuntime: {
    current: "zee"
    target: "opencode"
    mode: "inventory_locked"
  }
  surfaces: RuntimeSurfaceContract[]
  telemetry: RuntimeContractTelemetry
}

export const OpenCodeRuntimeContractInspected = BusEvent.define(
  "runtime.opencode-contract.inspected",
  z.object({
    contractId: z.literal("opencode-runtime-core"),
    contractVersion: z.literal(1),
    surfaceCount: z.number().int().nonnegative(),
    entryPointCount: z.number().int().nonnegative(),
    invariantCount: z.number().int().nonnegative(),
    capabilityCount: z.number().int().nonnegative(),
    transportCount: z.number().int().nonnegative(),
    gatewayPresent: z.boolean(),
    orchestrationPresent: z.boolean(),
  }),
)

const SURFACES: RuntimeSurfaceContract[] = [
  {
    surface: "cli",
    objective:
      "Preserve Zee CLI session semantics while routing primary execution through an OpenCode-aligned runtime.",
    currentRuntime: "Yargs CLI dispatch with Zee SDK/HTTP client attachment and in-process bootstrap.",
    targetRuntime: "OpenCode-first execution substrate behind Zee-native commands and persona semantics.",
    entryPoints: [
      {
        id: "cli.bootstrap",
        surface: "cli",
        name: "CLI bootstrap",
        command: "zee <command>",
        description: "Loads daemon env, initializes logging/flags, and dispatches the full command tree.",
        transport: "in_process",
        references: [
          { file: "packages/zee/src/index.ts", symbol: "loadDaemonEnv" },
          { file: "packages/zee/src/index.ts", symbol: "cli.parse" },
        ],
      },
      {
        id: "cli.run",
        surface: "cli",
        name: "Interactive run surface",
        command: "zee run",
        description: "Primary operator-facing execution path for single-shot or continued session runs.",
        transport: "sdk_http",
        references: [
          { file: "packages/zee/src/cli/cmd/run.ts", symbol: "RunCommand" },
          { file: "packages/zee/src/cli/cmd/run.ts", symbol: "createZeeClient" },
          { file: "packages/zee/src/cli/cmd/run.ts", symbol: "resolveRunMode" },
        ],
      },
      {
        id: "cli.attach",
        surface: "cli",
        name: "Attached client/TUI surface",
        command: "zee attach",
        description: "Attaches a local CLI/TUI client to a running Zee server without changing session semantics.",
        transport: "http",
        references: [
          { file: "packages/zee/src/cli/cmd/tui/attach.ts", symbol: "AttachCommand" },
          { file: "packages/zee/src/cli/cmd/client.ts", symbol: "ClientCommand" },
        ],
      },
      {
        id: "cli.serve",
        surface: "cli",
        name: "Server runtime surface",
        command: "zee serve",
        description: "Exposes the HTTP/OpenAPI runtime that attached CLI and other clients depend on.",
        transport: "http",
        references: [
          { file: "packages/zee/src/cli/cmd/serve.ts", symbol: "ServeCommand" },
          { file: "packages/zee/src/server/server.ts", symbol: "Server.listen" },
        ],
      },
    ],
    invariants: [
      {
        id: "cli.workspace-resolution",
        requirement:
          "Workspace, config, and project-local `.zee/` discovery remain Zee-native even when execution moves behind an OpenCode adapter.",
        references: [
          { file: "packages/zee/src/index.ts", symbol: "middleware" },
          { file: "packages/zee/src/cli/cmd/run.ts", symbol: "bootstrap" },
        ],
      },
      {
        id: "cli.session-identity",
        requirement:
          "Session continuation, message routing, and persona selection must preserve Zee IDs and agent resolution.",
        references: [
          { file: "packages/zee/src/cli/cmd/run.ts", symbol: "RunCommand" },
          { file: "packages/zee/src/agent/agent.ts", symbol: "Agent.get" },
        ],
      },
      {
        id: "cli.provider-resolution",
        requirement:
          "Model/provider selection continues through Zee provider resolution rather than adopting OpenCode naming blindly.",
        references: [
          { file: "packages/zee/src/cli/cmd/run.ts", symbol: "Provider.getModel" },
          { file: "packages/zee/src/provider/provider.ts", symbol: "Provider.parseModel" },
        ],
      },
      {
        id: "cli.event-shape",
        requirement:
          "CLI/TUI consumers keep the existing event stream and formatted output contract while the runtime substrate changes underneath.",
        references: [
          { file: "packages/zee/src/cli/cmd/run.ts", symbol: "GlobalBus" },
          { file: "packages/zee/src/cli/cmd/tui/worker.ts", symbol: "Rpc.emit" },
        ],
      },
    ],
    adapterCapabilities: [
      {
        id: "cli.command-dispatch",
        requirement:
          "Map Zee command entrypoints to the OpenCode-backed runtime without changing command names or flags.",
        references: [
          { file: "packages/zee/src/index.ts", symbol: "cli.command" },
          { file: "packages/zee/src/cli/cmd/run.ts", symbol: "RunCommand" },
        ],
      },
      {
        id: "cli.session-bootstrap",
        requirement: "Carry Zee session/message context into the adapter boundary for continue/attach flows.",
        references: [
          { file: "packages/zee/src/cli/cmd/run.ts", symbol: "session" },
          { file: "packages/zee/src/session/index.ts", symbol: "Session.create" },
        ],
      },
      {
        id: "cli.tool-permissions",
        requirement: "Respect Zee tool/permission policy before delegating execution into the OpenCode runtime.",
        references: [
          { file: "packages/zee/src/permission/index.ts", symbol: "Permission" },
          { file: "packages/zee/src/tool/registry.ts", symbol: "ToolRegistry" },
        ],
      },
      {
        id: "cli.output-normalization",
        requirement: "Normalize tool/status output back into Zee CLI/TUI rendering conventions.",
        references: [
          { file: "packages/zee/src/cli/cmd/run.ts", symbol: "renderTool" },
          { file: "packages/zee/src/session/message-v2.ts", symbol: "MessageV2" },
        ],
      },
    ],
  },
  {
    surface: "orchestration",
    objective:
      "Keep Zee daemon orchestration stable while defining the adapter boundary for OpenCode-backed worker execution.",
    currentRuntime: "Zee daemon IPC server backed by the in-repo swarm orchestrator and worker lifecycle.",
    targetRuntime: "OpenCode-backed worker execution behind the existing Zee daemon IPC and orchestration contracts.",
    entryPoints: [
      {
        id: "orchestration.client",
        surface: "orchestration",
        name: "Daemon IPC client",
        description: "Submits work and lists event streams over newline-delimited JSON on the daemon socket.",
        transport: "ipc_socket",
        references: [
          { file: "packages/zee/src/orchestration/daemon-ipc.ts", symbol: "requestOrchestration" },
          { file: "packages/zee/src/orchestration/daemon-ipc.ts", symbol: "runTaskViaDaemon" },
        ],
      },
      {
        id: "orchestration.server",
        surface: "orchestration",
        name: "Daemon IPC server",
        description: "Owns the orchestration command surface and task/event lifecycle exposed to clients.",
        transport: "ipc_socket",
        references: [
          { file: "src/daemon/ipc-server.ts", symbol: "DaemonServer" },
          { file: "src/daemon/ipc-server.ts", symbol: "registerDefaultHandlers" },
        ],
      },
      {
        id: "orchestration.engine",
        surface: "orchestration",
        name: "Swarm orchestrator",
        description: "Schedules drones, tasks, retries, and emitted orchestration events for the daemon control plane.",
        transport: "in_process",
        references: [
          { file: "src/swarm/orchestrator.ts", symbol: "Orchestrator" },
          { file: "src/swarm/queen.ts", symbol: "Queen" },
        ],
      },
    ],
    invariants: [
      {
        id: "orchestration.socket-protocol",
        requirement:
          "The daemon socket remains a newline-delimited JSON request/response protocol during runtime migration.",
        references: [
          { file: "packages/zee/src/orchestration/daemon-ipc.ts", symbol: "OrchestrationRequest" },
          { file: "src/daemon/ipc-server.ts", symbol: "processRequest" },
        ],
      },
      {
        id: "orchestration-parent-context",
        requirement:
          "Parent session/message IDs, task IDs, priorities, and timeouts stay explicit across the adapter boundary.",
        references: [
          { file: "packages/zee/src/orchestration/daemon-ipc.ts", symbol: "RunTaskParams" },
          { file: "src/daemon/types.ts", symbol: "RunTaskParams" },
        ],
      },
      {
        id: "orchestration-event-ordering",
        requirement: "Event cursor ordering and event-type semantics remain stable for daemon event consumers.",
        references: [
          { file: "packages/zee/src/orchestration/daemon-ipc.ts", symbol: "ListEventsResult" },
          { file: "src/swarm/events.ts", symbol: "OrchestrationEventType" },
        ],
      },
      {
        id: "orchestration-shutdown",
        requirement:
          "Daemon shutdown and draining behavior stay under Zee control even if worker execution becomes OpenCode-backed.",
        references: [
          { file: "src/daemon/ipc-server.ts", symbol: "stop" },
          { file: "src/swarm/orchestrator.ts", symbol: "shutdown" },
        ],
      },
    ],
    adapterCapabilities: [
      {
        id: "orchestration-task-submission",
        requirement:
          "Translate Zee run-task requests into OpenCode worker execution requests without changing the daemon IPC schema.",
        references: [
          { file: "packages/zee/src/orchestration/daemon-ipc.ts", symbol: "runTaskViaDaemon" },
          { file: "src/daemon/ipc-server.ts", symbol: "run_task" },
        ],
      },
      {
        id: "orchestration-worker-lifecycle",
        requirement: "Preserve Zee worker lifecycle states while delegating actual execution to an adapter.",
        references: [
          { file: "src/swarm/orchestrator.ts", symbol: "spawnDrone" },
          { file: "src/swarm/orchestrator.ts", symbol: "runTask" },
        ],
      },
      {
        id: "orchestration-retry-timeout",
        requirement: "Keep retry, interrupt, and timeout semantics visible in Zee orchestration events.",
        references: [
          { file: "src/swarm/events.ts", symbol: "retry" },
          { file: "packages/zee/src/orchestration/daemon-ipc.ts", symbol: "timeoutMs" },
        ],
      },
      {
        id: "orchestration-snapshot",
        requirement:
          "Expose queue depth, active workers, and task counts through the existing daemon status/snapshot APIs.",
        references: [
          { file: "src/daemon/ipc-server.ts", symbol: "getSnapshot" },
          { file: "packages/zee/src/cli/cmd/daemon-events.ts", symbol: "DaemonEventsCommand" },
        ],
      },
    ],
  },
  {
    surface: "gateway",
    objective:
      "Keep gateway-triggered execution and embedded runtime supervision stable while defining the OpenCode adapter seam.",
    currentRuntime: "Embedded Zee gateway runtime with HTTP bridge routes and shared in-process WebSocket client auth.",
    targetRuntime: "OpenCode-aware execution behind Zee gateway supervision, auth, and bridge semantics.",
    entryPoints: [
      {
        id: "gateway.supervisor",
        surface: "gateway",
        name: "Gateway supervisor",
        description: "Starts and monitors the embedded gateway runtime from the daemon/always-on surface.",
        transport: "in_process",
        references: [
          { file: "packages/zee/src/cli/cmd/daemon.ts", symbol: "GatewaySupervisor" },
          { file: "packages/zee/src/cli/cmd/always-on.ts", symbol: "GatewaySupervisor.start" },
        ],
      },
      {
        id: "gateway.embedded-runtime",
        surface: "gateway",
        name: "Embedded gateway runtime",
        description: "Loads the Swabble gateway runtime, injects daemon URL, and resolves shared auth state.",
        transport: "in_process",
        references: [
          { file: "packages/zee/src/gateway/embedded-gateway.ts", symbol: "startEmbeddedGateway" },
          { file: "packages/zee/src/gateway/embedded-gateway.ts", symbol: "resolveGatewayRuntime" },
        ],
      },
      {
        id: "gateway.ws-client",
        surface: "gateway",
        name: "Gateway WebSocket client",
        description: "Executes method calls against the gateway control plane using a request/response frame protocol.",
        transport: "websocket",
        references: [
          { file: "packages/zee/src/gateway/ws-client.ts", symbol: "GatewayWsClient" },
          { file: "packages/zee/src/gateway/ws-client.ts", symbol: "GatewayRequestFrame" },
        ],
      },
      {
        id: "gateway.http-bridge",
        surface: "gateway",
        name: "Gateway HTTP bridge",
        description: "Accepts inbound HTTP gateway requests and bridges them into Zee sessions and gateway clients.",
        transport: "http",
        references: [
          { file: "packages/zee/src/server/route/gateway.ts", symbol: "GatewayRoute" },
          { file: "packages/zee/src/server/server.ts", symbol: "GatewayRoute" },
        ],
      },
    ],
    invariants: [
      {
        id: "gateway-shared-auth",
        requirement:
          "The in-process WebSocket client and embedded gateway server continue to share one resolved auth token source.",
        references: [
          { file: "packages/zee/src/gateway/embedded-gateway.ts", symbol: "resolveGatewayAuth" },
          { file: "packages/zee/src/gateway/embedded-gateway.ts", symbol: "ZEE_GATEWAY_TOKEN" },
        ],
      },
      {
        id: "gateway-daemon-url",
        requirement:
          "Gateway-triggered execution keeps explicit daemon URL propagation instead of implicit local discovery.",
        references: [
          { file: "packages/zee/src/gateway/embedded-gateway.ts", symbol: "maybeInjectZeeUrl" },
          { file: "packages/zee/src/cli/cmd/always-on.ts", symbol: "daemonUrl" },
        ],
      },
      {
        id: "gateway-degrade-cleanly",
        requirement:
          "When the embedded gateway runtime is unavailable, gateway surfaces degrade explicitly instead of partially starting.",
        references: [
          { file: "packages/zee/src/gateway/embedded-gateway.ts", symbol: "resolveGatewayRuntime" },
          { file: "packages/zee/src/cli/cmd/gateway/start.ts", symbol: "Gateway runtime is unavailable" },
        ],
      },
      {
        id: "gateway-bridge-shape",
        requirement:
          "HTTP bridge routes and WebSocket client calls preserve Zee-side request/response and session mapping semantics.",
        references: [
          { file: "packages/zee/src/server/route/gateway.ts", symbol: "send endpoint" },
          { file: "packages/zee/src/gateway/ws-client.ts", symbol: "call" },
        ],
      },
    ],
    adapterCapabilities: [
      {
        id: "gateway-supervision",
        requirement:
          "Supervise an OpenCode-backed execution path without moving gateway lifecycle ownership out of Zee.",
        references: [
          { file: "packages/zee/src/cli/cmd/daemon.ts", symbol: "GatewaySupervisor" },
          { file: "packages/zee/src/cli/cmd/always-on.ts", symbol: "startAlwaysOnProcess" },
        ],
      },
      {
        id: "gateway-request-routing",
        requirement:
          "Translate gateway-initiated execution into the adapter runtime while keeping Zee gateway method names stable.",
        references: [
          { file: "packages/zee/src/gateway/ws-client.ts", symbol: "sendRequest" },
          { file: "packages/zee/src/server/route/gateway.ts", symbol: "inbound endpoint" },
        ],
      },
      {
        id: "gateway-config-snapshot",
        requirement: "Keep config snapshot and runtime health inspection anchored in Zee-owned gateway config readers.",
        references: [
          { file: "packages/zee/src/gateway/embedded-gateway.ts", symbol: "readEmbeddedGatewayConfigSnapshot" },
          { file: "packages/zee/src/cli/cmd/gateway/status.ts", symbol: "status" },
        ],
      },
      {
        id: "gateway-session-handoff",
        requirement: "Preserve Zee session mapping when gateway traffic enters the assistant runtime.",
        references: [
          { file: "packages/zee/src/server/route/gateway.ts", symbol: "Inbound injection + mapping" },
          { file: "packages/zee/src/session/index.ts", symbol: "Session.messages" },
        ],
      },
    ],
  },
]

function flattenRequirements(
  surfaces: RuntimeSurfaceContract[],
  key: "invariants" | "adapterCapabilities",
): RuntimeContractRequirement[] {
  return surfaces.flatMap((surface) => surface[key])
}

export function buildOpenCodeRuntimeContractReport(now: Date = new Date()): OpenCodeRuntimeContractReport {
  const surfaces = SURFACES
  const entryPoints = surfaces.flatMap((surface) => surface.entryPoints)
  const invariants = flattenRequirements(surfaces, "invariants")
  const capabilities = flattenRequirements(surfaces, "adapterCapabilities")
  const transportCount = new Set(entryPoints.map((entryPoint) => entryPoint.transport)).size

  return {
    contractId: "opencode-runtime-core",
    contractVersion: 1,
    generatedAt: now.toISOString(),
    roadmapIssue: 485,
    upstreamTarget: "sst/opencode",
    rolloutPhase: "inventory",
    defaultRuntime: {
      current: "zee",
      target: "opencode",
      mode: "inventory_locked",
    },
    surfaces,
    telemetry: {
      eventType: OpenCodeRuntimeContractInspected.type,
      metricNames: [
        "surfaceCount",
        "entryPointCount",
        "invariantCount",
        "capabilityCount",
        "transportCount",
        "gatewayPresent",
        "orchestrationPresent",
      ],
      metrics: {
        surfaceCount: surfaces.length,
        entryPointCount: entryPoints.length,
        invariantCount: invariants.length,
        capabilityCount: capabilities.length,
        transportCount,
        gatewayPresent: surfaces.some((surface) => surface.surface === "gateway"),
        orchestrationPresent: surfaces.some((surface) => surface.surface === "orchestration"),
      },
    },
  }
}

export async function emitOpenCodeRuntimeContractTelemetry(report: OpenCodeRuntimeContractReport): Promise<void> {
  log.info("OpenCode runtime contract inspected", {
    contractId: report.contractId,
    contractVersion: report.contractVersion,
    ...report.telemetry.metrics,
  })

  await Bus.publish(OpenCodeRuntimeContractInspected, {
    contractId: report.contractId,
    contractVersion: report.contractVersion,
    ...report.telemetry.metrics,
  })
}

export function summarizeOpenCodeRuntimeContract(report: OpenCodeRuntimeContractReport): string {
  const lines = [
    `OpenCode runtime contract v${report.contractVersion}`,
    `phase=${report.rolloutPhase} target=${report.defaultRuntime.target} surfaces=${report.telemetry.metrics.surfaceCount}`,
  ]

  for (const surface of report.surfaces) {
    const commands = surface.entryPoints
      .map((entryPoint) => entryPoint.command)
      .filter((command): command is string => Boolean(command))
      .join(", ")
    lines.push(
      `- ${surface.surface}: entries=${surface.entryPoints.length} invariants=${surface.invariants.length} capabilities=${surface.adapterCapabilities.length}${commands ? ` commands=${commands}` : ""}`,
    )
  }

  lines.push(
    `telemetry event=${report.telemetry.eventType} entryPoints=${report.telemetry.metrics.entryPointCount} transports=${report.telemetry.metrics.transportCount}`,
  )
  return lines.join("\n")
}
