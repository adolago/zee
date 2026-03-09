/**
 * Knowledge File Loader
 *
 * Loads assistant knowledge files defined in Zee config
 * and injects them into the system prompt.
 */

import fs from "fs/promises"
import path from "path"
import os from "os"

export interface LoadedKnowledge {
  path: string
  content: string
  size: number
}

/**
 * Load knowledge files for an assistant
 */
export async function loadKnowledgeFiles(knowledgePaths: string[] | undefined): Promise<LoadedKnowledge[]> {
  if (!knowledgePaths || knowledgePaths.length === 0) {
    return []
  }

  const loaded: LoadedKnowledge[] = []

  for (const rawPath of knowledgePaths) {
    const resolved = resolvePath(rawPath)

    try {
      const content = await fs.readFile(resolved, "utf-8")
      loaded.push({
        path: rawPath,
        content: content.trim(),
        size: content.length,
      })
    } catch {
      // Log but don't fail - knowledge files are optional
      // console.debug(`Knowledge file not found: ${resolved}`)
    }
  }

  return loaded
}

/**
 * Format loaded knowledge for system prompt
 */
export function formatKnowledgeForPrompt(knowledge: LoadedKnowledge[], maxTokens: number = 4000): string {
  if (knowledge.length === 0) {
    return ""
  }

  const lines: string[] = ["## Knowledge Context", ""]

  let totalSize = 0
  const approxCharsPerToken = 4
  const maxChars = maxTokens * approxCharsPerToken

  for (const file of knowledge) {
    const basename = path.basename(file.path)

    if (totalSize + file.size > maxChars) {
      // Truncate if exceeding budget
      const remaining = maxChars - totalSize
      if (remaining > 500) {
        const truncated = file.content.slice(0, remaining - 50) + "\n...(truncated)"
        lines.push(`### ${basename}`)
        lines.push(truncated)
        lines.push("")
      }
      break
    }

    lines.push(`### ${basename}`)
    lines.push(file.content)
    lines.push("")

    totalSize += file.size
  }

  return lines.join("\n")
}

function resolvePath(inputPath: string): string {
  // Handle environment variable substitution
  let resolved = inputPath.replace(/\$\{([^}]+)\}/g, (_match, varName) => {
    return process.env[varName] ?? ""
  })

  // Handle ~ for home directory
  if (resolved.startsWith("~/")) {
    resolved = path.join(os.homedir(), resolved.slice(2))
  }

  // Handle absolute vs relative paths
  return path.isAbsolute(resolved) ? resolved : path.resolve(process.cwd(), resolved)
}
