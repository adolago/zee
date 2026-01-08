import path from "node:path";
import { describe, expect, it } from "vitest";

import { resolveOAuthDir, resolveOAuthPath } from "./paths.js";

describe("oauth paths", () => {
  it("prefers ZEE_OAUTH_DIR over ZEE_STATE_DIR", () => {
    const env = {
      ZEE_OAUTH_DIR: "/custom/oauth",
      ZEE_STATE_DIR: "/custom/state",
    } as NodeJS.ProcessEnv;

    expect(resolveOAuthDir(env, "/custom/state")).toBe(
      path.resolve("/custom/oauth"),
    );
    expect(resolveOAuthPath(env, "/custom/state")).toBe(
      path.join(path.resolve("/custom/oauth"), "oauth.json"),
    );
  });

  it("derives oauth path from ZEE_STATE_DIR when unset", () => {
    const env = {
      ZEE_STATE_DIR: "/custom/state",
    } as NodeJS.ProcessEnv;

    expect(resolveOAuthDir(env, "/custom/state")).toBe(
      path.join("/custom/state", "credentials"),
    );
    expect(resolveOAuthPath(env, "/custom/state")).toBe(
      path.join("/custom/state", "credentials", "oauth.json"),
    );
  });
});
