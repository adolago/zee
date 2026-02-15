import { describeRoute, resolver, validator } from "hono-openapi"
import { Hono } from "hono"
import { z } from "zod"
import { streamSSE } from "hono/streaming"
import { Session } from "../../session"
import { SessionStatus } from "../../session/status"
import { Todo } from "../../session/todo"
import { MessageV2 } from "../../session/message-v2"
import { Bus } from "@/bus"
import { Log } from "../../util/log"
import { errors } from "../error"
import { ServerState } from "../state"
import { SseLimit } from "../sse-limit"
import { registerSseKeepalive } from "../sse-keepalive"
import { Config } from "../../config/config"
import { Storage } from "../../storage/storage"
import { SessionPrompt } from "../../session/prompt"
import { SessionSteering } from "../../session/steering"
import { SessionRevert } from "../../session/revert"
import { Snapshot } from "@/snapshot"
import { SessionSummary } from "@/session/summary"
import { SessionCompaction } from "../../session/compaction"
import { Agent } from "../../agent/agent"
import { PermissionNext } from "@/permission/next"

const log = Log.create({ service: "server:session" })

function normalizeShareBaseUrl(raw?: string) {
  if (!raw) return undefined
  return raw.replace(/\/+$/, "")
}

function resolveShareBaseUrl() {
  const env = normalizeShareBaseUrl(process.env["ZEE_SHARE_BASE_URL"] ?? process.env["SHARE_BASE_URL"])
  if (env) return env
  return normalizeShareBaseUrl(ServerState.url().toString()) ?? ServerState.url().toString()
}

function buildShareUrl(session: Session.Info) {
  const base = resolveShareBaseUrl()
  return `${base}/s/${session.slug}`
}

