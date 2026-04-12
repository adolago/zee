import { cmd } from "./cmd"
import { UI } from "../ui"
import { Global } from "../../global"
import path from "path"
import fs from "fs"
import * as prompts from "@clack/prompts"
import { ensureManagedOpenBBDirectories, type OpenBBRuntimeConfigLike } from "../../openbb/runtime"
import { OpenBB } from "../../paths"
import { Config } from "../../config/config"
import { runOnboard } from "./onboard"
import { prepareLocalMemory } from "../../../../../src/memory/local-runtime"
import { checkAgentProviderReady } from "../setup-check"

type SetupProfile = "assistant" | "engine" | "investment-research" | "dcm"

type SetupArgs = {
  profile?: SetupProfile
  "skip-profile"?: boolean
  "skip-openbb"?: boolean
  "skip-provider-check"?: boolean
  services?: boolean
}

function buildOnboardingProfileConfig(profile: SetupProfile) {
  const runtimeProfile = profile === "engine" ? "engine" : "assistant"
  const secureControlUiAuth = {
    required: true,
    mode: "token",
    allowPasswordOnly: false,
    allowInsecureHttp: false,
  } as const

  if (runtimeProfile === "assistant") {
    return {
      $schema: "zee",
      profile: runtimeProfile,
      server: {
        hostname: "127.0.0.1",
      },
      gateway: {
        controlUi: {
          auth: secureControlUiAuth,
        },
      },
      experimental: {
        surfaces: {
          cli: { enabled: true },
          whatsapp: { enabled: false },
          telegram: { enabled: false },
        },
      },
      memory: {
        required: false,
        backend: "sqlite",
        embedding: {
          provider: "local",
        },
        localIndex: {
          enabled: true,
          backend: "sqlite-fts",
          degradedRead: "keyword_only",
        },
      },
    }
  }

  return {
    $schema: "zee",
    profile: runtimeProfile,
    server: {
      hostname: "127.0.0.1",
    },
    gateway: {
      controlUi: {
        auth: secureControlUiAuth,
      },
    },
  }
}

