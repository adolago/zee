import fs from "node:fs/promises";
import path from "node:path";

import type { ZeeConfig } from "../config/config.js";
import { resolveZeeAgentDir } from "./agent-paths.js";
import { resolveZeeProvidersFromOpencodeRegistry } from "./opencode-registry.js";

export async function ensureZeeModelsJson(
  _config?: ZeeConfig,
  agentDirOverride?: string,
): Promise<{ agentDir: string; wrote: boolean }> {
  const agentDir = agentDirOverride?.trim() ? agentDirOverride.trim() : resolveZeeAgentDir();

  // Providers/models are sourced from agent-core (OpenCode) only.
  // Zee should not do local provider discovery or maintain its own provider registry.
  const providers = await resolveZeeProvidersFromOpencodeRegistry();
  if (Object.keys(providers).length === 0) {
    return { agentDir, wrote: false };
  }

  const targetPath = path.join(agentDir, "models.json");

  const next = `${JSON.stringify({ providers }, null, 2)}\n`;
  const existingRaw = await fs.readFile(targetPath, "utf8").catch(() => "");
  if (existingRaw === next) return { agentDir, wrote: false };

  await fs.mkdir(agentDir, { recursive: true, mode: 0o700 });
  await fs.writeFile(targetPath, next, { mode: 0o600 });
  return { agentDir, wrote: true };
}
