import { describe, expect, it } from "vitest";

import {
  buildParseArgv,
  getFlagValue,
  getCommandPath,
  getPrimaryCommand,
  getPositiveIntFlagValue,
  getVerboseFlag,
  hasHelpOrVersion,
  hasFlag,
  shouldMigrateState,
  shouldMigrateStateFromPath,
} from "./argv.js";

describe("argv helpers", () => {
  it("detects help/version flags", () => {
    expect(hasHelpOrVersion(["node", "zee", "--help"])).toBe(true);
    expect(hasHelpOrVersion(["node", "zee", "-V"])).toBe(true);
    expect(hasHelpOrVersion(["node", "zee", "status"])).toBe(false);
  });

  it("extracts command path ignoring flags and terminator", () => {
    expect(getCommandPath(["node", "zee", "status", "--json"], 2)).toEqual(["status"]);
    expect(getCommandPath(["node", "zee", "agents", "list"], 2)).toEqual(["agents", "list"]);
    expect(getCommandPath(["node", "zee", "status", "--", "ignored"], 2)).toEqual(["status"]);
  });

  it("returns primary command", () => {
    expect(getPrimaryCommand(["node", "zee", "agents", "list"])).toBe("agents");
    expect(getPrimaryCommand(["node", "zee"])).toBeNull();
  });

  it("parses boolean flags and ignores terminator", () => {
    expect(hasFlag(["node", "zee", "status", "--json"], "--json")).toBe(true);
    expect(hasFlag(["node", "zee", "--", "--json"], "--json")).toBe(false);
  });

  it("extracts flag values with equals and missing values", () => {
    expect(getFlagValue(["node", "zee", "status", "--timeout", "5000"], "--timeout")).toBe(
      "5000",
    );
    expect(getFlagValue(["node", "zee", "status", "--timeout=2500"], "--timeout")).toBe("2500");
    expect(getFlagValue(["node", "zee", "status", "--timeout"], "--timeout")).toBeNull();
    expect(getFlagValue(["node", "zee", "status", "--timeout", "--json"], "--timeout")).toBe(
      null,
    );
    expect(getFlagValue(["node", "zee", "--", "--timeout=99"], "--timeout")).toBeUndefined();
  });

  it("parses verbose flags", () => {
    expect(getVerboseFlag(["node", "zee", "status", "--verbose"])).toBe(true);
    expect(getVerboseFlag(["node", "zee", "status", "--debug"])).toBe(false);
    expect(getVerboseFlag(["node", "zee", "status", "--debug"], { includeDebug: true })).toBe(
      true,
    );
  });

  it("parses positive integer flag values", () => {
    expect(getPositiveIntFlagValue(["node", "zee", "status"], "--timeout")).toBeUndefined();
    expect(
      getPositiveIntFlagValue(["node", "zee", "status", "--timeout"], "--timeout"),
    ).toBeNull();
    expect(
      getPositiveIntFlagValue(["node", "zee", "status", "--timeout", "5000"], "--timeout"),
    ).toBe(5000);
    expect(
      getPositiveIntFlagValue(["node", "zee", "status", "--timeout", "nope"], "--timeout"),
    ).toBeUndefined();
  });

  it("builds parse argv from raw args", () => {
    const nodeArgv = buildParseArgv({
      programName: "zee",
      rawArgs: ["node", "zee", "status"],
    });
    expect(nodeArgv).toEqual(["node", "zee", "status"]);

    const versionedNodeArgv = buildParseArgv({
      programName: "zee",
      rawArgs: ["node-22", "zee", "status"],
    });
    expect(versionedNodeArgv).toEqual(["node-22", "zee", "status"]);

    const versionedNodeWindowsArgv = buildParseArgv({
      programName: "zee",
      rawArgs: ["node-22.2.0.exe", "zee", "status"],
    });
    expect(versionedNodeWindowsArgv).toEqual(["node-22.2.0.exe", "zee", "status"]);

    const versionedNodePatchlessArgv = buildParseArgv({
      programName: "zee",
      rawArgs: ["node-22.2", "zee", "status"],
    });
    expect(versionedNodePatchlessArgv).toEqual(["node-22.2", "zee", "status"]);

    const versionedNodeWindowsPatchlessArgv = buildParseArgv({
      programName: "zee",
      rawArgs: ["node-22.2.exe", "zee", "status"],
    });
    expect(versionedNodeWindowsPatchlessArgv).toEqual(["node-22.2.exe", "zee", "status"]);

    const versionedNodeWithPathArgv = buildParseArgv({
      programName: "zee",
      rawArgs: ["/usr/bin/node-22.2.0", "zee", "status"],
    });
    expect(versionedNodeWithPathArgv).toEqual(["/usr/bin/node-22.2.0", "zee", "status"]);

    const nodejsArgv = buildParseArgv({
      programName: "zee",
      rawArgs: ["nodejs", "zee", "status"],
    });
    expect(nodejsArgv).toEqual(["nodejs", "zee", "status"]);

    const nonVersionedNodeArgv = buildParseArgv({
      programName: "zee",
      rawArgs: ["node-dev", "zee", "status"],
    });
    expect(nonVersionedNodeArgv).toEqual(["node", "zee", "node-dev", "zee", "status"]);

    const directArgv = buildParseArgv({
      programName: "zee",
      rawArgs: ["zee", "status"],
    });
    expect(directArgv).toEqual(["node", "zee", "status"]);

    const bunArgv = buildParseArgv({
      programName: "zee",
      rawArgs: ["bun", "src/entry.ts", "status"],
    });
    expect(bunArgv).toEqual(["bun", "src/entry.ts", "status"]);
  });

  it("builds parse argv from fallback args", () => {
    const fallbackArgv = buildParseArgv({
      programName: "zee",
      fallbackArgv: ["status"],
    });
    expect(fallbackArgv).toEqual(["node", "zee", "status"]);
  });

  it("decides when to migrate state", () => {
    expect(shouldMigrateState(["node", "zee", "status"])).toBe(false);
    expect(shouldMigrateState(["node", "zee", "health"])).toBe(false);
    expect(shouldMigrateState(["node", "zee", "sessions"])).toBe(false);
    expect(shouldMigrateState(["node", "zee", "memory", "status"])).toBe(false);
    expect(shouldMigrateState(["node", "zee", "agent", "--message", "hi"])).toBe(false);
    expect(shouldMigrateState(["node", "zee", "agents", "list"])).toBe(true);
    expect(shouldMigrateState(["node", "zee", "message", "send"])).toBe(true);
  });

  it("reuses command path for migrate state decisions", () => {
    expect(shouldMigrateStateFromPath(["status"])).toBe(false);
    expect(shouldMigrateStateFromPath(["agents", "list"])).toBe(true);
  });
});
