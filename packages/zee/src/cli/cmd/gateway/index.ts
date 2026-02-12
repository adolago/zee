import { cmd } from "../cmd"
import { GatewayStartCommand } from "./start"
import { GatewayStatusCommand } from "./status"
import { GatewayUrlCommand } from "./url"
import { GatewayTokenCommand } from "./token"

export const GatewayCommand = cmd({
  command: "gateway",
  describe: "Manage Zee gateway (WebSocket control plane)",
  builder: (yargs) =>
    yargs
      .command(GatewayStartCommand)
      .command(GatewayStatusCommand)
      .command(GatewayUrlCommand)
      .command(GatewayTokenCommand)
      .demandCommand(1, "Please specify a subcommand"),
  async handler() {},
})

