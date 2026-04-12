import fs from "node:fs/promises"
import fsSync from "node:fs"
import path from "node:path"
import * as prompts from "@clack/prompts"
import { applyEdits, modify } from "jsonc-parser"
import { Global } from "../../global"
import { OPENBB_FREE_PROVIDERS, providersRequiringCredentials } from "../../openbb/free-providers"
import { cmd } from "./cmd"
import { runAuthAcquire } from "./auth-acquire"
import { prepareLocalMemory } from "../../../../../src/memory/local-runtime"

type FinanceProfile = "investment-research" | "dcm"

type OnboardArgs = {
  profile?: FinanceProfile
  role?: string
  region?: string
  coverage?: string
  "asset-class"?: string
  compliance?: string
  "openbb-mode"?: "remote" | "managed" | "degraded"
  "acquire-keys"?: boolean
  "dry-run"?: boolean
  json?: boolean
  "non-interactive"?: boolean
}

type SeedResult = {
  path: string
  action: "created" | "exists" | "would-create"
}

type OnboardResult = {
  profile: FinanceProfile
  configPath: string
  configWritten: boolean
  workspace: string
  seeded: SeedResult[]
  providerIds: string[]
  next: string[]
}

const PROFILE_DEFAULTS: Record<FinanceProfile, { role: string; coverage: string; assetClass: string }> = {
  "investment-research": {
    role: "Investment research analyst",
    coverage: "public equities, macro data, issuer filings, market news",
    assetClass: "equity, credit, rates, macro",
  },
  dcm: {
    role: "Debt Capital Markets professional",
    coverage: "issuers, comps, credit spreads, rates, new issues, covenants",
    assetClass: "investment grade credit, high yield, loans, rates",
  },
}

function splitCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function fileContent(
  name: string,
  context: Required<Pick<OnboardArgs, "role" | "region" | "coverage">> & {
    profile: FinanceProfile
    assetClass: string
    compliance: string
  },
): string {
  switch (name) {
    case "USER.md":
      return [
        "# User",
        "",
        `Role: ${context.role}`,
        `Region: ${context.region}`,
        `Coverage: ${context.coverage}`,
        `Asset classes: ${context.assetClass}`,
        `Compliance posture: ${context.compliance}`,
        "",
      ].join("\n")
    case "IDENTITY.md":
      return [
        "# Zee Identity",
        "",
        "Zee is a lightweight research operating system for the user's work.",
        "It starts with local memory and only enables external data services when configured.",
        "",
      ].join("\n")
    case "SOUL.md":
      return [
        "# Soul",
        "",
        "- Prefer concise, source-aware research notes.",
        "- Separate facts, assumptions, estimates, and opinions.",
        "- Treat confidential deal, issuer, client, and employer context as private.",
        "- Do not imply investment advice without clear user intent and appropriate sourcing.",
        "",
      ].join("\n")
    case "MEMORY.md":
      return [
        "# Long-Term Memory",
        "",
        "Curated durable facts, preferences, decisions, and research context belong here.",
        "",
        "## Research Operating Preferences",
        "",
        `- Active profile: ${context.profile}`,
        `- Role: ${context.role}`,
        `- Region: ${context.region}`,
        "",
      ].join("\n")
    case "AGENTS.md":
      return [
        "# Zee Workspace Instructions",
        "",
        "- Use this workspace as the private, human-readable memory surface.",
        "- Save durable facts to MEMORY.md and daily observations to memory/YYYY-MM-DD.md.",
        "- For finance work, cite source URLs or provider names whenever possible.",
        "- Prefer free/public data providers unless the user explicitly configures a paid provider.",
        "",
      ].join("\n")
    case "TOOLS.md":
      return [
        "# Tools",
        "",
        "- OpenBB is optional and may be remote or locally managed.",
        "- Free provider credentials can be configured with `zee auth acquire`.",
        "- Browser acquisition opens provider pages and saves only keys captured during an opted-in flow.",
        "",
      ].join("\n")
    case "research/README.md":
      return [
        "# Research",
        "",
        "Use this folder for issuer notes, market snapshots, watchlists, and credential acquisition reports.",
        "",
      ].join("\n")
    default:
      return ""
  }
}

async function seedFile(relativePath: string, content: string, dryRun: boolean): Promise<SeedResult> {
  const filePath = path.join(Global.Path.workspace, relativePath)
  if (fsSync.existsSync(filePath)) return { path: filePath, action: "exists" }
  if (dryRun) return { path: filePath, action: "would-create" }
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, "utf-8")
  return { path: filePath, action: "created" }
}

