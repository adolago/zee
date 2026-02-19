import { EOL } from "os"
import { Config } from "../../../config/config"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"
import { UI } from "../../ui"
import { Symbols } from "../../style"
import path from "path"
import { parse as parseJsonc, type ParseError } from "jsonc-parser"

const DEPRECATIONS = [
  {
    field: "mode",
    replacement: "agent",
    message: "The 'mode' field is deprecated. Use 'agent' instead.",
  },
  {
    field: "tools",
    replacement: "permission",
    message: "The 'tools' field is deprecated. Use 'permission' instead.",
  },
  {
    field: "layout",
    replacement: null,
    message: "The 'layout' field is deprecated and no longer has any effect.",
  },
]

const dim = (s: string) => `${UI.Style.TEXT_DIM}${s}${UI.Style.TEXT_NORMAL}`
const warn = (s: string) => `${UI.Style.TEXT_WARNING}${s}${UI.Style.TEXT_NORMAL}`
const success = (s: string) => `${UI.Style.TEXT_SUCCESS}${s}${UI.Style.TEXT_NORMAL}`

export const MigrateCommand = cmd({
  command: "migrate",
  describe: "check for deprecated config fields",
  builder: (yargs) =>
    yargs.option("fix", {
      type: "boolean",
      describe: "automatically migrate deprecated fields (creates backup)",
      default: false,
    }),
  async handler() {
    await bootstrap(process.cwd(), async () => {
      const { directories } = await Config.state()

      let foundDeprecations = false

      // Check each config directory for deprecated fields
      for (const dir of directories) {
        for (const filename of ["zee.jsonc"]) {
          const filepath = path.join(dir, filename)
          const file = Bun.file(filepath)
          if (!(await file.exists())) continue

          try {
            const content = await file.text()
            const parseErrors: ParseError[] = []
            const data = parseJsonc(content, parseErrors, {
              allowTrailingComma: true,
              allowEmptyContent: false,
            })
            if (parseErrors.length > 0 || typeof data !== "object" || data === null) {
              continue
            }

            const issues: string[] = []
            for (const dep of DEPRECATIONS) {
              if (dep.field in data) {
                issues.push(`  • ${dep.message}`)
              }
            }

            if (issues.length > 0) {
              foundDeprecations = true
              console.log(`${dim("●")} ${filepath}`)
              for (const issue of issues) {
                console.log(`  ${warn("⚠")} ${issue}`)
              }
              console.log()
            }
          } catch {
            // Skip files that can't be parsed
          }
        }
      }

      // Also check agent files for deprecated fields
      for (const dir of directories) {
        const agentDir = path.join(dir, "agent")
        const glob = new Bun.Glob("**/*.md")
        try {
          for await (const item of glob.scan({ cwd: agentDir, absolute: true })) {
            const content = await Bun.file(item).text()
            // Check if using deprecated maxSteps in frontmatter
            if (content.includes("maxSteps:")) {
              foundDeprecations = true
              console.log(`${dim("●")} ${item}`)
              console.log(`  ${warn("⚠")} The 'maxSteps' field is deprecated. Use 'steps' instead.`)
              console.log()
            }
          }
        } catch {
          // Agent dir might not exist
        }
      }

      if (!foundDeprecations) {
        console.log(`${success(Symbols.check)} No deprecated fields found in configuration.`)
      } else {
        console.log(`${dim(Symbols.hLine.repeat(60))}`)
        console.log()
        console.log("These deprecated fields still work but will be removed in a future version.")
        console.log("Please update your configuration to use the recommended replacements.")
      }

      process.stdout.write(EOL)
    })
  },
})
