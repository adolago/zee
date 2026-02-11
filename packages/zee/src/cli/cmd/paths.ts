import { Global } from "../../global"
import { cmd } from "./cmd"

export const PathsCommand = cmd({
  command: "paths",
  describe: "show resolved paths (data, config, cache, state, workspace)",
  builder: (yargs) =>
    yargs.option("json", {
      type: "boolean",
      default: false,
      describe: "output as JSON",
    }),
  handler(args) {
    const entries = Object.entries(Global.Path)
    if (args.json) {
      const payload = Object.fromEntries(entries)
      console.log(JSON.stringify(payload, null, 2))
      return
    }
    for (const [key, value] of entries) {
      console.log(key.padEnd(10), value)
    }
  },
})
