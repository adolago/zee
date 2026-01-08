import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const callGateway = vi.fn(async () => ({ ok: true }));
const resolveGatewayProgramArguments = vi.fn(async () => ({
  programArguments: ["/bin/node", "cli", "gateway", "--port", "18789"],
}));
const serviceInstall = vi.fn().mockResolvedValue(undefined);
const serviceUninstall = vi.fn().mockResolvedValue(undefined);
const serviceStop = vi.fn().mockResolvedValue(undefined);
const serviceRestart = vi.fn().mockResolvedValue(undefined);
const serviceIsLoaded = vi.fn().mockResolvedValue(false);
const serviceReadCommand = vi.fn().mockResolvedValue(null);
const serviceReadRuntime = vi.fn().mockResolvedValue({ status: "running" });
const findExtraGatewayServices = vi.fn(async () => []);
const inspectPortUsage = vi.fn(async (port: number) => ({
  port,
  status: "free",
  listeners: [],
  hints: [],
}));

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
  callGateway: (opts: unknown) => callGateway(opts),
}));

vi.mock("../daemon/program-args.js", () => ({
  resolveGatewayProgramArguments: (opts: unknown) =>
    resolveGatewayProgramArguments(opts),
}));

vi.mock("../daemon/service.js", () => ({
  resolveGatewayService: () => ({
    label: "LaunchAgent",
    loadedText: "loaded",
    notLoadedText: "not loaded",
    install: serviceInstall,
    uninstall: serviceUninstall,
    stop: serviceStop,
    restart: serviceRestart,
    isLoaded: serviceIsLoaded,
    readCommand: serviceReadCommand,
    readRuntime: serviceReadRuntime,
  }),
}));

vi.mock("../daemon/legacy.js", () => ({
  findLegacyGatewayServices: () => [],
}));

vi.mock("../daemon/inspect.js", () => ({
  findExtraGatewayServices: (env: unknown, opts?: unknown) =>
    findExtraGatewayServices(env, opts),
}));

vi.mock("../infra/ports.js", () => ({
  inspectPortUsage: (port: number) => inspectPortUsage(port),
  formatPortDiagnostics: () => ["Port 18789 is already in use."],
}));

vi.mock("../runtime.js", () => ({
  defaultRuntime,
}));

vi.mock("./deps.js", () => ({
  createDefaultDeps: () => {},
}));

