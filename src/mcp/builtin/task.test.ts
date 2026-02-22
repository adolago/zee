import { describe, expect, test } from "bun:test";
import { resolveSubagentProfileName, TaskTool } from "./task";

describe("TaskTool", () => {
  test("maps github-librarian aliases to librarian profile", () => {
    expect(resolveSubagentProfileName("github-librarian")).toBe("librarian");
    expect(resolveSubagentProfileName("gh")).toBe("librarian");
    expect(resolveSubagentProfileName("reviewer")).toBe("reviewer");
  });

  test("publishes task description with available subagents", async () => {
    const runtime = await TaskTool.init();
    expect(runtime.description).toContain("librarian");
    expect(runtime.description).toContain("coder");
  });
});
