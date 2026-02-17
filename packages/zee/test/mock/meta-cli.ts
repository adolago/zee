/**
 * Mock meta-cli for testing
 *
 * Provides mock responses for the `meta wa send` command to enable testing
 * WhatsApp messaging without a real meta-cli binary or Business API token.
 */

export interface MetaCliMockOptions {
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

/** Default success response matching real meta-cli JSON output */
export const META_CLI_SUCCESS_RESPONSE = JSON.stringify({
  messaging_product: "whatsapp",
  contacts: [{ input: "+15551234567", wa_id: "15551234567" }],
  messages: [{ id: "wamid.HBgNMTU1NTEyMzQ1NjcVAgASGBQzQUY5" }],
})

/** Default auth failure stderr */
export const META_CLI_AUTH_ERROR = "Error: unauthorized - invalid or expired access token"

/** Default API error stderr */
export const META_CLI_API_ERROR = "Error: 400 - invalid recipient: not a valid WhatsApp number"

/**
 * Build a mock CommandResult for use with sendWhatsAppMessage tests.
 */
export function mockMetaCliResult(options: MetaCliMockOptions = {}) {
  const { exitCode = 0, stdout = META_CLI_SUCCESS_RESPONSE, stderr = "", notFound = false, timeout = false } = options

  return {
    ok: exitCode === 0 && !notFound && !timeout,
    exitCode: notFound ? null : exitCode,
    stdout: notFound ? "" : stdout,
    stderr: notFound ? "" : stderr,
    notFound,
    timedOut: timeout,
    error: notFound ? "spawn meta ENOENT" : undefined,
  }
}
