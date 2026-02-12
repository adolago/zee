import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";

const callGateway = vi.fn(async (opts: { method?: string }) => {
  if (opts.method === "node.list") {
    return {
      nodes: [
        {
          nodeId: "node-1",
          displayName: "Node",
          platform: "linux",
          caps: ["screen"],
          connected: true,
          permissions: { screenRecording: true },
        },
      ],
    };
  }
  if (opts.method === "node.invoke") {
    return {
      payload: {
        stdout: "",
        stderr: "",
        exitCode: 0,
        success: true,
        timedOut: false,
      },
    };
  }
  if (opts.method === "exec.approvals.node.get") {
    return {
      path: "/tmp/exec-approvals.json",
      exists: true,
      hash: "hash",
      file: {
        version: 1,
        defaults: {
          security: "allowlist",
          ask: "on-miss",
          askFallback: "deny",
        },
        agents: {},
      },
    };
  }
  if (opts.method === "exec.approval.request") {
    return { decision: "allow-once" };
  }
  return { ok: true };
});

const randomIdempotencyKey = vi.fn(() => "rk_test");

const runtimeLogs: string[] = [];
const runtimeErrors: string[] = [];
const defaultRuntime = {
  log: (msg: string) => runtimeLogs.push(msg),
  error: (msg: string) => runtimeErrors.push(msg),
  exit: (code: number) => {
    throw new Error(`__exit__:${code}`);
  },
};

vi.mock("../gateway/call.js", () => ({
  callGateway: (opts: unknown) => callGateway(opts as { method?: string }),
  randomIdempotencyKey: () => randomIdempotencyKey(),
}));

vi.mock("../runtime.js", () => ({
  defaultRuntime,
}));

vi.mock("../config/config.js", () => ({
  loadConfig: () => ({}),
}));

describe("nodes-cli coverage", () => {
  it("lists nodes via node.list", async () => {
    runtimeLogs.length = 0;
    runtimeErrors.length = 0;
    callGateway.mockClear();

    const { registerNodesCli } = await import("./nodes-cli.js");
    const program = new Command();
    program.exitOverride();
    registerNodesCli(program);

    await program.parseAsync(["nodes", "status"], { from: "user" });

    expect(callGateway).toHaveBeenCalled();
    expect(callGateway.mock.calls[0]?.[0]?.method).toBe("node.list");
    expect(runtimeErrors).toHaveLength(0);
  });

  it("revokes a paired node via node.pair.revoke", async () => {
    runtimeLogs.length = 0;
    runtimeErrors.length = 0;
    callGateway.mockClear();

    const { registerNodesCli } = await import("./nodes-cli.js");
    const program = new Command();
    program.exitOverride();
    registerNodesCli(program);

    await program.parseAsync(["nodes", "revoke", "--node", "node-1"], { from: "user" });

    const methods = callGateway.mock.calls.map((call) =>
      String(
        call[0] && typeof call[0] === "object" ? (call[0] as { method?: string }).method : "",
      ),
    );
    expect(methods).toContain("node.list");
    expect(methods).toContain("node.pair.revoke");
  });

  it("invokes system.run with parsed params", async () => {
    runtimeLogs.length = 0;
    runtimeErrors.length = 0;
    callGateway.mockClear();
    randomIdempotencyKey.mockClear();

    const { registerNodesCli } = await import("./nodes-cli.js");
    const program = new Command();
    program.exitOverride();
    registerNodesCli(program);

    await program.parseAsync(
      [
        "nodes",
        "run",
        "--node",
        "node-1",
        "--cwd",
        "/tmp",
        "--env",
        "FOO=bar",
        "--command-timeout",
        "1200",
        "--needs-screen-recording",
        "--invoke-timeout",
        "5000",
        "echo",
        "hi",
      ],
      { from: "user" },
    );

    const invoke = callGateway.mock.calls.find((call) => call[0]?.method === "node.invoke")?.[0];

    expect(invoke).toBeTruthy();
    expect(invoke?.params?.idempotencyKey).toBe("rk_test");
    expect(invoke?.params?.command).toBe("system.run");
    expect(invoke?.params?.params).toEqual({
      command: ["echo", "hi"],
      cwd: "/tmp",
      env: { FOO: "bar" },
      timeoutMs: 1200,
      needsScreenRecording: true,
      agentId: "main",
      approved: true,
      approvalDecision: "allow-once",
    });
    expect(invoke?.params?.timeoutMs).toBe(5000);
  });

  it("invokes system.run with raw command", async () => {
    runtimeLogs.length = 0;
    runtimeErrors.length = 0;
    callGateway.mockClear();
    randomIdempotencyKey.mockClear();

    const { registerNodesCli } = await import("./nodes-cli.js");
    const program = new Command();
    program.exitOverride();
    registerNodesCli(program);

    await program.parseAsync(
      ["nodes", "run", "--agent", "main", "--node", "node-1", "--raw", "echo hi"],
      { from: "user" },
    );

    const invoke = callGateway.mock.calls.find((call) => call[0]?.method === "node.invoke")?.[0];

    expect(invoke).toBeTruthy();
    expect(invoke?.params?.idempotencyKey).toBe("rk_test");
    expect(invoke?.params?.command).toBe("system.run");
    expect(invoke?.params?.params).toMatchObject({
      command: ["/bin/sh", "-lc", "echo hi"],
      rawCommand: "echo hi",
      agentId: "main",
      approved: true,
      approvalDecision: "allow-once",
    });
  });

  it("invokes system.notify with provided fields", async () => {
    runtimeLogs.length = 0;
    runtimeErrors.length = 0;
    callGateway.mockClear();

    const { registerNodesCli } = await import("./nodes-cli.js");
    const program = new Command();
    program.exitOverride();
    registerNodesCli(program);

    await program.parseAsync(
      [
        "nodes",
        "notify",
        "--node",
        "node-1",
        "--title",
        "Ping",
        "--body",
        "Gateway ready",
        "--delivery",
        "overlay",
      ],
      { from: "user" },
    );

    const invoke = callGateway.mock.calls.find((call) => call[0]?.method === "node.invoke")?.[0];

    expect(invoke).toBeTruthy();
    expect(invoke?.params?.command).toBe("system.notify");
    expect(invoke?.params?.params).toEqual({
      title: "Ping",
      body: "Gateway ready",
      sound: undefined,
      priority: undefined,
      delivery: "overlay",
    });
  });

  it("invokes location.get with params", async () => {
    runtimeLogs.length = 0;
    runtimeErrors.length = 0;
    callGateway.mockClear();

    const { registerNodesCli } = await import("./nodes-cli.js");
    const program = new Command();
    program.exitOverride();
    registerNodesCli(program);

    await program.parseAsync(
      [
        "nodes",
        "location",
        "get",
        "--node",
        "node-1",
        "--accuracy",
        "precise",
        "--max-age",
        "1000",
        "--location-timeout",
        "5000",
        "--invoke-timeout",
        "6000",
      ],
      { from: "user" },
    );

    const invoke = callGateway.mock.calls.find((call) => call[0]?.method === "node.invoke")?.[0];

    expect(invoke).toBeTruthy();
    expect(invoke?.params?.command).toBe("location.get");
    expect(invoke?.params?.params).toEqual({
      maxAgeMs: 1000,
      desiredAccuracy: "precise",
      timeoutMs: 5000,
    });
    expect(invoke?.params?.timeoutMs).toBe(6000);
  });
});
