import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { ZeeConfig } from "../config/config.js";
import { runSecurityAudit } from "./audit.js";

describe("security/audit node exposure (deep)", () => {
  it("flags stale paired nodes with high-risk command surfaces", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "zee-audit-nodes-"));
    try {
      const nodesDir = path.join(tmpDir, "nodes");
      await fs.mkdir(nodesDir, { recursive: true });
      await fs.writeFile(path.join(nodesDir, "pending.json"), "{}\n", "utf8");
      await fs.writeFile(
        path.join(nodesDir, "paired.json"),
        JSON.stringify(
          {
            "node-1": {
              nodeId: "node-1",
              token: "token-1",
              displayName: "Old Node",
              platform: "linux",
              createdAtMs: Date.now() - 60 * 86_400_000,
              approvedAtMs: Date.now() - 60 * 86_400_000,
              lastConnectedAtMs: Date.now() - 45 * 86_400_000,
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      const cfg: ZeeConfig = {};
      const nonDeep = await runSecurityAudit({
        config: cfg,
        includeFilesystem: false,
        includeChannelSecurity: false,
        deep: false,
        stateDir: tmpDir,
      });
      expect(nonDeep.findings.some((finding) => finding.checkId === "nodes.pairing.high_risk_commands")).toBe(false);

      const deep = await runSecurityAudit({
        config: cfg,
        includeFilesystem: false,
        includeChannelSecurity: false,
        deep: true,
        stateDir: tmpDir,
      });
      const finding = deep.findings.find(
        (entry) => entry.checkId === "nodes.pairing.high_risk_commands",
      );
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("critical");
      expect(finding?.detail).toContain("system.run");
      expect(finding?.remediation).toContain("zee nodes revoke --node");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
