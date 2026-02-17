import { cmd } from "../cmd"
import { Output } from "../../output"
import { readZeeGatewayTokenFromFile } from "@/gateway/token"

type TokenArgs = {
  print?: boolean
}

async function resolveToken(): Promise<{
  token?: string
  source: "env" | "file" | "none"
  warnings: string[]
}> {
  const warnings: string[] = []

  const envToken = process.env.ZEE_GATEWAY_TOKEN?.trim()
  if (envToken) {
    return { token: envToken, source: "env", warnings }
  }

  const fileToken =
    (await readZeeGatewayTokenFromFile({
      env: process.env,
      log: {
        warn: (message, extra) => {
          const details = extra?.path ? ` (path: ${String(extra.path)})` : ""
          warnings.push(`${message}${details}`)
        },
      },
    }).catch(() => undefined)) ?? undefined

  if (fileToken) return { token: fileToken, source: "file", warnings }
  return { token: undefined, source: "none", warnings }
}

export const GatewayTokenCommand = cmd({
  command: "token",
  describe: "Show gateway token status (use --print to output the token)",
  builder: (yargs) =>
    yargs.option("print", {
      type: "boolean",
      default: false,
      describe: "Print the token to stdout (careful: this is a secret)",
    }),
  handler: async (args) => {
    const typed = args as TokenArgs
    const { token, source, warnings } = await resolveToken()

    if (warnings.length > 0) {
      Output.log("Warnings:")
      for (const w of warnings) Output.log(`  - ${w}`)
    }

    if (typed.print) {
      if (!token) {
        Output.error("No gateway token found (ZEE_GATEWAY_TOKEN or token file).")
        process.exit(1)
      }
      process.stdout.write(token + "\n")
      return
    }

    const fileHint = process.env.ZEE_GATEWAY_TOKEN_FILE?.trim() ? " (ZEE_GATEWAY_TOKEN_FILE)" : ""
    Output.log("Gateway Token")
    Output.log(`  Env:    ${process.env.ZEE_GATEWAY_TOKEN?.trim() ? "set (ZEE_GATEWAY_TOKEN)" : "unset"}`)
    Output.log(`  File:   ${source === "file" ? `set${fileHint}` : `unset${fileHint}`}`)
    Output.log(`  Result: ${token ? `set (${source})` : "unset"}`)
    Output.log("  Hint:   Use `zee gateway token --print` to print the token.")
  },
})
