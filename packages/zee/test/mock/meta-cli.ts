/**
 * Mock wacli for testing
 *
 * Provides mock responses for the `wacli send text` command to enable testing
 * WhatsApp messaging without a real wacli binary or authenticated session.
 */

export interface WacliMockOptions {
  /** Exit code to return (default: 0) */
  exitCode?: number
  /** JSON stdout for successful sends */
  stdout?: string
  /** stderr output for failures */
  stderr?: string
  /** Simulate ENOENT (binary not found) */
  notFound?: boolean
  /** Simulate timeout */
  timeout?: boolean
}

/** Default success response matching real wacli JSON output */
export const WACLI_SUCCESS_RESPONSE = JSON.stringify({
  success: true,
  data: { id: "3EB07708F23B77D53A6C26", sent: true, to: "15551234567@s.whatsapp.net" },
  error: null,
})

/** Default auth failure stderr */
export const WACLI_AUTH_ERROR = "Error: not authenticated -- run wacli auth to pair"

/** Default send failure stderr */
export const WACLI_SEND_ERROR = "Error: failed to send message: context deadline exceeded"

/**
 * Build a mock CommandResult for use with sendWhatsAppMessage tests.
 */
export function mockWacliResult(options: WacliMockOptions = {}) {
  const { exitCode = 0, stdout = WACLI_SUCCESS_RESPONSE, stderr = "", notFound = false, timeout = false } = options

  return {
    ok: exitCode === 0 && !notFound && !timeout,
    exitCode: notFound ? null : exitCode,
    stdout: notFound ? "" : stdout,
    stderr: notFound ? "" : stderr,
    notFound,
    timedOut: timeout,
    error: notFound ? "spawn wacli ENOENT" : undefined,
  }
}

// Legacy aliases for backward compatibility
export const META_CLI_SUCCESS_RESPONSE = WACLI_SUCCESS_RESPONSE
export const META_CLI_AUTH_ERROR = WACLI_AUTH_ERROR
export const META_CLI_API_ERROR = WACLI_SEND_ERROR
export const mockMetaCliResult = mockWacliResult
export type MetaCliMockOptions = WacliMockOptions
