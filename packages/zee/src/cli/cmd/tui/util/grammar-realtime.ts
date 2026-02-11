import { createSignal } from "solid-js"
import { Grammar } from "./grammar"

export interface GrammarError {
  start: number
  end: number
  message: string
  shortMessage: string
  replacements: string[]
  ruleId: string
  category: "spelling" | "grammar" | "style"
}

export interface GrammarCheckerOptions {
  debounceMs?: number
  enabled: () => boolean
  config?: () => { username?: string; apiKey?: string } | undefined
}

export interface GrammarChecker {
  check: (text: string) => void
  errors: () => GrammarError[]
  loading: () => boolean
  cancel: () => void
  clear: () => void
}

function categorizeError(issueType: string): GrammarError["category"] {
  const type = issueType.toLowerCase()
  if (type === "misspelling" || type.includes("spell")) {
    return "spelling"
  }
  if (type === "style" || type.includes("style") || type === "typographical") {
    return "style"
  }
  return "grammar"
}

export function createGrammarChecker(options: GrammarCheckerOptions): GrammarChecker {
  const debounceMs = options.debounceMs ?? 500
  const [errors, setErrors] = createSignal<GrammarError[]>([])
  const [loading, setLoading] = createSignal(false)

  let debounceTimer: ReturnType<typeof setTimeout> | undefined
  let abortController: AbortController | undefined
  let lastCheckedText = ""
  let pendingText: string | undefined

  function cancel() {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = undefined
    }
    if (abortController) {
      abortController.abort()
      abortController = undefined
    }
    pendingText = undefined
    setLoading(false)
  }

  function clear() {
    cancel()
    setErrors([])
    lastCheckedText = ""
  }

  async function performCheck(text: string) {
    // Skip if text is unchanged or empty
    if (text === lastCheckedText || !text.trim()) {
      setLoading(false)
      return
    }

    // Skip if disabled
    if (!options.enabled()) {
      setLoading(false)
      return
    }

    // Skip very short inputs (< 3 chars)
    if (text.length < 3) {
      setLoading(false)
      setErrors([])
      return
    }

    setLoading(true)
    abortController = new AbortController()

    try {
      const matches = await Grammar.check(text, options.config?.())

      // Check if aborted or text changed while checking
      if (abortController?.signal.aborted || pendingText !== undefined) {
        return
      }

      lastCheckedText = text

      const grammarErrors: GrammarError[] = matches.map((match) => ({
        start: match.offset,
        end: match.offset + match.length,
        message: match.message,
        shortMessage: match.shortMessage ?? match.rule.description,
        replacements: match.replacements.slice(0, 5).map((r) => r.value),
        ruleId: match.rule.id,
        category: categorizeError(match.rule.issueType),
      }))

      setErrors(grammarErrors)
    } catch (error) {
      // Silently ignore errors (network issues, API errors, etc.)
      // Grammar checking is best-effort
      console.debug("Grammar check error:", error)
    } finally {
      setLoading(false)
      abortController = undefined
    }
  }

  function check(text: string) {
    // Cancel any pending check
    if (debounceTimer) {
      clearTimeout(debounceTimer)
    }
    if (abortController) {
      abortController.abort()
      abortController = undefined
    }

    // If text is empty or disabled, clear errors immediately
    if (!text.trim() || !options.enabled()) {
      setErrors([])
      lastCheckedText = ""
      return
    }

    // If text unchanged, skip
    if (text === lastCheckedText) {
      return
    }

    // Mark as pending and schedule check
    pendingText = text
    setLoading(true)

    debounceTimer = setTimeout(() => {
      const textToCheck = pendingText
      pendingText = undefined
      debounceTimer = undefined
      if (textToCheck) {
        performCheck(textToCheck)
      }
    }, debounceMs)
  }

  return {
    check,
    errors,
    loading,
    cancel,
    clear,
  }
}
