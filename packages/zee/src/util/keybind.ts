import { isDeepEqual } from "remeda"
import type { ParsedKey } from "@opentui/core"

export const RETURN_KEY_NAMES = ["return", "enter", "linefeed", "kpenter"] as const

const KEY_NAME_ALIASES: Record<string, string> = {
  " ": "space",
  enter: "return",
  linefeed: "return",
  kpenter: "return",
}

const MODIFIER_SIDE_KEY_NAMES = {
  alt: ["leftalt", "rightalt"],
  ctrl: ["leftctrl", "rightctrl"],
  shift: ["leftshift", "rightshift"],
  super: ["leftmeta", "rightmeta", "leftsuper", "rightsuper"],
} as const

export function normalizeKeyName(name: string | undefined) {
  if (!name) return name
  return KEY_NAME_ALIASES[name] ?? name
}

export function isReturn(name: string | undefined) {
  return normalizeKeyName(name) === "return"
}

export function isEscape(name: string | undefined) {
  return normalizeKeyName(name) === "escape"
}

export function isSpace(name: string | undefined) {
  return normalizeKeyName(name) === "space"
}

export function resolveModifierSideKeyNames(bindings: Keybind.Info[] | undefined): Set<string> {
  const names = new Set<string>()
  for (const binding of bindings ?? []) {
    if (binding.name !== "") continue
    if (binding.meta) MODIFIER_SIDE_KEY_NAMES.alt.forEach((name) => names.add(name))
    if (binding.ctrl) MODIFIER_SIDE_KEY_NAMES.ctrl.forEach((name) => names.add(name))
    if (binding.shift) MODIFIER_SIDE_KEY_NAMES.shift.forEach((name) => names.add(name))
    if (binding.super) MODIFIER_SIDE_KEY_NAMES.super.forEach((name) => names.add(name))
  }
  return names
}

export namespace Keybind {
  /**
   * Keybind info derived from OpenTUI's ParsedKey with our custom `leader` field.
   * This ensures type compatibility and catches missing fields at compile time.
   */
  export type Info = Pick<ParsedKey, "name" | "ctrl" | "meta" | "shift" | "super"> & {
    leader: boolean // our custom field
  }

  export function match(a: Info | undefined, b: Info): boolean {
    if (!a) return false
    const normalizedA = { ...a, super: a.super ?? false }
    const normalizedB = { ...b, super: b.super ?? false }
    return isDeepEqual(normalizedA, normalizedB)
  }

  export function matchAny(
    bindings: Info[] | undefined,
    parsed: Info,
    options?: {
      shiftLetterBindings?: Set<string>
    },
  ): boolean {
    if (!bindings) return false
    const shiftLetterBindings = options?.shiftLetterBindings
    for (const kb of bindings) {
      if (match(kb, parsed)) return true
      if (
        shiftLetterBindings &&
        parsed.shift &&
        !kb.shift &&
        parsed.name &&
        parsed.name.length === 1 &&
        kb.name === parsed.name
      ) {
        const scope = kb.leader ? "leader" : "plain"
        if (!shiftLetterBindings.has(`${scope}:${kb.name}`)) {
          const relaxed = { ...parsed, shift: false }
          if (match(kb, relaxed)) return true
        }
      }
    }
    return false
  }

  /**
   * Convert OpenTUI's ParsedKey to our Keybind.Info format.
   * This helper ensures all required fields are present and avoids manual object creation.
   */
  export function fromParsedKey(key: ParsedKey, leader = false): Info {
    return {
      name: normalizeKeyName(key.name) ?? "",
      ctrl: key.ctrl,
      meta: key.meta,
      shift: key.shift,
      super: key.super ?? false,
      leader,
    }
  }

  export function toString(info: Info | undefined): string {
    if (!info) return ""
    const parts: string[] = []

    if (info.ctrl) parts.push("ctrl")
    if (info.meta) parts.push("alt")
    if (info.super) parts.push("super")
    if (info.shift) parts.push("shift")
    if (info.name) {
      if (info.name === "delete") parts.push("del")
      else parts.push(info.name)
    }

    let result = parts.join("+")

    if (info.leader) {
      result = result ? `<leader> ${result}` : `<leader>`
    }

    return result
  }

  export function parse(key: string): Info[] {
    if (key === "none") return []

    return key.split(",").map((combo) => {
      // Handle <leader> syntax by replacing with leader+
      const normalized = combo.replace(/<leader>/g, "leader+")
      const parts = normalized.toLowerCase().split("+")
      const info: Info = {
        ctrl: false,
        meta: false,
        shift: false,
        super: false,
        leader: false,
        name: "",
      }

      for (const part of parts) {
        switch (part) {
          case "ctrl":
            info.ctrl = true
            break
          case "alt":
          case "meta":
          case "option":
            info.meta = true
            break
          case "super":
            info.super = true
            break
          case "shift":
            info.shift = true
            break
          case "leader":
            info.leader = true
            break
          case "esc":
            info.name = "escape"
            break
          default:
            info.name = normalizeKeyName(part) ?? part
            break
        }
      }

      return info
    })
  }
}
