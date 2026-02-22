/**
 * Edit Tool
 *
 * Perform exact string replacements in files.
 * Supports various fuzzy matching strategies for robustness.
 */

import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { defineTool } from '../registry';
import type { ToolExecutionContext } from '../types';
import { resolveToolSandbox } from '../security/sandbox';
import { assertToolPath } from '../security/validate-path';
import { findMeshConflicts } from '../coordination/mesh-reservations';

// ============================================================================
// Tool Definition
// ============================================================================

export const EditTool = defineTool(
  'edit',
  'builtin',
  {
    description: `Perform exact string replacements in files.

Usage:
- You must read the file first before editing
- The old_string must be unique in the file, or the edit will fail
- Use replace_all to change every instance of old_string
- Preserve exact indentation (tabs/spaces) from the file
- ALWAYS prefer editing existing files to creating new ones`,

    parameters: z.object({
      filePath: z.string().describe('Path to the file to modify (absolute or relative to the sandbox cwd)'),
      oldString: z.string().describe('The text to replace'),
      newString: z.string().describe('The text to replace it with (must be different from oldString)'),
      replaceAll: z.boolean().optional().describe('Replace all occurrences of oldString (default false)'),
    }),

    async execute(params, ctx: ToolExecutionContext) {
      if (!params.filePath) {
        throw new Error('filePath is required');
      }

      if (params.oldString === params.newString) {
        throw new Error('oldString and newString must be different');
      }

      const sandbox = resolveToolSandbox(ctx);
      const { resolved: filePath, relative } = await assertToolPath({
        filePath: params.filePath,
        cwd: sandbox.cwd,
        root: sandbox.root,
      });

      const conflicts = await findMeshConflicts({
        requestedPath: filePath,
        sessionId: ctx.sessionId,
        cwd: sandbox.cwd,
      });
      if (conflicts.length > 0) {
        const conflict = conflicts[0];
        throw new Error(
          `Mesh reservation conflict: ${relative || path.basename(filePath)} is reserved by session ${conflict.ownerSessionId} at ${conflict.reservedPath} until ${new Date(conflict.expiresAt).toISOString()}`
        );
      }

      // Check file exists
      if (!fs.existsSync(filePath)) {
        throw new Error(`File ${filePath} not found`);
      }

      const stats = fs.statSync(filePath);
      if (stats.isDirectory()) {
        throw new Error(`Path is a directory, not a file: ${filePath}`);
      }

      // Handle empty oldString (create new file)
      if (params.oldString === '') {
        fs.writeFileSync(filePath, params.newString);
        return {
          title: relative || path.basename(filePath),
          metadata: {
            diff: `Created file with ${params.newString.split('\n').length} lines`,
          },
          output: '',
        };
      }

      // Read and replace
      const contentOld = fs.readFileSync(filePath, 'utf-8');
      const contentNew = replace(contentOld, params.oldString, params.newString, params.replaceAll);

      // Write back
      fs.writeFileSync(filePath, contentNew);

      // Generate simple diff info
      const oldLines = contentOld.split('\n').length;
      const newLines = contentNew.split('\n').length;
      const diff = `Changed: ${oldLines} -> ${newLines} lines`;

      return {
        title: relative || path.basename(filePath),
        metadata: {
          diff,
        },
        output: '',
      };
    },
  }
);

// ============================================================================
// Replace Logic
// ============================================================================

type Replacer = (content: string, find: string) => Generator<string, void, unknown>;

const SimpleReplacer: Replacer = function* (_content, find) {
  yield find;
};

const LineTrimmedReplacer: Replacer = function* (content, find) {
  const originalLines = content.split('\n');
  const searchLines = find.split('\n');

  if (searchLines[searchLines.length - 1] === '') {
    searchLines.pop();
  }

  for (let i = 0; i <= originalLines.length - searchLines.length; i++) {
    let matches = true;

    for (let j = 0; j < searchLines.length; j++) {
      const originalTrimmed = originalLines[i + j].trim();
      const searchTrimmed = searchLines[j].trim();

      if (originalTrimmed !== searchTrimmed) {
        matches = false;
        break;
      }
    }

    if (matches) {
      let matchStartIndex = 0;
      for (let k = 0; k < i; k++) {
        matchStartIndex += originalLines[k].length + 1;
      }

      let matchEndIndex = matchStartIndex;
      for (let k = 0; k < searchLines.length; k++) {
        matchEndIndex += originalLines[i + k].length;
        if (k < searchLines.length - 1) {
          matchEndIndex += 1;
        }
      }

      yield content.substring(matchStartIndex, matchEndIndex);
    }
  }
};

const WhitespaceNormalizedReplacer: Replacer = function* (content, find) {
  const normalizeWhitespace = (text: string) => text.replace(/\s+/g, ' ').trim();
  const normalizedFind = normalizeWhitespace(find);

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (normalizeWhitespace(line) === normalizedFind) {
      yield line;
    }
  }
};

function replace(content: string, oldString: string, newString: string, replaceAll = false): string {
  if (oldString === newString) {
    throw new Error('oldString and newString must be different');
  }

  let notFound = true;

  for (const replacer of [SimpleReplacer, LineTrimmedReplacer, WhitespaceNormalizedReplacer]) {
    for (const search of replacer(content, oldString)) {
      const index = content.indexOf(search);
      if (index === -1) continue;
      notFound = false;
      if (replaceAll) {
        return content.replaceAll(search, newString);
      }
      const lastIndex = content.lastIndexOf(search);
      if (index !== lastIndex) continue;
      return content.substring(0, index) + newString + content.substring(index + search.length);
    }
  }

  if (notFound) {
    throw new Error('oldString not found in content');
  }
  throw new Error(
    'Found multiple matches for oldString. Provide more surrounding lines in oldString to identify the correct match.'
  );
}
