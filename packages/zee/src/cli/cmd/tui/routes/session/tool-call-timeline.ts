import type { Part, ToolPart } from "@zee/sdk/v2"
import path from "path"

type LightweightCounts = {
  thoughts: number
  fileReads: number
  searches: number
  fetches: number
  tasks: number
  todos: number
  questions: number
  skills: number
  tools: number
}

function emptyCounts(): LightweightCounts {
  return {
    thoughts: 0,
    fileReads: 0,
    searches: 0,
    fetches: 0,
    tasks: 0,
    todos: 0,
    questions: 0,
    skills: 0,
    tools: 0,
  }
}

function countAddedLines(diff?: string): number {
  if (!diff) return 0
  return diff.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++")).length
}

function normalizePath(input?: string): string {
  if (!input) return ""
  if (path.isAbsolute(input)) {
    return path.relative(process.cwd(), input) || "."
  }
  return input
}

function toolStatusPrefix(part: ToolPart): string {
  if (part.state.status === "error") return "✗"
  if (part.state.status === "completed") return "✓"
  return "~"
}

function categoryFromTool(tool: string): keyof LightweightCounts {
  switch (tool) {
    case "read":
    case "list":
      return "fileReads"
    case "grep":
    case "glob":
    case "codesearch":
    case "websearch":
      return "searches"
    case "webfetch":
      return "fetches"
    case "task":
      return "tasks"
    case "todowrite":
      return "todos"
    case "question":
      return "questions"
    case "skill":
      return "skills"
    default:
      return "tools"
  }
}

function label(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}

function flushCounts(lines: string[], counts: LightweightCounts) {
  const summary: string[] = []
  if (counts.thoughts > 0) summary.push(label(counts.thoughts, "thought", "thoughts"))
  if (counts.fileReads > 0) summary.push(label(counts.fileReads, "file read", "file reads"))
  if (counts.searches > 0) summary.push(label(counts.searches, "search", "searches"))
  if (counts.fetches > 0) summary.push(label(counts.fetches, "fetch", "fetches"))
  if (counts.tasks > 0) summary.push(label(counts.tasks, "task", "tasks"))
  if (counts.todos > 0) summary.push(label(counts.todos, "todo update", "todo updates"))
  if (counts.questions > 0) summary.push(label(counts.questions, "question", "questions"))
  if (counts.skills > 0) summary.push(label(counts.skills, "skill", "skills"))
  if (counts.tools > 0) summary.push(label(counts.tools, "tool", "tools"))

  if (summary.length > 0) {
    lines.push(`✓ ${summary.join(", ")}`)
  }

  counts.thoughts = 0
  counts.fileReads = 0
  counts.searches = 0
  counts.fetches = 0
  counts.tasks = 0
  counts.todos = 0
  counts.questions = 0
  counts.skills = 0
  counts.tools = 0
}

function formatBashLine(part: ToolPart): string {
  const command = String(part.state.input?.command ?? "").trim()
  if (!command) return `${toolStatusPrefix(part)} command`
  if (part.state.status === "completed") return `$ ${command}`
  return `${toolStatusPrefix(part)} $ ${command}`
}

function formatWriteLine(part: ToolPart): string {
  const filePath = normalizePath(String(part.state.input?.filePath ?? ""))
  if (!filePath) return `${toolStatusPrefix(part)} wrote file`
  return `${toolStatusPrefix(part)} Wrote ${filePath}`
}

function formatEditLine(part: ToolPart): string {
  const filePath = normalizePath(String(part.state.input?.filePath ?? ""))
  const diff = (part.state as any).metadata?.diff as string | undefined
  const additions = countAddedLines(diff)
  const suffix = additions > 0 ? ` +${additions}` : ""
  if (!filePath) return `${toolStatusPrefix(part)} Edited file${suffix}`
  return `${toolStatusPrefix(part)} Edited ${filePath}${suffix}`
}

function formatApplyPatchLine(part: ToolPart): string {
  const files = ((part.state as any).metadata?.files ?? []) as Array<{
    type?: string
    relativePath?: string
    filePath?: string
    deletions?: number
    diff?: string
  }>
  if (!Array.isArray(files) || files.length === 0) {
    return `${toolStatusPrefix(part)} Edited files`
  }

  if (files.length > 1) {
    return `${toolStatusPrefix(part)} Edited files`
  }

  const file = files[0]
  const target = normalizePath(file?.relativePath ?? file?.filePath ?? "")
  if (file?.type === "delete") {
    const deleted = typeof file.deletions === "number" && file.deletions > 0 ? ` -${file.deletions}` : ""
    return `${toolStatusPrefix(part)} Deleted ${target || "file"}${deleted}`
  }
  const additions = countAddedLines(file?.diff)
  const suffix = additions > 0 ? ` +${additions}` : ""
  return `${toolStatusPrefix(part)} Edited ${target || "file"}${suffix}`
}

function formatGenericToolLine(part: ToolPart): string {
  const prefix = toolStatusPrefix(part)
  return `${prefix} ${part.tool.replace(/_/g, " ")}`
}

function formatConcreteToolLine(part: ToolPart): string {
  switch (part.tool) {
    case "bash":
      return formatBashLine(part)
    case "write":
      return formatWriteLine(part)
    case "edit":
      return formatEditLine(part)
    case "apply_patch":
      return formatApplyPatchLine(part)
    default:
      return formatGenericToolLine(part)
  }
}

function shouldBeConcrete(part: ToolPart): boolean {
  if (part.state.status === "error") return true
  switch (part.tool) {
    case "bash":
    case "write":
    case "edit":
    case "apply_patch":
      return true
    default:
      return false
  }
}

export function buildCompactToolTimeline(parts: Part[]): string[] {
  const lines: string[] = []
  const counts = emptyCounts()

  for (const part of parts) {
    if (part.type === "reasoning") {
      if (part.text.trim()) counts.thoughts += 1
      continue
    }

    if (part.type !== "tool") continue

    if (shouldBeConcrete(part)) {
      flushCounts(lines, counts)
      lines.push(formatConcreteToolLine(part))
      continue
    }

    const category = categoryFromTool(part.tool)
    counts[category] += 1
  }

  flushCounts(lines, counts)
  return lines
}
