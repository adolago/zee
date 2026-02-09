import { tool } from "@zee/plugin"

async function loadSplitwiseModule() {
  try {
    return await import("../../src/domain/zee/splitwise.js")
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    if (!errorMsg.includes("Cannot find module") && !errorMsg.includes("ERR_MODULE_NOT_FOUND")) {
      throw error
    }
    return await import("../../src/domain/zee/splitwise.ts")
  }
}

const SPLITWISE_ACTIONS = [
  "current-user",
  "groups",
  "group",
  "friends",
  "friend",
  "expenses",
  "expense",
  "create-expense",
  "update-expense",
  "delete-expense",
  "create-payment",
  "notifications",
  "currencies",
  "categories",
  "request",
] as const

// Note: In zod v4, z.record(valueSchema) has a bug where valueType is undefined.
// Use z.record(keySchema, valueSchema) instead for toJSONSchema compatibility.
const splitwiseValue = tool.schema.union([
  tool.schema.string(),
  tool.schema.number(),
  tool.schema.boolean(),
])

export default tool({
  description: `Access Splitwise API for shared expenses and balances.

Requires configuration:
- zee.jsonc: { "zee": { "splitwise": { "enabled": true, "token": "{env:SPLITWISE_TOKEN}" } } }

Token sources (when enabled):
- zee.splitwise.token in zee.jsonc
- zee.splitwise.tokenFile in zee.jsonc
- SPLITWISE_TOKEN environment variable.`,
  args: {
    action: tool.schema.enum(SPLITWISE_ACTIONS).describe("Splitwise action to perform"),
    groupId: tool.schema.number().optional().describe("Group ID for group actions"),
    friendId: tool.schema.number().optional().describe("Friend ID for friend actions"),
    expenseId: tool.schema.number().optional().describe("Expense ID for expense actions"),
    endpoint: tool.schema.string().optional().describe("Endpoint for request action (e.g., get_expenses)"),
    method: tool.schema.enum(["GET", "POST", "PUT", "DELETE"]).optional().describe("HTTP method for request action"),
    query: tool.schema.record(tool.schema.string(), splitwiseValue).optional().describe("Query parameters"),
    payload: tool.schema.record(tool.schema.string(), splitwiseValue).optional().describe("Request payload"),
    payloadFormat: tool.schema.enum(["json", "form"]).default("json").describe("Payload encoding for POST/PUT"),
    timeoutMs: tool.schema.number().optional().describe("Override timeout in ms"),
  },
  async execute(args) {
    const { buildSplitwiseRequest, callSplitwiseApi, resolveSplitwiseConfig } = await loadSplitwiseModule()

    const config = resolveSplitwiseConfig()
    if (!config.enabled) {
      return `Splitwise tooling is disabled.

Enable it in zee.jsonc:
{
  "zee": {
    "splitwise": {
      "enabled": true,
      "token": "{env:SPLITWISE_TOKEN}"
    }
  }
}`
    }

    if (config.error) {
      return config.error
    }

    if (!config.token) {
      return `Splitwise token is not configured.

Set one of:
- zee.splitwise.token in zee.jsonc
- zee.splitwise.tokenFile in zee.jsonc
- SPLITWISE_TOKEN environment variable`
    }

    const requestResult = buildSplitwiseRequest({
      action: args.action,
      groupId: args.groupId,
      friendId: args.friendId,
      expenseId: args.expenseId,
      endpoint: args.endpoint,
      method: args.method,
      query: args.query as Record<string, string | number | boolean> | undefined,
      payload: args.payload as Record<string, string | number | boolean> | undefined,
      payloadFormat: args.payloadFormat,
      timeoutMs: args.timeoutMs,
    })

    if (requestResult.error || !requestResult.request) {
      return requestResult.error || "Invalid Splitwise request."
    }

    try {
      const response = await callSplitwiseApi(requestResult.request, config)
      const output =
        typeof response.data === "string"
          ? response.data
          : JSON.stringify(response.data, null, 2)

      if (!response.ok) {
        return `Splitwise error (${response.status}):

${output || response.raw || "Splitwise request failed."}`
      }

      return output || "Splitwise request succeeded."
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      if (error instanceof Error && error.name === "AbortError") {
        return "Splitwise request timed out."
      }
      return `Splitwise request failed: ${errorMsg}`
    }
  },
})
