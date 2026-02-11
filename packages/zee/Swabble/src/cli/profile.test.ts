import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatCliCommand } from "./command-format.js";
import { applyCliProfileEnv, parseCliProfileArgs } from "./profile.js";

describe("parseCliProfileArgs", () => {
  it("leaves gateway --dev for subcommands", () => {
    const res = parseCliProfileArgs([
      "node",
      "zee",
      "gateway",
      "--dev",
      "--allow-unconfigured",
    ]);
    if (!res.ok) throw new Error(res.error);
    expect(res.profile).toBeNull();
    expect(res.argv).toEqual(["node", "zee", "gateway", "--dev", "--allow-unconfigured"]);
  });

  it("still accepts global --dev before subcommand", () => {
    const res = parseCliProfileArgs(["node", "zee", "--dev", "gateway"]);
    if (!res.ok) throw new Error(res.error);
    expect(res.profile).toBe("dev");
    expect(res.argv).toEqual(["node", "zee", "gateway"]);
  });

  it("parses --profile value and strips it", () => {
    const res = parseCliProfileArgs(["node", "zee", "--profile", "work", "status"]);
    if (!res.ok) throw new Error(res.error);
    expect(res.profile).toBe("work");
    expect(res.argv).toEqual(["node", "zee", "status"]);
  });

  it("rejects missing profile value", () => {
    const res = parseCliProfileArgs(["node", "zee", "--profile"]);
    expect(res.ok).toBe(false);
  });

  it("rejects combining --dev with --profile (dev first)", () => {
    const res = parseCliProfileArgs(["node", "zee", "--dev", "--profile", "work", "status"]);
    expect(res.ok).toBe(false);
  });

  it("rejects combining --dev with --profile (profile first)", () => {
    const res = parseCliProfileArgs(["node", "zee", "--profile", "work", "--dev", "status"]);
    expect(res.ok).toBe(false);
  });
});

describe("applyCliProfileEnv", () => {
  it("fills env defaults for dev profile", () => {
    const env: Record<string, string | undefined> = {};
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    const expectedStateDir = path.join("/home/peter", ".zee-dev");
    expect(env.ZEE_PROFILE).toBe("dev");
    expect(env.ZEE_STATE_DIR).toBe(expectedStateDir);
    expect(env.ZEE_CONFIG_PATH).toBe(path.join(expectedStateDir, "zee.json"));
    expect(env.ZEE_GATEWAY_PORT).toBe("19001");
  });

  it("does not override explicit env values", () => {
    const env: Record<string, string | undefined> = {
      ZEE_STATE_DIR: "/custom",
      ZEE_GATEWAY_PORT: "19099",
    };
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    expect(env.ZEE_STATE_DIR).toBe("/custom");
    expect(env.ZEE_GATEWAY_PORT).toBe("19099");
    expect(env.ZEE_CONFIG_PATH).toBe(path.join("/custom", "zee.json"));
  });
});

describe("formatCliCommand", () => {
  it("returns command unchanged when no profile is set", () => {
    expect(formatCliCommand("zee doctor --fix", {})).toBe("zee doctor --fix");
  });

  it("returns command unchanged when profile is default", () => {
    expect(formatCliCommand("zee doctor --fix", { ZEE_PROFILE: "default" })).toBe(
      "zee doctor --fix",
    );
  });

  it("returns command unchanged when profile is Default (case-insensitive)", () => {
    expect(formatCliCommand("zee doctor --fix", { ZEE_PROFILE: "Default" })).toBe(
      "zee doctor --fix",
    );
  });

  it("returns command unchanged when profile is invalid", () => {
    expect(formatCliCommand("zee doctor --fix", { ZEE_PROFILE: "bad profile" })).toBe(
      "zee doctor --fix",
    );
  });

  it("returns command unchanged when --profile is already present", () => {
    expect(formatCliCommand("zee --profile work doctor --fix", { ZEE_PROFILE: "work" })).toBe(
      "zee --profile work doctor --fix",
    );
  });

  it("returns command unchanged when --dev is already present", () => {
    expect(formatCliCommand("zee --dev doctor", { ZEE_PROFILE: "dev" })).toBe(
      "zee --dev doctor",
    );
  });

  it("inserts --profile flag when profile is set", () => {
    expect(formatCliCommand("zee doctor --fix", { ZEE_PROFILE: "work" })).toBe(
      "zee --profile work doctor --fix",
    );
  });

  it("trims whitespace from profile", () => {
    expect(formatCliCommand("zee doctor --fix", { ZEE_PROFILE: "  jbzee  " })).toBe(
      "zee --profile jbzee doctor --fix",
    );
  });

  it("handles command with no args after zee", () => {
    expect(formatCliCommand("zee", { ZEE_PROFILE: "test" })).toBe("zee --profile test");
  });

  it("handles pnpm wrapper", () => {
    expect(formatCliCommand("pnpm zee doctor", { ZEE_PROFILE: "work" })).toBe(
      "pnpm zee --profile work doctor",
    );
  });
});
