/**
 * Zee Inter-Persona Delegation Tool
 *
 * Allows Zee to delegate tasks to Stanley or Johny by opening a headless session,
 * sending the query, and relaying the response back.
 *
 * This enables seamless cross-persona communication where:
 * - User asks Zee via WhatsApp: "Check with Stanley about my portfolio"
 * - Zee uses this tool to ask Stanley
 * - Stanley's response is returned to Zee
 * - Zee relays it back to the user
 */

import { tool } from "@zee/plugin"

// Get daemon API base URL
function getDaemonUrl(): string {
  const port = process.env.AGENT_CORE_DAEMON_PORT || "3456"
  return `http://127.0.0.1:${port}`
}

// Get working directory
function getDirectory(): string {
  return process.env.AGENT_CORE_DIRECTORY || process.cwd()
}

export default tool({
  description: `Delegate a question or task to another persona (Stanley or Johny).

Use this when:
- User asks about investing, markets, portfolio → delegate to Stanley
- User asks about learning, studying, knowledge → delegate to Johny
- User wants to check on a task they left with another persona

Examples:
- "Ask Stanley about my portfolio performance"
- "Check with Johny about my study progress"
- "Have Stanley analyze NVDA stock"
- "Ask Johny to quiz me on calculus"

The tool opens a headless session with the target persona, sends your query,
and returns their response for you to relay to the user.`,
  args: {
    persona: tool.schema
      .enum(["stanley", "johny"])
      .describe("Which persona to delegate to: stanley (investing) or johny (learning)"),
    query: tool.schema
      .string()
      .describe("The question or task to send to the persona"),
    context: tool.schema
      .string()
      .optional()
      .describe("Optional context to include (e.g., 'User is asking via WhatsApp')"),
  },
  async execute(args) {
    const { persona, query, context } = args
    const baseUrl = getDaemonUrl()
    const directory = getDirectory()

    // Timeout for LLM response (90 seconds - personas may need time to think)
    const TIMEOUT_MS = 90000

    try {
      // Step 1: Create a headless session with the target persona
      const today = new Date().toISOString().split("T")[0]
      const sessionTitle = `${persona.charAt(0).toUpperCase() + persona.slice(1)} - Delegation - ${today}`

      const createResponse = await fetch(`${baseUrl}/session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-opencode-directory": directory,
        },
        body: JSON.stringify({ title: sessionTitle }),
      })

      if (!createResponse.ok) {
        const error = await createResponse.text()
        return `Failed to create session with ${persona}: ${error}

This might mean the daemon is not running. Ensure agent-core daemon is started.`
      }

      const session = (await createResponse.json()) as { id: string }
      const sessionId = session.id

      // Step 2: Build the message with context
      const fullQuery = context
        ? `[Context: ${context}]\n\nUser query: ${query}`
        : query

      // Step 3: Send message to the session and get response
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

      try {
        const messageResponse = await fetch(`${baseUrl}/session/${sessionId}/message`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-opencode-directory": directory,
          },
          body: JSON.stringify({
            parts: [{ type: "text", text: fullQuery }],
            agent: persona, // Use the target persona
          }),
          signal: controller.signal,
        })

        clearTimeout(timeoutId)

        if (!messageResponse.ok) {
          const error = await messageResponse.text()
          return `${persona.charAt(0).toUpperCase() + persona.slice(1)} encountered an error: ${error}

Session ID: ${sessionId} (you can check the session later)`
        }

        const data = (await messageResponse.json()) as {
          parts?: Array<{ type: string; text?: string }>
        }

        // Extract text parts from response
        const textParts = data.parts
          ?.filter((p) => p.type === "text" && p.text)
          .map((p) => p.text!) || []

        const response = textParts.join("\n").trim()

        if (!response) {
          return `${persona.charAt(0).toUpperCase() + persona.slice(1)} did not provide a response.

Session: ${sessionId}
To continue this conversation: agent-core attach ${sessionId}`
        }

        // Format the response with clear persona identification
        const personaName = persona.charAt(0).toUpperCase() + persona.slice(1)
        const personaEmoji = persona === "stanley" ? "📊" : "📚" // Stanley=charts, Johny=books
        const modelInfo = persona === "stanley" ? "opus" : "sonnet" // Stanley uses Opus, Johny uses Sonnet

        return `${personaEmoji} **${personaName}** (via ${modelInfo}):

${response}

---
Session: \`${sessionId}\`
To continue directly: \`agent-core attach ${sessionId}\`
Or ask me to follow up with ${personaName}`
      } catch (error) {
        clearTimeout(timeoutId)

        if (error instanceof Error && error.name === "AbortError") {
          return `${persona.charAt(0).toUpperCase() + persona.slice(1)} is taking too long to respond.

The session has been created (ID: ${sessionId}), so they may still be working on it.
You can check back later or ask them to continue.`
        }

        throw error
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)

      if (errorMsg.includes("ECONNREFUSED") || errorMsg.includes("fetch failed")) {
        return `Could not connect to agent-core daemon.

To enable persona delegation:
1. Start the daemon: agent-core daemon
2. Make sure it's running on port ${process.env.AGENT_CORE_DAEMON_PORT || "3456"}

Error: ${errorMsg}`
      }

      return `Failed to delegate to ${persona}: ${errorMsg}`
    }
  },
})
