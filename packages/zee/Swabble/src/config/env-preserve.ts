const FULL_ENV_REF_RE = /^\$\{([A-Z_][A-Z0-9_]*)\}$/;

function restoreAtPath(
  nextValue: unknown,
  originalValue: unknown,
  env: Record<string, string | undefined>,
): unknown {
  if (typeof nextValue === "string") {
    if (typeof originalValue !== "string") return nextValue;
    const match = FULL_ENV_REF_RE.exec(originalValue.trim());
    if (!match) return nextValue;
    const varName = match[1];
    const resolved = env[varName];
    if (resolved && nextValue === resolved) {
      return originalValue;
    }
    return nextValue;
  }

  if (Array.isArray(nextValue)) {
    const originalArray = Array.isArray(originalValue) ? originalValue : [];
    return nextValue.map((entry, index) => restoreAtPath(entry, originalArray[index], env));
  }

  if (nextValue && typeof nextValue === "object") {
    const nextObj = nextValue as Record<string, unknown>;
    const originalObj =
      originalValue && typeof originalValue === "object" && !Array.isArray(originalValue)
        ? (originalValue as Record<string, unknown>)
        : {};
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(nextObj)) {
      output[key] = restoreAtPath(value, originalObj[key], env);
    }
    return output;
  }

  return nextValue;
}

/**
 * Restores `${VAR}` references from the current on-disk config when the caller
 * writes back the same resolved value.
 */
export function restoreEnvVarRefs(
  nextConfig: unknown,
  originalConfig: unknown,
  env: Record<string, string | undefined>,
): unknown {
  return restoreAtPath(nextConfig, originalConfig, env);
}
