import type { KittyKeyboardOptions } from "@opentui/core"

export type TuiKeyboardConfigInput = {
  tui?: {
    kitty_keyboard?: boolean
  }
}

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

export function resolveKittyKeyboardOptions(config: TuiKeyboardConfigInput | null | undefined): KittyKeyboardOptions {
  return config?.tui?.kitty_keyboard === true ? KITTY_KEYBOARD_ENABLED : KITTY_KEYBOARD_DISABLED
}
