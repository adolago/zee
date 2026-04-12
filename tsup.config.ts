import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "provider/index": "src/provider/index.ts",
    "agent/index": "src/agent/index.ts",
    "tool/index": "src/tool/index.ts",
    "mcp/index": "src/mcp/index.ts",
    "memory/index": "src/memory/index.ts",
    "surface/index": "src/surface/index.ts",
    "session/index": "src/session/index.ts",
    "config/index": "src/config/index.ts",
  },
  format: ["esm"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  minify: false,
  external: [
    "@ai-sdk/anthropic",
    "@ai-sdk/openai",
    "@modelcontextprotocol/sdk",
  ],
});
