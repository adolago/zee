// Shared helper for attaching the TUI to an already-running Zee server.

import { tui } from "./app"
import { UI } from "../../ui"
import { createAuthorizedFetch } from "../../../server/auth"
import { reloadFlags } from "../../../flag/flag"
import * as prompts from "@clack/prompts"

export type AttachTuiOptions = {
  url: string
  directory: string
  password?: string
  model?: string
  continue?: boolean
  sessionID?: string
  agent?: string
}

function normalizeUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "")
}

export async function attachTui(options: AttachTuiOptions): Promise<void> {
  const url = normalizeUrl(options.url)

  // Apply password from CLI flag
  if (options.password) {
    process.env.ZEE_SERVER_PASSWORD = options.password
    reloadFlags()
  }

  // Verify health
  let res: Response
  try {
    const authorizedFetch = createAuthorizedFetch(fetch)
    res = await authorizedFetch(`${url}/global/health`, {
      signal: AbortSignal.timeout(3000),
    })
  } catch {
    UI.error(`Cannot reach process at ${url}.`)
    process.exit(1)
  }

  // If 401 and no password was provided, prompt interactively
  if (res.status === 401 && !options.password) {
    const pw = await prompts.password({
      message: "Server requires authentication. Enter password:",
      validate: (x) => (x && x.length > 0 ? undefined : "Required"),
    })
    if (prompts.isCancel(pw)) {
      process.exit(1)
    }
    process.env.ZEE_SERVER_PASSWORD = pw
    reloadFlags()

    // Retry health check
    try {
      const authorizedFetch = createAuthorizedFetch(fetch)
      res = await authorizedFetch(`${url}/global/health`, {
        signal: AbortSignal.timeout(3000),
      })
    } catch {
      UI.error(`Cannot reach process at ${url}.`)
      process.exit(1)
    }
  }

  if (!res.ok) {
    if (res.status === 401) {
      UI.error("Authentication failed. Check your password.")
    } else {
      UI.error(`Process at ${url} is not healthy (status ${res.status}).`)
    }
    process.exit(1)
  }

  const authorizedFetch = createAuthorizedFetch(fetch)
  await tui({
    url,
    directory: options.directory,
    fetch: authorizedFetch,
    args: {
      continue: options.continue,
      sessionID: options.sessionID,
      agent: options.agent,
      model: options.model,
    },
  })
}

