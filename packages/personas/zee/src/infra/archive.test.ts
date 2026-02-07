import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import * as tar from "tar";
import { afterEach, describe, expect, it } from "vitest";
import { extractArchive, resolveArchiveKind, resolvePackedRootDir } from "./archive.js";

const tempDirs: string[] = [];

function writeString(buf: Buffer, offset: number, length: number, value: string) {
  const bytes = Buffer.from(value, "utf8");
  bytes.copy(buf, offset, 0, Math.min(bytes.length, length));
}

function writeOctal(buf: Buffer, offset: number, length: number, value: number) {
  const s = value.toString(8).padStart(length - 1, "0") + "\0";
  writeString(buf, offset, length, s);
}

function buildTar(entries: Array<{ name: string; content?: string; typeflag?: string; linkname?: string }>): Buffer {
  const blocks: Buffer[] = [];
  const now = Math.floor(Date.now() / 1000);

  for (const entry of entries) {
    const content = typeof entry.content === "string" ? Buffer.from(entry.content, "utf8") : Buffer.alloc(0);
    const header = Buffer.alloc(512, 0);

    writeString(header, 0, 100, entry.name);
    writeString(header, 100, 8, "0000777\0");
    writeString(header, 108, 8, "0000000\0");
    writeString(header, 116, 8, "0000000\0");
    writeOctal(header, 124, 12, content.length);
    writeOctal(header, 136, 12, now);

    // Checksum field must be spaces for calculation.
    header.fill(0x20, 148, 156);

    const typeflag = entry.typeflag ?? "0";
    writeString(header, 156, 1, typeflag);

    if (entry.linkname) {
      writeString(header, 157, 100, entry.linkname);
    }

    writeString(header, 257, 6, "ustar\0");
    writeString(header, 263, 2, "00");

    let checksum = 0;
    for (const b of header) checksum += b;
    const chksum = checksum.toString(8).padStart(6, "0") + "\0 ";
    writeString(header, 148, 8, chksum);

    blocks.push(header);
    blocks.push(content);

    const pad = content.length % 512 === 0 ? 0 : 512 - (content.length % 512);
    if (pad) blocks.push(Buffer.alloc(pad, 0));
  }

  // End of archive: two empty blocks.
  blocks.push(Buffer.alloc(1024, 0));
  return Buffer.concat(blocks);
}

async function makeTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zee-archive-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  }
});

describe("archive utils", () => {
  it("detects archive kinds", () => {
    expect(resolveArchiveKind("/tmp/file.zip")).toBe("zip");
    expect(resolveArchiveKind("/tmp/file.tgz")).toBe("tar");
    expect(resolveArchiveKind("/tmp/file.tar.gz")).toBe("tar");
    expect(resolveArchiveKind("/tmp/file.tar")).toBe("tar");
    expect(resolveArchiveKind("/tmp/file.txt")).toBeNull();
  });

  it("extracts zip archives", async () => {
    const workDir = await makeTempDir();
    const archivePath = path.join(workDir, "bundle.zip");
    const extractDir = path.join(workDir, "extract");

    const zip = new JSZip();
    zip.file("package/hello.txt", "hi");
    await fs.writeFile(archivePath, await zip.generateAsync({ type: "nodebuffer" }));

    await fs.mkdir(extractDir, { recursive: true });
    await extractArchive({ archivePath, destDir: extractDir, timeoutMs: 5_000 });
    const rootDir = await resolvePackedRootDir(extractDir);
    const content = await fs.readFile(path.join(rootDir, "hello.txt"), "utf-8");
    expect(content).toBe("hi");
  });

  it("rejects zip slip entries", async () => {
    const workDir = await makeTempDir();
    const archivePath = path.join(workDir, "bundle.zip");
    const extractDir = path.join(workDir, "extract");

    const zip = new JSZip();
    zip.file("../evil.txt", "nope");
    await fs.writeFile(archivePath, await zip.generateAsync({ type: "nodebuffer" }));

    await fs.mkdir(extractDir, { recursive: true });
    await expect(extractArchive({ archivePath, destDir: extractDir, timeoutMs: 5_000 })).rejects.toThrow(
      /path traversal|\.\.|absolute/i,
    );
  });

  it("extracts tar archives", async () => {
    const workDir = await makeTempDir();
    const archivePath = path.join(workDir, "bundle.tar");
    const extractDir = path.join(workDir, "extract");
    const packageDir = path.join(workDir, "package");

    await fs.mkdir(packageDir, { recursive: true });
    await fs.writeFile(path.join(packageDir, "hello.txt"), "yo");
    await tar.c({ cwd: workDir, file: archivePath }, ["package"]);

    await fs.mkdir(extractDir, { recursive: true });
    await extractArchive({ archivePath, destDir: extractDir, timeoutMs: 5_000 });
    const rootDir = await resolvePackedRootDir(extractDir);
    const content = await fs.readFile(path.join(rootDir, "hello.txt"), "utf-8");
    expect(content).toBe("yo");
  });

  it("rejects tar slip entries", async () => {
    const workDir = await makeTempDir();
    const archivePath = path.join(workDir, "bundle.tar");
    const extractDir = path.join(workDir, "extract");

    await fs.writeFile(archivePath, buildTar([{ name: "../evil.txt", content: "nope" }]));
    await fs.mkdir(extractDir, { recursive: true });

    await expect(extractArchive({ archivePath, destDir: extractDir, timeoutMs: 5_000 })).rejects.toThrow(
      /path traversal|\.\./i,
    );
  });

  it("rejects tar symlink entries", async () => {
    const workDir = await makeTempDir();
    const archivePath = path.join(workDir, "bundle.tar");
    const extractDir = path.join(workDir, "extract");

    await fs.writeFile(
      archivePath,
      buildTar([{ name: "package/link", typeflag: "2", linkname: "/etc/passwd" }]),
    );
    await fs.mkdir(extractDir, { recursive: true });

    await expect(extractArchive({ archivePath, destDir: extractDir, timeoutMs: 5_000 })).rejects.toThrow(
      /link/i,
    );
  });
});
