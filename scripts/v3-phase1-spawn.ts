/**
 * V3 Phase 1 -- Spawn Foundation Agents via Daemon API
 *
 * Creates 5 sessions on the running daemon (port 3210):
 *   #2 Security Architect
 *   #3 Security Implementer
 *   #4 Security Tester
 *   #5 Core Architect
 *   #6 Core Implementer
 *
 * Usage: bun run scripts/v3-phase1-spawn.ts
 */

const DAEMON_URL = "http://127.0.0.1:3210";

interface AgentTask {
  id: string;
  name: string;
  agent: string;
  prompt: string;
}

const PHASE1_AGENTS: AgentTask[] = [
  {
    id: "v3-agent-2",
    name: "V3 Security Architect",
    agent: "zee",
    prompt: `You are V3 Security Architect (Agent #2).

Your mission: Design the security architecture for agent-core v3.

Tasks:
1. Review the codebase for CVE-1 (vulnerable @anthropic-ai/claude-code dependency),
   CVE-2 (SHA-256 with hardcoded salt), CVE-3 (hardcoded default credentials).
2. Catalog HIGH-1 (shell:true in spawn) and HIGH-2 (path traversal) locations.
3. Draft a threat model covering API boundary, authentication, authorization,
   agent communication, and data protection layers.
4. Output a SECURITY-ARCHITECTURE.md to .claude/v3/deliverables/.

Reference: .claude/agents/v3/v3-security-architect.md
GitHub tracking: https://github.com/adolago/agent-core/issues/199`,
  },
  {
    id: "v3-agent-3",
    name: "V3 Security Implementer",
    agent: "zee",
    prompt: `You are V3 Security Implementer (Agent #3).

Your mission: Plan concrete CVE remediation for agent-core v3.

Tasks:
1. For CVE-1: identify the exact package.json line and target version.
2. For CVE-2: locate the SHA-256 hashing code and plan bcrypt migration with 12 rounds.
3. For CVE-3: locate hardcoded credentials and plan random generation.
4. For HIGH-1: list all spawn({shell:true}) call sites.
5. For HIGH-2: list all unvalidated path operations.
6. Output a CVE-REMEDIATION-PLAN.md to .claude/v3/deliverables/.

Reference: .claude/agents/v3/v3-security-architect.md
GitHub tracking: https://github.com/adolago/agent-core/issues/199`,
  },
  {
    id: "v3-agent-4",
    name: "V3 Security Tester",
    agent: "zee",
    prompt: `You are V3 Security Tester (Agent #4).

Your mission: Design the security testing framework for agent-core v3.

Tasks:
1. Design test cases for each CVE (CVE-1, CVE-2, CVE-3).
2. Design test cases for HIGH-1 (command injection) and HIGH-2 (path traversal).
3. Plan a TDD London School approach for security-critical code.
4. Define the security regression test suite structure.
5. Output a SECURITY-TEST-PLAN.md to .claude/v3/deliverables/.

Reference: .claude/agents/v3/v3-security-architect.md
GitHub tracking: https://github.com/adolago/agent-core/issues/199`,
  },
  {
    id: "v3-agent-5",
    name: "V3 Core Architect",
    agent: "zee",
    prompt: `You are V3 Core Architect (Agent #5).

Your mission: Design the DDD domain boundaries for agent-core v3.

Tasks:
1. Analyze the current codebase structure under packages/agent-core/src/.
2. Identify bounded contexts: Session, Provider, Skill, Tool, Memory, Swarm, CLI.
3. Define domain boundaries, aggregates, and value objects for each context.
4. Design the microkernel pattern with dependency injection.
5. Output a DDD-ARCHITECTURE.md to .claude/v3/deliverables/.

Reference: .claude/agents/v3/v3-queen-coordinator.md (DDD section)
GitHub tracking: https://github.com/adolago/agent-core/issues/200`,
  },
  {
    id: "v3-agent-6",
    name: "V3 Core Implementer",
    agent: "zee",
    prompt: `You are V3 Core Implementer (Agent #6).

Your mission: Plan the type modernization for agent-core v3.

Tasks:
1. Audit current TypeScript strictness (tsconfig.json settings).
2. Identify areas using 'any' types, missing return types, loose interfaces.
3. Plan strict TypeScript migration: noImplicitAny, strictNullChecks, etc.
4. Design the module boundary enforcement strategy (barrel exports, internal).
5. Output a TYPE-MODERNIZATION-PLAN.md to .claude/v3/deliverables/.

Reference: .claude/agents/v3/v3-queen-coordinator.md (Core section)
GitHub tracking: https://github.com/adolago/agent-core/issues/200`,
  },
];