async function maybeApplyOnboardingProfile(args: SetupArgs): Promise<boolean> {
  if (args["skip-profile"]) return true

  const configPath = path.join(Global.Path.config, "zee.jsonc")
  if (fs.existsSync(configPath)) {
    if (args.profile) {
      UI.warn(`Config already exists at ${configPath}; keeping existing profile settings.`)
    } else {
      UI.info(`Existing config detected at ${configPath}; skipping onboarding profile prompt.`)
    }
    return true
  }

  let profile = args.profile
  if (!profile) {
    const selected = await prompts.select({
      message: "Choose onboarding profile",
      options: [
        {
          value: "assistant",
          label: "Assistant mode",
          hint: "single-user defaults, channel-first safety posture",
        },
        {
          value: "engine",
          label: "Engine mode",
          hint: "full multi-domain flexibility and advanced workflows",
        },
      ],
      initialValue: "assistant",
    })
    if (prompts.isCancel(selected)) {
      UI.warn("Setup cancelled during onboarding profile selection.")
      process.exitCode = 1
      return false
    }
    profile = selected as SetupProfile
  }

  fs.mkdirSync(Global.Path.config, { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(buildOnboardingProfileConfig(profile), null, 2) + "\n")

  const runtimeProfile = profile === "engine" ? "engine" : "assistant"
  UI.success(`Onboarding profile '${runtimeProfile}' written to ${configPath}`)
  if (runtimeProfile === "assistant") {
    UI.info("Assistant mode applied secure single-user defaults and disabled messaging channels by default.")
  } else {
    UI.info("Engine mode applied secure defaults while preserving advanced multi-domain flexibility.")
  }
  UI.info("Mode tradeoffs: docs/architecture/assistant-mode.md")
  return true
}

async function ensureAgentProviderReady(args: SetupArgs): Promise<boolean> {
  if (args["skip-provider-check"]) return true

  const provider = await checkAgentProviderReady()
  if (provider.available) {
    UI.success(`LLM provider ready: ${provider.providerId} (${provider.source})`)
    return true
  }

  UI.error("No usable LLM provider is configured for agent runs.")
  UI.info(provider.action ?? "Run `zee auth login <provider>` and rerun `zee setup`.")
  process.exitCode = 1
  return false
}

export const SetupCommand = cmd({
  command: "setup",
  describe: "run onboarding and prepare Zee's local runtime",
  builder: (yargs) =>
    yargs
      .option("profile", {
        type: "string",
        choices: ["assistant", "engine", "investment-research", "dcm"],
        describe: "onboarding profile preset for first-time setup",
      })
      .option("skip-profile", {
        type: "boolean",
        default: false,
        describe: "skip onboarding profile prompt/write",
      })
      .option("skip-openbb", {
        type: "boolean",
        default: false,
        describe: "skip managed OpenBB install/setup",
      })
      .option("skip-provider-check", {
        type: "boolean",
        default: false,
        describe: "skip the final LLM provider readiness check",
      })
      .option("services", {
        type: "boolean",
        default: false,
        describe: "also prepare managed OpenBB when no remote OpenBB API is configured",
      }),
  async handler(args) {
    const typedArgs = args as SetupArgs
    UI.header("Zee Setup")

    UI.info("Preparing local memory runtime...")
    const memoryStatus = await prepareLocalMemory()
    if (!memoryStatus.ok) {
      UI.error(memoryStatus.sqlite.error || memoryStatus.embedding.error || "Local memory preparation failed.")
      process.exitCode = 1
      return
    }
    UI.success(`Local memory is ready at ${memoryStatus.paths.memoryDir}`)

    if (!typedArgs.services) {
      if (typedArgs.profile === "assistant" || typedArgs.profile === "engine") {
        const onboardingApplied = await maybeApplyOnboardingProfile(typedArgs)
        if (!onboardingApplied) return
        if (!(await ensureAgentProviderReady(typedArgs))) return
        UI.info("Run `zee onboard --profile dcm` when you want finance workspace files and OpenBB provider setup.")
        return
      }

      const financeProfile =
        typedArgs.profile === "investment-research" || typedArgs.profile === "dcm" ? typedArgs.profile : undefined
      const result = await runOnboard({
        profile: financeProfile,
        "openbb-mode": "degraded",
        "non-interactive": Boolean(financeProfile),
      })
      UI.success(`Onboarding complete: ${result.profile}`)
      UI.info(`Config: ${result.configPath}`)
      UI.info(`Workspace: ${result.workspace}`)
      if (!(await ensureAgentProviderReady(typedArgs))) return
      UI.info("Run `zee setup --services` only if you want managed OpenBB on this machine.")
      return
    }

    const onboardingApplied = await maybeApplyOnboardingProfile(typedArgs)
    if (!onboardingApplied) return
    const config = await Config.get().catch(() => undefined)
    const openbbConfig = config?.openbb
    const hasConfiguredRemoteOpenBB = Boolean(openbbConfig?.apiUrl?.trim()) || OpenBB.apiUrlOverridden()

    if (!(typedArgs["skip-openbb"] || hasConfiguredRemoteOpenBB)) {
      UI.info("Preparing managed OpenBB runtime...")
      const openbbReady = await installManagedOpenBB(openbbConfig)
      if (!openbbReady) {
        UI.warn(
          "OpenBB setup did not complete. Zee can still run, but investing features and Workspace copilot will stay degraded until OpenBB is installed.",
        )
      }
    } else if (hasConfiguredRemoteOpenBB) {
      UI.info(
        `Skipping managed OpenBB install because a remote OpenBB API is configured at ${openbbConfig?.apiUrl || OpenBB.apiUrl()}`,
      )
    }

    if (!(await ensureAgentProviderReady(typedArgs))) return
    UI.success("Setup complete. You can now run 'zee daemon'.")
  },
})

async function installManagedOpenBB(config?: OpenBBRuntimeConfigLike): Promise<boolean> {
  const resolution = await ensureManagedOpenBBDirectories(config)
  const uv = Bun.which("uv")
  const existingManagedRuntime = fs.existsSync(resolution.managedApiCommandPath)
  if (!uv) {
    if (existingManagedRuntime) {
      UI.info(`Using existing managed OpenBB runtime at ${resolution.installDir}`)
      return true
    }
    UI.warn("`uv` is not installed, so Zee cannot provision the managed OpenBB runtime automatically.")
    UI.info("Install uv from https://docs.astral.sh/uv/ and rerun `zee setup`.")
    return false
  }

  const commands: Array<{ label: string; cmd: string[] }> = []
  if (!fs.existsSync(resolution.managedPythonPath)) {
    commands.push({
      label: "Creating OpenBB Python 3.12 environment",
      cmd: [uv, "venv", "--python", "3.12", resolution.venvDir],
    })
  } else {
    UI.info(`Using existing managed OpenBB environment at ${resolution.venvDir}`)
  }

  commands.push({
    label: "Installing OpenBB packages",
    cmd: [uv, "pip", "install", "--python", resolution.managedPythonPath, "openbb", "openbb-platform-api"],
  })

  for (const step of commands) {
    UI.info(step.label)
    const proc = Bun.spawn(step.cmd, {
      stdout: "inherit",
      stderr: "inherit",
      stdin: "ignore",
      env: {
        ...process.env,
        PYTHONUNBUFFERED: process.env.PYTHONUNBUFFERED || "1",
      },
    })
    const exitCode = await proc.exited
    if (exitCode !== 0) {
      UI.error(`Failed while running: ${step.cmd.join(" ")}`)
      return false
    }
  }

  if (fs.existsSync(OpenBB.managedBuildCommandPath())) {
    UI.info("Refreshing OpenBB extension build")
    const buildProc = Bun.spawn([OpenBB.managedBuildCommandPath()], {
      stdout: "inherit",
      stderr: "inherit",
      stdin: "ignore",
      env: {
        ...process.env,
        PYTHONUNBUFFERED: process.env.PYTHONUNBUFFERED || "1",
      },
    })
    const buildExitCode = await buildProc.exited
    if (buildExitCode !== 0) {
      UI.error(`Failed while running: ${OpenBB.managedBuildCommandPath()}`)
      return false
    }
  }

  UI.success(`Managed OpenBB runtime is ready at ${resolution.installDir}`)
  return true
}
