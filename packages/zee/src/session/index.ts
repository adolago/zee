import { Slug } from "@zee/util/slug"
import path from "path"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Decimal } from "decimal.js"
import z from "zod"
import { type LanguageModelUsage, type ProviderMetadata } from "ai"

import { Identifier } from "../id/id"
import { Installation } from "../installation"

import { Storage } from "../storage/storage"
import { Log } from "../util/log"
import { MessageV2 } from "./message-v2"
import { Instance } from "../project/instance"
import { SessionPrompt } from "./prompt"
import { fn } from "@/util/fn"
import { iife } from "@/util/iife"
import { Command } from "../command"
import { Snapshot } from "@/snapshot"

import type { Provider } from "@/provider/provider"
import { PermissionNext } from "@/permission/next"
import { Global } from "@/global"
import { ExecutionModeSchema, parseExecutionMode, type ExecutionMode } from "./mode"

// Re-export Thread for convenience
export { Thread } from "./thread"

export namespace Session {
  const log = Log.create({ service: "session" })

  const parentTitlePrefix = "New session - "
  const childTitlePrefix = "Child session - "
  const forkTitlePrefix = "Fork "

  function createDefaultTitle(isChild = false) {
    return (isChild ? childTitlePrefix : parentTitlePrefix) + new Date().toISOString()
  }

  function getForkedTitle(parent: Info, siblings: Info[]) {
    const suffix = ` - ${parent.title}`
    let max = 0
    for (const sibling of siblings) {
      if (!sibling.title.startsWith(forkTitlePrefix) || !sibling.title.endsWith(suffix)) continue
      const raw = sibling.title.slice(forkTitlePrefix.length, sibling.title.length - suffix.length).trim()
      const num = Number.parseInt(raw, 10)
      if (Number.isFinite(num)) max = Math.max(max, num)
    }
    return `${forkTitlePrefix}${max + 1}${suffix}`
  }

  export function isDefaultTitle(title: string) {
    return new RegExp(
      `^(${parentTitlePrefix}|${childTitlePrefix})\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$`,
    ).test(title)
  }

  function normalizeStoredMode(value: unknown): ExecutionMode | undefined {
    return parseExecutionMode(value)
  }

  function canonicalizeSessionInfoModes(info: Info): { session: Info; changed: boolean } {
    let changed = false
    let session = info

    const mode = normalizeStoredMode(info.mode)
    if (mode !== info.mode) {
      changed = true
      session = { ...session }
      if (mode) session.mode = mode
      else delete session.mode
    }

    const snapshot = session.toolPolicySnapshot
    if (snapshot) {
      const snapshotMode = normalizeStoredMode(snapshot.mode) ?? "plan"
      if (snapshotMode !== snapshot.mode) {
        changed = true
        session = {
          ...session,
          toolPolicySnapshot: {
            ...snapshot,
            mode: snapshotMode,
          },
        }
      }
    }

    return { session, changed }
  }

  async function readSessionInfo(key: string[]): Promise<Info> {
    const read = await Storage.read<Info>(key)
    const { session, changed } = canonicalizeSessionInfoModes(read)
    if (changed) await Storage.write(key, session)
    return session
  }