async function createSession(title: string): Promise<string> {
  const res = await fetch(`${DAEMON_URL}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, surface: "api" }),
  });
  if (!res.ok) throw new Error(`Failed to create session: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.id;
}

async function sendMessage(
  sessionID: string,
  text: string,
  agent: string,
): Promise<{ status: string; text: string }> {
  const res = await fetch(`${DAEMON_URL}/session/${sessionID}/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agent,
      parts: [{ type: "text", text }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    return { status: "error", text: body };
  }
  const data = await res.json();
  const responseText = data.parts
    ?.filter((p: { type: string }) => p.type === "text")
    .map((p: { text: string }) => p.text)
    .join("\n") ?? "";
  return { status: data.info?.finish ?? "unknown", text: responseText };
}

async function sendMessageAsync(sessionID: string, text: string, agent: string): Promise<void> {
  const res = await fetch(`${DAEMON_URL}/session/${sessionID}/prompt_async`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agent,
      parts: [{ type: "text", text }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Async prompt failed: ${res.status} ${body}`);
  }
}

async function main() {
  console.log("=== V3 Phase 1: Foundation Agents ===");
  console.log(`Daemon: ${DAEMON_URL}`);
  console.log(`Spawning ${PHASE1_AGENTS.length} agents...`);
  console.log();

  const sessions: Array<{ agent: AgentTask; sessionID: string }> = [];

  // Create sessions in parallel
  const sessionResults = await Promise.allSettled(
    PHASE1_AGENTS.map(async (agent) => {
      const sessionID = await createSession(agent.name);
      console.log(`[${agent.id}] Session created: ${sessionID}`);
      return { agent, sessionID };
    }),
  );

  for (const result of sessionResults) {
    if (result.status === "fulfilled") {
      sessions.push(result.value);
    } else {
      console.error(`Session creation failed: ${result.reason}`);
    }
  }

  if (sessions.length === 0) {
    console.error("No sessions created. Is the daemon running?");
    process.exit(1);
  }

  // Send prompts asynchronously (non-blocking) so all agents start working in parallel
  console.log();
  console.log("Sending prompts (async)...");

  const promptResults = await Promise.allSettled(
    sessions.map(async ({ agent, sessionID }) => {
      await sendMessageAsync(sessionID, agent.prompt, agent.agent);
      console.log(`[${agent.id}] ${agent.name} -- prompt sent (session: ${sessionID})`);
      return { agent, sessionID };
    }),
  );

  console.log();
  console.log("=== Phase 1 Spawn Summary ===");
  console.log();

  let successCount = 0;
  for (const result of promptResults) {
    if (result.status === "fulfilled") {
      const { agent, sessionID } = result.value;
      console.log(`  ${agent.id} ${agent.name} -- RUNNING (${sessionID})`);
      successCount++;
    } else {
      console.error(`  FAILED: ${result.reason}`);
    }
  }

  console.log();
  console.log(`${successCount}/${PHASE1_AGENTS.length} agents spawned successfully`);
  console.log();
  console.log("Monitor via:");
  console.log("  agent-core daemon-status");
  console.log("  curl http://127.0.0.1:3210/session/status");
  console.log("  curl http://127.0.0.1:3210/events  (SSE stream)");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
