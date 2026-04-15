export type TerminalProfile = "kitty" | "ghostty" | "foot" | "wezterm" | "warp" | "windows-terminal" | "unknown"

export type TerminalCapabilityOptions = {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  isTTY?: boolean | null
}

export type TerminalProbePolicy = {
  allowOscColorQueries: boolean
}

function normalizeEnv(env: NodeJS.ProcessEnv) {
  return {
    termProgram: env.TERM_PROGRAM?.trim().toLowerCase() ?? "",
    term: env.TERM?.trim().toLowerCase() ?? "",
    lang: env.LANG ?? "",
  }
}

export function detectTerminalProfile(env: NodeJS.ProcessEnv = process.env): TerminalProfile {
  const normalized = normalizeEnv(env)

  if (normalized.termProgram === "ghostty") return "ghostty"
  if (normalized.termProgram === "kitty" || normalized.term === "xterm-kitty") return "kitty"
  if (normalized.termProgram === "foot" || normalized.term.startsWith("foot")) return "foot"
  if (normalized.termProgram === "wezterm") return "wezterm"
  if (normalized.termProgram.includes("warp")) return "warp"
  if (env.WT_SESSION?.trim()) return "windows-terminal"
  return "unknown"
}

export function describeTerminalProfile(profile: TerminalProfile): string {
  switch (profile) {
    case "kitty":
      return "Kitty"
    case "ghostty":
      return "Ghostty"
    case "foot":
      return "foot"
    case "wezterm":
      return "WezTerm"
    case "warp":
      return "Warp"
    case "windows-terminal":
      return "Windows Terminal"
    default:
      return "unknown terminal"
  }
}

function isModernWindowsTerminal(env: NodeJS.ProcessEnv, profile: TerminalProfile): boolean {
  const termProgram = env.TERM_PROGRAM?.trim().toLowerCase() ?? ""
  return profile === "warp" || profile === "windows-terminal" || termProgram === "vscode"
}

export function supportsColorOutput(options: TerminalCapabilityOptions = {}): boolean {
  const env = options.env ?? process.env

  if (env.NO_COLOR !== undefined) return false
  if (env.FORCE_COLOR !== undefined) return true
  return Boolean(options.isTTY)
}

export function supportsUnicodeOutput(options: TerminalCapabilityOptions = {}): boolean {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const normalized = normalizeEnv(env)

  if (env.NO_COLOR !== undefined) return false
  if (env.NO_UNICODE !== undefined || env.ASCII_ONLY !== undefined) return false
  if (env.FORCE_UNICODE !== undefined) return true
  if (options.isTTY === false) return false

  if (normalized.lang.includes("UTF-8") || normalized.lang.includes("utf8")) return true
  if (normalized.term.includes("256color") || normalized.term.includes("truecolor")) return true

  if (platform === "win32") {
    return isModernWindowsTerminal(env, detectTerminalProfile(env))
  }

  return true
}

export function resolveTerminalProbePolicy(options: Omit<TerminalCapabilityOptions, "isTTY"> = {}): TerminalProbePolicy {
  const platform = options.platform ?? process.platform

  if (platform === "win32") {
    return {
      allowOscColorQueries: false,
    }
  }

  return {
    allowOscColorQueries: true,
  }
}
