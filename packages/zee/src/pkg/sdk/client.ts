export * from "./gen/types.gen.js"

import { createClient } from "./gen/client/client.gen.js"
import { type Config } from "./gen/client/types.gen.js"
import { ZeeClient as GeneratedZeeClient } from "./gen/sdk.gen.js"

export class ZeeClient extends GeneratedZeeClient {}
export type ZeeClientConfig = Config

export function createZeeClient(config?: Config & { directory?: string }) {
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
      "x-zee-directory": config.directory,
    }
  }

  const client = createClient(config)
  return new ZeeClient({ client })
}
