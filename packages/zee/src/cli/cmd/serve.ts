import { Server } from "../../server/server"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless zee server",
  handler: async (args) => {
    const opts = await resolveNetworkOptions(args)
    const server = Server.listen(opts)
    // Emit both markers for backward compatibility with older SDKs/parsers.
    const url = `http://${server.hostname}:${server.port}`
    console.log(`zee server listening on ${url}`)
    console.log(`opencode server listening on ${url}`)
    await new Promise(() => {})
    await server.stop()
  },
})
