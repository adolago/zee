import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OAuthCredentials } from "../agents/pi-ai-compat.js";

import { writeOAuthCredentials } from "./onboard-auth.js";

describe("writeOAuthCredentials", () => {
  const previousStateDir = process.env.ZEE_STATE_DIR;
  const previousAgentDir = process.env.ZEE_AGENT_DIR;
  const previousPiAgentDir = process.env.PI_CODING_AGENT_DIR;
  let tempStateDir: string | null = null;

  afterEach(async () => {
    if (tempStateDir) {
      await fs.rm(tempStateDir, { recursive: true, force: true });
      tempStateDir = null;
    }
    if (previousStateDir === undefined) {
      delete process.env.ZEE_STATE_DIR;
    } else {
      process.env.ZEE_STATE_DIR = previousStateDir;
    }
    if (previousAgentDir === undefined) {
      delete process.env.ZEE_AGENT_DIR;
    } else {
      process.env.ZEE_AGENT_DIR = previousAgentDir;
    }
    if (previousPiAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previousPiAgentDir;
    }
    delete process.env.ZEE_OAUTH_DIR;
  });

  it("writes auth-profiles.json under ZEE_STATE_DIR/agents/main/agent", async () => {
    tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "zee-oauth-"));
    process.env.ZEE_STATE_DIR = tempStateDir;
    // Even if legacy env vars are set, onboarding should write to the multi-agent path.
    process.env.ZEE_AGENT_DIR = path.join(tempStateDir, "agent");
    process.env.PI_CODING_AGENT_DIR = process.env.ZEE_AGENT_DIR;

    const creds = {
      refresh: "refresh-token",
      access: "access-token",
      expires: Date.now() + 60_000,
    } satisfies OAuthCredentials;

    await writeOAuthCredentials("anthropic", creds);

    // Now writes to the multi-agent path: agents/main/agent
    const authProfilePath = path.join(
      tempStateDir,
      "agents",
      "main",
      "agent",
      "auth-profiles.json",
    );
    const raw = await fs.readFile(authProfilePath, "utf8");
    const parsed = JSON.parse(raw) as {
      profiles?: Record<string, OAuthCredentials & { type?: string }>;
    };
    expect(parsed.profiles?.["anthropic:default"]).toMatchObject({
      refresh: "refresh-token",
      access: "access-token",
      type: "oauth",
    });

    await expect(
      fs.readFile(
        path.join(tempStateDir, "agent", "auth-profiles.json"),
        "utf8",
      ),
    ).rejects.toThrow();
  });
});
