import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("cli credentials", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    delete process.env.CODEX_HOME;
    const { resetCliCredentialCachesForTest } = await import("./cli-credentials.js");
    resetCliCredentialCachesForTest();
  });

  it("writes Claude CLI credentials to the file store", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zee-"));
    const credPath = path.join(tempDir, ".claude", ".credentials.json");

    fs.mkdirSync(path.dirname(credPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      credPath,
      `${JSON.stringify(
        {
          claudeAiOauth: {
            accessToken: "old-access",
            refreshToken: "old-refresh",
            expiresAt: Date.now() + 60_000,
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const { writeClaudeCliCredentials } = await import("./cli-credentials.js");

    const ok = writeClaudeCliCredentials(
      {
        access: "new-access",
        refresh: "new-refresh",
        expires: Date.now() + 120_000,
      },
      { homeDir: tempDir },
    );

    expect(ok).toBe(true);

    const updated = JSON.parse(fs.readFileSync(credPath, "utf8")) as {
      claudeAiOauth?: {
        accessToken?: string;
        refreshToken?: string;
        expiresAt?: number;
      };
    };

    expect(updated.claudeAiOauth?.accessToken).toBe("new-access");
    expect(updated.claudeAiOauth?.refreshToken).toBe("new-refresh");
    expect(updated.claudeAiOauth?.expiresAt).toBeTypeOf("number");
  });

  it("caches Claude CLI credentials within the TTL window", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zee-"));
    const credPath = path.join(tempDir, ".claude", ".credentials.json");
    fs.mkdirSync(path.dirname(credPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      credPath,
      JSON.stringify(
        {
          claudeAiOauth: {
            accessToken: "cached-access",
            refreshToken: "cached-refresh",
            expiresAt: Date.now() + 60_000,
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));

    const { readClaudeCliCredentialsCached } = await import("./cli-credentials.js");

    const first = readClaudeCliCredentialsCached({
      ttlMs: 15 * 60 * 1000,
      homeDir: tempDir,
    });

    fs.writeFileSync(
      credPath,
      JSON.stringify(
        {
          claudeAiOauth: {
            accessToken: "changed-access",
            refreshToken: "changed-refresh",
            expiresAt: Date.now() + 60_000,
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const second = readClaudeCliCredentialsCached({
      ttlMs: 15 * 60 * 1000,
      homeDir: tempDir,
    });

    expect(first).toBeTruthy();
    expect(second).toEqual(first);
  });

  it("reads Codex credentials from auth.json", async () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "zee-codex-"));
    process.env.CODEX_HOME = tempHome;

    const authPath = path.join(tempHome, "auth.json");
    fs.mkdirSync(tempHome, { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      authPath,
      JSON.stringify({
        tokens: {
          access_token: "file-access",
          refresh_token: "file-refresh",
        },
      }),
      "utf8",
    );

    const { readCodexCliCredentials } = await import("./cli-credentials.js");
    const creds = readCodexCliCredentials();

    expect(creds).toMatchObject({
      access: "file-access",
      refresh: "file-refresh",
      provider: "openai-codex",
    });
  });
});