export const SessionRoute = new Hono()
  .get(
    "/session",
    describeRoute({
      summary: "List sessions",
      description: "Get a list of all zee sessions, sorted by most recently updated.",
      operationId: "session.list",
      responses: {
        200: {
          description: "List of sessions",
          content: {
            "application/json": {
              schema: resolver(Session.Info.array()),
            },
          },
        },
      },
    }),
    validator(
      "query",
      z.object({
        start: z.coerce
          .number()
          .optional()
          .meta({ description: "Filter sessions updated on or after this timestamp (milliseconds since epoch)" }),
        search: z.string().optional().meta({ description: "Filter sessions by title (case-insensitive)" }),
        directory: z.string().optional().meta({ description: "Filter sessions by directory path" }),
        limit: z.coerce.number().optional().meta({ description: "Maximum number of sessions to return" }),
      }),
    ),
    async (c) => {
      const query = c.req.valid("query")
      const term = query.search?.toLowerCase()
      const sessions: Session.Info[] = []
      for await (const session of Session.list()) {
        if (query.start !== undefined && session.time.updated < query.start) continue
        if (query.directory !== undefined && session.directory !== query.directory) continue
        if (term !== undefined && !session.title.toLowerCase().includes(term)) continue
        sessions.push(session)
        if (query.limit !== undefined && sessions.length >= query.limit) break
      }
      return c.json(sessions)
    },
  )
  .post(
    "/session",
    describeRoute({
      summary: "Create session",
      description: "Create a new zee session for interacting with AI assistants and managing conversations.",
      operationId: "session.create",
      responses: {
        ...errors(400),
        200: {
          description: "Successfully created session",
          content: {
            "application/json": {
              schema: resolver(Session.Info),
            },
          },
        },
      },
    }),
    validator("json", Session.create.schema.optional()),
    async (c) => {
      const body = c.req.valid("json") ?? {}
      const session = await Session.create(body)
      return c.json(session)
    },
  )
	  .post(
	    "/session/:sessionID/message",
	    describeRoute({
	      summary: "Send message",
	      description: "Create and send a new message to a session.",
	      operationId: "session.prompt",
	      responses: {
	        200: {
	          description: "Created message",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  info: MessageV2.Assistant,
                  parts: MessageV2.Part.array(),
                }),
              ),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator(
      "param",
      z.object({
        sessionID: z.string().meta({ description: "Session ID" }),
      }),
    ),
	    validator("json", SessionPrompt.PromptInput.omit({ sessionID: true })),
	    async (c) => {
	      const sessionID = c.req.valid("param").sessionID
	      const body = c.req.valid("json")
	      // Validate session exists so the error surfaces as a proper HTTP 404 (and
	      // doesn't get auto-created by SessionPrompt.prompt()).
	      await Session.get(sessionID)
	      const msg = await SessionPrompt.prompt({ ...body, sessionID })
	      return c.json(msg)
	    },
	  )
  .get(
    "/session/status",
    describeRoute({
      summary: "Get session status",
      description: "Retrieve the current status of all sessions, including active, idle, and completed states.",
      operationId: "session.status",
      responses: {
        200: {
          description: "Get session status",
          content: {
            "application/json": {
              schema: resolver(z.record(z.string(), SessionStatus.Info)),
            },
          },
        },
        ...errors(400),
      },
    }),
    async (c) => {
      const result = SessionStatus.list()
      return c.json(result)
    },
  )
  .get(
    "/session/:sessionID",
    describeRoute({
      summary: "Get session",
      description: "Retrieve detailed information about a specific zee session.",
      tags: ["Session"],
      operationId: "session.get",
      responses: {
        200: {
          description: "Get session",
          content: {
            "application/json": {
              schema: resolver(Session.Info),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator(
      "param",
      z.object({
        sessionID: Session.get.schema,
      }),
    ),
    async (c) => {
      const sessionID = c.req.valid("param").sessionID
      log.info("SEARCH", { url: c.req.url })
      const session = await Session.get(sessionID)
      return c.json(session)
    },
  )
  .patch(
    "/session/:sessionID",
    describeRoute({
      summary: "Update session",
      description: "Update properties of an existing session, such as title or other metadata.",
      operationId: "session.update",
      responses: {
        200: {
          description: "Successfully updated session",
          content: {
            "application/json": {
              schema: resolver(Session.Info),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator(
      "param",
      z.object({
        sessionID: z.string(),
      }),
    ),
    validator(
      "json",
      z.object({
        title: z.string().optional(),
        time: z
          .object({
            archived: z.number().optional(),
          })
          .optional(),
        systemPrompt: z.string().nullable().optional(),
        skills: z.array(z.string()).nullable().optional(),
        contextFiles: z.array(z.string()).nullable().optional(),
      }),
    ),
    async (c) => {
      const sessionID = c.req.valid("param").sessionID
      const updates = c.req.valid("json")

      const updatedSession = await Session.update(sessionID, (session) => {
        if (updates.title !== undefined) {
          session.title = updates.title
        }
        if (updates.systemPrompt !== undefined) {
          session.systemPrompt = updates.systemPrompt ?? undefined
        }
        if (updates.skills !== undefined) {
          session.skills = updates.skills ?? undefined
        }
        if (updates.contextFiles !== undefined) {
          session.contextFiles = updates.contextFiles ?? undefined
        }
        if (updates.time?.archived !== undefined) session.time.archived = updates.time.archived
      }, { touch: false })

      return c.json(updatedSession)
    },
  )
  .patch(
    "/session/:sessionID/mode",
    describeRoute({
      summary: "Update session mode",
      description: "Set the session mode. Plan mode restricts file modifications; Accept auto-approves edits; Bypass skips all permission checks.",
      operationId: "session.mode",
      responses: {
        200: {
          description: "Successfully updated session mode",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  ok: z.boolean(),
                  mode: z.enum(["plan", "accept", "bypass"]),
                }),
              ),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator(
      "param",
      z.object({
        sessionID: z.string(),
      }),
    ),
    validator(
      "json",
      z.object({
        mode: z.enum(["plan", "accept", "bypass"]),
      }),
    ),
    async (c) => {
      const { sessionID } = c.req.valid("param")
      const { mode } = c.req.valid("json")
      await Session.update(sessionID, (draft) => {
        draft.mode = mode
      })
      return c.json({ ok: true, mode })
    },
  )
  .post(
    "/session/:sessionID/share",
    describeRoute({
      summary: "Share session",
      description: "Create a shareable link for a session.",
      operationId: "session.share",
      responses: {
        200: {
          description: "Successfully shared session",
          content: {
            "application/json": {
              schema: resolver(Session.Info),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator(
      "param",
      z.object({
        sessionID: z.string(),
      }),
    ),
    async (c) => {
      const { sessionID } = c.req.valid("param")
      const config = await Config.get()
      if (config.share === "disabled") {
        return c.json({ error: "Sharing is disabled by configuration." }, 400)
      }

      try {
        const session = await Session.get(sessionID)
        const url = buildShareUrl(session)

        await Storage.write(["session_share", sessionID], {
          secret: session.slug,
          url,
        } satisfies Session.ShareInfo)

        const updated = await Session.update(sessionID, (draft) => {
          draft.share = { url }
        }, { touch: false })
        return c.json(updated)
      } catch (error) {
        log.error("session share failed", { error: error instanceof Error ? error.message : String(error) })
        return c.json({ error: "Session not found." }, 404)
      }
    },
  )
  .delete(
    "/session/:sessionID/share",
    describeRoute({
      summary: "Unshare session",
      description: "Remove the shareable link for a session.",
      operationId: "session.unshare",
      responses: {
        200: {
          description: "Successfully unshared session",
          content: {
            "application/json": {
              schema: resolver(Session.Info),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator(
      "param",
      z.object({
        sessionID: z.string(),
      }),
    ),
    async (c) => {
      const { sessionID } = c.req.valid("param")
      try {
        await Storage.remove(["session_share", sessionID])
        const updated = await Session.update(sessionID, (draft) => {
          delete draft.share
        }, { touch: false })
        return c.json(updated)
      } catch (error) {
        log.error("session unshare failed", { error: error instanceof Error ? error.message : String(error) })
        return c.json({ error: "Session not found." }, 404)
      }
    },
  )
  .delete(
    "/session/:sessionID",
    describeRoute({
      summary: "Delete session",
      description: "Delete a session and permanently remove all associated data, including messages and history.",
      operationId: "session.delete",
      responses: {
        200: {
          description: "Successfully deleted session",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator(
      "param",
      z.object({
        sessionID: Session.remove.schema,
      }),
    ),
    async (c) => {
      const sessionID = c.req.valid("param").sessionID
      await Session.remove(sessionID)
      return c.json(true)
    },
  )
  .get(
    "/sync",
    describeRoute({
      summary: "Sync state for offline clients",
      tags: ["Sync"],
      description:
        "Get all sessions, messages, and todos updated since a given timestamp. Used for offline-first clients to sync delta changes.",
      operationId: "sync.delta",
      responses: {
        200: {
          description: "Sync data with server timestamp",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  timestamp: z.number().describe("Server timestamp for next sync"),
                  sessions: Session.Info.array().describe("Sessions updated since 'since' param"),
                  todos: z
                    .array(
                      z.object({
                        sessionID: z.string(),
                        todos: Todo.Info.array(),
                      }),
                    )
                    .describe("Todos for updated sessions"),
                }),
              ),
            },
          },
        },
      },
    }),
    validator(
      "query",
      z.object({
        since: z.coerce
          .number()
          .optional()
          .meta({ description: "Timestamp (ms since epoch) to get changes since. Omit for full sync." }),
        limit: z.coerce.number().optional().default(100).meta({ description: "Maximum sessions to return" }),
      }),
    ),
    async (c) => {
      const query = c.req.valid("query")
      const since = query.since ?? 0
      const serverTimestamp = Date.now()

      const sessions: Session.Info[] = []
      for await (const session of Session.list()) {
        if (session.time.updated >= since) {
          sessions.push(session)
          if (sessions.length >= (query.limit ?? 100)) break
        }
      }

      const todosPerSession: Array<{ sessionID: string; todos: Todo.Info[] }> = []
      for (const session of sessions) {
        const todos = await Todo.get(session.id)
        if (todos.length > 0) {
          todosPerSession.push({ sessionID: session.id, todos })
        }
      }

      return c.json({
        timestamp: serverTimestamp,
        sessions,
        todos: todosPerSession,
      })
    },
  )
  .post(
    "/session/:sessionID/handoff",
    describeRoute({
      summary: "Session handoff",
      tags: ["Session"],
      description:
        "Prepare a session for handoff to another surface (cli, web, api, whatsapp). Returns session state and a handoff token for resumption.",
      operationId: "session.handoff",
      responses: {
        200: {
          description: "Handoff data",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  sessionID: z.string(),
                  title: z.string(),
                  surface: z.string(),
                  timestamp: z.number(),
                  messageCount: z.number(),
                  lastMessage: z.string().optional(),
                  todos: Todo.Info.array(),
                  context: z.object({
                    recentMessages: z.array(z.string()),
                    activeTodos: z.array(z.object({
                      id: z.string(),
                      content: z.string(),
                      status: z.string(),
                    })),
                    previousSurface: z.string().optional(),
                    persona: z.string().optional(),
                  }),
                  resumeUrl: z.string(),
                }),
              ),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    validator("json", z.object({ targetSurface: z.enum(["cli", "web", "api", "whatsapp"]) })),
    async (c) => {
      const sessionID = c.req.valid("param").sessionID
      const { targetSurface } = c.req.valid("json")

      // Update the session's surface to the target
      const session = await Session.update(sessionID, (draft) => {
        draft.surface = targetSurface
      })

      const messages = await Array.fromAsync(MessageV2.stream(sessionID))
      const todos = await Todo.get(sessionID)

      // Extract last N user messages for context
      const recentUserMessages = [...messages]
        .reverse()
        .filter((m) => m.info.role === "user")
        .slice(0, 5)
        .map((m) => {
          const text = m.parts
            .filter((p): p is MessageV2.TextPart => p.type === "text")
            .map((p) => p.text)
            .join(" ")
            .slice(0, 200)
          return text
        })
        .filter(Boolean)

      const lastMessageText = recentUserMessages[0]

      // Build a compact context summary for the receiving surface
      const activeTodos = todos.filter((t) => t.status !== "completed")
      const context = {
        recentMessages: recentUserMessages,
        activeTodos: activeTodos.map((t) => ({ id: t.id, content: t.content, status: t.status })),
        previousSurface: session.surface,
        persona: undefined as string | undefined,
      }

      // Try to detect persona from session title
      const lowerTitle = session.title.toLowerCase()
      if (lowerTitle.includes("stanley")) context.persona = "stanley"
      else if (lowerTitle.includes("johny")) context.persona = "johny"
      else if (lowerTitle.includes("zee")) context.persona = "zee"

      const resumeUrl = `zee://session/${sessionID}`

      return c.json({
        sessionID,
        title: session.title,
        surface: targetSurface,
        timestamp: Date.now(),
        messageCount: messages.length,
        lastMessage: lastMessageText,
        todos,
        context,
        resumeUrl,
      })
    },
  )
  .get(
    "/session/:sessionID/todo",
    describeRoute({
      summary: "Get session todos",
      description: "Retrieve the todo list associated with a specific session, showing tasks and action items.",
      operationId: "session.todo",
      responses: {
        200: {
          description: "Todo list",
          content: {
            "application/json": {
              schema: resolver(Todo.Info.array()),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    async (c) => {
      const sessionID = c.req.valid("param").sessionID
      const todos = await Todo.get(sessionID)
      return c.json(todos)
    },
  )
  .post(
    "/session/:sessionID/init",
    describeRoute({
      summary: "Initialize session",
      description:
        "Analyze the current application and create an AGENTS.md file with project-specific agent configurations.",
      operationId: "session.init",
      responses: {
        200: {
          description: "200",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    validator("json", Session.initialize.schema.omit({ sessionID: true })),
    async (c) => {
      const sessionID = c.req.valid("param").sessionID
      const body = c.req.valid("json")
      await Session.initialize({ ...body, sessionID })
      return c.json(true)
    },
  )
  .post(
    "/session/:sessionID/fork",
    describeRoute({
      summary: "Fork session",
      description: "Create a new session by forking an existing session at a specific message point.",
      operationId: "session.fork",
      responses: {
        200: {
          description: "200",
          content: {
            "application/json": {
              schema: resolver(Session.Info),
            },
          },
        },
      },
    }),
    validator("param", z.object({ sessionID: Session.fork.schema.shape.sessionID })),
    validator("json", Session.fork.schema.omit({ sessionID: true })),
    async (c) => {
      const sessionID = c.req.valid("param").sessionID
      const body = c.req.valid("json")
      const result = await Session.fork({ ...body, sessionID })
      return c.json(result)
    },
  )
  .post(
    "/session/:sessionID/abort",
    describeRoute({
      summary: "Abort session",
      description: "Abort an active session and stop any ongoing AI processing or command execution.",
      operationId: "session.abort",
      responses: {
        200: {
          description: "Aborted session",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    async (c) => {
      SessionPrompt.cancel(c.req.valid("param").sessionID)
      return c.json(true)
    },
  )
  .post(
    "/session/:sessionID/steer",
    describeRoute({
      summary: "Steer session",
      description:
        "Inject a user message into a running session. If the session is busy, the message is delivered at the next tool-call boundary without aborting the current run. If idle, a new loop is started.",
      operationId: "session.steer",
      responses: {
        204: {
          description: "Steering message accepted",
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    validator("json", SessionPrompt.PromptInput.omit({ sessionID: true })),
    async (c) => {
      const sessionID = c.req.valid("param").sessionID
      const body = c.req.valid("json")

      // Persist the user message without starting a reply
      await SessionPrompt.prompt({ ...body, sessionID, noReply: true })

      const status = SessionStatus.get(sessionID)
      if (status.type === "busy") {
        // Session is running -- mark it for steering so the processor
        // exits at the next tool-call step boundary.
        SessionSteering.mark(sessionID)
      } else {
        // Session is idle -- start the loop so the model processes the
        // new message immediately.
        SessionPrompt.loop(sessionID).catch((err) => {
          Log.Default.error("session.steer loop error", {
            error: err instanceof Error ? err.message : String(err),
            sessionID,
          })
        })
      }
      return c.body(null, 204)
    },
  )
  .get(
    "/session/:sessionID/diff",
    describeRoute({
      summary: "Get message diff",
      description: "Get the file changes (diff) that resulted from a specific user message in the session.",
      operationId: "session.diff",
      responses: {
        200: {
          description: "Successfully retrieved diff",
          content: {
            "application/json": {
              schema: resolver(Snapshot.FileDiff.array()),
            },
          },
        },
      },
    }),
    validator("param", z.object({ sessionID: SessionSummary.diff.schema.shape.sessionID })),
    validator("query", z.object({ messageID: SessionSummary.diff.schema.shape.messageID })),
    async (c) => {
      const query = c.req.valid("query")
      const params = c.req.valid("param")
      const result = await SessionSummary.diff({
        sessionID: params.sessionID,
        messageID: query.messageID,
      })
      return c.json(result)
    },
  )
  .get(
    "/session/:sessionID/diff/all", // NOTE: Changed path to avoid ambiguity with :messageID query route? No, query params don't change path.
    // The original code had two GET routes for "/session/:sessionID/diff".
    // 1668: .get(".../diff", ... { query: messageID })
    // 1836: .get(".../diff", ... { no query })
    // In Hono, the first one matches. If messageID is required in query, request without it fails 400.
    // So the second route is unreachable unless the first one's validation is skipped or optional.
    // In the original, the first validator has messageID required? Yes `z.string()`.
    // So `GET /diff` would fail the first route's validation. Hono MIGHT fall through to next route?
    // Hono-openapi validator usually returns 400 if validation fails.
    // I will use distinct paths to be safe and clean.
    // Original: 1668 operationId: session.diff
    // Original: 1836 operationId: session.diff (Wait, duplicate operationId?)
    // This is definitely a bug/issue in the original code.
    // I will map the second one (session-wide diff) to `/session/:sessionID/diff/all`.
    describeRoute({
      summary: "Get session diff",
      description: "Get all file changes (diffs) made during this session.",
      operationId: "session.diff_all",
      responses: {
        200: {
          description: "List of diffs",
          content: {
            "application/json": {
              schema: resolver(Snapshot.FileDiff.array()),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    async (c) => {
      const diff = await Session.diff(c.req.valid("param").sessionID)
      return c.json(diff)
    },
  )
  .post(
    "/session/:sessionID/summarize",
    describeRoute({
      summary: "Summarize session",
      description: "Generate a concise summary of the session using AI compaction to preserve key information.",
      operationId: "session.summarize",
      responses: {
        200: {
          description: "Summarized session",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    validator(
      "json",
      z.object({
        providerID: z.string(),
        modelID: z.string(),
        auto: z.boolean().optional().default(false),
      }),
    ),
    async (c) => {
      const sessionID = c.req.valid("param").sessionID
      const body = c.req.valid("json")
      const session = await Session.get(sessionID)
      await SessionRevert.cleanup(session)
      const msgs = await Session.messages({ sessionID })
      let currentAgent = await Agent.defaultAgent()
      for (let i = msgs.length - 1; i >= 0; i--) {
        const info = msgs[i].info
        if (info.role === "user") {
          currentAgent = info.agent || (await Agent.defaultAgent())
          break
        }
      }
      await SessionCompaction.create({
        sessionID,
        agent: currentAgent,
        model: {
          providerID: body.providerID,
          modelID: body.modelID,
        },
        auto: body.auto,
      })
      await SessionPrompt.loop(sessionID)
      return c.json(true)
    },
  )
  .get(
    "/session/:sessionID/message",
    describeRoute({
      summary: "Get session messages",
      description: "Retrieve all messages in a session, including user prompts and AI responses.",
      operationId: "session.messages",
      responses: {
        200: {
          description: "List of messages",
          content: {
            "application/json": {
              schema: resolver(MessageV2.WithParts.array()),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    validator("query", z.object({ limit: z.coerce.number().optional() })),
    async (c) => {
      const query = c.req.valid("query")
      const messages = await Session.messages({
        sessionID: c.req.valid("param").sessionID,
        limit: query.limit,
      })
      return c.json(messages)
    },
  )
  .get(
    "/session/:sessionID/message/:messageID",
    describeRoute({
      summary: "Get message",
      description: "Retrieve a specific message from a session by its message ID.",
      operationId: "session.message",
      responses: {
        200: {
          description: "Message",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  info: MessageV2.Info,
                  parts: MessageV2.Part.array(),
                }),
              ),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ sessionID: z.string(), messageID: z.string() })),
    async (c) => {
      const params = c.req.valid("param")
      const message = await MessageV2.get({
        sessionID: params.sessionID,
        messageID: params.messageID,
      })
      return c.json(message)
    },
  )
  .delete(
    "/session/:sessionID/message/:messageID/part/:partID",
    describeRoute({
      description: "Delete a part from a message",
      operationId: "part.delete",
      responses: {
        200: {
          description: "Successfully deleted part",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ sessionID: z.string(), messageID: z.string(), partID: z.string() })),
    async (c) => {
      const params = c.req.valid("param")
      await Session.removePart({
        sessionID: params.sessionID,
        messageID: params.messageID,
        partID: params.partID,
      })
      return c.json(true)
    },
  )
  .patch(
    "/session/:sessionID/message/:messageID/part/:partID",
    describeRoute({
      description: "Update a part in a message",
      operationId: "part.update",
      responses: {
        200: {
          description: "Successfully updated part",
          content: {
            "application/json": {
              schema: resolver(MessageV2.Part),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ sessionID: z.string(), messageID: z.string(), partID: z.string() })),
    validator("json", MessageV2.Part),
    async (c) => {
      const params = c.req.valid("param")
      const body = c.req.valid("json")
      if (
        body.id !== params.partID ||
        body.messageID !== params.messageID ||
        body.sessionID !== params.sessionID
      ) {
        throw new Error("Part mismatch")
      }
      const part = await Session.updatePart(body)
      return c.json(part)
    },
  )
  .post(
    "/session/:sessionID/prompt_async",
    describeRoute({
      summary: "Send async message",
      description:
        "Create and send a new message to a session asynchronously, starting the session if needed and returning immediately.",
      operationId: "session.prompt_async",
      responses: {
        204: {
          description: "Prompt accepted",
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    validator("json", SessionPrompt.PromptInput.omit({ sessionID: true })),
    async (c) => {
      const sessionID = c.req.valid("param").sessionID
      const body = c.req.valid("json")

      // Ensure the user message is persisted before responding so the client doesn't
      // clear the prompt optimistically on a background failure.
      const ack = await SessionPrompt.prompt({ ...body, sessionID, noReply: true })

      // Only start the assistant loop for real user prompts (not /hold, /release, etc)
      // and when the caller actually wants a reply.
      const status = SessionStatus.get(sessionID)
      if (status.type !== "busy" && ack.info.role === "user" && body.noReply !== true) {
        SessionPrompt.loop(sessionID).catch((err) => {
          Log.Default.error("session.prompt_async loop error", {
            error: err instanceof Error ? err.message : String(err),
            sessionID,
          })
        })
      }
      return c.body(null, 204)
    },
  )
  .post(
    "/session/:sessionID/command",
    describeRoute({
      summary: "Send command",
      description: "Send a new command to a session for execution by the AI assistant.",
      operationId: "session.command",
      responses: {
        200: {
          description: "Created message",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  info: MessageV2.Assistant,
                  parts: MessageV2.Part.array(),
                }),
              ),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    validator("json", SessionPrompt.CommandInput.omit({ sessionID: true })),
    async (c) => {
      const sessionID = c.req.valid("param").sessionID
      const body = c.req.valid("json")
      const msg = await SessionPrompt.command({ ...body, sessionID })
      return c.json(msg)
    },
  )
  .post(
    "/session/:sessionID/shell",
    describeRoute({
      summary: "Run shell command",
      description: "Execute a shell command within the session context and return the AI's response.",
      operationId: "session.shell",
      responses: {
        200: {
          description: "Created message",
          content: {
            "application/json": {
              schema: resolver(MessageV2.Assistant),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    validator("json", SessionPrompt.ShellInput.omit({ sessionID: true })),
    async (c) => {
      const sessionID = c.req.valid("param").sessionID
      const body = c.req.valid("json")
      const msg = await SessionPrompt.shell({ ...body, sessionID })
      return c.json(msg)
    },
  )
  .post(
    "/session/:sessionID/revert",
    describeRoute({
      summary: "Revert message",
      description: "Revert a specific message in a session, undoing its effects and restoring the previous state.",
      operationId: "session.revert",
      responses: {
        200: {
          description: "Updated session",
          content: {
            "application/json": {
              schema: resolver(Session.Info),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    validator("json", SessionRevert.RevertInput.omit({ sessionID: true })),
    async (c) => {
      const sessionID = c.req.valid("param").sessionID
      log.info("revert", c.req.valid("json"))
      const session = await SessionRevert.revert({
        sessionID,
        ...c.req.valid("json"),
      })
      return c.json(session)
    },
  )
  .post(
    "/session/:sessionID/unrevert",
    describeRoute({
      summary: "Restore reverted messages",
      description: "Restore all previously reverted messages in a session.",
      operationId: "session.unrevert",
      responses: {
        200: {
          description: "Updated session",
          content: {
            "application/json": {
              schema: resolver(Session.Info),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    async (c) => {
      const sessionID = c.req.valid("param").sessionID
      const session = await SessionRevert.unrevert({ sessionID })
      return c.json(session)
    },
  )
  .post(
    "/session/:sessionID/permissions/:permissionID",
    describeRoute({
      summary: "Respond to permission",
      deprecated: true,
      description: "Approve or deny a permission request from the AI assistant.",
      operationId: "permission.respond",
      responses: {
        200: {
          description: "Permission processed successfully",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ sessionID: z.string(), permissionID: z.string() })),
    validator("json", z.object({ response: PermissionNext.Reply })),
    async (c) => {
      const params = c.req.valid("param")
      PermissionNext.reply({
        requestID: params.permissionID,
        reply: c.req.valid("json").response,
      })
      return c.json(true)
    },
  )
  .get(
    "/session/:sessionID/children",
    describeRoute({
      summary: "Get session children",
      tags: ["Session"],
      description: "Retrieve all child sessions that were forked from the specified parent session.",
      operationId: "session.children",
      responses: {
        200: {
          description: "List of children",
          content: {
            "application/json": {
              schema: resolver(Session.Info.array()),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ sessionID: Session.children.schema })),
    async (c) => {
      const sessionID = c.req.valid("param").sessionID
      const session = await Session.children(sessionID)
      return c.json(session)
    },
  )
  .get(
    "/session/:sessionID/todo",
    describeRoute({
      summary: "Get session todos",
      description: "Retrieve the todo list associated with a specific session, showing tasks and action items.",
      operationId: "session.todo",
      responses: {
        200: {
          description: "Todo list",
          content: {
            "application/json": {
              schema: resolver(Todo.Info.array()),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    async (c) => {
      const sessionID = c.req.valid("param").sessionID
      const todos = await Todo.get(sessionID)
      return c.json(todos)
    },
  )
  .get(
    "/session/:sessionID/events",
    describeRoute({
      summary: "Session event stream (SSE)",
      tags: ["Session"],
      description:
        "Subscribe to real-time session events via Server-Sent Events. Streams session updates, messages, and todos for cross-platform sync.",
      operationId: "session.events",
      responses: {
        200: {
          description: "Event stream (text/event-stream)",
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    async (c) => {
      const sessionID = c.req.valid("param").sessionID
      await Session.get(sessionID)

      const slot = SseLimit.acquire(c.req.raw)
      if (!slot.ok) {
        return c.json({ error: slot.error }, slot.status)
      }

      try {
        return streamSSE(c, async (stream) => {
        const subscriptions: (() => void)[] = []

        subscriptions.push(
          Bus.subscribe(Session.Event.Updated, async (event) => {
            if (event.properties.info.id === sessionID) {
              await stream.writeSSE({
                event: "session.updated",
                data: JSON.stringify(event.properties.info),
              })
            }
          }),
        )

        subscriptions.push(
          Bus.subscribe(MessageV2.Event.Updated, async (event) => {
            if (event.properties.info.sessionID === sessionID) {
              await stream.writeSSE({
                event: "message.updated",
                data: JSON.stringify(event.properties.info),
              })
            }
          }),
        )

        subscriptions.push(
          Bus.subscribe(MessageV2.Event.PartUpdated, async (event) => {
            if (event.properties.part.sessionID === sessionID) {
              await stream.writeSSE({
                event: "message.part.updated",
                data: JSON.stringify(event.properties),
              })
            }
          }),
        )

        subscriptions.push(
          Bus.subscribe(Todo.Event.Updated, async (event) => {
            if (event.properties.sessionID === sessionID) {
              await stream.writeSSE({
                event: "todo.updated",
                data: JSON.stringify(event.properties),
              })
            }
          }),
        )

        subscriptions.push(
          Bus.subscribe(SessionStatus.Event.Status, async (event) => {
            if (event.properties.sessionID === sessionID) {
              await stream.writeSSE({
                event: "session.status",
                data: JSON.stringify(event.properties),
              })
            }
          }),
        )

        subscriptions.push(
          Bus.subscribe(SessionStatus.Event.Idle, async (event) => {
            if (event.properties.sessionID === sessionID) {
              await stream.writeSSE({
                event: "session.idle",
                data: JSON.stringify(event.properties),
              })
            }
          }),
        )

        await stream.writeSSE({
          event: "connected",
          data: JSON.stringify({ sessionID, timestamp: Date.now() }),
        })

        const unregisterKeepalive = registerSseKeepalive(stream)

        stream.onAbort(() => {
          slot.release()
          unregisterKeepalive()
          subscriptions.forEach((unsub) => unsub())
        })

        await new Promise(() => {})
        })
      } catch (err) {
        slot.release()
        throw err
      }
    },
  )
  .get(
    "/personas",
    describeRoute({
      summary: "List available personas",
      tags: ["Personas"],
      description: "Get list of available personas (Zee, Stanley, Johny) with their status and capabilities.",
      operationId: "personas.list",
      responses: {
        200: {
          description: "List of personas",
          content: {
            "application/json": {
              schema: resolver(
                z.array(
                  z.object({
                    id: z.string(),
                    name: z.string(),
                    description: z.string(),
                    domain: z.string(),
                    capabilities: z.array(z.string()),
                  }),
                ),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      const personas = [
        {
          id: "zee",
          name: "Zee",
          description: "Personal assistant for life admin",
          domain: "personal",
          capabilities: ["memory", "messaging", "calendar", "contacts", "notifications", "splitwise", "codexbar"],
        },
        {
          id: "stanley",
          name: "Stanley",
          description: "Investing and financial research assistant",
          domain: "finance",
          capabilities: ["market-data", "portfolio", "sec-filings", "research", "backtesting"],
        },
        {
          id: "johny",
          name: "Johny",
          description: "Study assistant for learning and knowledge management",
          domain: "learning",
          capabilities: ["study", "knowledge-graph", "spaced-repetition", "mastery-tracking"],
        },
      ]
      return c.json(personas)
    },
  )
  .get(
    "/events",
    describeRoute({
      summary: "Global event stream (SSE)",
      tags: ["Events"],
      description:
        "Subscribe to all session events via Server-Sent Events. Useful for dashboards and cross-platform monitoring.",
      operationId: "events.global",
      responses: {
        200: {
          description: "Event stream (text/event-stream)",
        },
      },
    }),
    async (c) => {
      const slot = SseLimit.acquire(c.req.raw)
      if (!slot.ok) {
        return c.json({ error: slot.error }, slot.status)
      }

      try {
        return streamSSE(c, async (stream) => {
        const subscriptions: (() => void)[] = []

        subscriptions.push(
          Bus.subscribe(Session.Event.Created, async (event) => {
            await stream.writeSSE({
              event: "session.created",
              data: JSON.stringify(event.properties.info),
            })
          }),
        )

        subscriptions.push(
          Bus.subscribe(Session.Event.Updated, async (event) => {
            await stream.writeSSE({
              event: "session.updated",
              data: JSON.stringify(event.properties.info),
            })
          }),
        )

        subscriptions.push(
          Bus.subscribe(Session.Event.Deleted, async (event) => {
            await stream.writeSSE({
              event: "session.deleted",
              data: JSON.stringify(event.properties.info),
            })
          }),
        )

        subscriptions.push(
          Bus.subscribe(SessionStatus.Event.Status, async (event) => {
            await stream.writeSSE({
              event: "session.status",
              data: JSON.stringify(event.properties),
            })
          }),
        )

        subscriptions.push(
          Bus.subscribe(SessionStatus.Event.Idle, async (event) => {
            await stream.writeSSE({
              event: "session.idle",
              data: JSON.stringify(event.properties),
            })
          }),
        )

        await stream.writeSSE({
          event: "connected",
          data: JSON.stringify({ timestamp: Date.now(), status: SessionStatus.list() }),
        })

        const unregisterKeepalive = registerSseKeepalive(stream)

        stream.onAbort(() => {
          slot.release()
          unregisterKeepalive()
          subscriptions.forEach((unsub) => unsub())
        })

        await new Promise(() => {})
        })
      } catch (err) {
        slot.release()
        throw err
      }
    },
  )
