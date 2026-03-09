// Run isolated agent jobs - creates a temporary session, runs the agent, returns result.

import type { CronJob } from "./types"
import { Log } from "../util/log"

const log = Log.create({ service: "cron:isolated" })

export type IsolatedAgentResult = {
  status: "ok" | "error" | "skipped"
  summary?: string
  outputText?: string
  error?: string
}

function resolveModelOverride(modelRaw: string | undefined): { providerID: string; modelID: string } | undefined {
  const normalized = modelRaw?.trim()
  if (!normalized) return undefined
  const [providerID, ...modelParts] = normalized.split("/")
  if (!providerID || modelParts.length === 0) return undefined
  return { providerID, modelID: modelParts.join("/") }
}

function extractResponseText(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return ""
  }

  const result = payload as {
    parts?: Array<{ type?: string; text?: string; synthetic?: boolean; ignored?: boolean }>
  }
  if (!Array.isArray(result.parts)) {
    return ""
  }

  return result.parts
    .filter(
      (part) =>
        part?.type === "text" &&
        typeof part.text === "string" &&
        part.synthetic !== true &&
        part.ignored !== true,
    )
    .map((part) => part.text!.trim())
    .filter(Boolean)
    .join("\n")
    .trim()
}

/**
 * Run an isolated cron job by creating a temporary session and sending a message.
 * This is the default implementation used when no custom runner is provided.
 */
export async function runIsolatedAgentJob(params: {
  job: CronJob
  message: string
  /** Base URL for the zee server (e.g. http://127.0.0.1:3210). */
  serverUrl: string
}): Promise<IsolatedAgentResult> {
  const { job, message, serverUrl } = params

  try {
    // Create a temporary session for this cron job
    const sessionRes = await fetch(`${serverUrl}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: `cron:${job.id}:${job.name}`,
        agent: job.payload.kind === "agentTurn" ? job.payload.agent : undefined,
      }),
    })

    if (!sessionRes.ok) {
      const text = await sessionRes.text().catch(() => "")
      return {
        status: "error",
        error: `failed to create session: ${sessionRes.status} ${text}`,
      }
    }

    const session = (await sessionRes.json()) as { id: string }

    // Send the message to the session
    const modelOverride = job.payload.kind === "agentTurn" ? resolveModelOverride(job.payload.model) : undefined
    const agentOverride = job.payload.kind === "agentTurn" ? job.payload.agent : undefined
    const msgRes = await fetch(`${serverUrl}/session/${session.id}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent: agentOverride,
        parts: [{ type: "text", text: message }],
        options: { senderId: "cron" },
        model: modelOverride,
      }),
    })

    if (!msgRes.ok) {
      const text = await msgRes.text().catch(() => "")
      return {
        status: "error",
        error: `failed to send message: ${msgRes.status} ${text}`,
      }
    }

    const result = await msgRes.json()
    const outputText = extractResponseText(result)

    return {
      status: "ok",
      summary: `Cron job "${job.name}" completed`,
      outputText,
    }
  } catch (err) {
    log.error("isolated agent job failed", {
      jobId: job.id,
      error: err instanceof Error ? err.message : String(err),
    })
    return {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
