import type { Argv } from "yargs"
import fs from "node:fs/promises"
import path from "node:path"
import { cmd } from "./cmd"
import type { CompareFormat, CompareScope } from "../../compare/types"
import { getCatalog } from "../../compare/catalog"
import { collectSnapshot } from "../../compare/snapshot"
import { renderCompare } from "../../compare/render"

type CompareArgs = {
  format?: CompareFormat
  scope?: CompareScope
  output?: string
  fetch?: boolean
  metrics?: boolean
  pins?: boolean
}

const FORMATS: CompareFormat[] = ["text", "md", "json"]
const SCOPES: CompareScope[] = ["quick", "full"]

export const CompareCommand = cmd({
  command: "compare",
  describe: "Compare features across Zee, OpenCode, OpenClaw, and Pi-mono",
  builder: (yargs: Argv) => {
    return yargs
      .option("format", {
        type: "string",
        choices: FORMATS,
        default: "text",
        describe: "Output format (text, md, json)",
      })
      .option("scope", {
        type: "string",
        choices: SCOPES,
        default: "quick",
        describe: "Output scope (quick: matrix only; full: include notes and warnings)",
      })
      .option("output", {
        alias: "o",
        type: "string",
        describe: "Write output to a file path instead of stdout",
      })
      .option("fetch", {
        type: "boolean",
        default: false,
        describe: "Fetch upstream git remotes before collecting snapshot pins",
      })
      .option("metrics", {
        type: "boolean",
        default: true,
        describe: "Include snapshot metrics (pins, versions, counts). Disable with --no-metrics",
      })
      .option("pins", {
        type: "boolean",
        default: false,
        describe: "Include snapshot pins even in quick scope (text/md)",
      })
  },
  handler: async (args) => {
    try {
      const typed = args as CompareArgs
      const format = (typed.format ?? "text") as CompareFormat
      const scope = (typed.scope ?? "quick") as CompareScope

      if (!FORMATS.includes(format)) {
        console.error(`Invalid --format. Valid: ${FORMATS.join(", ")}`)
        process.exit(2)
      }
      if (!SCOPES.includes(scope)) {
        console.error(`Invalid --scope. Valid: ${SCOPES.join(", ")}`)
        process.exit(2)
      }

      const features = getCatalog()

      const snapshot =
        typed.metrics === false
          ? undefined
          : await collectSnapshot({
              fetch: Boolean(typed.fetch),
            })

      const snapshotForTextOrMd = scope === "full" || Boolean(typed.pins) ? snapshot : undefined
      const snapshotForRender = format === "json" ? snapshot : snapshotForTextOrMd

      const rendered = renderCompare({
        features,
        snapshot: snapshotForRender,
        scope,
        format,
      })

      const payload = format === "json" ? JSON.stringify(rendered, null, 2) + "\n" : String(rendered).trimEnd() + "\n"

      if (typed.output) {
        const outPath = path.resolve(String(typed.output))
        await fs.mkdir(path.dirname(outPath), { recursive: true })
        await fs.writeFile(outPath, payload, "utf-8")
        process.stderr.write(`Wrote ${outPath}\n`)
        return
      }

      process.stdout.write(payload)
    } catch (error) {
      console.error("compare failed:", error instanceof Error ? error.message : String(error))
      process.exit(2)
    }
  },
})
