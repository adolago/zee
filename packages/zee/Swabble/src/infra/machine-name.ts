import os from "node:os";

let cachedPromise: Promise<string> | null = null;

function fallbackHostName() {
  return (
    os
      .hostname()
      .replace(/\.local$/i, "")
      .trim() || "zee"
  );
}

export async function getMachineDisplayName(): Promise<string> {
  if (cachedPromise) return cachedPromise;
  cachedPromise = (async () => {
    if (process.env.VITEST || process.env.NODE_ENV === "test") {
      return fallbackHostName();
    }
    return fallbackHostName();
  })();
  return cachedPromise;
}
