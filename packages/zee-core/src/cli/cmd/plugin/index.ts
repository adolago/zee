import { cmd } from "../cmd"
import { SearchCommand } from "./search"
import { ListCommand } from "./list"
import { InstallCommand } from "./install"
import { RemoveCommand } from "./remove"
import { InfoCommand } from "./info"

export const PluginCommand = cmd({
  command: "plugin",
  describe: "manage plugins (search, install, remove)",
  builder: (yargs) =>
    yargs
      .command(SearchCommand)
      .command(ListCommand)
      .command(InstallCommand)
      .command(RemoveCommand)
      .command(InfoCommand)
      .demandCommand(1, "Please specify a subcommand"),
  async handler() {},
})
