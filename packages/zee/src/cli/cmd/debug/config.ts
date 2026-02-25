import { EOL } from "os"
import { Config } from "../../../config/config"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"

export const ConfigCommand = cmd({
  command: "config",
  describe: "show resolved configuration",
  builder: (yargs) =>
    yargs.option("reload-managed", {
      type: "boolean",
      default: false,
      describe: "reload managed settings before printing config",
    }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      if (args["reload-managed"]) {
        await Config.reloadManaged()
      }
      const config = await Config.get()
      process.stdout.write(JSON.stringify(config, null, 2) + EOL)
    })
  },
})
