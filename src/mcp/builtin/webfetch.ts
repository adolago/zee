/**
 * WebFetch Tool
 *
 * Fetch content from URLs and convert to various formats.
 * Supports HTML to markdown/text conversion.
 */

import { z } from 'zod';
import { defineTool } from '../registry';
import type { ToolExecutionContext } from '../types';

// ============================================================================
// Configuration
// ============================================================================

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB
const DEFAULT_TIMEOUT = 30 * 1000; // 30 seconds
const MAX_TIMEOUT = 120 * 1000; // 2 minutes

// ============================================================================
// Tool Definition
// ============================================================================

export const WebFetchTool = defineTool(
  'webfetch',
  'builtin',
  {
    description: `Fetch content from a URL and process it.

Usage:
- URL must start with http:// or https://
- format: "text" extracts plain text, "markdown" converts HTML, "html" returns raw
- Optional timeout in seconds (max 120)
- Response size limited to 5MB`,

    parameters: z.object({
      url: z.string().describe('The URL to fetch content from'),
      format: z.enum(['text', 'markdown', 'html']).describe('The format to return the content in'),
      timeout: z.number().optional().describe('Optional timeout in seconds (max 120)'),
    }),

    async execute(params, ctx: ToolExecutionContext) {
      // Validate URL
      if (!params.url.startsWith('http://') && !params.url.startsWith('https://')) {
        throw new Error('URL must start with http:// or https://');
      }

      const timeout = Math.min((params.timeout ?? DEFAULT_TIMEOUT / 1000) * 1000, MAX_TIMEOUT);

      const controller = new AbortController();
      const timeoutId = setTimeout(controller.abort.bind(controller), timeout);

      // Build Accept header based on format
      let acceptHeader = '*/*';
      switch (params.format) {
        case 'markdown':
          acceptHeader = 'text/markdown;q=1.0, text/html;q=0.9, text/plain;q=0.8, */*;q=0.1';
          break;
        case 'text':
          acceptHeader = 'text/plain;q=1.0, text/html;q=0.9, */*;q=0.1';
          break;
        case 'html':
          acceptHeader = 'text/html;q=1.0, application/xhtml+xml;q=0.9, */*;q=0.1';
          break;
      }

      const response = await fetch(params.url, {
        signal: AbortSignal.any([controller.signal, ctx.abort]),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Zee/1.0)',
          Accept: acceptHeader,
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Request failed with status code: ${response.status}`);
      }

      // Check content length
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
        throw new Error('Response too large (exceeds 5MB limit)');
      }

      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
        throw new Error('Response too large (exceeds 5MB limit)');
      }

      const content = new TextDecoder().decode(arrayBuffer);
      const contentType = response.headers.get('content-type') || '';
      const title = `${params.url} (${contentType})`;

      // Process based on format
      switch (params.format) {
        case 'markdown':
          if (contentType.includes('text/html')) {
            return {
              output: convertHtmlToMarkdown(content),
              title,
              metadata: {},
            };
          }
          return { output: content, title, metadata: {} };

        case 'text':
          if (contentType.includes('text/html')) {
            return {
              output: extractTextFromHtml(content),
              title,
              metadata: {},
            };
          }
          return { output: content, title, metadata: {} };

        case 'html':
          return { output: content, title, metadata: {} };

        default:
          return { output: content, title, metadata: {} };
      }
    },
  }
);

// ============================================================================
// HTML Processing
// ============================================================================

function extractTextFromHtml(html: string): string {
  // Simple HTML text extraction
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function convertHtmlToMarkdown(html: string): string {
  // Simple HTML to markdown conversion
  let md = html;

  // Remove script and style
  md = md.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  md = md.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  // Headers
  md = md.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n');
  md = md.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n');
  md = md.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n');
  md = md.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n\n');
  md = md.replace(/<h5[^>]*>(.*?)<\/h5>/gi, '##### $1\n\n');
  md = md.replace(/<h6[^>]*>(.*?)<\/h6>/gi, '###### $1\n\n');

  // Paragraphs
  md = md.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n');

  // Bold and italic
  md = md.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
  md = md.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**');
  md = md.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
  md = md.replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*');

  // Links
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');

  // Lists
  md = md.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n');
  md = md.replace(/<\/?[uo]l[^>]*>/gi, '\n');

  // Code
  md = md.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`');
  md = md.replace(/<pre[^>]*>(.*?)<\/pre>/gi, '```\n$1\n```\n');

  // Line breaks
  md = md.replace(/<br\s*\/?>/gi, '\n');

  // Remove remaining tags
  md = md.replace(/<[^>]+>/g, '');

  // Clean up whitespace
  md = md.replace(/\n{3,}/g, '\n\n');
  md = md.trim();

  return md;
}
