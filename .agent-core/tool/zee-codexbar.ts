import { tool } from "@agent-core/plugin"

async function loadCodexbarModule() {
  try {
    return await import("../../src/domain/zee/codexbar.js")
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    if (!errorMsg.includes("Cannot find module") && !errorMsg.includes("ERR_MODULE_NOT_FOUND")) {
      throw error
    }
    return await import("../../src/domain/zee/codexbar.ts")
  }
}

export default tool({
  description: `Run CodexBar CLI commands to check provider usage and resets.

Requires configuration:
- agent-core.jsonc: { "zee": { "codexbar": { "enabled": true } } }`,
  args: {
    args: tool.schema.array(tool.schema.string()).default([]).describe("Arguments to pass to codexbar CLI"),
    timeoutMs: tool.schema.number().optional().describe("Override timeout in ms"),
  },
  async execute(args) {
    const { resolveCodexbarConfig, runCodexbar } = await loadCodexbarModule()

    const config = resolveCodexbarConfig()
    if (!config.enabled) {
      return `CodexBar tooling is disabled.

Enable it in agent-core.jsonc:
{
  "zee": {
    "codexbar": {
      "enabled": true
    }
  }
}`
    }

    if (config.error) {
      return config.error
    }

    const result = runCodexbar(args.args, config, args.timeoutMs)
    const stdout = result.stdout.trim()
    const stderr = result.stderr.trim()
    const output = stdout || stderr

    if (!result.ok) {
      return result.error || output || "CodexBar command failed."
    }

    return output || "CodexBar command completed with no output."
  },
})
