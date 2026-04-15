import type { KittyKeyboardOptions } from "@opentui/core"
import type { Keybind } from "@/util/keybind"
import { type TerminalProfile, describeTerminalProfile, detectTerminalProfile } from "@/cli/terminal-capabilities"

export type TuiKeyboardConfigInput = {
  tui?: Record<string, unknown> & {
    kitty_keyboard?: boolean
  }
}

export type TerminalKeyboardProfile = TerminalProfile

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

const KITTY_KEYBOARD_SUPPORTED_PROFILES = new Set<TerminalKeyboardProfile>(["kitty", "ghostty", "foot", "warp"])
const KITTY_KEYBOARD_SUPPORTED_LABEL = "kitty, ghostty, foot, and Warp"

export function detectTerminalKeyboardProfile(env: NodeJS.ProcessEnv = process.env): TerminalKeyboardProfile {
  return detectTerminalProfile(env)
}

export function describeTerminalKeyboardProfile(profile: TerminalKeyboardProfile): string {
  return describeTerminalProfile(profile)
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
    warning: `Ignoring tui.kitty_keyboard=true in ${describeTerminalKeyboardProfile(profile)}; supported terminals are ${KITTY_KEYBOARD_SUPPORTED_LABEL}.`,
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
      warning: `input_dictation_hold requires tui.kitty_keyboard=true on ${KITTY_KEYBOARD_SUPPORTED_LABEL}. Hold-to-record is disabled.`,
    }
  }

  if (!input.kittyKeyboard.enabled) {
    return {
      profile: input.kittyKeyboard.profile,
      enabled: false,
      warning: `input_dictation_hold is disabled in ${describeTerminalKeyboardProfile(input.kittyKeyboard.profile)}; supported terminals are ${KITTY_KEYBOARD_SUPPORTED_LABEL}.`,
    }
  }

  return {
    profile: input.kittyKeyboard.profile,
    enabled: true,
  }
}
