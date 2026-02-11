// Zee SDK
// Re-exports from the internal SDK implementation

export * from "./client.js"
export * from "./server.js"

import { createZeeClient } from "./client.js"
import { createZeeServer } from "./server.js"
import type { ServerOptions } from "./server.js"

/**
 * Creates both a Zee server and client
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
