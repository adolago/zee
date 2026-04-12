import { cmd } from "./cmd"
import { UI } from "../ui"
import {
  getLocalMemoryStatus,
  prepareLocalMemory,
  type LocalMemoryScope,
} from "../../../../../src/memory/local-runtime"

type MemoryArgs = {
  scope?: LocalMemoryScope
  json?: boolean
}

function parseScope(scope?: string): LocalMemoryScope | undefined {
  if (scope === "user" || scope === "machine") return scope
  return undefined
}

function printStatus(status: Awaited<ReturnType<typeof getLocalMemoryStatus>>): void {
  if (status.ok) {
    UI.success(`Local memory is ready (${status.scope} scope)`)
  } else {
    UI.warn(`Local memory is not fully prepared (${status.scope} scope)`)
  }
  UI.info(`Vector DB: ${status.sqlite.vectorDbPath}`)
  UI.info(`FTS DB: ${status.sqlite.ftsDbPath}`)
  UI.info(`Embedding: ${status.embedding.model} (${status.embedding.dimensions} dims)`)
  UI.info(`Model manifest: ${status.embedding.modelManifestPath}`)
  if (status.sqlite.error) UI.warn(`SQLite: ${status.sqlite.error}`)
  if (status.embedding.error) UI.warn(`Embedding: ${status.embedding.error}`)
}

export const MemoryCommand = cmd({
  command: "memory <action>",
  describe: "Prepare and inspect Zee local memory",
  builder: (yargs) =>
    yargs
      .positional("action", {
        type: "string",
        choices: ["prepare", "status"],
        describe: "Memory action",
      })
      .option("scope", {
        type: "string",
        choices: ["user", "machine"],
        describe: "Preparation scope. Windows machine scope uses ProgramData.",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "Output JSON",
      }),
  async handler(args) {
    const action = String(args.action)
    const options = { scope: parseScope(args.scope as string | undefined) }
    const status = action === "prepare" ? await prepareLocalMemory(options) : await getLocalMemoryStatus(options)

    if ((args as MemoryArgs).json) {
      console.log(JSON.stringify(status, null, 2))
    } else {
      printStatus(status)
    }

    if (!status.ok) process.exitCode = 1
  },
})
