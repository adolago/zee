import type { KittyKeyboardOptions } from "@opentui/core"
import type { Keybind } from "@/util/keybind"

export type TuiKeyboardConfigInput = {
  tui?: Record<string, unknown> & {
    kitty_keyboard?: boolean
  }
}

export type TerminalKeyboardProfile =
  | "kitty"
  | "ghostty"
  | "foot"
  | "wezterm"
  | "warp"
  | "windows-terminal"
  | "unknown"

export const KITTY_KEYBOARD_DISABLED: KittyKeyboardOptions = {
  disambiguate: false,
  alternateKeys: false,
  events: false,
  allKeysAsEscapes: false,
  reportText: false,
}

export const KITTY_KEYBOARD_ENABLED: KittyKeyboardOptions = {
  events: true,
}

const KITTY_KEYBOARD_SUPPORTED_PROFILES = new Set<TerminalKeyboardProfile>(["kitty", "ghostty", "foot"])

export function detectTerminalKeyboardProfile(env: NodeJS.ProcessEnv = process.env): TerminalKeyboardProfile {
  const termProgram = env.TERM_PROGRAM?.trim().toLowerCase() ?? ""
  const term = env.TERM?.trim().toLowerCase() ?? ""

  if (termProgram === "ghostty") return "ghostty"
  if (termProgram === "kitty" || term === "xterm-kitty") return "kitty"
  if (termProgram === "foot" || term.startsWith("foot")) return "foot"
  if (termProgram === "wezterm") return "wezterm"
  if (termProgram.includes("warp")) return "warp"
  if (env.WT_SESSION?.trim()) return "windows-terminal"
  return "unknown"
}

export function describeTerminalKeyboardProfile(profile: TerminalKeyboardProfile): string {
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

export function supportsKittyKeyboardProfile(profile: TerminalKeyboardProfile): boolean {
  return KITTY_KEYBOARD_SUPPORTED_PROFILES.has(profile)
}

export type ResolvedKittyKeyboard = {
  profile: TerminalKeyboardProfile
  explicitlyEnabled: boolean
  enabled: boolean
  options: KittyKeyboardOptions
  warning?: string
}

export function resolveKittyKeyboard(
  config: TuiKeyboardConfigInput | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedKittyKeyboard {
  const profile = detectTerminalKeyboardProfile(env)
  const explicitlyEnabled = config?.tui?.kitty_keyboard === true

  if (!explicitlyEnabled) {
    return {
      profile,
      explicitlyEnabled,
      enabled: false,
      options: KITTY_KEYBOARD_DISABLED,
    }
  }

  if (supportsKittyKeyboardProfile(profile)) {
    return {
      profile,
      explicitlyEnabled,
      enabled: true,
      options: KITTY_KEYBOARD_ENABLED,
    }
  }

  return {
    profile,
    explicitlyEnabled,
    enabled: false,
    options: KITTY_KEYBOARD_DISABLED,
    warning: `Ignoring tui.kitty_keyboard=true in ${describeTerminalKeyboardProfile(profile)}; supported terminals are kitty, ghostty, and foot.`,
  }
}

export function resolveKittyKeyboardOptions(
  config: TuiKeyboardConfigInput | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): KittyKeyboardOptions {
  return resolveKittyKeyboard(config, env).options
}

export type HoldToRecordSupport = {
  profile: TerminalKeyboardProfile
  enabled: boolean
  warning?: string
}

export function hasHoldToRecordBinding(bindings: Keybind.Info[] | undefined): boolean {
  return (bindings?.length ?? 0) > 0
}

export function resolveHoldToRecordSupport(input: {
  bindings: Keybind.Info[] | undefined
  kittyKeyboard: Pick<ResolvedKittyKeyboard, "profile" | "explicitlyEnabled" | "enabled">
}): HoldToRecordSupport {
  if (!hasHoldToRecordBinding(input.bindings)) {
    return {
      profile: input.kittyKeyboard.profile,
      enabled: false,
    }
  }

  if (!input.kittyKeyboard.explicitlyEnabled) {
    return {
      profile: input.kittyKeyboard.profile,
      enabled: false,
      warning:
        "input_dictation_hold requires tui.kitty_keyboard=true on kitty, ghostty, or foot. Hold-to-record is disabled.",
    }
  }

  if (!input.kittyKeyboard.enabled) {
    return {
      profile: input.kittyKeyboard.profile,
      enabled: false,
      warning: `input_dictation_hold is disabled in ${describeTerminalKeyboardProfile(input.kittyKeyboard.profile)}; supported terminals are kitty, ghostty, and foot.`,
    }
  }

  return {
    profile: input.kittyKeyboard.profile,
    enabled: true,
  }
}
