import type { Feature } from "./types"

const CATEGORY_ORDER: string[] = [
  "Positioning",
  "Surfaces",
  "Architecture",
  "Config & State",
  "Memory",
  "Extensibility",
  "Coding Workflow",
  "Messaging & Channels",
  "Providers & Models",
  "Security & Ops",
  "Packaging",
]

export const FEATURE_CATALOG: Feature[] = [
  // ----------------------------------------------------------------------------
  // Positioning
  // ----------------------------------------------------------------------------
  {
    id: "positioning.unified-engine",
    category: "Positioning",
    label: "Unified assistant engine",
    description: "Focuses on life admin + investing + learning as a single engine with domain toolsets.",
    support: {
      zee: {
        level: "yes",
        evidence: [{ kind: "doc", ref: "README.md" }],
      },
      opencode: {
        level: "no",
        notes: "OpenCode is primarily an AI coding agent.",
        evidence: [{ kind: "note", ref: "sst/opencode README (dev)" }],
      },
      openclaw: {
        level: "partial",
        notes: "Personal assistant focus; not positioned as a multi-domain engine with investing/learning personas.",
        evidence: [{ kind: "note", ref: "openclaw/openclaw README (main)" }],
      },
      pimono: {
        level: "no",
        notes: "Pi-mono is a tools monorepo (agent runtime, LLM API, CLIs).",
        evidence: [{ kind: "note", ref: "badlogic/pi-mono README (main)" }],
      },
    },
  },
  {
    id: "positioning.coding-agent",
    category: "Positioning",
    label: "Dedicated coding agent",
    description: "A primary product surface aimed at software development workflows.",
    support: {
      zee: {
        level: "yes",
        notes: "Zee retains the core coding-agent surfaces (run/session/TUI/LSP) and adds additional domains.",
        evidence: [{ kind: "doc", ref: "docs/architecture/upstream-differences.md" }],
      },
      opencode: {
        level: "yes",
        evidence: [{ kind: "note", ref: "sst/opencode README (dev)" }],
      },
      openclaw: {
        level: "partial",
        notes: "OpenClaw can do coding tasks but is positioned as a personal assistant product.",
        evidence: [{ kind: "note", ref: "openclaw/openclaw README (main)" }],
      },
      pimono: {
        level: "yes",
        notes: "Includes @mariozechner/pi-coding-agent CLI.",
        evidence: [{ kind: "note", ref: "badlogic/pi-mono README (main)" }],
      },
    },
  },
  {
    id: "positioning.personal-assistant",
    category: "Positioning",
    label: "Personal assistant product",
    description: "Designed to answer on everyday channels (chat apps, devices) as a single-user assistant.",
    support: {
      zee: {
        level: "partial",
        notes: "Optional embedded gateway enables always-on messaging, but Zee’s core is a multi-domain engine.",
        evidence: [{ kind: "doc", ref: "docs/architecture/upstream-differences.md" }],
      },
      opencode: {
        level: "no",
        notes: "Not a messaging-first assistant product.",
        evidence: [{ kind: "doc", ref: "docs/architecture/upstream-differences.md" }],
      },
      openclaw: {
        level: "yes",
        evidence: [{ kind: "note", ref: "openclaw/openclaw README (main)" }],
      },
      pimono: {
        level: "no",
        notes: "Provides tools and CLIs; not a personal assistant across messaging channels.",
        evidence: [{ kind: "note", ref: "badlogic/pi-mono README (main)" }],
      },
    },
  },
  {
    id: "positioning.agent-libraries",
    category: "Positioning",
    label: "Reusable agent libraries",
    description: "Ships reusable packages (LLM API, agent runtime, TUI toolkit) meant to be embedded elsewhere.",
    support: {
      zee: {
        level: "partial",
        notes: "Zee is a product/engine; it has internal packages but is not primarily a library monorepo.",
      },
      opencode: {
        level: "partial",
        notes: "Primarily a product; provides some SDK surfaces but not positioned as a library monorepo.",
      },
      openclaw: {
        level: "partial",
        notes: "Primarily a product; uses Pi-based packages but is not itself a library monorepo.",
      },
      pimono: {
        level: "yes",
        notes: "Pi-mono is explicitly a multi-package tools monorepo (pi-ai, pi-agent-core, pi-tui, etc).",
        evidence: [{ kind: "note", ref: "badlogic/pi-mono README (main)" }],
      },
    },
  },

  // ----------------------------------------------------------------------------
  // Surfaces
  // ----------------------------------------------------------------------------
  {
    id: "surface.cli",
    category: "Surfaces",
    label: "CLI",
    description: "Command-line interface for interacting with the agent and managing configuration.",
    support: {
      zee: { level: "yes", evidence: [{ kind: "repo_path", ref: "packages/zee/src/index.ts" }] },
      opencode: { level: "yes", evidence: [{ kind: "note", ref: "sst/opencode README (dev)" }] },
      openclaw: { level: "yes", evidence: [{ kind: "note", ref: "openclaw/openclaw README (main)" }] },
      pimono: { level: "yes", evidence: [{ kind: "note", ref: "badlogic/pi-mono README (main)" }] },
    },
  },
  {
    id: "surface.tui",
    category: "Surfaces",
    label: "Terminal UI (TUI)",
    description: "Interactive terminal UI beyond simple prompts.",
    support: {
      zee: { level: "yes", evidence: [{ kind: "repo_path", ref: "packages/zee/src/cli/cmd/tui" }] },
      opencode: { level: "yes", evidence: [{ kind: "note", ref: "sst/opencode README (dev)" }] },
      openclaw: {
        level: "partial",
        notes: "OpenClaw is CLI-first with a web control UI; terminal UX is mostly wizard/prompt driven.",
      },
      pimono: {
        level: "yes",
        notes: "Includes pi-coding-agent CLI and a dedicated pi-tui library.",
        evidence: [{ kind: "note", ref: "badlogic/pi-mono README (main)" }],
      },
    },
  },
  {
    id: "surface.desktop-app",
    category: "Surfaces",
    label: "Desktop app",
    description: "Ships a desktop application distribution in addition to a CLI.",
    support: {
      zee: { level: "no" },
      opencode: { level: "yes", evidence: [{ kind: "note", ref: "sst/opencode README (dev)" }] },
      openclaw: {
        level: "yes",
        notes: "macOS app plus iOS/Android nodes.",
        evidence: [{ kind: "note", ref: "openclaw/openclaw README (main)" }],
      },
      pimono: { level: "no" },
    },
  },
  {
    id: "surface.web-ui",
    category: "Surfaces",
    label: "Web UI",
    description: "Ships a web UI/control surface in the core repo.",
    support: {
      zee: {
        level: "partial",
        notes: "Zee does not expose the upstream `web` command, but includes web/hosted packages and gateway UI surfaces.",
        evidence: [{ kind: "doc", ref: "docs/architecture/upstream-differences.md" }],
      },
      opencode: { level: "yes", notes: "Includes web/console packages and web surfaces.", evidence: [{ kind: "note", ref: "sst/opencode README (dev)" }] },
      openclaw: { level: "yes", notes: "Control UI + WebChat.", evidence: [{ kind: "note", ref: "openclaw/openclaw README (main)" }] },
      pimono: { level: "partial", notes: "Provides pi-web-ui components, not a single product web app.", evidence: [{ kind: "note", ref: "badlogic/pi-mono README (main)" }] },
    },
  },
  {
    id: "surface.http-api",
    category: "Surfaces",
    label: "HTTP API + OpenAPI",
    description: "Exposes an HTTP API and/or generates OpenAPI specs.",
    support: {
      zee: {
        level: "yes",
        notes: "Zee has `serve` and can generate OpenAPI with `zee generate`.",
        evidence: [
          { kind: "repo_path", ref: "packages/zee/src/cli/cmd/serve.ts" },
          { kind: "repo_path", ref: "packages/zee/src/cli/cmd/generate.ts" },
        ],
      },
      opencode: { level: "partial", notes: "Client/server architecture implies an API surface; exact OpenAPI generation varies by version." },
      openclaw: {
        level: "yes",
        notes: "Gateway control plane includes HTTP + WS endpoints for control surfaces.",
        evidence: [{ kind: "doc", ref: "docs/architecture/upstream-differences.md" }],
      },
      pimono: { level: "partial", notes: "Includes multiple CLIs and packages; not a single documented OpenAPI surface." },
    },
  },
  {
    id: "surface.daemon-service",
    category: "Surfaces",
    label: "Daemon/service mode",
    description: "Runs as a background service (systemd/launchd) for always-on operation.",
    support: {
      zee: { level: "yes", evidence: [{ kind: "repo_path", ref: "packages/zee/src/cli/cmd/daemon.ts" }] },
      opencode: { level: "partial", notes: "Has client/server and desktop modes; not primarily an always-on messaging daemon." },
      openclaw: { level: "yes", notes: "Wizard installs a gateway daemon.", evidence: [{ kind: "note", ref: "openclaw/openclaw README (main)" }] },
      pimono: { level: "no" },
    },
  },
  {
    id: "surface.shell-completion",
    category: "Surfaces",
    label: "Shell completion",
    description: "Built-in shell completion generation.",
    support: {
      zee: { level: "yes", evidence: [{ kind: "repo_path", ref: "packages/zee/src/index.ts" }] },
      opencode: { level: "yes", notes: "Yargs-based CLIs typically ship completion; verify in upstream." },
      openclaw: { level: "unknown" },
      pimono: { level: "unknown" },
    },
  },

  // ----------------------------------------------------------------------------
  // Architecture
  // ----------------------------------------------------------------------------
  {
    id: "arch.multi-persona",
    category: "Architecture",
    label: "Multi-persona routing",
    description: "First-class persona/domain routing inside the engine.",
    support: {
      zee: { level: "yes", evidence: [{ kind: "doc", ref: "docs/architecture/agent-personas.md" }] },
      opencode: { level: "no" },
      openclaw: { level: "partial", notes: "Supports multi-agent routing for channels/workspaces; differs from Zee personas.", evidence: [{ kind: "note", ref: "openclaw/openclaw README (main)" }] },
      pimono: { level: "partial", notes: "Provides primitives to build multi-agent systems; not a product-level persona router." },
    },
  },
  {
    id: "arch.sessions",
    category: "Architecture",
    label: "Session system",
    description: "Persistent sessions with message history and tooling context.",
    support: {
      zee: { level: "yes", evidence: [{ kind: "doc", ref: "docs/architecture/session-system.md" }] },
      opencode: { level: "yes", notes: "Core to OpenCode’s coding workflow." },
      openclaw: { level: "yes", notes: "Session model is a core concept.", evidence: [{ kind: "note", ref: "openclaw/openclaw README (main)" }] },
      pimono: { level: "partial", notes: "pi-agent-core provides runtime state; session UX depends on the embedding product (pi-coding-agent / consumers)." },
    },
  },
  {
    id: "arch.gateway-control-plane",
    category: "Architecture",
    label: "Gateway WS control plane",
    description: "A WebSocket control plane for channels/tools/events and remote clients.",
    support: {
      zee: {
        level: "partial",
        notes: "Zee embeds a trimmed OpenClaw-like gateway under Swabble.",
        evidence: [{ kind: "doc", ref: "docs/architecture/upstream-differences.md" }],
      },
      opencode: { level: "no" },
      openclaw: { level: "yes", evidence: [{ kind: "note", ref: "openclaw/openclaw README (main)" }] },
      pimono: { level: "no" },
    },
  },
  {
    id: "arch.client-server",
    category: "Architecture",
    label: "Client/server split",
    description: "Separates a client UI from a server runtime for the agent.",
    support: {
      zee: { level: "partial", notes: "Zee runs as CLI/TUI with optional daemon; server surfaces exist but aren’t a separate hosted product." },
      opencode: { level: "yes", evidence: [{ kind: "doc", ref: "docs/architecture/upstream-differences.md" }] },
      openclaw: { level: "yes", notes: "Gateway is the control plane; nodes can be remote." },
      pimono: { level: "partial", notes: "pi-pods and other packages target deployments; not a single end-user client/server split." },
    },
  },

  // ----------------------------------------------------------------------------
  // Config & State
  // ----------------------------------------------------------------------------
  {
    id: "config.xdg",
    category: "Config & State",
    label: "XDG directories",
    description: "Uses XDG Base Dir paths for config/cache/state on Linux.",
    support: {
      zee: { level: "yes", evidence: [{ kind: "doc", ref: "README.md" }] },
      opencode: { level: "yes", notes: "OpenCode uses XDG-style config/state for most installs.", evidence: [{ kind: "doc", ref: "docs/architecture/upstream-differences.md" }] },
      openclaw: { level: "no", notes: "OpenClaw uses a dedicated state root (e.g. ~/.openclaw).", evidence: [{ kind: "doc", ref: "docs/architecture/upstream-differences.md" }] },
      pimono: { level: "unknown" },
    },
  },
  {
    id: "config.project-local-bundle",
    category: "Config & State",
    label: "Project-local config bundle",
    description: "Supports a project-local directory bundle (.zee/ or .opencode/) for config/tools/themes/plans.",
    support: {
      zee: { level: "yes", notes: "Uses .zee/ in project root.", evidence: [{ kind: "doc", ref: "README.md" }] },
      opencode: { level: "yes", notes: "Uses .opencode/ in project root.", evidence: [{ kind: "doc", ref: "docs/architecture/upstream-differences.md" }] },
      openclaw: { level: "no", notes: "OpenClaw prefers the state dir + a workspace repo model.", evidence: [{ kind: "doc", ref: "docs/architecture/upstream-differences.md" }] },
      pimono: { level: "no" },
    },
  },
  {
    id: "config.global-config-file",
    category: "Config & State",
    label: "Global config file",
    description: "Has a primary global config file path for defaults and policies.",
    support: {
      zee: { level: "yes", notes: "~/.config/zee/zee.jsonc", evidence: [{ kind: "doc", ref: "README.md" }] },
      opencode: { level: "yes", notes: "~/.config/opencode/opencode.jsonc (varies by install)", evidence: [{ kind: "doc", ref: "docs/architecture/upstream-differences.md" }] },
      openclaw: { level: "yes", notes: "~/.openclaw/openclaw.json (or $OPENCLAW_STATE_DIR)", evidence: [{ kind: "doc", ref: "docs/architecture/upstream-differences.md" }] },
      pimono: { level: "partial", notes: "Per-package configuration; not a single global product config." },
    },
  },
  {
    id: "config.secrets-policy",
    category: "Config & State",
    label: "Secret handling policy",
    description: "Defines how API keys/OAuth tokens are stored and referenced.",
    support: {
      zee: {
        level: "yes",
        notes: "Secrets are env-var only; JSONC config references {env:...}.",
        evidence: [{ kind: "doc", ref: "docs/architecture/upstream-differences.md" }],
      },
      opencode: { level: "partial", notes: "Supports env vars and config-based defaults depending on provider." },
      openclaw: { level: "yes", notes: "Uses a state-dir .env plus env vars; wizard-driven onboarding.", evidence: [{ kind: "note", ref: "openclaw/openclaw README (main)" }] },
      pimono: { level: "partial", notes: "Depends on the consumer; pi-ai supports multiple providers and key sources." },
    },
  },
  {
    id: "config.state-root-override",
    category: "Config & State",
    label: "State root override",
    description: "Allows overriding the main state/config root via env var(s).",
    support: {
      zee: { level: "yes", notes: "ZEE_STATE_DIR", evidence: [{ kind: "doc", ref: "README.md" }] },
      opencode: { level: "unknown" },
      openclaw: { level: "yes", notes: "OPENCLAW_STATE_DIR", evidence: [{ kind: "doc", ref: "docs/architecture/upstream-differences.md" }] },
      pimono: { level: "unknown" },
    },
  },
  {
    id: "config.workspace-model",
    category: "Config & State",
    label: "Workspace/worktree model",
    description: "Has a canonical workspace/worktree location where projects/sessions run.",
    support: {
      zee: { level: "yes", notes: "Default worktree under XDG data; override via ZEE_WORKSPACE_DIR.", evidence: [{ kind: "doc", ref: "README.md" }] },
      opencode: { level: "yes", notes: "Project worktree/session model is core to coding workflows." },
      openclaw: { level: "yes", notes: "~/.openclaw/workspace is the canonical surface.", evidence: [{ kind: "doc", ref: "docs/architecture/upstream-differences.md" }] },
      pimono: { level: "partial", notes: "Depends on the specific CLI (pi-coding-agent) and consumer." },
    },
  },

  // ----------------------------------------------------------------------------
  // Memory
  // ----------------------------------------------------------------------------
  {
    id: "memory.semantic",
    category: "Memory",
    label: "Semantic memory",
    description: "Semantic recall beyond session history (embeddings, retrieval, long-term memory).",
    support: {
      zee: { level: "yes", notes: "Qdrant-backed semantic memory.", evidence: [{ kind: "repo_path", ref: "src/memory" }] },
      opencode: { level: "no", notes: "Primarily session/worktree focused; does not ship Qdrant-style semantic memory in the same way.", evidence: [{ kind: "doc", ref: "docs/architecture/upstream-differences.md" }] },
      openclaw: { level: "yes", notes: "Local-first memory and indexing surfaces; differs in storage model.", evidence: [{ kind: "doc", ref: "docs/architecture/upstream-differences.md" }] },
      pimono: { level: "partial", notes: "Provides LLM/runtime primitives; memory layer depends on the embedding product." },
    },
  },
  {
    id: "memory.qdrant",
    category: "Memory",
    label: "Qdrant integration",
    description: "First-class Qdrant support for vectors/memory.",
    support: {
      zee: { level: "yes", evidence: [{ kind: "repo_path", ref: "src/memory" }] },
      opencode: { level: "no" },
      openclaw: { level: "no", notes: "Uses local indexing (sqlite-vec) rather than Qdrant by default.", evidence: [{ kind: "doc", ref: "docs/architecture/upstream-differences.md" }] },
      pimono: { level: "no" },
    },
  },
  {
    id: "memory.local-indexing",
    category: "Memory",
    label: "Local indexing store",
    description: "Local embedding index (e.g. sqlite-vec) and plugin-based memory stores.",
    support: {
      zee: { level: "partial", notes: "Gateway embeds memory extensions (e.g. LanceDB) in Swabble; primary semantic memory is Qdrant.", evidence: [{ kind: "repo_path", ref: "packages/zee/Swabble/extensions" }] },
      opencode: { level: "no" },
      openclaw: { level: "yes", notes: "Uses sqlite-vec for local indexing and memory surfaces.", evidence: [{ kind: "doc", ref: "docs/architecture/upstream-differences.md" }] },
      pimono: { level: "no" },
    },
  },
  {
    id: "memory.session-export-import",
    category: "Memory",
    label: "Session export/import",
    description: "Exports/imports session data for portability and backups.",
    support: {
      zee: { level: "yes", evidence: [{ kind: "repo_path", ref: "packages/zee/src/cli/cmd/export.ts" }, { kind: "repo_path", ref: "packages/zee/src/cli/cmd/import.ts" }] },
      opencode: { level: "unknown" },
      openclaw: { level: "partial", notes: "Sessions are persisted; export UX differs." },
      pimono: { level: "no" },
    },
  },

  // ----------------------------------------------------------------------------
  // Extensibility
  // ----------------------------------------------------------------------------
  {
    id: "ext.skills",
    category: "Extensibility",
    label: "Skills system (SKILL.md)",
    description: "Skill packaging using SKILL.md files (with metadata and progressive disclosure).",
    support: {
      zee: { level: "yes", notes: "Persona-scoped skills under .agents/skills.", evidence: [{ kind: "doc", ref: "AGENTS.md" }] },
      opencode: { level: "no", notes: "OpenCode uses agent modes and extensions; does not ship the same SKILL.md catalog model." },
      openclaw: { level: "yes", notes: "Skills live under skills/ and user state.", evidence: [{ kind: "doc", ref: "docs/architecture/upstream-differences.md" }] },
      pimono: { level: "no" },
    },
  },
  {
    id: "ext.plugins",
    category: "Extensibility",
    label: "Plugin manager",
    description: "Install/search/remove plugins via a first-class CLI.",
    support: {
      zee: { level: "yes", evidence: [{ kind: "repo_path", ref: "packages/zee/src/cli/cmd/plugin" }] },
      opencode: { level: "no", notes: "Zee’s plugin command group is not present in the upstream OpenCode command surface.", evidence: [{ kind: "doc", ref: "docs/architecture/upstream-differences.md" }] },
      openclaw: { level: "partial", notes: "Has extensions and skills management; terminology and packaging differ." },
      pimono: { level: "no" },
    },
  },
  {
    id: "ext.mcp",
    category: "Extensibility",
    label: "MCP support",
    description: "Model Context Protocol support for tool servers/clients.",
    support: {
      zee: { level: "yes", evidence: [{ kind: "repo_path", ref: "packages/zee/src/cli/cmd/mcp.ts" }] },
      opencode: { level: "yes", notes: "Core MCP support is part of the OpenCode lineage." },
      openclaw: { level: "partial", notes: "Has a broad tool system; MCP integration may exist but is not the primary abstraction." },
      pimono: { level: "unknown" },
    },
  },
  {
    id: "ext.tool-permissions",
    category: "Extensibility",
    label: "Tool permissions/approvals",
    description: "Interactive and/or policy-driven permission gating for tools and commands.",
    support: {
      zee: { level: "yes", notes: "Fine-grained tool policy + sandbox gates.", evidence: [{ kind: "repo_path", ref: "packages/zee/src/permission" }] },
      opencode: { level: "partial", notes: "Built-in agent modes include a read-only/permissioned mode.", evidence: [{ kind: "note", ref: "sst/opencode README (dev)" }] },
      openclaw: { level: "yes", notes: "Pairing/allowlists + approvals are core for real channels.", evidence: [{ kind: "note", ref: "openclaw/openclaw README (main)" }] },
      pimono: { level: "partial", notes: "Runtime and tools exist; approval model depends on consumers." },
    },
  },
  {
    id: "ext.skill-scanner",
    category: "Extensibility",
    label: "Skill/plugin safety scanning",
    description: "Scans skill/plugin code for risky patterns as a supply-chain guardrail.",
    support: {
      zee: { level: "yes", evidence: [{ kind: "repo_path", ref: "packages/zee/src/skill/scanner.ts" }] },
      opencode: { level: "no" },
      openclaw: { level: "yes", notes: "Upstream has similar supply-chain scanning patterns (ported/adapted in Zee).", evidence: [{ kind: "doc", ref: "docs/architecture/openclaw-delta-map.md" }] },
      pimono: { level: "no" },
    },
  },
  {
    id: "ext.cron",
    category: "Extensibility",
    label: "Cron/reminders",
    description: "Built-in cron scheduling for reminders/background jobs.",
    support: {
      zee: { level: "yes", evidence: [{ kind: "repo_path", ref: "packages/zee/Swabble/src/cron" }] },
      opencode: { level: "unknown" },
      openclaw: { level: "yes", evidence: [{ kind: "note", ref: "openclaw/openclaw README (main)" }] },
      pimono: { level: "no" },
    },
  },

  // ----------------------------------------------------------------------------
  // Coding Workflow
  // ----------------------------------------------------------------------------
  {
    id: "code.lsp",
    category: "Coding Workflow",
    label: "LSP integration",
    description: "Language Server Protocol integration for code intelligence in the agent workflow.",
    support: {
      zee: { level: "yes", evidence: [{ kind: "repo_path", ref: "packages/zee/src/lsp" }] },
      opencode: { level: "yes", notes: "LSP support is a core OpenCode capability.", evidence: [{ kind: "doc", ref: "docs/architecture/upstream-differences.md" }] },
      openclaw: { level: "no", notes: "Not a primary surface for OpenClaw." },
      pimono: { level: "no" },
    },
  },
  {
    id: "code.worktrees",
    category: "Coding Workflow",
    label: "Worktrees/workspaces for code",
    description: "Project worktrees for running tools, reading files, and isolating sessions per repo.",
    support: {
      zee: { level: "yes", evidence: [{ kind: "repo_path", ref: "packages/zee/src/worktree" }] },
      opencode: { level: "yes", notes: "Worktree/session model is core to OpenCode.", evidence: [{ kind: "doc", ref: "docs/architecture/upstream-differences.md" }] },
      openclaw: { level: "partial", notes: "Has a workspace repo model for assistant context rather than code worktrees.", evidence: [{ kind: "doc", ref: "docs/architecture/upstream-differences.md" }] },
      pimono: { level: "partial", notes: "Depends on pi-coding-agent behavior; not a universal repo worktree system." },
    },
  },
  {
    id: "code.patch",
    category: "Coding Workflow",
    label: "Patch-based edits",
    description: "Generates/applies patches and diffs as a core editing primitive.",
    support: {
      zee: { level: "yes", evidence: [{ kind: "repo_path", ref: "packages/zee/src/patch" }] },
      opencode: { level: "yes", notes: "Patch editing is a typical OpenCode workflow; verify exact implementation in upstream." },
      openclaw: { level: "partial", notes: "Can do edits via tools/nodes; patch-first workflows are not the primary surface." },
      pimono: { level: "no" },
    },
  },
  {
    id: "code.vscode-extension",
    category: "Coding Workflow",
    label: "VS Code extension",
    description: "Editor extension to integrate the agent with VS Code.",
    support: {
      zee: { level: "yes", notes: "Ships a VS Code SDK/extension in-repo.", evidence: [{ kind: "repo_path", ref: "sdks/vscode" }] },
      opencode: { level: "yes", notes: "Upstream ships editor/desktop surfaces; VS Code extension exists in the OpenCode ecosystem." },
      openclaw: { level: "no" },
      pimono: { level: "no" },
    },
  },
  {
    id: "code.github-automation",
    category: "Coding Workflow",
    label: "GitHub automation",
    description: "First-class GitHub workflows (PR/issue automation) via a dedicated command surface.",
    support: {
      zee: { level: "yes", notes: "Includes `zee github` and `zee pr` flows.", evidence: [{ kind: "repo_path", ref: "packages/zee/src/cli/cmd/github.ts" }] },
      opencode: { level: "unknown" },
      openclaw: { level: "partial", notes: "Can act on GitHub via tools, but not necessarily a dedicated agent product surface." },
      pimono: { level: "no" },
    },
  },

  // ----------------------------------------------------------------------------
  // Messaging & Channels
  // ----------------------------------------------------------------------------
  {
    id: "msg.whatsapp",
    category: "Messaging & Channels",
    label: "WhatsApp",
    description: "WhatsApp channel integration for inbound/outbound messaging.",
    support: {
      zee: { level: "yes", notes: "WhatsApp support exists in Zee’s embedded gateway.", evidence: [{ kind: "repo_path", ref: "packages/zee/Swabble/src/web" }] },
      opencode: { level: "no" },
      openclaw: { level: "yes", evidence: [{ kind: "note", ref: "openclaw/openclaw README (main)" }] },
      pimono: { level: "no" },
    },
  },
  {
    id: "msg.multi-channel",
    category: "Messaging & Channels",
    label: "Multi-channel inbox",
    description: "Multiple real-world channels (Telegram/Slack/Discord/Signal/etc).",
    support: {
      zee: {
        level: "partial",
        notes: "Zee embeds a reduced subset of OpenClaw’s channel stack (focuses on WhatsApp and a small set of surfaces).",
        evidence: [{ kind: "doc", ref: "docs/architecture/upstream-differences.md" }],
      },
      opencode: { level: "no" },
      openclaw: { level: "yes", evidence: [{ kind: "note", ref: "openclaw/openclaw README (main)" }] },
      pimono: { level: "no" },
    },
  },
  {
    id: "msg.device-nodes",
    category: "Messaging & Channels",
    label: "Device nodes",
    description: "macOS/iOS/Android nodes for device-local actions (voice, camera, screen).",
    support: {
      zee: { level: "no" },
      opencode: { level: "no" },
      openclaw: { level: "yes", evidence: [{ kind: "note", ref: "openclaw/openclaw README (main)" }] },
      pimono: { level: "no" },
    },
  },
  {
    id: "msg.pairing-allowlists",
    category: "Messaging & Channels",
    label: "DM pairing + allowlists",
    description: "Pairing codes and allowlists to gate untrusted inbound DMs by default.",
    support: {
      zee: { level: "yes", evidence: [{ kind: "repo_path", ref: "packages/zee/Swabble/src/pairing" }] },
      opencode: { level: "no" },
      openclaw: { level: "yes", evidence: [{ kind: "note", ref: "openclaw/openclaw README (main)" }] },
      pimono: { level: "no" },
    },
  },
  {
    id: "msg.voice",
    category: "Messaging & Channels",
    label: "Voice wake/talk mode",
    description: "Always-on voice interfaces (wake word, talk mode) through device nodes.",
    support: {
      zee: { level: "no" },
      opencode: { level: "no" },
      openclaw: { level: "yes", evidence: [{ kind: "note", ref: "openclaw/openclaw README (main)" }] },
      pimono: { level: "no" },
    },
  },

  // ----------------------------------------------------------------------------
  // Providers & Models
  // ----------------------------------------------------------------------------
  {
    id: "model.multi-provider",
    category: "Providers & Models",
    label: "Multi-provider LLM support",
    description: "Supports multiple LLM providers (OpenAI/Anthropic/Google/etc).",
    support: {
      zee: { level: "yes", notes: "Uses the AI SDK provider stack and gateway provider integrations.", evidence: [{ kind: "repo_path", ref: "packages/zee/package.json" }] },
      opencode: { level: "yes", notes: "Multi-provider support is core to OpenCode deployments." },
      openclaw: { level: "yes", notes: "Supports any model; recommended subscription-based flows for Anthropic/OpenAI.", evidence: [{ kind: "note", ref: "openclaw/openclaw README (main)" }] },
      pimono: { level: "yes", notes: "pi-ai provides a unified multi-provider API.", evidence: [{ kind: "note", ref: "badlogic/pi-mono README (main)" }] },
    },
  },
  {
    id: "model.oauth-subscriptions",
    category: "Providers & Models",
    label: "OAuth subscriptions",
    description: "OAuth-based auth flows for subscription products (e.g., Claude Pro/Max, ChatGPT).",
    support: {
      zee: { level: "partial", notes: "Zee supports plugin-based OAuth flows for some providers; coverage depends on installed plugins.", evidence: [{ kind: "repo_path", ref: "plugins/index.json" }] },
      opencode: { level: "partial", notes: "Auth flows vary by provider; OpenCode ecosystem includes auth helpers." },
      openclaw: { level: "yes", evidence: [{ kind: "note", ref: "openclaw/openclaw README (main)" }] },
      pimono: { level: "no" },
    },
  },
  {
    id: "model.local-models",
    category: "Providers & Models",
    label: "Local models",
    description: "Local model backends (e.g., Ollama) as a supported provider.",
    support: {
      zee: { level: "yes", notes: "Includes an Ollama provider in the provider stack.", evidence: [{ kind: "doc", ref: "docs/architecture/openclaw-delta-map.md" }] },
      opencode: { level: "yes", notes: "Common in OpenCode deployments; verify exact provider set in upstream." },
      openclaw: { level: "yes", notes: "Supports local and remote models; configuration differs." },
      pimono: { level: "partial", notes: "pi-ai supports multiple deployment targets; local backend coverage depends on package configuration." },
    },
  },
  {
    id: "model.embeddings",
    category: "Providers & Models",
    label: "Embeddings",
    description: "Embeddings support for memory/search.",
    support: {
      zee: { level: "yes", notes: "Google-only embeddings for semantic memory by default.", evidence: [{ kind: "doc", ref: "docs/architecture/openclaw-delta-map.md" }] },
      opencode: { level: "unknown" },
      openclaw: { level: "yes", notes: "Supports embedding/indexing flows; storage differs." },
      pimono: { level: "unknown" },
    },
  },

  // ----------------------------------------------------------------------------
  // Security & Ops
  // ----------------------------------------------------------------------------
  {
    id: "ops.systemd",
    category: "Security & Ops",
    label: "systemd/launchd install",
    description: "Installs a user service for always-on operation on supported platforms.",
    support: {
      zee: { level: "yes", notes: "Includes daemon install helpers and systemd scripts.", evidence: [{ kind: "repo_path", ref: "scripts/systemd" }] },
      opencode: { level: "unknown" },
      openclaw: { level: "yes", notes: "Wizard installs launchd/systemd user service.", evidence: [{ kind: "note", ref: "openclaw/openclaw README (main)" }] },
      pimono: { level: "no" },
    },
  },
  {
    id: "ops.health-checks",
    category: "Security & Ops",
    label: "Health checks",
    description: "Built-in diagnostics/doctor command for setup and runtime health.",
    support: {
      zee: { level: "yes", notes: "`zee check`", evidence: [{ kind: "repo_path", ref: "packages/zee/src/cli/cmd/check.ts" }] },
      opencode: { level: "unknown" },
      openclaw: { level: "yes", notes: "`openclaw doctor`", evidence: [{ kind: "note", ref: "openclaw/openclaw README (main)" }] },
      pimono: { level: "partial", notes: "Monorepo has CI/test scripts; not a single end-user doctor flow." },
    },
  },
  {
    id: "ops.crash-report",
    category: "Security & Ops",
    label: "Crash report generator",
    description: "Generates a structured crash report bundle for issue filing.",
    support: {
      zee: { level: "yes", notes: "`zee bug-report`", evidence: [{ kind: "repo_path", ref: "packages/zee/src/cli/cmd/bug-report.ts" }] },
      opencode: { level: "unknown" },
      openclaw: { level: "unknown" },
      pimono: { level: "no" },
    },
  },
  {
    id: "ops.upstream-sync-lanes",
    category: "Security & Ops",
    label: "Upstream sync lanes (maintainers)",
    description: "Maintainer tooling and docs for tracking upstream deltas across multiple repos.",
    support: {
      zee: { level: "yes", notes: "Tracks OpenCode/OpenClaw/Pi-mono upstream pins and port lanes.", evidence: [{ kind: "repo_path", ref: "docs/architecture/upstream-differences.md" }] },
      opencode: { level: "no" },
      openclaw: { level: "no" },
      pimono: { level: "no" },
    },
  },

  // ----------------------------------------------------------------------------
  // Packaging
  // ----------------------------------------------------------------------------
  {
    id: "pkg.npm",
    category: "Packaging",
    label: "npm package",
    description: "Published as an npm package.",
    support: {
      zee: { level: "yes", evidence: [{ kind: "doc", ref: "README.md" }] },
      opencode: { level: "yes", evidence: [{ kind: "note", ref: "sst/opencode README (dev)" }] },
      openclaw: { level: "yes", evidence: [{ kind: "note", ref: "openclaw/openclaw README (main)" }] },
      pimono: { level: "yes", notes: "Multiple npm packages published from the monorepo.", evidence: [{ kind: "note", ref: "badlogic/pi-mono README (main)" }] },
    },
  },
  {
    id: "pkg.prebuilt-binaries",
    category: "Packaging",
    label: "Prebuilt binaries",
    description: "Ships prebuilt binaries (or installers) in addition to source install.",
    support: {
      zee: { level: "partial", notes: "Prebuilt Linux x64; other platforms build from source.", evidence: [{ kind: "doc", ref: "README.md" }] },
      opencode: { level: "yes", notes: "Install script + multiple package-manager distributions; desktop releases.", evidence: [{ kind: "note", ref: "sst/opencode README (dev)" }] },
      openclaw: { level: "partial", notes: "Primary distribution is npm + optional Docker/Nix; companion apps distributed separately.", evidence: [{ kind: "note", ref: "openclaw/openclaw README (main)" }] },
      pimono: { level: "no" },
    },
  },
]

export function getCatalog(): Feature[] {
  const order = new Map(CATEGORY_ORDER.map((c, i) => [c, i]))
  return [...FEATURE_CATALOG].sort((a, b) => {
    const ao = order.get(a.category) ?? Number.MAX_SAFE_INTEGER
    const bo = order.get(b.category) ?? Number.MAX_SAFE_INTEGER
    if (ao !== bo) return ao - bo
    const as = a.sort ?? 0
    const bs = b.sort ?? 0
    if (as !== bs) return as - bs
    return a.label.localeCompare(b.label)
  })
}

