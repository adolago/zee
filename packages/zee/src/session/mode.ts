import z from "zod"

export const EXECUTION_MODE_VALUES = ["plan", "accept", "bypass"] as const
export type ExecutionMode = (typeof EXECUTION_MODE_VALUES)[number]

export const ExecutionModeSchema = z.enum(EXECUTION_MODE_VALUES)
export const ExecutionModeInputSchema = z.string().trim().toLowerCase().pipe(ExecutionModeSchema)

export function parseExecutionMode(value: unknown): ExecutionMode | undefined {
  if (typeof value !== "string") return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === "plan" || normalized === "accept" || normalized === "bypass") {
    return normalized
  }
  return undefined
}
