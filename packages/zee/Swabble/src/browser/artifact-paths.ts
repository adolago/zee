import crypto from "node:crypto";
import path from "node:path";

export const BROWSER_ARTIFACT_ROOT = "/tmp/zee/browser-artifacts";
export const BROWSER_DOWNLOAD_ROOT = path.join(BROWSER_ARTIFACT_ROOT, "downloads");
export const BROWSER_TRACE_ROOT = path.join(BROWSER_ARTIFACT_ROOT, "traces");

function ensureTrailingSep(value: string): string {
  return value.endsWith(path.sep) ? value : `${value}${path.sep}`;
}

function isPathWithinRoot(rootDir: string, candidate: string): boolean {
  const rootWithSep = ensureTrailingSep(path.resolve(rootDir));
  const resolved = path.resolve(candidate);
  return resolved === path.resolve(rootDir) || resolved.startsWith(rootWithSep);
}

function sanitizeFileName(input: string, fallback: string): string {
  const base = path.basename(input).trim();
  if (!base) return fallback;
  const safe = base.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe || fallback;
}

function resolveArtifactPath(params: {
  rootDir: string;
  requestedPath?: string;
  defaultName: string;
}): string {
  const root = path.resolve(params.rootDir);
  const rawRequested = params.requestedPath?.trim();
  const resolved = rawRequested ? path.resolve(root, rawRequested) : path.join(root, params.defaultName);
  if (!isPathWithinRoot(root, resolved)) {
    throw new Error(`path must be within ${root}`);
  }
  return resolved;
}

export function resolveBrowserDownloadOutputPath(params: {
  requestedPath?: string;
  suggestedFilename?: string;
}): string {
  const fileName = sanitizeFileName(params.suggestedFilename ?? "", "download.bin");
  return resolveArtifactPath({
    rootDir: BROWSER_DOWNLOAD_ROOT,
    requestedPath: params.requestedPath,
    defaultName: `${crypto.randomUUID()}-${fileName}`,
  });
}

export function resolveBrowserTraceOutputPath(params: {
  requestedPath?: string;
  traceId?: string;
}): string {
  const traceId = sanitizeFileName(params.traceId ?? "", crypto.randomUUID());
  return resolveArtifactPath({
    rootDir: BROWSER_TRACE_ROOT,
    requestedPath: params.requestedPath,
    defaultName: `browser-trace-${traceId}.zip`,
  });
}
