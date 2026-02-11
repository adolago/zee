import { describe, expect, it, vi } from "vitest";

import type { runCommandWithTimeout } from "../process/exec.js";
import { discoverGatewayBeacons } from "./bonjour-discovery.js";

const EMPTY_RESULT = {
  stdout: "",
  stderr: "",
  code: 0,
  signal: null,
  killed: false,
};

describe("bonjour-discovery", () => {
  it("discovers beacons on linux via avahi", async () => {
    let call = 0;
    const run = vi.fn(async (argv: string[], options: { timeoutMs: number }) => {
      expect(options.timeoutMs).toBeGreaterThan(0);
      if (argv[0] !== "avahi-browse") {
        throw new Error(`unexpected argv: ${argv.join(" ")}`);
      }
      call += 1;
      if (call > 1) return EMPTY_RESULT;
      return {
        stdout: [
          "=;eth0;IPv4;Zee Gateway;_zee-gw._tcp;local",
          "   hostname = [zee.local]",
          "   port = [18789]",
          '   txt = ["displayName=Zee Gateway" "gatewayPort=18789" "sshPort=22"]',
          "",
        ].join("\n"),
        stderr: "",
        code: 0,
        signal: null,
        killed: false,
      };
    });

    const beacons = await discoverGatewayBeacons({
      platform: "linux",
      timeoutMs: 1234,
      domains: ["local."],
      run: run as unknown as typeof runCommandWithTimeout,
    });

    expect(beacons).toEqual([
      expect.objectContaining({
        domain: "local.",
        displayName: "Zee Gateway",
        host: "zee.local",
        port: 18789,
        gatewayPort: 18789,
        sshPort: 22,
      }),
    ]);
    expect(run).toHaveBeenCalled();
  });

  it("normalizes domains for avahi browse", async () => {
    const calls: string[][] = [];
    const run = vi.fn(async (argv: string[]) => {
      calls.push(argv);
      return EMPTY_RESULT;
    });

    await discoverGatewayBeacons({
      platform: "linux",
      timeoutMs: 1,
      domains: ["local", "zee.internal"],
      run: run as unknown as typeof runCommandWithTimeout,
    });

    const avahiCalls = calls.filter((argv) => argv[0] === "avahi-browse");
    expect(avahiCalls.length).toBeGreaterThan(0);
    expect(avahiCalls.some((argv) => argv.includes("-d") && argv.includes("zee.internal"))).toBe(true);
  });
});
