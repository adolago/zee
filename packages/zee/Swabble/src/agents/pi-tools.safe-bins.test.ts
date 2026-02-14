import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ZeeConfig } from "../config/config.js";
import type { ExecApprovalsResolved } from "../infra/exec-approvals.js";
import { createZeeCodingTools } from "./pi-tools.js";

vi.mock("../infra/exec-approvals.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../infra/exec-approvals.js")>();
  const approvals: ExecApprovalsResolved = {
    path: "/tmp/exec-approvals.json",
    socketPath: "/tmp/exec-approvals.sock",
    token: "token",
    defaults: {
      security: "allowlist",
      ask: "off",
      askFallback: "deny",
      autoAllowSkills: false,
    },
    agent: {
      security: "allowlist",
      ask: "off",
      askFallback: "deny",
      autoAllowSkills: false,
    },
    allowlist: [],
    file: {
      version: 1,
      socket: { path: "/tmp/exec-approvals.sock", token: "token" },
      defaults: {
        security: "allowlist",
        ask: "off",
        askFallback: "deny",
        autoAllowSkills: false,
      },
      agents: {},
    },
  };
  return { ...mod, resolveExecApprovals: () => approvals };
});

describe("createZeeCodingTools safeBins", () => {
  it("threads tools.exec.safeBins into exec allowlist checks", async () => {
    if (process.platform === "win32") return;

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zee-safe-bins-"));
    const cfg: ZeeConfig = {
      tools: {
        exec: {
          host: "gateway",
          security: "allowlist",
          ask: "off",
          safeBins: ["echo"],
        },
      },
    };

    const tools = createZeeCodingTools({
      config: cfg,
      sessionKey: "agent:main:main",
      workspaceDir: tmpDir,
      agentDir: path.join(tmpDir, "agent"),
    });
    const execTool = tools.find((tool) => tool.name === "exec");
    expect(execTool).toBeDefined();

    const marker = `safe-bins-${Date.now()}`;
    const result = await execTool!.execute("call1", {
      command: `echo ${marker}`,
      workdir: tmpDir,
    });
    const text = result.content.find((content) => content.type === "text")?.text ?? "";

    expect(result.details.status).toBe("completed");
    expect(text).toContain(marker);
  });

  it("applies agent-specific exec host defaults over global defaults", async () => {
    if (process.platform === "win32") return;

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zee-agent-exec-host-"));
    const cfg: ZeeConfig = {
      tools: {
        exec: {
          host: "sandbox",
          security: "full",
          ask: "off",
        },
      },
      agents: {
        list: [
          {
            id: "main",
            tools: {
              exec: {
                host: "gateway",
              },
            },
          },
          { id: "helper" },
        ],
      },
    };

    const mainTools = createZeeCodingTools({
      config: cfg,
      sessionKey: "agent:main:main",
      workspaceDir: tmpDir,
      agentDir: path.join(tmpDir, "agent-main"),
    });
    const mainExecTool = mainTools.find((tool) => tool.name === "exec");
    expect(mainExecTool).toBeDefined();
    await expect(
      mainExecTool!.execute("call-main", {
        command: "echo done",
        host: "sandbox",
      }),
    ).rejects.toThrow("exec host not allowed");

    const helperTools = createZeeCodingTools({
      config: cfg,
      sessionKey: "agent:helper:main",
      workspaceDir: tmpDir,
      agentDir: path.join(tmpDir, "agent-helper"),
    });
    const helperExecTool = helperTools.find((tool) => tool.name === "exec");
    expect(helperExecTool).toBeDefined();
    const helperResult = await helperExecTool!.execute("call-helper", {
      command: "echo done",
      host: "sandbox",
      yieldMs: 10,
    });
    expect(helperResult.details.status).toBe("completed");
  });
});
