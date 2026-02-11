import fs from "node:fs";
import path from "node:path";

import { resolveZeePackageRoot } from "../infra/zee-root.js";

export async function resolveZeeDocsPath(params: {
  workspaceDir?: string;
  argv1?: string;
  cwd?: string;
  moduleUrl?: string;
}): Promise<string | null> {
  const workspaceDir = params.workspaceDir?.trim();
  if (workspaceDir) {
    const workspaceDocs = path.join(workspaceDir, "docs");
    if (fs.existsSync(workspaceDocs)) return workspaceDocs;
  }

  const packageRoot = await resolveZeePackageRoot({
    cwd: params.cwd,
    argv1: params.argv1,
    moduleUrl: params.moduleUrl,
  });
  if (!packageRoot) return null;

  const packageDocs = path.join(packageRoot, "docs");
  return fs.existsSync(packageDocs) ? packageDocs : null;
}

// Legacy alias
export async function resolveZeeDocsPathLegacy(params: {
  workspaceDir?: string;
  argv1?: string;
  cwd?: string;
  moduleUrl?: string;
}): Promise<string | null> {
  return resolveZeeDocsPath(params);
}
