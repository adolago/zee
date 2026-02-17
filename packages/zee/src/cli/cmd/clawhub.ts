import { cmd } from "./cmd"
import { UI } from "../ui"

export const ClawHubCommand = cmd({
  command: "clawhub [action] [target]",
  describe: "deprecated compatibility command for ClawHub migration",
  builder: (yargs) =>
    yargs
      .positional("action", {
        describe: "Legacy ClawHub action (deprecated)",
        type: "string",
      })
      .positional("target", {
        describe: "Legacy ClawHub target (deprecated)",
        type: "string",
      }),
  handler: async () => {
    UI.warn("`zee clawhub` is deprecated and no longer supports marketplace operations.")
    UI.println("Skills are now first-party and managed in `.agents/skills/@zee/`.")
    UI.println("Use `zee skill` to inspect loaded skills, or `zee auth login <provider>` for credentials.")
    UI.println("Compatibility aliases are defined in `packages/zee/skills/aliases.yaml`.")
    process.exitCode = 2
  },
})
