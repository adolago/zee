import { describe, expect, test, vi } from "vitest";
import type { PluginRegistry } from "../plugins/registry.js";
import type { PluginDiagnostic } from "../plugins/types.js";
import { loadGatewayPlugins } from "./server-plugins.js";

const loadZeePlugins = vi.hoisted(() => vi.fn());

vi.mock("../plugins/loader.js", () => ({
  loadZeePlugins,
}));

const createRegistry = (diagnostics: PluginDiagnostic[]): PluginRegistry => ({
  plugins: [],
  tools: [],
  hooks: [],
  typedHooks: [],
  channels: [],
  providers: [],
  gatewayHandlers: {},
  httpHandlers: [],
  httpRoutes: [],
  cliRegistrars: [],
  services: [],
  diagnostics,
});

describe("loadGatewayPlugins", () => {
  test("logs plugin errors with details", () => {
    const diagnostics: PluginDiagnostic[] = [
      {
        level: "error",
        pluginId: "matrix",
        source: "/tmp/matrix/index.ts",
        message: "failed to load plugin: boom",
      },
    ];
    loadZeePlugins.mockReturnValue(createRegistry(diagnostics));

    const log = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    loadGatewayPlugins({
      cfg: {},
      workspaceDir: "/tmp",
      log,
      coreGatewayHandlers: {},
      baseMethods: [],
    });

    expect(log.error).toHaveBeenCalledWith(
      "[plugins] failed to load plugin: boom (plugin=matrix, source=/tmp/matrix/index.ts)",
    );
    expect(log.warn).not.toHaveBeenCalled();
  });
});
