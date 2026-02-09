import { cmd } from "../cmd"
import { installPlugin, isInstalled } from "../../../plugin/manager"
import { UI } from "../../ui"
import { Instance } from "../../../project/instance"

export const InstallCommand = cmd({
  command: "install <name>",
  aliases: ["add", "i"],
  describe: "install a plugin from the registry",
  builder: (yargs) =>
    yargs
      .positional("name", {
        describe: "plugin name",
        type: "string",
        demandOption: true,
      })
      .option("force", {
        alias: "f",
        describe: "force reinstall even if already installed",
        type: "boolean",
        default: false,
      }),
  async handler(args) {
    const { name, force } = args

    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        try {
          // Check if already installed
          if (!force && (await isInstalled(name))) {
            UI.warn(`Plugin "${name}" is already installed`)
            UI.println(UI.Style.TEXT_DIM + "Use --force to reinstall" + UI.Style.TEXT_NORMAL)
            return
          }

          UI.println(UI.Style.TEXT_DIM + `Installing ${name}...` + UI.Style.TEXT_NORMAL)

          const result = await installPlugin(name)

          if (result.success) {
            UI.success(result.message)
            if (result.plugin) {
              UI.empty()
              UI.println(
                UI.Style.TEXT_DIM + `Capabilities: ${result.plugin.capabilities.join(", ")}` + UI.Style.TEXT_NORMAL,
              )
              UI.println(UI.Style.TEXT_DIM + "Restart agent-core for changes to take effect" + UI.Style.TEXT_NORMAL)
            }
          } else {
            UI.error(result.message)
            process.exit(1)
          }
        } catch (error) {
          UI.error(`Install failed: ${error instanceof Error ? error.message : error}`)
          process.exit(1)
        }
      },
    })
  },
})