async function writeOnboardConfig(
  input: Required<Pick<OnboardArgs, "role" | "region" | "coverage">> & {
    profile: FinanceProfile
    assetClass: string
    compliance: string
    openbbMode: "remote" | "managed" | "degraded"
    providerIds: string[]
    dryRun: boolean
  },
): Promise<{ path: string; written: boolean }> {
  const configPath = path.join(Global.Path.config, "zee.jsonc")
  const file = Bun.file(configPath)
  let text = "{}"
  if (await file.exists()) text = await file.text()
  const formattingOptions = { tabSize: 2, insertSpaces: true }
  const updates: Array<{ path: (string | number)[]; value: unknown }> = [
    { path: ["$schema"], value: "zee" },
    { path: ["profile"], value: "assistant" },
    { path: ["server", "hostname"], value: "127.0.0.1" },
    { path: ["memory", "backend"], value: "sqlite" },
    { path: ["memory", "required"], value: false },
    { path: ["memory", "embedding", "provider"], value: "local" },
    { path: ["memory", "localIndex", "enabled"], value: true },
    { path: ["memory", "localIndex", "backend"], value: "sqlite-fts" },
    { path: ["memory", "localIndex", "degradedRead"], value: "keyword_only" },
    { path: ["openbb", "autoStart"], value: input.openbbMode === "managed" },
    { path: ["onboarding", "profile"], value: input.profile },
    { path: ["onboarding", "role"], value: input.role },
    { path: ["onboarding", "region"], value: input.region },
    { path: ["onboarding", "coverage"], value: splitCsv(input.coverage) },
    { path: ["onboarding", "assetClass"], value: splitCsv(input.assetClass) },
    { path: ["onboarding", "compliance"], value: input.compliance },
    { path: ["onboarding", "openbbMode"], value: input.openbbMode },
    { path: ["onboarding", "freeProviderIds"], value: input.providerIds },
  ]
  for (const update of updates) {
    text = applyEdits(text, modify(text, update.path, update.value, { formattingOptions }))
  }
  if (input.dryRun) return { path: configPath, written: false }
  await fs.mkdir(path.dirname(configPath), { recursive: true })
  await fs.writeFile(configPath, text.endsWith("\n") ? text : `${text}\n`, "utf-8")
  return { path: configPath, written: true }
}

async function resolveProfile(args: OnboardArgs): Promise<FinanceProfile> {
  if (args.profile) return args.profile
  if (args["non-interactive"] || args.json) return "dcm"
  const selected = await prompts.select({
    message: "Choose finance profile",
    options: [
      { label: "Debt Capital Markets", value: "dcm", hint: "issuers, spreads, rates, new issues" },
      { label: "Investment Research", value: "investment-research", hint: "markets, issuers, filings, macro" },
    ],
    initialValue: "dcm",
  })
  if (prompts.isCancel(selected)) throw new Error("Cancelled")
  return selected as FinanceProfile
}

async function resolveText(
  args: OnboardArgs,
  key: "role" | "region" | "coverage",
  initialValue: string,
): Promise<string> {
  const direct = args[key]
  if (direct) return direct
  if (args["non-interactive"] || args.json) return initialValue
  const answer = await prompts.text({
    message: key === "role" ? "Role" : key === "region" ? "Region" : "Coverage",
    initialValue,
  })
  if (prompts.isCancel(answer)) throw new Error("Cancelled")
  return String(answer || initialValue)
}

export async function runOnboard(args: OnboardArgs): Promise<OnboardResult> {
  const profile = await resolveProfile(args)
  const defaults = PROFILE_DEFAULTS[profile]
  const role = await resolveText(args, "role", defaults.role)
  const region = await resolveText(args, "region", "US, EU")
  const coverage = await resolveText(args, "coverage", defaults.coverage)
  const assetClass = args["asset-class"] ?? defaults.assetClass
  const compliance = args.compliance ?? "private workspace; no client/deal secrets in provider prompts"
  const openbbMode = args["openbb-mode"] ?? "degraded"
  const providerIds = OPENBB_FREE_PROVIDERS.map((provider) => provider.id)
  const context = { profile, role, region, coverage, assetClass, compliance }
  const files = ["AGENTS.md", "USER.md", "IDENTITY.md", "SOUL.md", "TOOLS.md", "MEMORY.md", "research/README.md"]
  const seeded = []
  for (const file of files) {
    seeded.push(await seedFile(file, fileContent(file, context), Boolean(args["dry-run"])))
  }
  const config = await writeOnboardConfig({
    profile,
    role,
    region,
    coverage,
    assetClass,
    compliance,
    openbbMode,
    providerIds,
    dryRun: Boolean(args["dry-run"]),
  })
  if (!args["dry-run"]) {
    await prepareLocalMemory()
  }

  return {
    profile,
    configPath: config.path,
    configWritten: config.written,
    workspace: Global.Path.workspace,
    seeded,
    providerIds,
    next: [
      "Run `zee` to start the CLI/TUI.",
      "Run `zee auth acquire --free-only` to configure free OpenBB provider keys.",
      `Credential-backed free providers: ${providersRequiringCredentials()
        .map((provider) => provider.id)
        .join(", ")}`,
    ],
  }
}

export const OnboardCommand = cmd({
  command: "onboard",
  describe: "lightweight identity, memory, and finance onboarding",
  builder: (yargs) =>
    yargs
      .option("profile", {
        type: "string",
        choices: ["investment-research", "dcm"],
        describe: "Finance profile pack",
      })
      .option("role", { type: "string" })
      .option("region", { type: "string" })
      .option("coverage", { type: "string", describe: "Comma-separated coverage areas" })
      .option("asset-class", { type: "string", describe: "Comma-separated asset classes" })
      .option("compliance", { type: "string" })
      .option("openbb-mode", {
        type: "string",
        choices: ["remote", "managed", "degraded"],
        default: "degraded",
      })
      .option("acquire-keys", { type: "boolean", default: false })
      .option("dry-run", { type: "boolean", default: false })
      .option("json", { type: "boolean", default: false })
      .option("non-interactive", { type: "boolean", default: false }),
  async handler(args) {
    const result = await runOnboard(args as OnboardArgs)
    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    prompts.log.success(`Onboarded ${result.profile} profile`)
    prompts.log.info(`Config: ${result.configPath}`)
    prompts.log.info(`Workspace: ${result.workspace}`)
    for (const item of result.next) prompts.log.info(item)

    const acquireKeys = Boolean(args["acquire-keys"] ?? args.acquireKeys)
    const dryRun = Boolean(args["dry-run"] ?? args.dryRun)
    if (acquireKeys && !dryRun) {
      await runAuthAcquire({ "free-only": true, openbb: true })
    }
  },
})
