/**
 * Grep Tool
 *
 * Search for patterns in file contents using regex.
 * Results are sorted by modification time.
 */

import { z } from 'zod';
import * as fs from 'fs';
import { glob } from 'glob';
import { defineTool } from '../registry';
import type { ToolExecutionContext } from '../types';
import { assertSafeGlobPattern } from '../security/glob-pattern';
import { resolveToolSandbox } from '../security/sandbox';
import { assertToolPath } from '../security/validate-path';

// ============================================================================
// Configuration
// ============================================================================

const MAX_LINE_LENGTH = 2000;
const RESULT_LIMIT = 100;

// ============================================================================
// Tool Definition
// ============================================================================

export const GrepTool = defineTool(
  'grep',
  'builtin',
  {
    description: `Search for patterns in file contents using regex.

Usage:
- Supports full regex syntax (e.g., "log.*Error", "function\\s+\\w+")
- Filter files with include parameter (e.g., "*.js", "**/*.tsx")
- Results are sorted by file modification time
- Use when you need to find content within files`,

    parameters: z.object({
      pattern: z.string().describe('The regex pattern to search for in file contents'),
      path: z.string().optional().describe('The directory to search in. Defaults to the tool sandbox cwd.'),
      include: z.string().optional().describe('File pattern to include in the search (e.g., "*.js", "*.{ts,tsx}")'),
    }),

    async execute(params, ctx: ToolExecutionContext) {
      if (!params.pattern) {
        throw new Error('pattern is required');
      }

      const sandbox = resolveToolSandbox(ctx);
      const searchInput = params.path || sandbox.cwd;
      const { resolved: searchPath } = await assertToolPath({
        filePath: searchInput,
        cwd: sandbox.cwd,
        root: sandbox.root,
      });

      const includePattern = params.include || '**/*';
      assertSafeGlobPattern(includePattern, 'include pattern');

      // Find files to search
      const files = await glob(includePattern, {
        cwd: searchPath,
        absolute: true,
        nodir: true,
        dot: true,
        ignore: ['**/node_modules/**', '**/.git/**', '**/*.min.js', '**/*.min.css'],
      });

      // Create regex
      let regex: RegExp;
      try {
        regex = new RegExp(params.pattern, 'gm');
      } catch (error) {
        throw new Error(`Invalid regex pattern: ${params.pattern}`);
      }

      // Search files
      const matches: {
        path: string;
        modTime: number;
        lineNum: number;
        lineText: string;
      }[] = [];

      for (const filePath of files) {
        try {
          const stats = fs.statSync(filePath);

          // Skip binary files
          if (stats.size > 10 * 1024 * 1024) continue; // Skip files > 10MB

          const content = fs.readFileSync(filePath, 'utf-8');
          const lines = content.split('\n');

          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              matches.push({
                path: filePath,
                modTime: stats.mtimeMs,
                lineNum: i + 1,
                lineText: lines[i],
              });

              if (matches.length >= RESULT_LIMIT) break;
            }
            regex.lastIndex = 0; // Reset regex state
          }

          if (matches.length >= RESULT_LIMIT) break;
        } catch {
          // Skip files we can't read
        }
      }

      if (matches.length === 0) {
        return {
          title: params.pattern,
          metadata: { matches: 0, truncated: false },
          output: 'No files found',
        };
      }

      // Sort by modification time
      matches.sort((a, b) => b.modTime - a.modTime);

      const truncated = matches.length >= RESULT_LIMIT;
      const outputLines = [`Found ${matches.length} matches`];

      let currentFile = '';
      for (const match of matches) {
        if (currentFile !== match.path) {
          if (currentFile !== '') {
            outputLines.push('');
          }
          currentFile = match.path;
          outputLines.push(`${match.path}:`);
        }
        const truncatedLineText =
          match.lineText.length > MAX_LINE_LENGTH
            ? match.lineText.substring(0, MAX_LINE_LENGTH) + '...'
            : match.lineText;
        outputLines.push(`  Line ${match.lineNum}: ${truncatedLineText}`);
      }

      if (truncated) {
        outputLines.push('');
        outputLines.push('(Results are truncated. Consider using a more specific path or pattern.)');
      }

      return {
        title: params.pattern,
        metadata: {
          matches: matches.length,
          truncated,
        },
        output: outputLines.join('\n'),
      };
    },
  }
);
