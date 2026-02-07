/**
 * Read Tool
 *
 * Read files from the filesystem with line number formatting.
 * Supports images, PDFs, and text files.
 */

import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { defineTool } from '../registry';
import type { ToolExecutionContext } from '../types';
import { resolveToolSandbox } from '../security/sandbox';
import { assertToolPath } from '../security/validate-path';

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_READ_LIMIT = 2000;
const MAX_LINE_LENGTH = 2000;

// ============================================================================
// Tool Definition
// ============================================================================

export const ReadTool = defineTool(
  'read',
  'builtin',
  {
    description: `Read a file from the filesystem.

Usage:
- The filePath parameter may be absolute or relative to the tool sandbox cwd
- Access is restricted to the tool sandbox root
- By default, reads up to 2000 lines from the beginning
- You can optionally specify a line offset and limit for long files
- Lines longer than 2000 characters will be truncated
- Results are returned with line numbers starting at 1
- Can read images (PNG, JPG, etc.) and PDF files
- Cannot read directories - use ls command instead`,

    parameters: z.object({
      filePath: z.string().describe('Path to the file to read (absolute or relative to the sandbox cwd)'),
      offset: z.coerce.number().optional().describe('Line number to start reading from (0-based)'),
      limit: z.coerce.number().optional().describe('Number of lines to read (defaults to 2000)'),
    }),

    async execute(params, ctx: ToolExecutionContext) {
      const sandbox = resolveToolSandbox(ctx);
      const { resolved: filepath, relative } = await assertToolPath({
        filePath: params.filePath,
        cwd: sandbox.cwd,
        root: sandbox.root,
      });

      const title = relative || path.basename(filepath);

      // Check if file exists
      if (!fs.existsSync(filepath)) {
        const dir = path.dirname(filepath);
        const base = path.basename(filepath);

        try {
          const dirEntries = fs.readdirSync(dir);
          const suggestions = dirEntries
            .filter(
              (entry) =>
                entry.toLowerCase().includes(base.toLowerCase()) ||
                base.toLowerCase().includes(entry.toLowerCase())
            )
            .map((entry) => path.join(dir, entry))
            .slice(0, 3);

          if (suggestions.length > 0) {
            throw new Error(`File not found: ${filepath}\n\nDid you mean one of these?\n${suggestions.join('\n')}`);
          }
        } catch {
          // Directory doesn't exist
        }

        throw new Error(`File not found: ${filepath}`);
      }

      const stats = fs.statSync(filepath);
      if (stats.isDirectory()) {
        throw new Error(`Path is a directory, not a file: ${filepath}`);
      }

      // Check for images and PDFs
      const ext = path.extname(filepath).toLowerCase();
      const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];
      const isImage = imageExtensions.includes(ext);
      const isPdf = ext === '.pdf';

      if (isImage || isPdf) {
        const content = fs.readFileSync(filepath);
        const mimeType = isImage
          ? `image/${ext.slice(1) === 'jpg' ? 'jpeg' : ext.slice(1)}`
          : 'application/pdf';

        const msg = `${isImage ? 'Image' : 'PDF'} read successfully`;
        return {
          title,
          output: msg,
          metadata: {
            preview: msg,
          },
          attachments: [
            {
              id: `file-${Date.now()}`,
              sessionId: ctx.sessionId,
              messageId: ctx.messageId,
              type: 'file' as const,
              mime: mimeType,
              url: `data:${mimeType};base64,${content.toString('base64')}`,
            },
          ],
        };
      }

      // Check for binary files
      const isBinary = await isBinaryFile(filepath);
      if (isBinary) {
        throw new Error(`Cannot read binary file: ${filepath}`);
      }

      // Read text file
      const limit = params.limit ?? DEFAULT_READ_LIMIT;
      const offset = params.offset || 0;
      const fileContent = fs.readFileSync(filepath, 'utf-8');
      const lines = fileContent.split('\n');

      const raw = lines.slice(offset, offset + limit).map((line) => {
        return line.length > MAX_LINE_LENGTH ? line.substring(0, MAX_LINE_LENGTH) + '...' : line;
      });

      const content = raw.map((line, index) => {
        return `${(index + offset + 1).toString().padStart(5, '0')}| ${line}`;
      });

      const preview = raw.slice(0, 20).join('\n');

      let output = '<file>\n';
      output += content.join('\n');

      const totalLines = lines.length;
      const lastReadLine = offset + content.length;
      const hasMoreLines = totalLines > lastReadLine;

      if (hasMoreLines) {
        output += `\n\n(File has more lines. Use 'offset' parameter to read beyond line ${lastReadLine})`;
      } else {
        output += `\n\n(End of file - total ${totalLines} lines)`;
      }
      output += '\n</file>';

      return {
        title,
        output,
        metadata: {
          preview,
        },
      };
    },
  }
);

// ============================================================================
// Helpers
// ============================================================================

async function isBinaryFile(filepath: string): Promise<boolean> {
  const ext = path.extname(filepath).toLowerCase();

  // Known binary extensions
  const binaryExtensions = [
    '.zip', '.tar', '.gz', '.exe', '.dll', '.so', '.class', '.jar',
    '.war', '.7z', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.odt', '.ods', '.odp', '.bin', '.dat', '.obj', '.o', '.a',
    '.lib', '.wasm', '.pyc', '.pyo',
  ];

  if (binaryExtensions.includes(ext)) {
    return true;
  }

  // Check file content
  const buffer = Buffer.alloc(4096);
  const fd = fs.openSync(filepath, 'r');
  const bytesRead = fs.readSync(fd, buffer, 0, 4096, 0);
  fs.closeSync(fd);

  if (bytesRead === 0) return false;

  let nonPrintableCount = 0;
  for (let i = 0; i < bytesRead; i++) {
    if (buffer[i] === 0) return true;
    if (buffer[i] < 9 || (buffer[i] > 13 && buffer[i] < 32)) {
      nonPrintableCount++;
    }
  }

  return nonPrintableCount / bytesRead > 0.3;
}
