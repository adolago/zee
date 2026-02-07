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

let scanImpl: (dirPath: string) => Promise<ScanSummary> = async () => emptyScanSummary;

vi.mock("../security/skill-scanner.js", () => ({
  scanDirectoryWithSummary: (dirPath: string) => scanImpl(dirPath),
}));

vi.mock("../process/exec.js", () => ({
  runCommandWithTimeout: async () => ({ code: 0, stdout: "ok", stderr: "" }),
}));

const tempDirs: string[] = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zee-skill-install-scan-"));
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

function writeSkill(params: { workspaceDir: string; skillName: string }) {
  const skillDir = path.join(params.workspaceDir, "skills", params.skillName);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${params.skillName}\ndescription: test skill\nmetadata: {"zee":{"install":[{"id":"node","kind":"node","package":"left-pad","label":"Install (node)"}]}}\n---\n\n# ${params.skillName}\n`,
    "utf-8",
  );
  fs.writeFileSync(path.join(skillDir, "runner.js"), "export {};\n", "utf-8");
  return { skillDir };
}

describe("agents/skills-install code safety scan (warn-only)", () => {
  it("attaches warnings on critical scan findings (successful install)", async () => {
    const workspaceDir = makeTempDir();
    const { skillDir } = writeSkill({ workspaceDir, skillName: "evil-skill" });

    scanImpl = async () => ({
      scannedFiles: 1,
      critical: 1,
      warn: 0,
      info: 0,
      findings: [
        {
          ruleId: "dangerous-exec",
          severity: "critical",
          file: path.join(skillDir, "runner.js"),
          line: 2,
          message: "Shell command execution detected (child_process)",
          evidence: "exec(...)",
        },
      ],
    });

    const { installSkill } = await import("./skills-install.js");
    const res = await installSkill({
      workspaceDir,
      skillName: "evil-skill",
      installId: "node",
    });

    expect(res.ok).toBe(true);
    expect(res.warnings?.length).toBe(1);
    expect(res.warnings?.[0]).toContain('WARNING: Skill "evil-skill"');
    expect(res.warnings?.[0]).toContain("runner.js:2");
  });

  it("attaches warnings when scan fails (installer still runs)", async () => {
    const workspaceDir = makeTempDir();
    writeSkill({ workspaceDir, skillName: "scanfail-skill" });

    scanImpl = async () => {
      throw new Error("boom");
    };

    const { installSkill } = await import("./skills-install.js");
    const res = await installSkill({
      workspaceDir,
      skillName: "scanfail-skill",
      installId: "node",
    });

    expect(res.ok).toBe(true);
    expect(res.warnings?.[0]).toContain("code safety scan failed");
    expect(res.warnings?.[0]).toContain("boom");
  });

  it("attaches warnings even when installer id is missing", async () => {
    const workspaceDir = makeTempDir();
    const { skillDir } = writeSkill({ workspaceDir, skillName: "missing-installer" });

    scanImpl = async () => ({
      scannedFiles: 1,
      critical: 1,
      warn: 0,
      info: 0,
      findings: [
        {
          ruleId: "dangerous-exec",
          severity: "critical",
          file: path.join(skillDir, "runner.js"),
          line: 1,
          message: "Shell command execution detected (child_process)",
          evidence: "exec(...)",
        },
      ],
    });

    const { installSkill } = await import("./skills-install.js");
    const res = await installSkill({
      workspaceDir,
      skillName: "missing-installer",
      installId: "nope",
    });

    expect(res.ok).toBe(false);
    expect(res.warnings?.[0]).toContain('WARNING: Skill "missing-installer"');
  });
});

