import { describe, expect, it, vi } from "vitest";

vi.mock("../commands/onboard-helpers.js", async () => {
  const actual = await vi.importActual<typeof import("../commands/onboard-helpers.js")>(
    "../commands/onboard-helpers.js",
  );
  return {
    ...actual,
    randomToken: () => "generated-token",
  };
});

import { configureGatewayForOnboarding } from "./onboarding.gateway-config.js";
import type { QuickstartGatewayDefaults } from "./onboarding.types.js";

function createPrompter(params?: {
  textValues?: unknown[];
  selectValues?: unknown[];
  confirmValues?: unknown[];
}) {
  const textValues = [...(params?.textValues ?? [])];
  const selectValues = [...(params?.selectValues ?? [])];
  const confirmValues = [...(params?.confirmValues ?? [])];
  return {
    intro: async () => {},
    outro: async () => {},
    note: async () => {},
    multiselect: async () => [],
    progress: () => ({ update: () => {}, stop: () => {} }),
    text: async () => textValues.shift() as string,
    select: async () => selectValues.shift() as string,
    confirm: async () => Boolean(confirmValues.shift()),
  };
}

function baseQuickstartDefaults(overrides: Partial<QuickstartGatewayDefaults> = {}): QuickstartGatewayDefaults {
  return {
    hasExisting: false,
    port: 3210,
    bind: "loopback",
    authMode: "token",
    tailscaleMode: "off",
    token: undefined,
    password: undefined,
    customBindHost: undefined,
    tailscaleResetOnExit: false,
    ...overrides,
  };
}

describe("configureGatewayForOnboarding credential normalization", () => {
  it("does not coerce missing token input into literal 'undefined'", async () => {
    const runtime = {
      error: vi.fn(),
      exit: vi.fn(),
    } as never;

    const result = await configureGatewayForOnboarding({
      flow: "advanced",
      baseConfig: {} as never,
      nextConfig: {} as never,
      localPort: 3210,
      quickstartGateway: baseQuickstartDefaults(),
      prompter: createPrompter({
        textValues: ["3210", undefined],
        selectValues: ["loopback", "token", "off"],
      }) as never,
      runtime,
    });

    expect(result.settings.gatewayToken).toBe("generated-token");
    expect(result.nextConfig.gateway?.auth).toMatchObject({
      mode: "token",
      token: "generated-token",
    });
    expect((runtime as any).exit).not.toHaveBeenCalled();
  });

  it("rejects invalid quickstart password value instead of storing 'undefined'", async () => {
    const runtime = {
      error: vi.fn(),
      exit: vi.fn(),
    } as never;

    await expect(
      configureGatewayForOnboarding({
        flow: "quickstart",
        baseConfig: {} as never,
        nextConfig: {} as never,
        localPort: 3210,
        quickstartGateway: baseQuickstartDefaults({
          authMode: "password",
          password: "undefined",
        }),
        prompter: createPrompter() as never,
        runtime,
      }),
    ).rejects.toThrow("Gateway password is required.");

    expect((runtime as any).error).toHaveBeenCalledWith("Gateway password is required.");
    expect((runtime as any).exit).toHaveBeenCalledWith(1);
  });
});
