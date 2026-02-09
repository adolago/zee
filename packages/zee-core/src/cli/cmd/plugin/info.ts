import { cmd } from "../cmd"
import { fetchRegistry, getPlugin } from "../../../plugin/registry"
import { getInstalled } from "../../../plugin/manager"
import { UI } from "../../ui"
import { Instance } from "../../../project/instance"

export const InfoCommand = cmd({
  command: "info <name>",
  describe: "show detailed information about a plugin",
  builder: (yargs) =>
    yargs
      .positional("name", {
        describe: "plugin name",
        type: "string",
        demandOption: true,
      })
      .option("json", {
        describe: "output as JSON",
        type: "boolean",
        default: false,
      }),
  async handler(args) {
    const { name, json } = args

    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        try {
          const registry = await fetchRegistry()
          const plugin = getPlugin(registry, name)
          const installed = await getInstalled(name)

          if (!plugin && !installed) {
            UI.error(`Plugin "${name}" not found`)
            UI.println(UI.Style.TEXT_DIM + "Search for plugins with: agent-core plugin search" + UI.Style.TEXT_NORMAL)
            process.exit(1)
          }

          const info = {
            ...plugin,
            installed: !!installed,
            installedVersion: installed?.version,
          }

          if (json) {
            console.log(JSON.stringify(info, null, 2))
            return
          }

          // Display info
          if (plugin) {
            UI.println(UI.Style.TEXT_HIGHLIGHT_BOLD + plugin.displayName + UI.Style.TEXT_NORMAL)
            UI.println(UI.Style.TEXT_DIM + plugin.name + UI.Style.TEXT_NORMAL)
            UI.empty()
            UI.println(plugin.description)
            UI.empty()
            UI.println(
              UI.Style.TEXT_NORMAL_BOLD + "Package:     " + UI.Style.TEXT_NORMAL + `${plugin.npm}@${plugin.version}`,
            )
            UI.println(UI.Style.TEXT_NORMAL_BOLD + "Category:    " + UI.Style.TEXT_NORMAL + plugin.category)
            UI.println(UI.Style.TEXT_NORMAL_BOLD + "Tags:        " + UI.Style.TEXT_NORMAL + plugin.tags.join(", "))
            UI.println(
              UI.Style.TEXT_NORMAL_BOLD + "Capabilities:" + UI.Style.TEXT_NORMAL + " " + plugin.capabilities.join(", "),
            )
            UI.println(UI.Style.TEXT_NORMAL_BOLD + "Author:      " + UI.Style.TEXT_NORMAL + plugin.author)
            if (plugin.homepage) {
              UI.println(
                UI.Style.TEXT_NORMAL_BOLD +
                  "Homepage:    " +
                  UI.Style.TEXT_INFO +
                  plugin.homepage +
                  UI.Style.TEXT_NORMAL,
              )
            }
            UI.empty()

            if (installed) {
              UI.println(
                UI.Style.TEXT_SUCCESS +
                  "✓" +
                  UI.Style.TEXT_NORMAL +
                  " Installed" +
                  UI.Style.TEXT_DIM +
                  ` (${installed.spec})` +
                  UI.Style.TEXT_NORMAL,
              )
            } else {
              UI.println(UI.Style.TEXT_DIM + "Not installed" + UI.Style.TEXT_NORMAL)
              UI.println(
                UI.Style.TEXT_DIM + `Install with: agent-core plugin install ${plugin.name}` + UI.Style.TEXT_NORMAL,
              )
            }
          } else if (installed) {
            // Plugin not in registry but is installed
            UI.println(UI.Style.TEXT_HIGHLIGHT_BOLD + installed.name + UI.Style.TEXT_NORMAL)
            UI.empty()
            UI.println(UI.Style.TEXT_NORMAL_BOLD + "Package:" + UI.Style.TEXT_NORMAL + ` ${installed.spec}`)
            UI.empty()
            UI.warn("This plugin is not in the official registry")
          }
        } catch (error) {
          UI.error(`Failed to get plugin info: ${error instanceof Error ? error.message : error}`)
          process.exit(1)
        }
      },
    })
  },
})
