import { Server } from "../../server/server"
import { Stanley } from "../../paths"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless zee server",
  handler: async (args) => {
    // Mandatory: Stanley Python backend must be ready
    const err = Stanley.preflight()
    if (err) {
      console.error(`\n  Stanley backend is not ready:\n`)
      for (const line of err.split("\n")) {
        console.error(`  ${line}`)
      }
      console.error()
      process.exit(1)
    }

    const opts = await resolveNetworkOptions(args)
    const server = Server.listen(opts)
    const url = `http://${server.hostname}:${server.port}`
    console.log(`zee server listening on ${url}`)
    await new Promise(() => {})
    await server.stop()
  },
})
