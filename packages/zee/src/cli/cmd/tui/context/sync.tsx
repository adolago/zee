import type {
  Message,
  Agent,
  Provider,
  Session,
  Part,
  Config,
  Todo,
  CommandListResponse,
  PermissionRequest,
  QuestionRequest,
  LspStatus,
  McpStatus,
  McpResource,
  FormatterStatus,
  SessionStatus,
  ProviderListResponse,
  ProviderAuthMethod,
  VcsInfo,
} from "@zee/sdk/v2"
import { createStore, produce, reconcile } from "solid-js/store"
import { useSDK } from "@tui/context/sdk"
import { Binary } from "@zee/util/binary"
import { createSimpleContext } from "./helper"
import type { Snapshot } from "@/snapshot"
import { useExit } from "./exit"
import { useArgs } from "./args"
import { batch, onCleanup, onMount } from "solid-js"
import { Log } from "@/util/log"
import type { Path } from "@zee/sdk/v2"
import { useToast } from "../ui/toast"
import { createAuthorizedFetch } from "@/server/auth"
import { createBufferedUpdater } from "./buffered-updater"

export const { use: useSync, provider: SyncProvider } = createSimpleContext({
  name: "Sync",
  init: () => {
    type CommandItem = CommandListResponse extends Array<infer T> ? T : never
    const [store, setStore] = createStore<{
      status: "loading" | "partial" | "complete"
      provider: Provider[]
      provider_default: Record<string, string>
      provider_next: ProviderListResponse
      provider_auth: Record<string, ProviderAuthMethod[]>
      agent: Agent[]
      command: CommandItem[]
      permission: {
        [sessionID: string]: PermissionRequest[]
      }
      question: {
        [sessionID: string]: QuestionRequest[]
      }
      config: Config
      session: Session[]
      session_status: {
        [sessionID: string]: SessionStatus
      }
      session_diff: {
        [sessionID: string]: Snapshot.FileDiff[]
      }
      todo: {
        [sessionID: string]: Todo[]
      }
      message: {
        [sessionID: string]: Message[]
      }
      part: {
        [messageID: string]: Part[]
      }
      lsp: LspStatus[]
      mcp: {
        [key: string]: McpStatus
      }
      mcp_resource: {
        [key: string]: McpResource
      }
      formatter: FormatterStatus[]
      vcs: VcsInfo | undefined
      path: Path
      daemon?: {
        healthy?: boolean
        version?: string
        channel?: string
        mode?: "source" | "binary"
        execPath?: string
        entry?: string
        pid?: number
        packageVersion?: string
        execModifiedAt?: string
        execModifiedTs?: number
        entryModifiedAt?: string
        entryModifiedTs?: number
        legacy?: boolean
        gateway?: { running: boolean; enabled: boolean; error?: string }
      }
      health: {
        internet: "ok" | "fail" | "checking"
        providers: { id: string; name: string; status: "ok" | "fail" | "skip" }[]
        memory?: { status: "ok" | "fail"; error?: string }
      }
    }>({
      provider_next: {
        all: [],
        default: {},
        connected: [],
      },
      provider_auth: {},
      config: {},
      status: "loading",
      agent: [],
      permission: {},
      question: {},
      command: [],
      provider: [],
      provider_default: {},
      session: [],
      session_status: {},
      session_diff: {},
      todo: {},
      message: {},
      part: {},
      lsp: [],
      mcp: {},
      mcp_resource: {},
      formatter: [],
      vcs: undefined,
      path: { state: "", config: "", worktree: "", directory: "", home: "" },
      daemon: undefined,
      health: { internet: "checking", providers: [] },
    })

    function normalizeDaemonHealth(data: unknown) {
      if (data && typeof data === "object") {
        const record = data as Record<string, unknown>
        const mode =
          record.mode === "source" || record.mode === "binary"
            ? (record.mode as "source" | "binary")
            : undefined
        return {
          healthy: typeof record.healthy === "boolean" ? record.healthy : true,
          version: typeof record.version === "string" ? record.version : undefined,
          channel: typeof record.channel === "string" ? record.channel : undefined,
          mode,
          execPath: typeof record.execPath === "string" ? record.execPath : undefined,
          entry: typeof record.entry === "string" ? record.entry : undefined,
          pid: typeof record.pid === "number" ? record.pid : undefined,
          packageVersion: typeof record.packageVersion === "string" ? record.packageVersion : undefined,
          execModifiedAt: typeof record.execModifiedAt === "string" ? record.execModifiedAt : undefined,
          execModifiedTs: typeof record.execModifiedTs === "number" ? record.execModifiedTs : undefined,
          entryModifiedAt: typeof record.entryModifiedAt === "string" ? record.entryModifiedAt : undefined,
          entryModifiedTs: typeof record.entryModifiedTs === "number" ? record.entryModifiedTs : undefined,
          legacy: false,
          gateway: record.gateway && typeof record.gateway === "object"
            ? {
                running: typeof (record.gateway as Record<string, unknown>).running === "boolean" ? (record.gateway as Record<string, unknown>).running as boolean : false,
                enabled: typeof (record.gateway as Record<string, unknown>).enabled === "boolean" ? (record.gateway as Record<string, unknown>).enabled as boolean : false,
                error: typeof (record.gateway as Record<string, unknown>).error === "string" ? (record.gateway as Record<string, unknown>).error as string : undefined,
              }
            : undefined,
        }
      }
      if (typeof data === "boolean") {
        return {
          healthy: data,
          legacy: true,
        }
      }
      return undefined
    }

    const sdk = useSDK()
    const toast = useToast()

    const bufferedPartUpdates = createBufferedUpdater<Part>({
      key: (p) => `${p.messageID}:${p.id}`,
      // Coalesce part updates into fewer store writes per render frame.
      // At 30fps (33ms/frame), 16ms batches ~2 flushes per frame instead
      // of ~6-7, reducing cascading signal re-evaluations during streaming.
      flushMs: 16,
      apply: (parts) => {
        batch(() => {
          for (const part of parts) {
            const existing = store.part[part.messageID]
            if (!existing) {
              setStore("part", part.messageID, [part])
              continue
            }
            const result = Binary.search(existing, part.id, (p) => p.id)
            if (result.found) {
              setStore("part", part.messageID, result.index, reconcile(part))
              continue
            }
            setStore(
              "part",
              part.messageID,
              produce((draft) => {
                draft.splice(result.index, 0, part)
              }),
            )
          }
        })
      },
    })

    sdk.event.listen((e) => {
      const event = e.details
      switch (event.type) {
        case "server.instance.disposed":
          bootstrap()
          break
        case "permission.replied": {
          const requests = store.permission[event.properties.sessionID]
          if (!requests) break
          const match = Binary.search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "permission",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "permission.asked": {
          const request = event.properties
          const requests = store.permission[request.sessionID]
          if (!requests) {
            setStore("permission", request.sessionID, [request])
            break
          }
          const match = Binary.search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("permission", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "permission",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        }

        case "question.replied":
        case "question.rejected": {
          const requests = store.question[event.properties.sessionID]
          if (!requests) break
          const match = Binary.search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "question",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "question.asked": {
          const request = event.properties
          const requests = store.question[request.sessionID]
          if (!requests) {
            setStore("question", request.sessionID, [request])
            break
          }
          const match = Binary.search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("question", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "question",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        }

        case "todo.updated":
          setStore("todo", event.properties.sessionID, event.properties.todos)
          break

        case "session.diff":
          setStore("session_diff", event.properties.sessionID, event.properties.diff)
          break

        case "session.deleted": {
          const result = Binary.search(store.session, event.properties.info.id, (s) => s.id)
          if (result.found) {
            setStore(
              "session",
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          break
        }
        case "session.updated": {
          const result = Binary.search(store.session, event.properties.info.id, (s) => s.id)
          if (result.found) {
            setStore("session", result.index, reconcile(event.properties.info))
            break
          }
          setStore(
            "session",
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.info)
            }),
          )
          break
        }

        case "session.status": {
          setStore("session_status", event.properties.sessionID, event.properties.status)
          break
        }

        case "message.updated": {
          const messages = store.message[event.properties.info.sessionID]
          if (!messages) {
            setStore("message", event.properties.info.sessionID, [event.properties.info])
            break
          }
          const result = Binary.search(messages, event.properties.info.id, (m) => m.id)
          if (result.found) {
            setStore("message", event.properties.info.sessionID, result.index, reconcile(event.properties.info))
            break
          }
          setStore(
            "message",
            event.properties.info.sessionID,
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.info)
            }),
          )
          const updated = store.message[event.properties.info.sessionID]
          if (updated.length > 100) {
            const oldest = updated[0]
            batch(() => {
              setStore(
                "message",
                event.properties.info.sessionID,
                produce((draft) => {
                  draft.shift()
                }),
              )
              setStore(
                "part",
                produce((draft) => {
                  delete draft[oldest.id]
                }),
              )
            })
          }
          break
        }
        case "message.removed": {
          const messages = store.message[event.properties.sessionID]
          if (!messages) break
          const result = Binary.search(messages, event.properties.messageID, (m) => m.id)
          if (result.found) {
            setStore(
              "message",
              event.properties.sessionID,
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          break
        }
        case "message.part.updated": {
          bufferedPartUpdates.push(event.properties.part)
          break
        }

        case "message.part.removed": {
          // Ensure any pending updates are applied before removing.
          bufferedPartUpdates.flushNow()
          const parts = store.part[event.properties.messageID]
          if (!parts) break
          const result = Binary.search(parts, event.properties.partID, (p) => p.id)
          if (result.found)
            setStore(
              "part",
              event.properties.messageID,
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          break
        }

        case "lsp.updated": {
          sdk.client.lsp.status().then((x) => setStore("lsp", x.data!))
          break
        }

        case "mcp.tools.changed": {
          void refreshMcpStatus()
          break
        }

        case "vcs.branch.updated": {
          setStore("vcs", { branch: event.properties.branch })
          break
        }
      }
    })

    const exit = useExit()
    const args = useArgs()
    let mcpRefreshInFlight: Promise<void> | undefined
    const MCP_STATUS_POLL_MS = 5_000

    async function refreshMcpStatus() {
      if (mcpRefreshInFlight) return mcpRefreshInFlight
      mcpRefreshInFlight = sdk.client.mcp
        .status()
        .then((x) => {
          if (x.data) {
            setStore("mcp", reconcile(x.data))
          }
        })
        .catch((error) => {
          Log.Default.debug("mcp status refresh failed", {
            error: error instanceof Error ? error.message : String(error),
          })
        })
        .finally(() => {
          mcpRefreshInFlight = undefined
        })
      return mcpRefreshInFlight
    }

    async function bootstrap() {
      const start = Date.now() - 30 * 24 * 60 * 60 * 1000
      
      // Create promises for all blocking requests - don't setStore in .then()
      // This avoids inconsistent intermediate state (e.g. agents briefly undefined)
      const sessionListPromise = sdk.client.session
        .list({ start: start })
        .then((x) => (x.data ?? []).toSorted((a, b) => a.id.localeCompare(b.id)))

      const providersPromise = sdk.client.config.providers({ throwOnError: true })
      const providerListPromise = sdk.client.provider.list({ throwOnError: true })
      const agentsPromise = sdk.client.app.agents({ throwOnError: true })
      const configPromise = sdk.client.config.get({ throwOnError: true })

      // blocking - include session.list when continuing a session
      const blockingRequests: Promise<unknown>[] = [
        providersPromise,
        providerListPromise,
        agentsPromise,
        configPromise,
        ...(args.continue ? [sessionListPromise] : []),
      ]

      await Promise.all(blockingRequests)
        .then(async () => {
          // Now extract all responses and apply in a single batch
          const providersResponse = await providersPromise
          const providerListResponse = await providerListPromise
          const agentsResponse = await agentsPromise
          const configResponse = await configPromise
          const sessionsResponse = args.continue ? await sessionListPromise : undefined

          // Validate agents response
          const agents = Array.isArray(agentsResponse.data) ? agentsResponse.data : []
          if (!Array.isArray(agentsResponse.data)) {
            Log.Default.error("agents response invalid", { type: typeof agentsResponse.data })
            toast.show({
              variant: "error",
              message: "Agents failed to load (invalid response). Check the daemon status.",
              duration: 5000,
            })
          } else if (agents.length === 0) {
            toast.show({
              variant: "error",
              message: "No agents loaded. Check zee config and restart the daemon.",
              duration: 5000,
            })
          }

          // Apply ALL initial state in a single batch to avoid inconsistent intermediate state
          batch(() => {
            if (providersResponse.data) {
              setStore("provider", reconcile(providersResponse.data.providers ?? []))
              setStore("provider_default", reconcile(providersResponse.data.default ?? []))
            }
            if (providerListResponse.data) {
              setStore("provider_next", reconcile(providerListResponse.data))
            }
            setStore("agent", reconcile(agents))
            if (configResponse.data) {
              setStore("config", reconcile(configResponse.data))
            }
            if (sessionsResponse !== undefined) {
              setStore("session", reconcile(sessionsResponse))
            }
          })
        })
        .then(() => {
          if (store.status !== "complete") setStore("status", "partial")
          // non-blocking
          Promise.all([
            ...(args.continue ? [] : [sessionListPromise.then((sessions) => setStore("session", reconcile(sessions)))]),
            sdk.client.command.list().then((x) => setStore("command", reconcile(x.data ?? []))),
            sdk.client.lsp.status().then((x) => setStore("lsp", reconcile(x.data!))),
            refreshMcpStatus(),
            sdk.client.experimental.resource.list().then((x) => setStore("mcp_resource", reconcile(x.data ?? {}))),
            sdk.client.formatter.status().then((x) => setStore("formatter", reconcile(x.data!))),
            sdk.client.session.status().then((x) => {
              setStore("session_status", reconcile(x.data!))
            }),
            sdk.client.provider.auth().then((x) => setStore("provider_auth", reconcile(x.data ?? {}))),
            sdk.client.vcs.get().then((x) => setStore("vcs", reconcile(x.data))),
            sdk.client.path.get().then((x) => {
              if (x.data) {
                setStore("path", reconcile(x.data))
              }
            }),
            createAuthorizedFetch(fetch)(`${sdk.url}/global/health`)
              .then((res) => res.json())
              .then((data) => {
                const normalized = normalizeDaemonHealth(data)
                setStore("daemon", normalized ? reconcile(normalized) : undefined)
              })
              .catch(() => setStore("daemon", undefined)),
            // Fetch health status (internet + providers)
            createAuthorizedFetch(fetch)(`${sdk.url}/global/health/status`)
              .then((res) => res.json())
              .then(
                (data: {
                  internet: "ok" | "fail" | "checking"
                  providers: { id: string; name: string; status: "ok" | "fail" | "skip" }[]
                  memory?: { status: "ok" | "fail"; error?: string }
                }) => {
                  setStore("health", reconcile(data))
                  if (data.memory?.status === "fail") {
                    const trimmed = data.memory.error?.replace(/\s+/g, " ").slice(0, 200)
                    const detail = trimmed ? `: ${trimmed}` : ""
                    toast.show({
                      variant: "error",
                      message: `Memory backend unavailable${detail}`,
                      duration: 7000,
                    })
                  }
                },
              )
              .catch(() => setStore("health", "internet", "fail")),
          ]).then(() => {
            setStore("status", "complete")
          })
        })
        .catch(async (e) => {
          Log.Default.error("tui bootstrap failed", {
            error: e instanceof Error ? e.message : String(e),
            name: e instanceof Error ? e.name : undefined,
            stack: e instanceof Error ? e.stack : undefined,
          })
          await exit(e)
        })
    }

    onMount(() => {
      void bootstrap()
      const mcpPoll = setInterval(() => {
        void refreshMcpStatus()
      }, MCP_STATUS_POLL_MS)
      onCleanup(() => {
        clearInterval(mcpPoll)
      })
    })

    const fullSyncedSessions = new Set<string>()
    const result = {
      data: store,
      set: setStore,
      get status() {
        return store.status
      },
      get ready() {
        return store.status !== "loading"
      },
      session: {
        get(sessionID: string) {
          const match = Binary.search(store.session, sessionID, (s) => s.id)
          if (match.found) return store.session[match.index]
          return undefined
        },
        status(sessionID: string) {
          const session = result.session.get(sessionID)
          if (!session) return "idle"
          if (session.time.compacting) return "compacting"
          const messages = store.message[sessionID] ?? []
          const last = messages.at(-1)
          if (!last) return "idle"
          if (last.role === "user") return "working"
          return last.time.completed ? "idle" : "working"
        },
        async sync(sessionID: string) {
          if (fullSyncedSessions.has(sessionID)) return
          const [session, messages, todo, diff] = await Promise.all([
            sdk.client.session.get({ sessionID }, { throwOnError: true }),
            sdk.client.session.messages({ sessionID, limit: 100 }),
            sdk.client.session.todo({ sessionID }),
            sdk.client.session.diff({ sessionID }),
          ])
          setStore(
            produce((draft) => {
              if (session.data) {
                const match = Binary.search(draft.session, sessionID, (s) => s.id)
                if (match.found) draft.session[match.index] = session.data
                if (!match.found) draft.session.splice(match.index, 0, session.data)
              }
              draft.todo[sessionID] = todo.data ?? []
              if (messages.data) {
                draft.message[sessionID] = messages.data.map((x) => x.info)
                for (const message of messages.data) {
                  draft.part[message.info.id] = message.parts
                }
              }
              draft.session_diff[sessionID] = diff.data ?? []
            }),
          )
          fullSyncedSessions.add(sessionID)
        },
      },
      bootstrap,
    }
    return result
  },
})
