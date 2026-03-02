function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Upsert an env variable in dotenv-style text while preserving other lines.
 */
export function upsertEnvVarInText(text: string, key: string, value: string): string {
  const normalized = text.replace(/\r\n/g, "\n")
  const lines = normalized.length > 0 ? normalized.split("\n") : []
  const pattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`)
  const nextLine = `${key}=${value}`

  let replaced = false
  const updated = lines.map((line) => {
    if (pattern.test(line)) {
      replaced = true
      return nextLine
    }
    return line
  })

  if (!replaced) {
    // Keep a visual separator when appending to a non-empty file that doesn't end with a blank line.
    if (updated.length > 0 && updated[updated.length - 1] !== "") {
      updated.push("")
    }
    updated.push(nextLine)
  }

  return updated.join("\n").replace(/\n*$/, "\n")
}

/**
 * Remove an env variable assignment from dotenv-style text.
 */
export function unsetEnvVarInText(text: string, key: string): string {
  const normalized = text.replace(/\r\n/g, "\n")
  const lines = normalized.length > 0 ? normalized.split("\n") : []
  const pattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`)
  const filtered = lines.filter((line) => !pattern.test(line))
  return filtered.join("\n").replace(/\n*$/, "\n")
}

