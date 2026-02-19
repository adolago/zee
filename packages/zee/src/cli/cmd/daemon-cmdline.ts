/**
 * Parse process command line text into argv.
 *
 * - Linux `/proc/<pid>/cmdline` payloads are NUL-separated.
 * - Fallback `ps` output is shell-like text where quoted segments should stay intact.
 * - Backslashes are preserved unless they intentionally escape `"` or `\`.
 */
export function parseDaemonCommandLineArgs(cmdline: string): string[] {
  if (cmdline.includes("\0")) {
    return cmdline.split("\0").filter(Boolean)
  }

  return parseQuotedCommandLine(cmdline.trim())
}

function parseQuotedCommandLine(input: string): string[] {
  if (!input) return []

  const args: string[] = []
  let current = ""
  let inQuotes = false
  let hasToken = false

  const push = () => {
    if (!hasToken) return
    args.push(current)
    current = ""
    hasToken = false
  }

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!

    // Preserve backslashes by default so Windows drive/UNC paths survive.
    // Only treat backslash as an escape for quote.
    if (ch === "\\" && i + 1 < input.length) {
      const next = input[i + 1]!
      if (next === '"') {
        current += next
        hasToken = true
        i++
        continue
      }
      current += ch
      hasToken = true
      continue
    }

    if (ch === '"') {
      inQuotes = !inQuotes
      hasToken = true
      continue
    }

    if (!inQuotes && /\s/.test(ch)) {
      push()
      continue
    }

    current += ch
    hasToken = true
  }

  push()
  return args
}
