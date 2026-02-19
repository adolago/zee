function normalizeBooleanInput(value: string | undefined): string {
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}

export function isTruthyEnvValue(value: string | undefined): boolean {
  const normalized = normalizeBooleanInput(value)
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on"
}

