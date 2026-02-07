/**
 * Glob Pattern Validation (MCP)
 *
 * Defensive checks to prevent glob patterns from escaping a sandbox directory.
 */

export class GlobPatternError extends Error {
  readonly code = 'GLOB_PATTERN_ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'GlobPatternError';
  }
}

export function assertSafeGlobPattern(pattern: string, label = 'glob pattern'): void {
  const raw = typeof pattern === 'string' ? pattern : '';
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new GlobPatternError(`Empty ${label}`);
  }

  // Normalize for checks only (do not change the actual pattern semantics).
  const normalized = trimmed.replaceAll('\\', '/');

  if (normalized.includes('\0')) {
    throw new GlobPatternError(`Invalid ${label}: contains NUL byte`);
  }

  // Absolute paths (posix) or Windows drive paths.
  if (normalized.startsWith('/')) {
    throw new GlobPatternError(`Invalid ${label}: absolute patterns are not allowed`);
  }
  if (/^[a-zA-Z]:[\\/]/.test(trimmed)) {
    throw new GlobPatternError(`Invalid ${label}: Windows absolute patterns are not allowed`);
  }

  // Block traversal segments like ../ or a/../b.
  const parts = normalized.split('/').filter((p) => p.length > 0);
  if (parts.some((p) => p === '..')) {
    throw new GlobPatternError(`Invalid ${label}: path traversal ("..") is not allowed`);
  }
}

