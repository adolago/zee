import { createZeeClient } from "@zee/zee/pkg/sdk/v2/client"
import { base64Encode } from "@zee/util/encode"

export const serverHost = process.env.PLAYWRIGHT_SERVER_HOST ?? "localhost"
export const serverPort = process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"

export const serverUrl = `http://${serverHost}:${serverPort}`
export const serverName = `${serverHost}:${serverPort}`

export const modKey = process.platform === "darwin" ? "Meta" : "Control"
export const terminalToggleKey = "Control+Backquote"

export function createSdk(directory?: string) {
  return createZeeClient({ baseUrl: serverUrl, directory, throwOnError: true })
}

export async function getWorktree() {
  const sdk = createSdk()
  const deadline = Date.now() + 20_000
  let lastError: string | undefined
  while (Date.now() < deadline) {
    try {
      const result = await sdk.path.get()
      const data = result.data
      if (data?.worktree) return data.worktree
      lastError = "no worktree in response"
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(
    `Failed to resolve a worktree from ${serverUrl}/path${lastError ? ` (last error: ${lastError})` : ""}`,
  )
}

export function dirSlug(directory: string) {
  return base64Encode(directory)
}

export function dirPath(directory: string) {
  return `/${dirSlug(directory)}`
}

export function sessionPath(directory: string, sessionID?: string) {
  return `${dirPath(directory)}/session${sessionID ? `/${sessionID}` : ""}`
}
