import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { Session } from "../../session"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"
import { Locale } from "../../util/locale"
import { Flag } from "../../flag/flag"
import { EOL } from "os"
import path from "path"

function pagerCmd(): string[] {
  const lessOptions = ["-R", "-S"]
  if (process.platform !== "win32") {
    return ["less", ...lessOptions]
  }

  // user could have less installed via other options
  const lessOnPath = Bun.which("less")
  if (lessOnPath) {
    if (Bun.file(lessOnPath).size) return [lessOnPath, ...lessOptions]
  }

  if (Flag.ZEE_GIT_BASH_PATH) {
    const less = path.join(Flag.ZEE_GIT_BASH_PATH, "..", "..", "usr", "bin", "less.exe")
    if (Bun.file(less).size) return [less, ...lessOptions]
  }

  const git = Bun.which("git")
  if (git) {
    const less = path.join(git, "..", "..", "usr", "bin", "less.exe")
    if (Bun.file(less).size) return [less, ...lessOptions]
  }

  // Fall back to Windows built-in more (via cmd.exe)
  return ["cmd", "/c", "more"]
}

async function collectSessions(): Promise<Session.Info[]> {
  const sessions: Session.Info[] = []
  for await (const session of Session.list()) {
    sessions.push(session)
  }
  return sessions
}

type SessionTreeNode = {
  info: Session.Info
  children: SessionTreeNode[]
}

function buildSessionTree(sessions: Session.Info[]): SessionTreeNode[] {
  const byId = new Map<string, Session.Info>()
  const byParent = new Map<string, Session.Info[]>()

  for (const session of sessions) {
    byId.set(session.id, session)
    if (!session.parentID) continue
    const list = byParent.get(session.parentID) ?? []
    list.push(session)
    byParent.set(session.parentID, list)
  }

  const roots = sessions
    .filter((session) => !session.parentID || !byId.has(session.parentID))
    .sort((a, b) => b.time.updated - a.time.updated)

  const toNode = (session: Session.Info): SessionTreeNode => {
    const children = (byParent.get(session.id) ?? [])
      .slice()
      .sort((a, b) => a.time.created - b.time.created)
      .map(toNode)

    return {
      info: session,
      children,
    }
  }

  return roots.map(toNode)
}

function formatSessionTree(nodes: SessionTreeNode[]): string {
  const lines: string[] = []

  const render = (node: SessionTreeNode, prefix: string, isLast: boolean, isRoot: boolean) => {
    const marker = isRoot ? "" : isLast ? "`- " : "|- "
    const timestamp = Locale.todayTimeOrDateTime(node.info.time.updated)
    lines.push(`${prefix}${marker}${node.info.id}  ${node.info.title}  (${timestamp})`)

    const nextPrefix = isRoot ? "" : prefix + (isLast ? "   " : "|  ")
    node.children.forEach((child, index) => {
      render(child, nextPrefix, index === node.children.length - 1, false)
    })
  }

  nodes.forEach((node, index) => {
    render(node, "", index === nodes.length - 1, true)
  })

  return lines.join(EOL)
}

function formatSessionTreeJSON(nodes: SessionTreeNode[]): string {
  const simplify = (node: SessionTreeNode): unknown => ({
    id: node.info.id,
    parentID: node.info.parentID,
    title: node.info.title,
    created: node.info.time.created,
    updated: node.info.time.updated,
    children: node.children.map((child) => simplify(child)),
  })

  return JSON.stringify(
    nodes.map((node) => simplify(node)),
    null,
    2,
  )
}

export const SessionCommand = cmd({
  command: "session",
  describe: "manage sessions",
  builder: (yargs: Argv) =>
    yargs.command(SessionListCommand).command(SessionTreeCommand).command(SessionForkCommand).demandCommand(),
  async handler() {},
})

