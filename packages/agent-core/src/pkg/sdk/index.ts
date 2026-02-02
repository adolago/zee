export * from "./client.js"
export * from "./server.js"

import { createAgentCoreClient } from "./client.js"
import { createAgentCoreServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export async function createAgentCore(options?: ServerOptions) {
  const server = await createAgentCoreServer({
    ...options,
  })

  const client = createAgentCoreClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}

/** @deprecated Use createAgentCore */
export const createOpencode = createAgentCore
