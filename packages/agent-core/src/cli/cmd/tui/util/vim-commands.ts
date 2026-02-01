/**
 * Shared vim command handling for the prompt textarea.
 * Simplified to only support `i` for entering insert mode.
 */

export namespace VimCommands {
  /**
   * Result of handling a vim normal mode key.
   */
  export type VimCommandResult = {
    /** Whether the key was handled */
    handled: boolean
    /** Whether to enter insert mode after handling */
    enterInsert?: boolean
  }

  /**
   * Handle a single key press in vim normal mode.
   * Only `i` is recognized (enters insert mode). All other keys are unhandled.
   */
  export function handleNormalModeKey(key: string): VimCommandResult {
    if (key === "i") {
      return { handled: true, enterInsert: true }
    }

    // Key not handled
    return { handled: false }
  }
}
