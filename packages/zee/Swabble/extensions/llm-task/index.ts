import type { ZeePluginApi } from "../../src/plugins/types.js";

import { createLlmTaskTool } from "./src/llm-task-tool.js";

export default function register(api: ZeePluginApi) {
  api.registerTool(createLlmTaskTool(api), { optional: true });
}
