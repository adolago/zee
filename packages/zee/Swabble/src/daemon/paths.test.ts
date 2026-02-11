import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveGatewayStateDir } from "./paths.js";

describe("resolveGatewayStateDir", () => {
  it("uses the default state dir when no overrides are set", () => {
    const env = { HOME: "/Users/test" };
    expect(resolveGatewayStateDir(env)).toBe(path.join("/Users/test", ".zee"));
  });

  it("appends the profile suffix when set", () => {
    const env = { HOME: "/Users/test", ZEE_PROFILE: "rescue" };
    expect(resolveGatewayStateDir(env)).toBe(path.join("/Users/test", ".zee-rescue"));
  });

  it("treats default profiles as the base state dir", () => {
    const env = { HOME: "/Users/test", ZEE_PROFILE: "Default" };
    expect(resolveGatewayStateDir(env)).toBe(path.join("/Users/test", ".zee"));
  });

  it("uses ZEE_STATE_DIR when provided", () => {
    const env = { HOME: "/Users/test", ZEE_STATE_DIR: "/var/lib/zee" };
    expect(resolveGatewayStateDir(env)).toBe(path.resolve("/var/lib/zee"));
  });

  it("expands ~ in ZEE_STATE_DIR", () => {
    const env = { HOME: "/Users/test", ZEE_STATE_DIR: "~/zee-state" };
    expect(resolveGatewayStateDir(env)).toBe(path.resolve("/Users/test/zee-state"));
  });

  it("preserves Windows absolute paths without HOME", () => {
    const env = { ZEE_STATE_DIR: "C:\\State\\zee" };
    expect(resolveGatewayStateDir(env)).toBe("C:\\State\\zee");
  });
});
