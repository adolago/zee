import open from "open"
import { normalizeHttpUrl } from "./net"

export type OpenExternalUrlFailureReason = "invalid_url" | "open_failed"

export type OpenExternalUrlResult =
  | {
      ok: true
      url: string
    }
  | {
      ok: false
      url: string
      reason: OpenExternalUrlFailureReason
      error: unknown
    }

export type OpenExternalUrlOptions = {
  /**
   * Time window to detect asynchronous child-process startup failures from the
   * `open` package (`error` event or non-zero `exit`).
   */
  errorCheckDelayMs?: number
}

const DEFAULT_ERROR_CHECK_DELAY_MS = 500

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

async function waitForOpenFailure(
  subprocess: {
    on?: (event: string, listener: (...args: any[]) => void) => unknown
    off?: (event: string, listener: (...args: any[]) => void) => unknown
  },
  timeoutMs: number,
): Promise<void> {
  const on = typeof subprocess.on === "function" ? subprocess.on.bind(subprocess) : undefined
  const off = typeof subprocess.off === "function" ? subprocess.off.bind(subprocess) : undefined
  if (timeoutMs <= 0 || !on) return

  await new Promise<void>((resolve, reject) => {
    let done = false

    const cleanup = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      if (off) {
        off("error", onError)
        off("exit", onExit)
      }
    }

    const onError = (error: unknown) => {
      cleanup()
      reject(toError(error))
    }

    const onExit = (code: number | null) => {
      if (code !== null && code !== 0) {
        cleanup()
        reject(new Error(`Browser open failed with exit code ${code}`))
      }
    }

    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, timeoutMs)

    on("error", onError)
    on("exit", onExit)
  })
}

export async function openExternalUrl(
  value: string,
  options: OpenExternalUrlOptions = {},
): Promise<OpenExternalUrlResult> {
  const safeUrl = normalizeHttpUrl(value)
  if (!safeUrl) {
    return {
      ok: false,
      reason: "invalid_url",
      url: value,
      error: new Error("URL must be http(s)"),
    }
  }

  const delay = options.errorCheckDelayMs ?? DEFAULT_ERROR_CHECK_DELAY_MS

  try {
    const subprocess = await open(safeUrl)
    await waitForOpenFailure(subprocess, delay)
    return {
      ok: true,
      url: safeUrl,
    }
  } catch (error) {
    return {
      ok: false,
      reason: "open_failed",
      url: safeUrl,
      error,
    }
  }
}
