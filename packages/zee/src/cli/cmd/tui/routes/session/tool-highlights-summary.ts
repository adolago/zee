import type { Part } from "@zee/sdk/v2"

type SummaryCounts = {
  thoughts: number
  fileReads: number
  searches: number
  writes: number
  commands: number
  fetches: number
  tasks: number
  todos: number
  questions: number
  skills: number
  tools: number
}

function label(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}

function emptyCounts(): SummaryCounts {
  return {
    thoughts: 0,
    fileReads: 0,
    searches: 0,
    writes: 0,
    commands: 0,
    fetches: 0,
    tasks: 0,
    todos: 0,
    questions: 0,
    skills: 0,
    tools: 0,
  }
}

function countParts(parts: Part[]): SummaryCounts {
  const counts = emptyCounts()

  for (const part of parts) {
    if (part.type === "reasoning" && part.text.trim()) {
      counts.thoughts += 1
      continue
    }

    if (part.type !== "tool") continue

    switch (part.tool) {
      case "read":
      case "list":
        counts.fileReads += 1
        break
      case "grep":
      case "glob":
      case "codesearch":
      case "websearch":
        counts.searches += 1
        break
      case "write":
      case "edit":
      case "apply_patch":
        counts.writes += 1
        break
      case "bash":
        counts.commands += 1
        break
      case "webfetch":
        counts.fetches += 1
        break
      case "task":
        counts.tasks += 1
        break
      case "todowrite":
        counts.todos += 1
        break
      case "question":
        counts.questions += 1
        break
      case "skill":
        counts.skills += 1
        break
      default:
        counts.tools += 1
        break
    }
  }

  return counts
}

export function summarizeToolHighlights(parts: Part[]): string | undefined {
  const counts = countParts(parts)
  const summary: string[] = []

  if (counts.thoughts > 0) summary.push(label(counts.thoughts, "thought", "thoughts"))
  if (counts.fileReads > 0) summary.push(label(counts.fileReads, "file read", "file reads"))
  if (counts.searches > 0) summary.push(label(counts.searches, "search", "searches"))
  if (counts.writes > 0) summary.push(label(counts.writes, "write", "writes"))
  if (counts.commands > 0) summary.push(label(counts.commands, "command", "commands"))
  if (counts.fetches > 0) summary.push(label(counts.fetches, "fetch", "fetches"))
  if (counts.tasks > 0) summary.push(label(counts.tasks, "task", "tasks"))
  if (counts.todos > 0) summary.push(label(counts.todos, "todo update", "todo updates"))
  if (counts.questions > 0) summary.push(label(counts.questions, "question", "questions"))
  if (counts.skills > 0) summary.push(label(counts.skills, "skill", "skills"))
  if (counts.tools > 0) summary.push(label(counts.tools, "tool", "tools"))

  if (summary.length === 0) return undefined
  return summary.join(" · ")
}
