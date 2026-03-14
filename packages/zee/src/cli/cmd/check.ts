/**
 * @file CLI Check Command
 * @description CLI entry point for health checks
 */

import type { Argv } from "yargs"
import { CheckEngine } from "../../diagnostics/check-engine"
import { InteractiveReporter } from "../../diagnostics/reporters/interactive"
import { JsonReporter } from "../../diagnostics/reporters/json"
import { MinimalReporter } from "../../diagnostics/reporters/minimal"
import type { CheckCategory } from "../../diagnostics/types"
import { cmd } from "./cmd"

const VALID_CATEGORIES: CheckCategory[] = ["runtime", "config", "providers", "integrity", "skills"]

type CheckArgs = {
  full?: boolean
  fix?: boolean
  json?: boolean
  minimal?: boolean
  verbose?: boolean
  timeout?: number
  category?: string[]
  skip?: string[]
  color?: boolean
}

export const CheckCommand = cmd({
  command: "check",
  describe: "Run diagnostic health checks",
  builder: (yargs: Argv) => {
    return yargs
      .option("full", {
        type: "boolean",
        default: false,
        describe: "Run extended checks (slower but more thorough)",
      })
      .option("fix", {
        type: "boolean",
        default: false,
        describe: "Attempt to auto-fix detected issues",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "Output in JSON format for scripting",
      })
      .option("minimal", {
        type: "boolean",
        default: false,
        describe: "Single-line output for scripts",
      })
      .option("verbose", {
        alias: "v",
        type: "boolean",
        default: false,
        describe: "Show detailed output including check details",
      })
      .option("timeout", {
        type: "number",
        default: 10000,
        describe: "Timeout per category in milliseconds",
      })
      .option("category", {
        type: "string",
        array: true,
        choices: VALID_CATEGORIES,
        describe: "Run only specific categories (runtime, config, providers, integrity, skills)",
      })
      .option("skip", {
        type: "string",
        array: true,
        describe: "Skip specific check IDs",
      })
      .option("color", {
        type: "boolean",
        default: true,
        describe: "Enable colored output",
      })
  },
  handler: async (args: CheckArgs) => {
    try {
      let categories: CheckCategory[] | undefined
      if (args.category?.length) {
        categories = args.category.filter((c): c is CheckCategory => VALID_CATEGORIES.includes(c as CheckCategory))
        if (categories.length === 0) {
          console.error(`Invalid categories. Valid options: ${VALID_CATEGORIES.join(", ")}`)
          process.exit(2)
        }
      }

      const engine = new CheckEngine({
        full: Boolean(args.full),
        fix: Boolean(args.fix),
        verbose: Boolean(args.verbose),
        timeout: args.timeout ?? 10000,
        categories,
        skip: args.skip,
      })

      const report = await engine.runAll()

      if (args.json) {
        const reporter = new JsonReporter()
        console.log(reporter.format(report))
      } else if (args.minimal) {
        const reporter = new MinimalReporter()
        console.log(reporter.format(report))
      } else {
        const reporter = new InteractiveReporter({
          verbose: args.verbose,
          colors: args.color !== false,
        })
        console.log(reporter.format(report))
      }

      if (report.summary.failed > 0) {
        process.exit(1)
      }
      process.exit(0)
    } catch (error) {
      console.error("Health check failed:", error instanceof Error ? error.message : String(error))
      process.exit(2)
    }
  },
})

export async function checkEnvironment(): Promise<void> {
  const engine = new CheckEngine({
    full: false,
    fix: false,
    verbose: false,
    timeout: 5000,
    categories: ["runtime", "config"],
  })

  const report = await engine.runAll()
  if (report.summary.failed > 0) {
    const reporter = new MinimalReporter()
    console.error(reporter.format(report))
    throw new Error("Environment checks failed")
  }
}

// Help examples
export const checkExamples = `
Examples:
  $ zee check                    # Run basic health checks
  $ zee check --full             # Run all checks including extended
  $ zee check --fix              # Auto-fix repairable issues
  $ zee check --json             # Output as JSON for CI
  $ zee check --category runtime # Check only runtime category
  $ zee check --skip runtime.disk-space  # Skip specific check
  $ zee check --verbose          # Show detailed output

Check Categories:
  runtime    - Bun version, directories, disk, memory
  config     - Configuration validation, deprecated options
  providers  - AI provider connectivity (Anthropic, OpenAI, Ollama)
  integrity  - Lock files, processes, session files
  skills     - Skill discovery, loading, conflicts, environment
  skills     - Skill discovery, loading, conflicts, env vars

Exit Codes:
  0 - All checks passed
  1 - One or more checks failed
  2 - Command error (invalid args, etc.)
`
