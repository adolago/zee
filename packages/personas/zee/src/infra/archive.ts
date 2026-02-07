import fs from "node:fs/promises";
import path from "node:path";
import * as tar from "tar";
import JSZip from "jszip";

export type ArchiveKind = "tar" | "zip";

export type ArchiveLogger = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
};

const TAR_SUFFIXES = [".tgz", ".tar.gz", ".tar"];

function assertWithinDest(destDir: string, candidatePath: string, entryName: string): void {
  const rel = path.relative(destDir, candidatePath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`archive entry escapes destination: ${entryName}`);
  }
}

function assertSafeArchiveEntryPath(entryPath: string): void {
  const normalized = entryPath.replaceAll("\\", "/");

  if (normalized.startsWith("/")) {
    throw new Error(`archive entry uses absolute path: ${entryPath}`);
  }
  if (/^[a-zA-Z]:[\\/]/.test(entryPath)) {
    throw new Error(`archive entry uses Windows absolute path: ${entryPath}`);
  }

  const parts = normalized.split("/").filter(Boolean);
  if (parts.some((p) => p === "..")) {
    throw new Error(`archive entry uses path traversal (".."): ${entryPath}`);
  }
}

export function resolveArchiveKind(filePath: string): ArchiveKind | null {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".zip")) return "zip";
  if (TAR_SUFFIXES.some((suffix) => lower.endsWith(suffix))) return "tar";
  return null;
}

export async function resolvePackedRootDir(extractDir: string): Promise<string> {
  const direct = path.join(extractDir, "package");
  try {
    const stat = await fs.stat(direct);
    if (stat.isDirectory()) return direct;
  } catch {
    // ignore
  }

  const entries = await fs.readdir(extractDir, { withFileTypes: true });
  const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  if (dirs.length !== 1) {
    throw new Error(`unexpected archive layout (dirs: ${dirs.join(", ")})`);
  }
  const onlyDir = dirs[0];
  if (!onlyDir) {
    throw new Error("unexpected archive layout (no package dir found)");
  }
  return path.join(extractDir, onlyDir);
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function extractZip(params: { archivePath: string; destDir: string }): Promise<void> {
  const destRoot = path.resolve(params.destDir);
  const buffer = await fs.readFile(params.archivePath);
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files);

  for (const entry of entries) {
    const entryPath = entry.name.replaceAll("\\", "/");
    assertSafeArchiveEntryPath(entryPath);
    if (!entryPath || entryPath.endsWith("/")) {
      const dirPath = path.resolve(destRoot, entryPath);
      assertWithinDest(destRoot, dirPath, entry.name);
      await fs.mkdir(dirPath, { recursive: true });
      continue;
    }

    const outPath = path.resolve(destRoot, entryPath);
    assertWithinDest(destRoot, outPath, entry.name);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    const data = await entry.async("nodebuffer");
    await fs.writeFile(outPath, data);
  }
}

async function validateTar(params: { archivePath: string }): Promise<void> {
  // Use sync mode so validation failures are propagated as errors.
  // In async mode, throwing inside onentry/onReadEntry can surface as an
  // unhandled exception instead of rejecting the returned promise.
  tar.t({
    file: params.archivePath,
    sync: true,
    onentry(entry) {
      const entryPath = String((entry as { path?: unknown }).path ?? "");
      assertSafeArchiveEntryPath(entryPath);

      const type = String((entry as { type?: unknown }).type ?? "");
      if (type === "SymbolicLink" || type === "Link" || type === "HardLink") {
        throw new Error(`tar entry is a link (type ${type}): ${entryPath}`);
      }
    },
  });
}

export async function extractArchive(params: {
  archivePath: string;
  destDir: string;
  timeoutMs: number;
  logger?: ArchiveLogger;
}): Promise<void> {
  const kind = resolveArchiveKind(params.archivePath);
  if (!kind) {
    throw new Error(`unsupported archive: ${params.archivePath}`);
  }

  const label = kind === "zip" ? "extract zip" : "extract tar";
  if (kind === "tar") {
    await withTimeout(validateTar(params), params.timeoutMs, "validate tar");
    await withTimeout(
      tar.x({ file: params.archivePath, cwd: params.destDir }),
      params.timeoutMs,
      label,
    );
    return;
  }

  await withTimeout(extractZip(params), params.timeoutMs, label);
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf-8");
  return JSON.parse(raw) as T;
}
