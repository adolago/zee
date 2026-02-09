import { cmd } from "../cmd"
import { listInstalled } from "../../../plugin/manager"
import { UI } from "../../ui"
import { Instance } from "../../../project/instance"

export const ListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list installed plugins",
  builder: (yargs) =>
    yargs.option("json", {
      describe: "output as JSON",
      type: "boolean",
      default: false,
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        try {
          const installed = await listInstalled()

          if (args.json) {
            console.log(JSON.stringify(installed, null, 2))
            return
          }

          if (installed.length === 0) {
            UI.warn("No plugins installed")
            UI.println(UI.Style.TEXT_DIM + "Search for plugins with: agent-core plugin search" + UI.Style.TEXT_NORMAL)
            return
          }

          UI.println(UI.Style.TEXT_NORMAL_BOLD + `Installed plugins (${installed.length}):` + UI.Style.TEXT_NORMAL)
          UI.empty()

          for (const plugin of installed) {
            const name = plugin.registryInfo?.displayName ?? plugin.name
            const badge = plugin.fromRegistry
              ? UI.Style.TEXT_SUCCESS + "✓" + UI.Style.TEXT_NORMAL
              : UI.Style.TEXT_WARNING + "⚠" + UI.Style.TEXT_NORMAL

            UI.println(`${badge} ${UI.Style.TEXT_HIGHLIGHT_BOLD}${name}${UI.Style.TEXT_NORMAL}`)
            UI.println(UI.Style.TEXT_DIM + `  ${plugin.spec}` + UI.Style.TEXT_NORMAL)

            if (plugin.registryInfo) {
              UI.println(UI.Style.TEXT_DIM + `  ${plugin.registryInfo.description}` + UI.Style.TEXT_NORMAL)
            }
            UI.empty()
          }
        } catch (error) {
          UI.error(`Failed to list plugins: ${error instanceof Error ? error.message : error}`)
          process.exit(1)
        }
      },
    })
  },
})
