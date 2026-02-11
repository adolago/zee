/**
 * Contextual tips and reminders for the zee TUI.
 * These are displayed in the status bar's reminder banner.
 */

export const reminderTips = [
  "💡 Use Ctrl+O to expand/collapse tool outputs",
  "💡 Press Ctrl+L to switch models",
  "💡 Type /help for available commands",
  "💡 Use Ctrl+G to switch agents",
  "💡 Press Ctrl+P to browse sessions",
  "💡 Use Ctrl+T to toggle thinking display",
  "💡 Start a line with ! to run shell commands",
  "💡 Press Escape to abort the current request",
  "💡 Double Ctrl+C to exit the TUI",
  "💡 Use /clear to reset the current session",
];

let tipIndex = 0;
let lastTipTime = 0;
const TIP_ROTATION_MS = 30_000; // Rotate tips every 30 seconds

/**
 * Get a random tip from the collection.
 */
export function getRandomTip(): string {
  const idx = Math.floor(Math.random() * reminderTips.length);
  return reminderTips[idx] ?? reminderTips[0]!;
}

/**
 * Get the next tip in rotation.
 * Tips rotate automatically after TIP_ROTATION_MS.
 */
export function getNextTip(): string {
  const now = Date.now();
  if (now - lastTipTime > TIP_ROTATION_MS) {
    tipIndex = (tipIndex + 1) % reminderTips.length;
    lastTipTime = now;
  }
  return reminderTips[tipIndex] ?? reminderTips[0]!;
}

/**
 * Get a contextual tip based on current TUI state.
 */
export function getContextualTip(context: {
  isWaiting?: boolean;
  hasTools?: boolean;
  isFirstMessage?: boolean;
}): string {
  if (context.isFirstMessage) {
    return "💡 Type a message to start chatting with zee";
  }
  if (context.isWaiting) {
    return "💡 Press Escape to abort the current request";
  }
  if (context.hasTools) {
    return "💡 Use Ctrl+O to expand/collapse tool outputs";
  }
  return getNextTip();
}
