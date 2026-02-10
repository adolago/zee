// Zee SDK v2
// Enhanced API with streaming and better type safety

export * from "./client.js"
export * from "./server.js"

import { createZeeClient } from "./client.js"
import { createZeeServer } from "./server.js"
import type { ServerOptions } from "./server.js"

/**
 * Creates both a Zee server and client (v2 API)
 * @param options Server options
 * @returns Object with client and server instances
 */
export async function createZee(options?: ServerOptions) {
  const server = await createZeeServer({
    ...options,
  })

  const client = createZeeClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}

/** @deprecated Use createZee instead */
export const createAgentCore = createZee

/** @deprecated Use createZee instead */
export const createOpencode = createZee
