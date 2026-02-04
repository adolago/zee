import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runtime: {
    initiateCall: vi.fn(),
    continueCall: vi.fn(),
    speak: vi.fn(),
    endCall: vi.fn(),
    getCallStatus: vi.fn(),
    getCall: vi.fn(),
    getActiveCalls: vi.fn(),
  },
  stopVoiceCallRuntime: vi.fn(async () => {}),
}));

vi.mock("../../extensions/voice-call/src/runtime.js", () => ({
  initializeVoiceCallRuntime: vi.fn(() => mocks.runtime),
  getVoiceCallRuntime: vi.fn(() => mocks.runtime),
  stopVoiceCallRuntime: mocks.stopVoiceCallRuntime,
}));

import registerPlugin from "../../extensions/voice-call/index.js";

const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

type Registered = {
  methods: Map<string, (ctx: Record<string, unknown>) => unknown>;
  tools: unknown[];
};

function setup(config: Record<string, unknown>): Registered {
  const methods = new Map<string, (ctx: Record<string, unknown>) => unknown>();
  const tools: unknown[] = [];
  registerPlugin({
    id: "voice-call",
    name: "Voice Call",
    description: "test",
    version: "0",
    source: "test",
    config: {},
    pluginConfig: config,
    runtime: { tts: { textToSpeechTelephony: vi.fn() } },
    logger: noopLogger,
    registerGatewayMethod: (method, handler) => methods.set(method, handler),
    registerTool: (tool) => tools.push(tool),
    registerCli: () => {},
    registerService: () => {},
    resolvePath: (p: string) => p,
  });
  return { methods, tools };
}

describe("voice-call plugin", () => {
  beforeEach(() => {
    mocks.runtime.initiateCall.mockReset();
    mocks.runtime.continueCall.mockReset();
    mocks.runtime.speak.mockReset();
    mocks.runtime.endCall.mockReset();
    mocks.runtime.getCallStatus.mockReset();
    mocks.runtime.getCall.mockReset();

    mocks.runtime.initiateCall.mockResolvedValue({
      callId: "call-1",
      providerCallId: "provider-1",
      status: "initiating",
    });
    mocks.runtime.getCallStatus.mockResolvedValue({
      callId: "call-1",
      providerCallId: "provider-1",
      status: "in-progress",
      duration: 12,
    });
    mocks.runtime.getCall.mockImplementation((id: string) =>
      id === "call-1"
        ? {
            callId: "call-1",
            providerCallId: "provider-1",
            status: "in-progress",
            duration: 12,
          }
        : undefined,
    );
  });

  afterEach(() => vi.restoreAllMocks());

  it("registers gateway methods", () => {
    const { methods } = setup({ provider: "mock", fromNumber: "+15550001111" });
    expect(methods.has("voicecall.initiate")).toBe(true);
    expect(methods.has("voicecall.continue")).toBe(true);
    expect(methods.has("voicecall.speak")).toBe(true);
    expect(methods.has("voicecall.end")).toBe(true);
    expect(methods.has("voicecall.status")).toBe(true);
    expect(methods.has("voicecall.start")).toBe(true);
  });

  it("initiates a call via voicecall.initiate", async () => {
    const { methods } = setup({ provider: "mock", fromNumber: "+15550001111" });
    const handler = methods.get("voicecall.initiate");
    const respond = vi.fn();
    await handler?.({ params: { to: "+15551230001", message: "Hi" }, respond });
    expect(mocks.runtime.initiateCall).toHaveBeenCalled();
    const [ok, payload] = respond.mock.calls[0];
    expect(ok).toBe(true);
    expect(payload.callId).toBe("call-1");
  });

  it("returns call status", async () => {
    const { methods } = setup({ provider: "mock", fromNumber: "+15550001111" });
    const handler = methods.get("voicecall.status");
    const respond = vi.fn();
    await handler?.({ params: { callId: "call-1" }, respond });
    const [ok, payload] = respond.mock.calls[0];
    expect(ok).toBe(true);
    expect(payload.status).toBe("in-progress");
  });

  it("tool get_status returns json payload", async () => {
    const { tools } = setup({ provider: "mock", fromNumber: "+15550001111" });
    const tool = tools[0] as {
      execute: (id: string, params: unknown) => Promise<unknown>;
    };
    const result = (await tool.execute("id", {
      action: "get_status",
      callId: "call-1",
    })) as { details: { status?: string } };
    expect(result.details.status).toBe("in-progress");
  });

  it("tool get_status without callId returns error payload", async () => {
    const { tools } = setup({ provider: "mock", fromNumber: "+15550001111" });
    const tool = tools[0] as {
      execute: (id: string, params: unknown) => Promise<unknown>;
    };
    const result = (await tool.execute("id", { action: "get_status" })) as {
      details: { error?: unknown };
    };
    expect(String(result.details.error)).toContain("missing_callId");
  });

  it("CLI start prints JSON", async () => {
    const program = new Command();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    registerPlugin({
      id: "voice-call",
      name: "Voice Call",
      description: "test",
      version: "0",
      source: "test",
      config: {},
      pluginConfig: { provider: "mock", fromNumber: "+15550001111" },
      runtime: { tts: { textToSpeechTelephony: vi.fn() } },
      logger: noopLogger,
      registerGatewayMethod: () => {},
      registerTool: () => {},
      registerCli: (fn: (ctx: { program: Command }) => void) => fn({ program }),
      registerService: () => {},
      resolvePath: (p: string) => p,
    });

    await program.parseAsync(["voicecall", "start", "--to", "+1", "--message", "Hello"], {
      from: "user",
    });
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });
});
