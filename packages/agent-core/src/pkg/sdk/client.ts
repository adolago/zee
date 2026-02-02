export * from "./gen/types.gen.js"

import { createClient } from "./gen/client/client.gen.js"
import { type Config } from "./gen/client/types.gen.js"
import { AgentCoreClient } from "./gen/sdk.gen.js"
export { type Config as AgentCoreClientConfig, AgentCoreClient }

/** @deprecated Use AgentCoreClient */
export const OpencodeClient = AgentCoreClient
/** @deprecated Use AgentCoreClientConfig */
export type OpencodeClientConfig = AgentCoreClientConfig

export function createAgentCoreClient(config?: Config & { directory?: string }) {
  if (!config?.fetch) {
    const customFetch: any = (req: any) => {
      // @ts-ignore
      req.timeout = false
      return fetch(req)
    }
    config = {
      ...config,
      fetch: customFetch,
    }
  }

  if (config?.directory) {
    config.headers = {
      ...config.headers,
      "x-opencode-directory": config.directory,
    }
  }

  const client = createClient(config)
  return new AgentCoreClient({ client })
}

/** @deprecated Use createAgentCoreClient */
export const createOpencodeClient = createAgentCoreClient
