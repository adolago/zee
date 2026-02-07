/**
 * Write Tool
 *
 * Write content to a file on the filesystem.
 * Creates parent directories if they don't exist.
 */

import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { defineTool } from '../registry';
import type { ToolExecutionContext } from '../types';
import { resolveToolSandbox } from '../security/sandbox';
import { assertToolPath } from '../security/validate-path';

// ============================================================================
// Tool Definition
// ============================================================================

export const WriteTool = defineTool(
  'write',
  'builtin',
  {
    description: `Write content to a file on the filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path
- The filePath parameter may be absolute or relative to the tool sandbox cwd
- Access is restricted to the tool sandbox root
- Parent directories will be created if they don't exist
- ALWAYS prefer editing existing files to creating new ones
- NEVER proactively create documentation files unless explicitly requested`,

    parameters: z.object({
      content: z.string().describe('The content to write to the file'),
      filePath: z.string().describe('Path to the file to write (absolute or relative to the sandbox cwd)'),
    }),

    async execute(params, ctx: ToolExecutionContext) {
      const sandbox = resolveToolSandbox(ctx);
      const { resolved: filepath, relative } = await assertToolPath({
        filePath: params.filePath,
        cwd: sandbox.cwd,
        root: sandbox.root,
      });

      const exists = fs.existsSync(filepath);
      const title = relative || path.basename(filepath);

      // Create parent directories if needed
      const parentDir = path.dirname(filepath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      // Write the file
      fs.writeFileSync(filepath, params.content);

      return {
        title,
        metadata: {
          filepath,
          exists,
        },
        output: exists ? `File updated: ${filepath}` : `File created: ${filepath}`,
      };
    },
  }
);
