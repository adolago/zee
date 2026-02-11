import type { Command } from "commander";
import { collectOption } from "../helpers.js";
import type { MessageCliHelpers } from "./helpers.js";

export function registerMessageStickerCommands(message: Command, helpers: MessageCliHelpers) {
  const sticker = message.command("sticker").description("Sticker actions");

  helpers
    .withMessageBase(
      helpers.withRequiredMessageTarget(sticker.command("send").description("Send stickers")),
    )
    .requiredOption("--sticker-id <id>", "Sticker id (repeat)", collectOption)
    .option("-m, --message <text>", "Optional message body")
    .action(async (opts) => {
      await helpers.runMessageAction("sticker", opts);
    });
}
