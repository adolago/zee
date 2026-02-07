/**
 * Glob Tool
 *
 * Fast file pattern matching using glob patterns.
 * Returns matching file paths sorted by modification time.
 */

import { z } from 'zod';
import { glob } from 'glob';
import * as fs from 'fs';
import { defineTool } from '../registry';
import type { ToolExecutionContext } from '../types';
import { assertSafeGlobPattern } from '../security/glob-pattern';
import { resolveToolSandbox } from '../security/sandbox';
import { assertToolPath } from '../security/validate-path';

// ============================================================================
// Configuration
// ============================================================================

const RESULT_LIMIT = 100;

// ============================================================================
// Tool Definition
// ============================================================================

export const GlobTool = defineTool(
  'glob',
  'builtin',
  {
    description: `Fast file pattern matching tool.

Usage:
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use when you need to find files by name patterns
- IMPORTANT: Omit the path field to use the tool sandbox cwd
- Access is restricted to the tool sandbox root`,

    parameters: z.object({
      pattern: z.string().describe('The glob pattern to match files against'),
      path: z
        .string()
        .optional()
        .describe('The directory to search in. If not specified, uses the tool sandbox cwd.'),
    }),

    async execute(params, ctx: ToolExecutionContext) {
      assertSafeGlobPattern(params.pattern, 'glob pattern');

      const sandbox = resolveToolSandbox(ctx);
      const searchInput = params.path ?? sandbox.cwd;
      const { resolved: searchPath, relative } = await assertToolPath({
        filePath: searchInput,
        cwd: sandbox.cwd,
        root: sandbox.root,
      });

      // Find files matching pattern
      const matches = await glob(params.pattern, {
        cwd: searchPath,
        absolute: true,
        nodir: true,
        dot: true,
        ignore: ['**/node_modules/**', '**/.git/**'],
      });

      // Get file stats and sort by mtime
      const files: { path: string; mtime: number }[] = [];
      let truncated = false;

      for (const match of matches) {
        if (files.length >= RESULT_LIMIT) {
          truncated = true;
          break;
        }

        try {
          const stats = fs.statSync(match);
          files.push({
            path: match,
            mtime: stats.mtimeMs,
          });
        } catch {
          // Skip files we can't stat
        }
      }

      files.sort((a, b) => b.mtime - a.mtime);

      // Build output
      const output: string[] = [];
      if (files.length === 0) {
        output.push('No files found');
      } else {
        output.push(...files.map((f) => f.path));
        if (truncated) {
          output.push('');
          output.push('(Results are truncated. Consider using a more specific path or pattern.)');
        }
      }

      return {
        title: relative || '.',
        metadata: {
          count: files.length,
          truncated,
        },
        output: output.join('\n'),
      };
    },
  }
);
