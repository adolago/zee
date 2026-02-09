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

/**
 * Run an isolated cron job by creating a temporary session and sending a message.
 * This is the default implementation used when no custom runner is provided.
 */
export async function runIsolatedAgentJob(params: {
  job: CronJob
  message: string
  /** Base URL for the agent-core server (e.g. http://127.0.0.1:3210). */
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
        agent: job.payload.kind === "agentTurn" ? job.payload.persona : undefined,
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
    const msgRes = await fetch(`${serverUrl}/session/${session.id}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: message,
        model: job.payload.kind === "agentTurn" ? job.payload.model : undefined,
      }),
    })

    if (!msgRes.ok) {
      const text = await msgRes.text().catch(() => "")
      return {
        status: "error",
        error: `failed to send message: ${msgRes.status} ${text}`,
      }
    }

    const result = (await msgRes.json()) as { content?: string }

    return {
      status: "ok",
      summary: `Cron job "${job.name}" completed`,
      outputText: result.content,
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