  export const Info = z
    .object({
      id: Identifier.schema("session"),
      slug: z.string(),
      projectID: z.string(),
      directory: z.string(),
      parentID: Identifier.schema("session").optional(),
      summary: z
        .object({
          additions: z.number(),
          deletions: z.number(),
          files: z.number(),
          diffs: Snapshot.FileDiff.array().optional(),
        })
        .optional(),
      share: z
        .object({
          url: z.string(),
        })
        .optional(),
      title: z.string(),
      version: z.string(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
        compacting: z.number().optional(),
        archived: z.number().optional(),
      }),
      permission: PermissionNext.Ruleset.optional(),
      revert: z
        .object({
          messageID: z.string(),
          partID: z.string().optional(),
          snapshot: z.string().optional(),
          diff: z.string().optional(),
        })
        .optional(),
      tokens: z
        .object({
          input: z.number(),
          output: z.number(),
          reasoning: z.number(),
        })
        .optional(),
      surface: z.enum(["cli", "web", "api", "whatsapp", "telegram"]).optional(),
      mode: ExecutionModeSchema.optional(),
      systemPrompt: z.string().optional(),
      skills: z.array(z.string()).optional(),
      contextFiles: z.array(z.string()).optional(),
      toolPolicySnapshot: z
        .object({
          createdAt: z.number(),
          mode: ExecutionModeSchema,
          surface: z.enum(["cli", "web", "api", "whatsapp", "telegram"]).optional(),
          agent: z.string().optional(),
          permission: PermissionNext.Ruleset.optional(),
        })
        .optional(),
    })
    .meta({
      ref: "Session",
    })
  export type Info = z.output<typeof Info>

  export const ShareInfo = z
    .object({
      secret: z.string(),
      url: z.string(),
    })
    .meta({
      ref: "SessionShare",
    })
  export type ShareInfo = z.output<typeof ShareInfo>

  export const Event = {
    Created: BusEvent.define(
      "session.created",
      z.object({
        info: Info,
      }),
    ),
    Updated: BusEvent.define(
      "session.updated",
      z.object({
        info: Info,
      }),
    ),
    Deleted: BusEvent.define(
      "session.deleted",
      z.object({
        info: Info,
      }),
    ),
    Diff: BusEvent.define(
      "session.diff",
      z.object({
        sessionID: z.string(),
        diff: Snapshot.FileDiff.array(),
      }),
    ),
    Error: BusEvent.define(
      "session.error",
      z.object({
        sessionID: z.string().optional(),
        error: MessageV2.Assistant.shape.error,
      }),
    ),
  }

  export const create = fn(
    z
      .object({
        parentID: Identifier.schema("session").optional(),
        title: z.string().optional(),
        permission: Info.shape.permission,
        surface: Info.shape.surface,
        systemPrompt: z.string().nullable().optional(),
        skills: z.array(z.string()).nullable().optional(),
        contextFiles: z.array(z.string()).nullable().optional(),
      })
      .optional(),
    async (input) => {
      return createNext({
        parentID: input?.parentID,
        directory: Instance.directory,
        title: input?.title,
        permission: input?.permission,
        surface: input?.surface,
        systemPrompt: input?.systemPrompt ?? undefined,
        skills: input?.skills ?? undefined,
        contextFiles: input?.contextFiles ?? undefined,
      })
    },
  )

  export const fork = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      messageID: Identifier.schema("message").optional(),
    }),
    async (input) => {
      const parent = await get(input.sessionID)
      const siblings = parent ? await children(parent.id) : []
      const session = await createNext({
        directory: Instance.directory,
        parentID: parent?.id,
        title: parent ? getForkedTitle(parent, siblings) : createDefaultTitle(false),
      })
      const msgs = await messages({ sessionID: input.sessionID })
      const idMap = new Map<string, string>()

      for (const msg of msgs) {
        if (input.messageID && msg.info.id >= input.messageID) break
        const newID = Identifier.ascending("message")
        idMap.set(msg.info.id, newID)

        const parentID = msg.info.role === "assistant" && msg.info.parentID ? idMap.get(msg.info.parentID) : undefined
        const cloned = await updateMessage({
          ...msg.info,
          sessionID: session.id,
          id: newID,
          ...(parentID && { parentID }),
        })

        for (const part of msg.parts) {
          await updatePart({
            ...part,
            id: Identifier.ascending("part"),
            messageID: cloned.id,
            sessionID: session.id,
          })
        }
      }
      return session
    },
  )

  export const touch = fn(Identifier.schema("session"), async (sessionID) => {
    await update(sessionID, (draft) => {
      draft.time.updated = Date.now()
      delete draft.time.archived
    })
  })

  export async function createNext(input: {
    id?: string
    title?: string
    parentID?: string
    directory: string
    permission?: PermissionNext.Ruleset
    surface?: Info["surface"]
    systemPrompt?: string
    skills?: string[]
    contextFiles?: string[]
    toolPolicySnapshot?: Info["toolPolicySnapshot"]
  }) {
    const result: Info = {
      id: Identifier.descending("session", input.id),
      slug: Slug.create(),
      version: Installation.VERSION,
      projectID: Instance.project.id,
      directory: input.directory,
      parentID: input.parentID,
      title: input.title ?? createDefaultTitle(!!input.parentID),
      permission: input.permission,
      surface: input.surface,
      systemPrompt: input.systemPrompt,
      skills: input.skills,
      contextFiles: input.contextFiles,
      toolPolicySnapshot: input.toolPolicySnapshot,
      time: {
        created: Date.now(),
        updated: Date.now(),
      },
    }
    log.info("created", result)
    await Storage.write(["session", Instance.project.id, result.id], result)
    Bus.publish(Event.Created, {
      info: result,
    })
    Bus.publish(Event.Updated, {
      info: result,
    })
    return result
  }

  export function plan(input: { slug: string; time: { created: number } }) {
    const base = Instance.project.vcs
      ? path.join(Instance.worktree, ".zee", "plans")
      : path.join(Global.Path.data, "plans")
    return path.join(base, [input.time.created, input.slug].join("-") + ".md")
  }

  export const get = fn(Identifier.schema("session"), async (id) => {
    return readSessionInfo(["session", Instance.project.id, id])
  })

  export async function update(id: string, editor: (session: Info) => void, options?: { touch?: boolean }) {
    const project = Instance.project
    const result = await Storage.update<Info>(["session", project.id, id], (draft) => {
      editor(draft)
      if (options?.touch !== false) {
        draft.time.updated = Date.now()
      }
    })
    Bus.publish(Event.Updated, {
      info: result,
    })
    return result
  }

  export const diff = fn(Identifier.schema("session"), async (sessionID) => {
    const diffs = await Storage.read<Snapshot.FileDiff[]>(["session_diff", sessionID])
    return diffs ?? []
  })

  export const messages = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      limit: z.number().optional(),
    }),
    async (input) => {
      const result = [] as MessageV2.WithParts[]
      for await (const msg of MessageV2.stream(input.sessionID)) {
        if (input.limit && result.length >= input.limit) break
        result.push(msg)
      }
      result.reverse()
      return result
    },
  )

  export async function* list() {
    const project = Instance.project
    for (const item of await Storage.list(["session", project.id])) {
      yield await readSessionInfo(item)
    }
  }

  export const children = fn(Identifier.schema("session"), async (parentID) => {
    const project = Instance.project
    const result = [] as Session.Info[]
    for (const item of await Storage.list(["session", project.id])) {
      const session = await readSessionInfo(item)
      if (session.parentID !== parentID) continue
      result.push(session)
    }
    return result
  })

  export const remove = fn(Identifier.schema("session"), async (sessionID) => {
    const project = Instance.project
    try {
      const session = await get(sessionID)
      for (const child of await children(sessionID)) {
        await remove(child.id)
      }
      for (const msg of await Storage.list(["message", sessionID])) {
        const messageID = msg.at(-1)
        if (!messageID) continue
        for (const part of await Storage.list(["part", messageID])) {
          await Storage.remove(part)
        }
        await Storage.remove(msg)
      }
      await Storage.remove(["session", project.id, sessionID])
      Bus.publish(Event.Deleted, {
        info: session,
      })
    } catch (e) {
      log.error(e instanceof Error ? e.message : String(e), { error: e })
    }
  })

  export const updateMessage = fn(MessageV2.Info, async (msg) => {
    await Storage.write(["message", msg.sessionID, msg.id], msg)
    Bus.publish(MessageV2.Event.Updated, {
      info: msg,
    })
    return msg
  })

  export const removeMessage = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      messageID: Identifier.schema("message"),
    }),
    async (input) => {
      await Storage.remove(["message", input.sessionID, input.messageID])
      Bus.publish(MessageV2.Event.Removed, {
        sessionID: input.sessionID,
        messageID: input.messageID,
      })
      return input.messageID
    },
  )

  export const removePart = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      messageID: Identifier.schema("message"),
      partID: Identifier.schema("part"),
    }),
    async (input) => {
      await Storage.remove(["part", input.messageID, input.partID])
      Bus.publish(MessageV2.Event.PartRemoved, {
        sessionID: input.sessionID,
        messageID: input.messageID,
        partID: input.partID,
      })
      return input.partID
    },
  )

  const UpdatePartInput = z.union([
    MessageV2.Part,
    z.object({
      part: MessageV2.TextPart,
      delta: z.string().optional(),
    }),
    z.object({
      part: MessageV2.ReasoningPart,
      delta: z.string().optional(),
    }),
  ])

  export const updatePart = fn(UpdatePartInput, async (input) => {
    const hasWrapper = "part" in input
    const part = hasWrapper ? input.part : input
    const delta = hasWrapper ? input.delta : undefined
    await Storage.write(["part", part.messageID, part.id], part)
    Bus.publish(MessageV2.Event.PartUpdated, {
      part,
      delta,
    })
    return part
  })

  export const getUsage = fn(
    z.object({
      model: z.custom<Provider.Model>(),
      usage: z.custom<LanguageModelUsage>(),
      metadata: z.custom<ProviderMetadata>().optional(),
    }),
    (input) => {
      const safe = (value: number) => {
        if (!Number.isFinite(value)) return 0
        return value
      }
      const inputTokens = safe(input.usage.inputTokens ?? 0)
      const outputTokens = safe(input.usage.outputTokens ?? 0)
      const reasoningTokens = safe(input.usage.reasoningTokens ?? 0)

      const cacheReadInputTokens = safe(input.usage.cachedInputTokens ?? 0)
      const cacheWriteInputTokens = safe(
        (input.metadata?.["anthropic"]?.["cacheCreationInputTokens"] ??
          // @ts-expect-error
          input.metadata?.["bedrock"]?.["usage"]?.["cacheWriteInputTokens"] ??
          // @ts-expect-error
          input.metadata?.["venice"]?.["usage"]?.["cacheCreationInputTokens"] ??
          input.metadata?.["venice"]?.["cacheWriteInputTokens"] ??
          input.metadata?.["venice"]?.["cacheCreationInputTokens"] ??
          0) as number,
      )

      // Anthropic/Bedrock report inputTokens excluding cached tokens.
      // Other providers (OpenRouter, OpenAI, Gemini, etc.) include cached tokens in inputTokens.
      const excludesCachedTokens = !!(input.metadata?.["anthropic"] || input.metadata?.["bedrock"])
      const adjustedInputTokens = safe(
        excludesCachedTokens ? inputTokens : inputTokens - cacheReadInputTokens - cacheWriteInputTokens,
      )

      // Anthropic/Bedrock don't provide accurate total_tokens; compute from components.
      const total = iife(() => {
        if (
          input.model.api.npm === "@ai-sdk/anthropic" ||
          input.model.api.npm === "@ai-sdk/amazon-bedrock" ||
          input.model.api.npm === "@ai-sdk/google-vertex/anthropic"
        ) {
          return adjustedInputTokens + outputTokens + cacheReadInputTokens + cacheWriteInputTokens
        }
        return input.usage.totalTokens
      })

      const tokens = {
        total,
        input: adjustedInputTokens,
        output: outputTokens,
        reasoning: reasoningTokens,
        cache: {
          write: cacheWriteInputTokens,
          read: cacheReadInputTokens,
        },
      }

      const costInfo =
        input.model.cost?.experimentalOver200K && tokens.input + tokens.cache.read > 200_000
          ? input.model.cost.experimentalOver200K
          : input.model.cost
      return {
        cost: safe(
          new Decimal(0)
            .add(new Decimal(tokens.input).mul(costInfo?.input ?? 0).div(1_000_000))
            .add(new Decimal(tokens.output).mul(costInfo?.output ?? 0).div(1_000_000))
            .add(new Decimal(tokens.cache.read).mul(costInfo?.cache?.read ?? 0).div(1_000_000))
            .add(new Decimal(tokens.cache.write).mul(costInfo?.cache?.write ?? 0).div(1_000_000))
            // NOTE: models.dev doesn't have dedicated reasoning token pricing yet.
            // As a workaround, reasoning tokens are charged at the output rate.
            .add(new Decimal(tokens.reasoning).mul(costInfo?.output ?? 0).div(1_000_000))
            .toNumber(),
        ),
        tokens,
      }
    },
  )

  export class BusyError extends Error {
    constructor(public readonly sessionID: string) {
      super(`Session ${sessionID} is busy`)
    }
  }

  export const initialize = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      modelID: z.string(),
      providerID: z.string(),
      messageID: Identifier.schema("message"),
    }),
    async (input) => {
      await SessionPrompt.command({
        sessionID: input.sessionID,
        messageID: input.messageID,
        model: input.providerID + "/" + input.modelID,
        command: Command.Default.INIT,
        arguments: "",
      })
    },
  )
}