describe("daemon-cli coverage", () => {
  const originalEnv = {
    ZEE_STATE_DIR: process.env.ZEE_STATE_DIR,
    ZEE_CONFIG_PATH: process.env.ZEE_CONFIG_PATH,
    ZEE_GATEWAY_PORT: process.env.ZEE_GATEWAY_PORT,
    ZEE_PROFILE: process.env.ZEE_PROFILE,
  };

  beforeEach(() => {
    process.env.ZEE_STATE_DIR = "/tmp/zee-cli-state";
    process.env.ZEE_CONFIG_PATH = "/tmp/zee-cli-state/zee.json";
    delete process.env.ZEE_GATEWAY_PORT;
    delete process.env.ZEE_PROFILE;
    serviceReadCommand.mockResolvedValue(null);
  });

  afterEach(() => {
    if (originalEnv.ZEE_STATE_DIR !== undefined)
      process.env.ZEE_STATE_DIR = originalEnv.ZEE_STATE_DIR;
    else delete process.env.ZEE_STATE_DIR;

    if (originalEnv.ZEE_CONFIG_PATH !== undefined)
      process.env.ZEE_CONFIG_PATH = originalEnv.ZEE_CONFIG_PATH;
    else delete process.env.ZEE_CONFIG_PATH;

    if (originalEnv.ZEE_GATEWAY_PORT !== undefined)
      process.env.ZEE_GATEWAY_PORT = originalEnv.ZEE_GATEWAY_PORT;
    else delete process.env.ZEE_GATEWAY_PORT;

    if (originalEnv.ZEE_PROFILE !== undefined)
      process.env.ZEE_PROFILE = originalEnv.ZEE_PROFILE;
    else delete process.env.ZEE_PROFILE;
  });

  it("probes gateway status by default", async () => {
    runtimeLogs.length = 0;
    runtimeErrors.length = 0;
    callGateway.mockClear();

    const { registerDaemonCli } = await import("./daemon-cli.js");
    const program = new Command();
    program.exitOverride();
    registerDaemonCli(program);

    await program.parseAsync(["daemon", "status"], { from: "user" });

    expect(callGateway).toHaveBeenCalledTimes(1);
    expect(callGateway).toHaveBeenCalledWith(
      expect.objectContaining({ method: "status" }),
    );
    expect(findExtraGatewayServices).toHaveBeenCalled();
    expect(inspectPortUsage).toHaveBeenCalled();
  });

  it("derives probe URL from service args + env (json)", async () => {
    runtimeLogs.length = 0;
    runtimeErrors.length = 0;
    callGateway.mockClear();
    inspectPortUsage.mockClear();

    serviceReadCommand.mockResolvedValueOnce({
      programArguments: ["/bin/node", "cli", "gateway", "--port", "19001"],
      environment: {
        ZEE_PROFILE: "dev",
        ZEE_STATE_DIR: "/tmp/zee-daemon-state",
        ZEE_CONFIG_PATH: "/tmp/zee-daemon-state/zee.json",
        ZEE_GATEWAY_PORT: "19001",
      },
      sourcePath: "/tmp/com.zee.gateway.plist",
    });

    const { registerDaemonCli } = await import("./daemon-cli.js");
    const program = new Command();
    program.exitOverride();
    registerDaemonCli(program);

    await program.parseAsync(["daemon", "status", "--json"], { from: "user" });

    expect(callGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "ws://127.0.0.1:19001",
        method: "status",
      }),
    );
    expect(inspectPortUsage).toHaveBeenCalledWith(19001);

    const parsed = JSON.parse(runtimeLogs[0] ?? "{}") as {
      gateway?: { port?: number; portSource?: string; probeUrl?: string };
      config?: { mismatch?: boolean };
      rpc?: { url?: string; ok?: boolean };
    };
    expect(parsed.gateway?.port).toBe(19001);
    expect(parsed.gateway?.portSource).toBe("service args");
    expect(parsed.gateway?.probeUrl).toBe("ws://127.0.0.1:19001");
    expect(parsed.config?.mismatch).toBe(true);
    expect(parsed.rpc?.url).toBe("ws://127.0.0.1:19001");
    expect(parsed.rpc?.ok).toBe(true);
  });

  it("passes deep scan flag for daemon status", async () => {
    findExtraGatewayServices.mockClear();

    const { registerDaemonCli } = await import("./daemon-cli.js");
    const program = new Command();
    program.exitOverride();
    registerDaemonCli(program);

    await program.parseAsync(["daemon", "status", "--deep"], { from: "user" });

    expect(findExtraGatewayServices).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ deep: true }),
    );
  });

  it("installs the daemon when requested", async () => {
    serviceIsLoaded.mockResolvedValueOnce(false);
    serviceInstall.mockClear();

    const { registerDaemonCli } = await import("./daemon-cli.js");
    const program = new Command();
    program.exitOverride();
    registerDaemonCli(program);

    await program.parseAsync(["daemon", "install", "--port", "18789"], {
      from: "user",
    });

    expect(serviceInstall).toHaveBeenCalledTimes(1);
  });

  it("starts and stops the daemon via service helpers", async () => {
    serviceRestart.mockClear();
    serviceStop.mockClear();
    serviceIsLoaded.mockResolvedValue(true);

    const { registerDaemonCli } = await import("./daemon-cli.js");
    const program = new Command();
    program.exitOverride();
    registerDaemonCli(program);

    await program.parseAsync(["daemon", "start"], { from: "user" });
    await program.parseAsync(["daemon", "stop"], { from: "user" });

    expect(serviceRestart).toHaveBeenCalledTimes(1);
    expect(serviceStop).toHaveBeenCalledTimes(1);
  });
});
