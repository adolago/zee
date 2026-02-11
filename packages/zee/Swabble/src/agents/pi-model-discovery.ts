import { join } from "node:path";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";

export { AuthStorage, ModelRegistry };

export function discoverAuthStorage(agentDir: string): AuthStorage {
  return new AuthStorage(join(agentDir, "auth.json"));
}

export function discoverModels(authStorage: AuthStorage, agentDir: string): ModelRegistry {
  return new ModelRegistry(authStorage, join(agentDir, "models.json"));
}
