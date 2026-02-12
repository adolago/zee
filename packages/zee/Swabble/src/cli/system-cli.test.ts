import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

const callGatewayFromCli = vi.fn();
const runtime = {
  log: vi.fn(),
  error: vi.fn(),
  exit: vi.fn(() => {
    throw new Error("exit");
  }),
};

vi.mock("./gateway-rpc.js", () => ({
  addGatewayClientOptions: (cmd: Command) => cmd,
  callGatewayFromCli,
}));

vi.mock("../runtime.js", () => ({
  defaultRuntime: runtime,
}));

describe("system cli", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("disables voice wake", async () => {
    callGatewayFromCli.mockResolvedValueOnce({
      enabled: false,
      triggers: ["zee", "computer"],
      effectiveTriggers: [],
    });
    const { registerSystemCli } = await import("./system-cli.js");
    const program = new Command();
    registerSystemCli(program);

    await program.parseAsync(["system", "voicewake", "disable"], { from: "user" });

    expect(callGatewayFromCli).toHaveBeenCalledWith(
      "voicewake.set",
      expect.objectContaining({ json: false }),
      { enabled: false },
      { expectFinal: false },
    );
  });

  it("sets custom voice wake triggers", async () => {
    callGatewayFromCli.mockResolvedValueOnce({
      enabled: true,
      triggers: ["zee", "assistant"],
      effectiveTriggers: ["zee", "assistant"],
    });
    const { registerSystemCli } = await import("./system-cli.js");
    const program = new Command();
    registerSystemCli(program);

    await program.parseAsync(["system", "voicewake", "set", "zee", "assistant"], { from: "user" });

    expect(callGatewayFromCli).toHaveBeenCalledWith(
      "voicewake.set",
      expect.objectContaining({ json: false }),
      { enabled: true, triggers: ["zee", "assistant"] },
      { expectFinal: false },
    );
  });

  it("shows voice wake status summary", async () => {
    callGatewayFromCli.mockResolvedValueOnce({
      enabled: false,
      triggers: ["zee", "claude"],
      effectiveTriggers: [],
    });
    const { registerSystemCli } = await import("./system-cli.js");
    const program = new Command();
    registerSystemCli(program);

    await program.parseAsync(["system", "voicewake", "status"], { from: "user" });

    expect(callGatewayFromCli).toHaveBeenCalledWith(
      "voicewake.get",
      expect.objectContaining({ json: false }),
      undefined,
      { expectFinal: false },
    );
    expect(runtime.log).toHaveBeenCalledWith(expect.stringContaining("voice wake: disabled"));
  });
});
