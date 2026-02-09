import fs from "fs/promises"
import path from "path"
import { Timestamp } from "../../../util/timestamp"
import { cmd } from "../cmd"
import { Global } from "../../../global"
import { resolveWideEventLogPath } from "@/util/wide-events"

export const LogsCommand = cmd({
  command: "logs",
  describe: "view and search log files",
  builder: (yargs) =>
    yargs
      .command(ListLogsCommand)
      .command(TailLogsCommand)
      .command(SearchLogsCommand)
      .command(WideEventsCommand)
      .demandCommand(),
  async handler() {},
})

const ListLogsCommand = cmd({
  command: "list",
  describe: "list available log files",
  async handler() {
    const logDir = Global.Path.log
    try {
      const files = await fs.readdir(logDir)
      const logFiles = files
        .filter((f) => f.endsWith(".log"))
        .sort()
        .reverse()

      if (logFiles.length === 0) {
        console.log("No log files found")
        return
      }

      console.log(`Log files in ${logDir}:\n`)
      for (const file of logFiles) {
        const stat = await fs.stat(path.join(logDir, file))
        const size = formatSize(stat.size)
        const date = Timestamp.iso(stat.mtime).replace("T", " ").slice(0, 19)
        console.log(`  ${file.padEnd(30)} ${size.padStart(10)} ${date}`)
      }
    } catch (e) {
      console.error(`Error reading log directory: ${e}`)
    }
  },
})

const TailLogsCommand = cmd({
  command: "tail [file]",
  describe: "show last N lines of a log file",
  builder: (yargs) =>
    yargs
      .positional("file", {
        type: "string",
        describe: "log file name (defaults to latest)",
      })
      .option("lines", {
        alias: "n",
        type: "number",
        default: 50,
        describe: "number of lines to show",
      }),
  async handler(args) {
    const logDir = Global.Path.log
    let logFile = args.file

    if (!logFile) {
      const files = await fs.readdir(logDir)
      const logFiles = files
        .filter((f) => f.endsWith(".log"))
        .sort()
        .reverse()
      if (logFiles.length === 0) {
        console.error("No log files found")
        return
      }
      logFile = logFiles[0]
    }

    const filePath = path.join(logDir, logFile)
    try {
      const content = await fs.readFile(filePath, "utf-8")
      const lines = content.trim().split("\n")
      const lastLines = lines.slice(-args.lines)
      console.log(lastLines.join("\n"))
    } catch (e) {
      console.error(`Error reading log file: ${e}`)
    }
  },
})

const SearchLogsCommand = cmd({
  command: "search <pattern>",
  describe: "search logs for a pattern",
  builder: (yargs) =>
    yargs
      .positional("pattern", {
        type: "string",
        demandOption: true,
        describe: "pattern to search for",
      })
      .option("file", {
        alias: "f",
        type: "string",
        describe: "specific log file (defaults to all recent logs)",
      })
      .option("context", {
        alias: "C",
        type: "number",
        default: 0,
        describe: "lines of context around matches",
      })
      .option("ignore-case", {
        alias: "i",
        type: "boolean",
        default: true,
        describe: "case insensitive search",
      }),
  async handler(args) {
    const logDir = Global.Path.log
    const pattern = args.ignoreCase ? new RegExp(args.pattern, "i") : new RegExp(args.pattern)

    let filesToSearch: string[] = []

    if (args.file) {
      filesToSearch = [args.file]
    } else {
      const files = await fs.readdir(logDir)
      filesToSearch = files
        .filter((f) => f.endsWith(".log"))
        .sort()
        .reverse()
        .slice(0, 5) // Search last 5 log files
    }

    let totalMatches = 0

    for (const file of filesToSearch) {
      const filePath = path.join(logDir, file)
      try {
        const content = await fs.readFile(filePath, "utf-8")
        const lines = content.split("\n")
        const matches: Array<{ line: number; text: string }> = []

        for (let i = 0; i < lines.length; i++) {
          if (pattern.test(lines[i])) {
            matches.push({ line: i + 1, text: lines[i] })
          }
        }

        if (matches.length > 0) {
          console.log(`\n=== ${file} (${matches.length} matches) ===\n`)
          for (const match of matches) {
            if (args.context > 0) {
              const start = Math.max(0, match.line - 1 - args.context)
              const end = Math.min(lines.length, match.line + args.context)
              for (let i = start; i < end; i++) {
                const prefix = i === match.line - 1 ? ">" : " "
                console.log(`${prefix} ${(i + 1).toString().padStart(6)}: ${lines[i]}`)
              }
              console.log("")
            } else {
              console.log(`${match.line.toString().padStart(6)}: ${match.text}`)
            }
          }
          totalMatches += matches.length
        }
      } catch (e) {
        console.error(`Error reading ${file}: ${e}`)
      }
    }

    console.log(`\nTotal: ${totalMatches} matches`)
  },
})

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

const WideEventsCommand = cmd({
  command: "wide [file]",
  describe: "show recent wide events",
  builder: (yargs) =>
    yargs
      .positional("file", {
        type: "string",
        describe: "wide events file path (defaults to current)",
      })
      .option("lines", {
        alias: "n",
        type: "number",
        default: 50,
        describe: "number of lines to show",
      })
      .option("where", {
        alias: "w",
        type: "array",
        describe: "filter key=value (repeatable)",
      }),
  async handler(args) {
    const logFile = args.file ? String(args.file) : await resolveWideEventLogPath()
    const filters = parseFilters(args.where as string[] | undefined)
    try {
      const content = await fs.readFile(logFile, "utf-8")
      const lines = content.trim().split("\n")
      const parsed = lines
        .map((line) => {
          try {
            return JSON.parse(line) as Record<string, unknown>
          } catch {
            return null
          }
        })
        .filter((line): line is Record<string, unknown> => Boolean(line))
        .filter((line) => matchesFilters(line, filters))
      const lastLines = parsed.slice(-args.lines)
      for (const line of lastLines) {
        const ts = typeof line.ts === "string" ? line.ts : ""
        const outcome = typeof line.outcome === "string" ? line.outcome : ""
        const sessionId = typeof line.sessionId === "string" ? line.sessionId : ""
        const summary = [ts, outcome, sessionId].filter(Boolean).join(" ")
        console.log(summary || JSON.stringify(line))
      }
    } catch (e) {
      console.error(`Error reading wide events: ${e}`)
    }
  },
})

function parseFilters(raw?: string[]) {
  const filters: Record<string, string> = {}
  if (!raw) return filters
  for (const item of raw) {
    const text = String(item).trim()
    if (!text) continue
    const [key, ...rest] = text.split("=")
    if (!key || rest.length === 0) continue
    filters[key.trim()] = rest.join("=").trim()
  }
  return filters
}

function matchesFilters(line: Record<string, unknown>, filters: Record<string, string>) {
  for (const [key, value] of Object.entries(filters)) {
    if (String(line[key] ?? "") !== value) return false
  }
  return true
}
