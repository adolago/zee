import { describe, expect, it } from "vitest";

import { buildSandboxCreateArgs, type SandboxDockerConfig } from "./sandbox.js";

describe("buildSandboxCreateArgs", () => {
  it("includes hardening and resource flags", () => {
    const cfg: SandboxDockerConfig = {
      image: "zee-sandbox:bookworm-slim",
      containerPrefix: "zee-sbx-",
      workdir: "/workspace",
      readOnlyRoot: true,
      tmpfs: ["/tmp"],
      network: "none",
      user: "1000:1000",
      capDrop: ["ALL"],
      env: { LANG: "C.UTF-8" },
      pidsLimit: 256,
      memory: "512m",
      memorySwap: 1024,
      cpus: 1.5,
      ulimits: {
        nofile: { soft: 1024, hard: 2048 },
        nproc: 128,
        core: "0",
      },
      seccompProfile: "/tmp/seccomp.json",
      apparmorProfile: "zee-sandbox",
      dns: ["1.1.1.1"],
      extraHosts: ["internal.service:10.0.0.5"],
    };

    const args = buildSandboxCreateArgs({
      name: "zee-sbx-test",
      cfg,
      scopeKey: "main",
      createdAtMs: 1700000000000,
      labels: { "zee.sandboxBrowser": "1" },
    });

    expect(args).toEqual(
      expect.arrayContaining([
        "create",
        "--name",
        "zee-sbx-test",
        "--label",
        "zee.sandbox=1",
        "--label",
        "zee.sessionKey=main",
        "--label",
        "zee.createdAtMs=1700000000000",
        "--label",
        "zee.sandboxBrowser=1",
        "--read-only",
        "--tmpfs",
        "/tmp",
        "--network",
        "none",
        "--user",
        "1000:1000",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--security-opt",
        "seccomp=/tmp/seccomp.json",
        "--security-opt",
        "apparmor=zee-sandbox",
        "--dns",
        "1.1.1.1",
        "--add-host",
        "internal.service:10.0.0.5",
        "--pids-limit",
        "256",
        "--memory",
        "512m",
        "--memory-swap",
        "1024",
        "--cpus",
        "1.5",
      ]),
    );

    const ulimitValues: string[] = [];
    for (let i = 0; i < args.length; i += 1) {
      if (args[i] === "--ulimit") {
        const value = args[i + 1];
        if (value) ulimitValues.push(value);
      }
    }
    expect(ulimitValues).toEqual(
      expect.arrayContaining(["nofile=1024:2048", "nproc=128", "core=0"]),
    );
  });
});
