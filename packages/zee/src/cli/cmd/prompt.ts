import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { checkEnvironment } from "./check"
import { Investing } from "../../paths"
import { UI } from "../ui"
import { reloadFlags } from "../../flag/flag"
import { Session } from "../../session"
import { SessionPrompt } from "../../session/prompt"
import { Identifier } from "../../id/id"
import { Provider } from "../../provider/provider"
import type { MessageV2 } from "../../session/message-v2"

type PromptPermissionScope = "full" | "readonly" | "explore"

function extractResponseText(parts: MessageV2.Part[]): string {
  return parts
    .filter((part): part is MessageV2.TextPart => part.type === "text")
    .map((part) => part.text)
    .join("")
}

export const PromptCommand = cmd({
  command: "prompt [message..]",
  describe: "send a single prompt through the session runtime without the TUI",
  builder: (yargs: Argv) =>
    yargs
      .positional("message", {
        describe: "message to send",
        type: "string",
        array: true,
        default: [],
      })
      .option("agent", {
        type: "string",
        describe: "agent to use",
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "print the assistant message as JSON",
      })
      .option("no-tui", {
        type: "boolean",
        default: false,
        hidden: true,
        describe: "mark the prompt as a non-TUI daemon worker execution",
      })
      .option("permission-scope", {
        type: "string",
        choices: ["full", "readonly", "explore"],
        describe: "override the worker permission scope",
      }),
  handler: async (args) => {
    await checkEnvironment()

    const investingErr = Investing.preflight()
    if (investingErr) {
      UI.error("Investing backend is not ready:\n" + investingErr)
      process.exit(1)
    }

    const agent = typeof args.agent === "string" ? args.agent : undefined
    const model = typeof args.model === "string" ? args.model : undefined
    const noTui = args.noTui === true
    const jsonOutput = args.json === true
    const permissionScope = args.permissionScope as PromptPermissionScope | undefined
    if (permissionScope) {
      process.env.ZEE_PERMISSION_SCOPE = permissionScope
    }

    if (noTui) {
      process.env.ZEE_CLIENT = "daemon"
      reloadFlags()
    }

    let message = [...args.message, ...(args["--"] || [])].join(" ").trim()
    if (!process.stdin.isTTY) {
      const stdin = (await Bun.stdin.text()).trim()
      if (stdin) {
        message = message ? `${message}\n${stdin}` : stdin
      }
    }

    if (!message) {
      UI.error("You must provide a prompt")
      process.exit(1)
    }

    await bootstrap(process.cwd(), async () => {
      const session = await Session.create({
        surface: noTui ? "api" : "cli",
      })

      const result = await SessionPrompt.prompt({
        sessionID: session.id,
        messageID: Identifier.ascending("message"),
        agent,
        model: model ? Provider.parseModel(model) : undefined,
        parts: [
          {
            id: Identifier.ascending("part"),
            type: "text",
            text: message,
          },
        ],
      })

      if (result.info.role === "assistant" && result.info.error) {
        const errorMessage = String("message" in result.info.error ? result.info.error.message : result.info.error.name)
        UI.error(errorMessage)
        process.exit(1)
      }

      if (jsonOutput) {
        console.log(JSON.stringify(result, null, 2))
        return
      }

      const text = extractResponseText(result.parts)
      if (text) {
        process.stdout.write(text.endsWith("\n") ? text : text + "\n")
      }
    })
  },
})
