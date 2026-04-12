import path from "node:path";
import { pathToFileURL } from "node:url";

export function isDirectMcpServerRun(metaUrl: string, argv: string[] = process.argv): boolean {
  const entry = argv[1];
  if (!entry) return false;
  const resolved = path.isAbsolute(entry) ? entry : path.resolve(process.cwd(), entry);
  return pathToFileURL(resolved).href === metaUrl;
}

export function runMcpServerWhenDirect(
  metaUrl: string,
  label: string,
  start: () => Promise<void>
): void {
  if (!isDirectMcpServerRun(metaUrl)) return;
  start().catch((error) => {
    console.error(`Failed to start ${label} MCP server:`, error);
    process.exit(1);
  });
}
