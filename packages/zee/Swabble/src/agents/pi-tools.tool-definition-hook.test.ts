import { beforeEach, describe, expect, it, vi } from "vitest";

type HookEvent = { tool: unknown };
type HookContext = { toolName: string };
type HookResult = { tool?: unknown; exclude?: boolean; excludeReason?: string } | undefined;

const hasHooksMock = vi.fn<() => boolean>();
const runToolDefinitionMock = vi.fn<(event: HookEvent, ctx: HookContext) => HookResult>();

vi.mock("../plugins/hook-runner-global.js", () => ({
  getGlobalHookRunner: () => ({
    hasHooks: hasHooksMock,
    runToolDefinition: runToolDefinitionMock,
  }),
}));

import { createZeeCodingTools } from "./pi-tools.js";

describe("tool_definition hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("can mutate tool definitions before they are returned", () => {
    hasHooksMock.mockReturnValue(true);
    runToolDefinitionMock.mockImplementation((event, ctx) => {
      if (ctx.toolName !== "web_search") return undefined;
      const tool = event.tool as { description?: string };
      return {
        tool: {
          ...tool,
          description: `${tool.description ?? ""} [hooked]`.trim(),
        },
      };
    });

    const tools = createZeeCodingTools();
    const webSearchTool = tools.find((tool) => tool.name === "web_search");
    expect(webSearchTool).toBeDefined();
    expect(webSearchTool?.description).toContain("[hooked]");
  });

  it("can exclude tools from the assembled tool list", () => {
    hasHooksMock.mockReturnValue(true);
    runToolDefinitionMock.mockImplementation((event, ctx) => {
      if (ctx.toolName !== "web_search") return { tool: event.tool };
      return { exclude: true, excludeReason: "test exclusion" };
    });

    const tools = createZeeCodingTools();
    expect(tools.some((tool) => tool.name === "web_search")).toBe(false);
  });
});
