export * from "./client.js"
export * from "./server.js"

import { createZeeClient } from "./client.js"
import { createZeeServer } from "./server.js"
import type { ServerOptions } from "./server.js"

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
