import * as prompts from "@clack/prompts"
import { UI } from "./ui"

export function throwIfCancelled<T>(value: T): asserts value is Exclude<T, symbol> {
  if (prompts.isCancel(value)) throw new UI.CancelledError()
}

export function isNonInteractive(): boolean {
  return !(process.stdin.isTTY && process.stdout.isTTY)
}
