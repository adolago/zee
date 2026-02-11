import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { withTempHome } from "./test-helpers.js";

describe("multi-agent agentDir validation", () => {
  it("rejects shared agents.list agentDir", async () => {
    vi.resetModules();
    const { validateConfigObject } = await import("./config.js");
    const shared = path.join(tmpdir(), "zee-shared-agentdir");
    const res = validateConfigObject({
      agents: {
        list: [
          { id: "a", agentDir: shared },
          { id: "b", agentDir: shared },
        ],
      },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issues.some((i) => i.path === "agents.list")).toBe(true);
      expect(res.issues[0]?.message).toContain("Duplicate agentDir");
    }
  });

  it("throws on shared agentDir during loadConfig()", async () => {
    await withTempHome(async (home) => {
      const configDir = path.join(home, ".zee");
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(
        path.join(configDir, "zee.json"),
        JSON.stringify(
          {
            agents: {
              list: [
                { id: "a", agentDir: "~/.zee/agents/shared/agent" },
                { id: "b", agentDir: "~/.zee/agents/shared/agent" },
              ],
            },
            bindings: [{ agentId: "a", match: { channel: "whatsapp" } }],
          },
          null,
          2,
        ),
        "utf-8",
      );

      vi.resetModules();
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { loadConfig } = await import("./config.js");
      expect(() => loadConfig()).toThrow(/duplicate agentDir/i);
      expect(spy.mock.calls.flat().join(" ")).toMatch(/Duplicate agentDir/i);
      spy.mockRestore();
    });
  });
});
