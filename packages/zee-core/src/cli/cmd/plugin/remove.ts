import { cmd } from "../cmd"
import { removePlugin, isInstalled } from "../../../plugin/manager"
import { UI } from "../../ui"
import { Instance } from "../../../project/instance"

export const RemoveCommand = cmd({
  command: "remove <name>",
  aliases: ["rm", "uninstall"],
  describe: "remove an installed plugin",
  builder: (yargs) =>
    yargs.positional("name", {
      describe: "plugin name",
      type: "string",
      demandOption: true,
    }),
  async handler(args) {
    const { name } = args

    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        try {
          // Check if installed
          if (!(await isInstalled(name))) {
            UI.warn(`Plugin "${name}" is not installed`)
            UI.println(
              UI.Style.TEXT_DIM + "Use 'agent-core plugin list' to see installed plugins" + UI.Style.TEXT_NORMAL,
            )
            return
          }

          UI.println(UI.Style.TEXT_DIM + `Removing ${name}...` + UI.Style.TEXT_NORMAL)

          const result = await removePlugin(name)

          if (result.success) {
            UI.success(result.message)
            UI.println(UI.Style.TEXT_DIM + "Restart agent-core for changes to take effect" + UI.Style.TEXT_NORMAL)
          } else {
            UI.error(result.message)
            process.exit(1)
          }
        } catch (error) {
          UI.error(`Remove failed: ${error instanceof Error ? error.message : error}`)
          process.exit(1)
        }
      },
    })
  },
})
