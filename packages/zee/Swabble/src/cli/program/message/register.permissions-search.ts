import type { Command } from "commander";
import type { MessageCliHelpers } from "./helpers.js";

export function registerMessagePermissionsCommand(message: Command, helpers: MessageCliHelpers) {
  helpers
    .withMessageBase(
      helpers.withRequiredMessageTarget(
        message.command("permissions").description("Fetch channel permissions"),
      ),
    )
    .action(async (opts) => {
      await helpers.runMessageAction("permissions", opts);
    });
}