export const SessionListCommand = cmd({
  command: "list",
  describe: "list sessions",
  builder: (yargs: Argv) => {
    return yargs
      .option("max-count", {
        alias: "n",
        describe: "limit to N most recent sessions",
        type: "number",
      })
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["table", "json"],
        default: "table",
      })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const sessions = []
      for await (const session of Session.list()) {
        if (!session.parentID) {
          sessions.push(session)
        }
      }

      sessions.sort((a, b) => b.time.updated - a.time.updated)

      const limitedSessions = args.maxCount ? sessions.slice(0, args.maxCount) : sessions

      if (limitedSessions.length === 0) {
        return
      }

      let output: string
      if (args.format === "json") {
        output = formatSessionJSON(limitedSessions)
      } else {
        output = formatSessionTable(limitedSessions)
      }

      const shouldPaginate = process.stdout.isTTY && !args.maxCount && args.format === "table"

      if (shouldPaginate) {
        const proc = Bun.spawn({
          cmd: pagerCmd(),
          stdin: "pipe",
          stdout: "inherit",
          stderr: "inherit",
        })

        proc.stdin.write(output)
        proc.stdin.end()
        await proc.exited
      } else {
        console.log(output)
      }
    })
  },
})

export const SessionTreeCommand = cmd({
  command: "tree",
  describe: "show parent/child session tree",
  builder: (yargs: Argv) =>
    yargs.option("json", {
      type: "boolean",
      default: false,
      describe: "output as JSON",
    }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const sessions = await collectSessions()
      if (sessions.length === 0) return

      const tree = buildSessionTree(sessions)
      const output = args.json ? formatSessionTreeJSON(tree) : formatSessionTree(tree)
      console.log(output)
    })
  },
})

export const SessionForkCommand = cmd({
  command: "fork <sessionID>",
  describe: "fork a session to a new child session",
  builder: (yargs: Argv) =>
    yargs
      .positional("sessionID", {
        type: "string",
        describe: "session to fork",
      })
      .option("message-id", {
        type: "string",
        describe: "fork up to (but not including) this message id",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "output as JSON",
      }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const sessionID = String(args.sessionID || "").trim()
      if (!sessionID) {
        UI.error("sessionID is required")
        process.exit(2)
      }

      const parent = await Session.get(sessionID)
      if (!parent) {
        UI.error(`Session not found: ${sessionID}`)
        process.exit(1)
      }

      const forked = await Session.fork({
        sessionID,
        messageID: args.messageId ? String(args.messageId) : undefined,
      })

      if (args.json) {
        console.log(
          JSON.stringify(
            {
              parent: {
                id: parent.id,
                title: parent.title,
              },
              fork: {
                id: forked.id,
                title: forked.title,
                parentID: forked.parentID,
                created: forked.time.created,
              },
            },
            null,
            2,
          ),
        )
        return
      }

      console.log(`Forked session ${parent.id} -> ${forked.id}`)
      console.log(`New title: ${forked.title}`)
    })
  },
})

function formatSessionTable(sessions: Session.Info[]): string {
  const lines: string[] = []

  const maxIdWidth = Math.max(20, ...sessions.map((s) => s.id.length))
  const maxTitleWidth = Math.max(25, ...sessions.map((s) => s.title.length))

  const header = `Session ID${" ".repeat(maxIdWidth - 10)}  Title${" ".repeat(maxTitleWidth - 5)}  Updated`
  lines.push(header)
  lines.push("─".repeat(header.length))
  for (const session of sessions) {
    const truncatedTitle = Locale.truncate(session.title, maxTitleWidth)
    const timeStr = Locale.todayTimeOrDateTime(session.time.updated)
    const line = `${session.id.padEnd(maxIdWidth)}  ${truncatedTitle.padEnd(maxTitleWidth)}  ${timeStr}`
    lines.push(line)
  }

  return lines.join(EOL)
}

function formatSessionJSON(sessions: Session.Info[]): string {
  const jsonData = sessions.map((session) => ({
    id: session.id,
    title: session.title,
    updated: session.time.updated,
    created: session.time.created,
    projectId: session.projectID,
    directory: session.directory,
  }))
  return JSON.stringify(jsonData, null, 2)
}
