import { cmd } from "../cmd"
import { fetchRegistry, searchPlugins } from "../../../plugin/registry"
import { UI } from "../../ui"

export const SearchCommand = cmd({
  command: "search [query]",
  describe: "search for plugins in the registry",
  builder: (yargs) =>
    yargs
      .positional("query", {
        describe: "search query (matches name, description, tags)",
        type: "string",
        default: "",
      })
      .option("category", {
        alias: "c",
        describe: "filter by category",
        type: "string",
      })
      .option("json", {
        describe: "output as JSON",
        type: "boolean",
        default: false,
      }),
  async handler(args) {
    try {
      const registry = await fetchRegistry()
      let plugins = args.query ? searchPlugins(registry, args.query) : registry.plugins

      if (args.category) {
        plugins = plugins.filter((p) => p.category === args.category)
      }

      if (args.json) {
        console.log(JSON.stringify(plugins, null, 2))
        return
      }

      if (plugins.length === 0) {
        UI.warn("No plugins found")
        if (args.query) {
          UI.println(
            UI.Style.TEXT_DIM +
              "Try a different search term or browse all with: agent-core plugin search" +
              UI.Style.TEXT_NORMAL,
          )
        }
        return
      }

      UI.println(UI.Style.TEXT_NORMAL_BOLD + `Found ${plugins.length} plugin(s):` + UI.Style.TEXT_NORMAL)
      UI.empty()

      for (const plugin of plugins) {
        UI.println(
          UI.Style.TEXT_HIGHLIGHT_BOLD +
            plugin.displayName +
            UI.Style.TEXT_NORMAL +
            UI.Style.TEXT_DIM +
            ` (${plugin.name})` +
            UI.Style.TEXT_NORMAL,
        )
        UI.println("  " + plugin.description)
        UI.println(
          UI.Style.TEXT_DIM +
            `  ${plugin.npm}@${plugin.version} · ${plugin.category} · ${plugin.tags.join(", ")}` +
            UI.Style.TEXT_NORMAL,
        )
        UI.empty()
      }

      UI.println(UI.Style.TEXT_DIM + "Install with: agent-core plugin install <name>" + UI.Style.TEXT_NORMAL)
    } catch (error) {
      UI.error(`Failed to fetch registry: ${error instanceof Error ? error.message : error}`)
      process.exit(1)
    }
  },
})
