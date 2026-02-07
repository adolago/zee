/**
 * Tool Sandbox Resolution (MCP)
 *
 * Derives a sandbox `root` and `cwd` from ToolExecutionContext. Callers can
 * override these via ctx.extra.
 */

import path from 'node:path';
import type { ToolExecutionContext } from '../types';

export interface ToolSandbox {
  cwd: string;
  root: string;
}

function getString(extra: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = extra?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * Resolve the tool sandbox from context.
 *
 * Supported ctx.extra keys:
 * - `cwd`: working directory for resolving relative paths
 * - `root`: sandbox root for path allowlist
 * - `sandboxRoot`: alias for `root`
 */
export function resolveToolSandbox(ctx: ToolExecutionContext): ToolSandbox {
  const extra = ctx.extra;

  const cwdRaw = getString(extra, 'cwd') ?? process.cwd();
  const rootRaw = getString(extra, 'root') ?? getString(extra, 'sandboxRoot') ?? cwdRaw;

  const cwd = path.resolve(cwdRaw);
  const root = path.resolve(rootRaw);

  return { cwd, root };
}

