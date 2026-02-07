import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

type ScanSummary = {
  scannedFiles: number;
  critical: number;
  warn: number;
  info: number;
  findings: Array<{
    ruleId: string;
    severity: "info" | "warn" | "critical";
    file: string;
    line: number;
    message: string;
    evidence: string;
  }>;
};

const emptyScanSummary: ScanSummary = {
  scannedFiles: 0,
  critical: 0,
  warn: 0,
  info: 0,
  findings: [],
};

let scanImpl: (dirPath: string, opts?: { includeFiles?: string[] }) => Promise<ScanSummary> =
  async () => emptyScanSummary;

vi.mock("../security/skill-scanner.js", () => ({
  scanDirectoryWithSummary: (dirPath: string, opts?: { includeFiles?: string[] }) =>
    scanImpl(dirPath, opts),
}));

const tempDirs: string[] = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zee-plugin-scan-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  scanImpl = async () => emptyScanSummary;
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  }
});

describe("plugins/install code safety scan (warn-only)", () => {
  it("warns on critical scan findings but continues", async () => {
    const stateDir = makeTempDir();
    const pluginDir = makeTempDir();
    fs.writeFileSync(
      path.join(pluginDir, "package.json"),
      JSON.stringify({
        name: "@zee/evil-plugin",
        version: "0.0.1",
        zee: { extensions: ["index.js"] },
      }),
      "utf-8",
    );

    scanImpl = async () => ({
      scannedFiles: 1,
      critical: 1,
      warn: 0,
      info: 0,
      findings: [
        {
          ruleId: "dangerous-exec",
          severity: "critical",
          file: path.join(pluginDir, "index.js"),
          line: 1,
          message: "Shell command execution detected (child_process)",
          evidence: 'exec("curl ...")',
        },
      ],
    });

    const warnings: string[] = [];
    const { installPluginFromDir } = await import("./install.js");
    const res = await installPluginFromDir({
      dirPath: pluginDir,
      extensionsDir: path.join(stateDir, "extensions"),
      dryRun: true,
      logger: { warn: (m) => warnings.push(m) },
    });

    expect(res.ok).toBe(true);
    expect(warnings.some((w) => w.includes('WARNING: Plugin "evil-plugin"'))).toBe(true);
    expect(warnings.some((w) => w.includes("dangerous code patterns"))).toBe(true);
  });

  it("warns when extension entry is under a hidden path (targeted scan coverage)", async () => {
    const stateDir = makeTempDir();
    const pluginDir = makeTempDir();
    fs.writeFileSync(
      path.join(pluginDir, "package.json"),
      JSON.stringify({
        name: "@zee/hidden-plugin",
        version: "0.0.1",
        zee: { extensions: [".hidden/index.js"] },
      }),
      "utf-8",
    );

    const warnings: string[] = [];
    const { installPluginFromDir } = await import("./install.js");
    const res = await installPluginFromDir({
      dirPath: pluginDir,
      extensionsDir: path.join(stateDir, "extensions"),
      dryRun: true,
      logger: { warn: (m) => warnings.push(m) },
    });

    expect(res.ok).toBe(true);
    expect(warnings.some((w) => w.includes("hidden/node_modules") && w.includes(".hidden/index.js")))
      .toBe(true);
  });

  it("warns on scan failure but continues", async () => {
    const stateDir = makeTempDir();
    const pluginDir = makeTempDir();
    fs.writeFileSync(
      path.join(pluginDir, "package.json"),
      JSON.stringify({
        name: "@zee/scanfail-plugin",
        version: "0.0.1",
        zee: { extensions: ["index.js"] },
      }),
      "utf-8",
    );

    scanImpl = async () => {
      throw new Error("boom");
    };

    const warnings: string[] = [];
    const { installPluginFromDir } = await import("./install.js");
    const res = await installPluginFromDir({
      dirPath: pluginDir,
      extensionsDir: path.join(stateDir, "extensions"),
      dryRun: true,
      logger: { warn: (m) => warnings.push(m) },
    });

    expect(res.ok).toBe(true);
    expect(warnings.some((w) => w.includes("code safety scan failed") && w.includes("boom"))).toBe(
      true,
    );
  });
});

