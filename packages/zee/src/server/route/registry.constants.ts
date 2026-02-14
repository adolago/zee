// Local copy of registry values used by server routes to avoid external file deps in CI.
export const LOBSTER_PALETTE = {
  accent: "#FF5A2D",
  accentBright: "#FF7A3D",
  accentDim: "#D14A22",
  info: "#FF8A5B",
  success: "#2FBF71",
  warn: "#FFB020",
  error: "#E23D2D",
  muted: "#8B7F77",
} as const

export const PROVIDERS = {
  anthropic: { label: "Anthropic", icon: "anthropic" },
  openai: { label: "OpenAI", icon: "openai" },
  google: { label: "Google", icon: "google" },
  "github-copilot": { label: "GitHub Copilot", icon: "github-copilot" },
  "amazon-bedrock": { label: "Amazon Bedrock", icon: "amazon-bedrock" },
  openrouter: { label: "OpenRouter", icon: "openrouter" },
  "openai-compatible": { label: "OpenAI Compatible", icon: "openai" },
  opencode: { label: "Opencode", icon: "opencode" },
  "agent-core": { label: "Agent-Core", icon: "opencode" },
} as const

export const SKILL_FRONTMATTER_REQUIRED_KEYS = ["name", "description"] as const

export const SKILL_FRONTMATTER_COMMON_OPTIONAL_KEYS = [
  "homepage",
  "tags",
  "triggers",
  "requires",
  "primaryEnv",
  "version",
  "category",
  "author",
  "source",
  "metadata",
] as const
