import { cmd } from "../cmd"
import { resolveGatewayWsUrl } from "./util"

export const GatewayUrlCommand = cmd({
  command: "url",
  describe: "Print the gateway WebSocket URL",
  handler: async () => {
    process.stdout.write(resolveGatewayWsUrl() + "\n")
  },
})

