---
summary: "Exploration: hub persona routing and cross-channel session continuity"
read_when:
- Designing a hub persona across WhatsApp and WhatsApp
  - Planning cross-persona context visibility without shared sessions
status: draft
---
# Persona Hub Routing Exploration

This document captures a proposed design for a hub persona pattern in Zee. It is
not a shipping spec. For current behavior, see:
- [Multi-Agent Routing](/concepts/multi-agent)
- [Session management](/concepts/session)
- [Session tools](/concepts/session-tool)

## Goals

- Zee is the hub persona with WhatsApp and WhatsApp access.
- Johny and Stanley run as isolated personas without external chat endpoints by default.
- Zee can answer questions about Johny and Stanley conversations.
- Johny and Stanley do not see each other or Zee by default.
- Users do not need session ids to resume or start a new thread.
- Optional: keep DM sessions persistent across channels unless the user explicitly resets.

## Roles and constraints

- Zee is the only WhatsApp endpoint.
- Zee is the only WhatsApp endpoint (optional).
- GUI sessions can be started for any persona.
- Cross-persona access is by design intent, not by shared state.

## Proposed routing model

- Run three agents: `zee`, `johny`, `stanley`.
- Bind WhatsApp and WhatsApp to `zee`.
- Enable agent-to-agent messaging so Zee can call into other persona sessions.
- Restrict session tools to Zee only via per-agent tool policy.

Config sketch:

```json5
{
  agents: {
    list: [
      {
        id: "zee",
        name: "Zee",
        tools: {
          allow: ["sessions_list", "sessions_history", "sessions_send", "session_status"]
        }
      },
      {
        id: "johny",
        name: "Johny",
        tools: {
          deny: ["sessions_list", "sessions_history", "sessions_send", "session_status"]
        }
      },
      {
        id: "stanley",
        name: "Stanley",
        tools: {
          deny: ["sessions_list", "sessions_history", "sessions_send", "session_status"]
        }
      }
    ]
  },
  tools: {
    agentToAgent: {
      enabled: true,
      allow: ["zee", "johny", "stanley"]
    }
  },
  bindings: [
    { agentId: "zee", match: { channel: "whatsapp", peer: { kind: "dm", id: "+15555550123" } } },
    { agentId: "zee", match: { channel: "whatsapp", peer: { kind: "dm", id: "@artur:example.org" } } }
  ]
}
```

Notes:
- The allowlist is required so `sessions_send` can target other agents.
- The deny lists on Johny and Stanley prevent them from using session tools.

## Hub behavior on WhatsApp

Zee should interpret intents like:
- "Ask Johny about X"
- "Talk to Stanley about Y"

Flow:
1. Zee calls `sessions_send` to the target persona session.
2. Zee uses the tool reply to answer the user on WhatsApp.
3. The target persona suppresses channel announce with `ANNOUNCE_SKIP` so the hub stays quiet.

This keeps WhatsApp as the single human inbox while still leveraging the other personas.

## Context visibility

Zee can use `sessions_list` and `sessions_history` to fetch context from other agents
when the user asks a cross-persona question. Johny and Stanley cannot call session
tools, so they remain isolated unless Zee forwards a request.

## Session continuity without ids

Use existing session controls to make continuity feel automatic:

- `session.dmScope` selects how direct chats group across channels.
  - `per-channel-peer` keeps WhatsApp and WhatsApp separate.
  - `per-peer` plus `session.identityLinks` can merge the same user across channels.
- `session.reset` defines daily, idle, or manual resets. Manual disables automatic session rolls.
- `session.resetTriggers` can include natural phrases such as `new`, `new topic`, `start fresh`.

### Persistent sessions (opt-in)

If you want long-lived sessions that survive day boundaries, configure DM scoping
and reset policy so the same person keeps a stable session key across channels.

```json5
  {
    session: {
      dmScope: "per-peer",
      identityLinks: {
      "user:artur": ["whatsapp:+15555550123", "whatsapp:@artur:example.org"]
      },
      resetByType: {
        dm: { mode: "idle", idleMinutes: 10080 } // 7 days
      }
  }
}
```

Notes:
- `dmScope: "main"` keeps a single DM thread for all users; use `per-peer` when
  you want per-user continuity.
- A large `idleMinutes` window approximates persistence while still allowing
  occasional resets. For true "never reset" behavior, set
  `session.reset.mode: "manual"` so sessions only change via explicit reset.

Proposed UX improvement:
- When a reset triggers, Zee sends a short header message with an auto title and date
  so the user can see a new thread started in WhatsApp or WhatsApp.

## Prompt drafts

### Zee hub prompt

```text
You are Zee, the hub persona. You can see summaries and history from other personas
via session tools. Answer questions directly when possible. If the user asks for
Johny or Stanley, use sessions_send and return the result. Do not expose session ids.
If a request is ambiguous, ask one short clarifying question.
```

### Johny prompt

```text
You are Johny. You only see your own session history. You do not have access to Zee
or Stanley unless Zee forwards a request. If you receive a sessions_send request,
answer it clearly and end with ANNOUNCE_SKIP to avoid posting to chat.
```

### Stanley prompt

```text
You are Stanley. You only see your own session history. You do not have access to Zee
or Johny unless Zee forwards a request. If you receive a sessions_send request,
answer it clearly and end with ANNOUNCE_SKIP to avoid posting to chat.
```

## Implementation Plan

- Phase 1: Config and prompt defaults. Add persona-specific workspace templates, wire agent id into bootstrap selection, and provide a hub config example.
- Phase 2: Hub routing UX. Add a light-weight command parser for "ask Johny" and "ask Stanley" in the hub persona, plus a single-shot disambiguation prompt.
- Phase 3: Session continuity helpers. Add optional reset trigger phrases and a short reset header message that labels new threads by date and topic.
- Phase 4: Observability and tests. Add tests for agent-to-agent gating, session selection, and hub routing flows.

## Open questions

- Should Zee store cross-persona summaries in memory for faster recall?
- Do we want a fixed list of natural reset triggers or a configurable map?
- Should the UI show the active session label in WhatsApp and WhatsApp headers?
