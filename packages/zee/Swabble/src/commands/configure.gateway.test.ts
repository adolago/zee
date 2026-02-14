import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  text: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
  note: vi.fn(),
  findTailscaleBinary: vi.fn(),
}));

vi.mock("./configure.shared.js", () => ({
  text: mocks.text,
  select: mocks.select,
  confirm: mocks.confirm,
}));

vi.mock("../terminal/note.js", () => ({
  note: mocks.note,
}));

vi.mock("../infra/tailscale.js", () => ({
  findTailscaleBinary: mocks.findTailscaleBinary,
}));

vi.mock("./onboard-helpers.js", async () => {
  const actual = await vi.importActual<typeof import("./onboard-helpers.js")>("./onboard-helpers.js");
  return {
    ...actual,
    guardCancel: (value: unknown) => value,
    randomToken: () => "generated-token",
  };
});

import { promptGatewayConfig } from "./configure.gateway.js";

describe("promptGatewayConfig credential normalization", () => {
  beforeEach(() => {
    mocks.text.mockReset();
    mocks.select.mockReset();
    mocks.confirm.mockReset();
    mocks.note.mockReset();
    mocks.findTailscaleBinary.mockReset();
  });

  it("does not coerce missing token input into literal 'undefined'", async () => {
    mocks.text
      .mockResolvedValueOnce("3210")
      .mockResolvedValueOnce(undefined as unknown as string);
    mocks.select
      .mockResolvedValueOnce("loopback")
      .mockResolvedValueOnce("token")
      .mockResolvedValueOnce("off");

    const runtime = {
      error: vi.fn(),
      exit: vi.fn(),
    } as unknown as Parameters<typeof promptGatewayConfig>[1];

    const result = await promptGatewayConfig({} as never, runtime);
    expect(result.token).toBe("generated-token");
    expect(result.config.gateway?.auth).toMatchObject({
      mode: "token",
      token: "generated-token",
    });
    expect(runtime.exit).not.toHaveBeenCalled();
  });

  it("rejects missing password input instead of storing 'undefined'", async () => {
    mocks.text
      .mockResolvedValueOnce("3210")
      .mockResolvedValueOnce(undefined as unknown as string);
    mocks.select
      .mockResolvedValueOnce("loopback")
      .mockResolvedValueOnce("password")
      .mockResolvedValueOnce("off");

    const runtime = {
      error: vi.fn(),
      exit: vi.fn(),
    } as unknown as Parameters<typeof promptGatewayConfig>[1];

    await expect(promptGatewayConfig({} as never, runtime)).rejects.toThrow(
      "Gateway password is required.",
    );
    expect(runtime.error).toHaveBeenCalledWith("Gateway password is required.");
    expect(runtime.exit).toHaveBeenCalledWith(1);
  });
});
