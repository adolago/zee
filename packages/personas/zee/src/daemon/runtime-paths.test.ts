import { afterEach, describe, expect, it, vi } from "vitest";

const fsMocks = vi.hoisted(() => ({
  access: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  default: { access: fsMocks.access },
  access: fsMocks.access,
}));

import {
  renderSystemNodeWarning,
  resolvePreferredNodePath,
  resolveSystemNodeInfo,
} from "./runtime-paths.js";

afterEach(() => {
  vi.resetAllMocks();
});

describe("resolvePreferredNodePath", () => {
  const linuxNode = "/usr/local/bin/node";

  it("uses system node when it meets the minimum version", async () => {
    fsMocks.access.mockImplementation(async (target: string) => {
      if (target === linuxNode) return;
      throw new Error("missing");
    });

    const execFile = vi.fn().mockResolvedValue({ stdout: "22.12.0\n", stderr: "" });

    const result = await resolvePreferredNodePath({
      env: {},
      runtime: "node",
      platform: "linux",
      execFile,
    });

    expect(result).toBe(linuxNode);
    expect(execFile).toHaveBeenCalledTimes(1);
  });

  it("skips system node when it is too old", async () => {
    fsMocks.access.mockImplementation(async (target: string) => {
      if (target === linuxNode) return;
      throw new Error("missing");
    });

    const execFile = vi.fn().mockResolvedValue({ stdout: "18.19.0\n", stderr: "" });

    const result = await resolvePreferredNodePath({
      env: {},
      runtime: "node",
      platform: "linux",
      execFile,
    });

    expect(result).toBeUndefined();
    expect(execFile).toHaveBeenCalledTimes(1);
  });

  it("returns undefined when no system node is found", async () => {
    fsMocks.access.mockRejectedValue(new Error("missing"));

    const execFile = vi.fn();

    const result = await resolvePreferredNodePath({
      env: {},
      runtime: "node",
      platform: "linux",
      execFile,
    });

    expect(result).toBeUndefined();
    expect(execFile).not.toHaveBeenCalled();
  });
});

describe("resolveSystemNodeInfo", () => {
  const linuxNode = "/usr/local/bin/node";

  it("returns supported info when version is new enough", async () => {
    fsMocks.access.mockImplementation(async (target: string) => {
      if (target === linuxNode) return;
      throw new Error("missing");
    });

    const execFile = vi.fn().mockResolvedValue({ stdout: "22.12.0\n", stderr: "" });

    const result = await resolveSystemNodeInfo({
      env: {},
      platform: "linux",
      execFile,
    });

    expect(result).toEqual({
      path: linuxNode,
      version: "22.12.0",
      supported: true,
    });
  });

  it("renders a warning when system node is too old", () => {
    const warning = renderSystemNodeWarning(
      {
        path: linuxNode,
        version: "18.19.0",
        supported: false,
      },
      "/home/me/.fnm/node-22/bin/node",
    );

    expect(warning).toContain("below the required Node 22+");
    expect(warning).toContain(linuxNode);
  });
});
