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

type SetupProfile = "assistant" | "engine" | "investment-research" | "dcm"

type SetupArgs = {
  profile?: SetupProfile
  "skip-profile"?: boolean
  "skip-openbb"?: boolean
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

export const SetupCommand = cmd({
  command: "setup",
  describe: "run lightweight onboarding; use --services for local Qdrant/OpenBB setup",
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
      .option("services", {
        type: "boolean",
        default: false,
        describe: "run advanced local service setup for Qdrant and managed OpenBB",
      }),
  async handler(args) {
    const typedArgs = args as SetupArgs
    UI.header("Zee Setup")

    if (!typedArgs.services) {
      if (typedArgs.profile === "assistant" || typedArgs.profile === "engine") {
        const onboardingApplied = await maybeApplyOnboardingProfile(typedArgs)
        if (!onboardingApplied) return
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
      UI.info("Run `zee setup --services` only if you want local Qdrant/OpenBB services on this machine.")
      return
    }

    const onboardingApplied = await maybeApplyOnboardingProfile(typedArgs)
    if (!onboardingApplied) return
    const config = await Config.get().catch(() => undefined)
    const openbbConfig = config?.openbb
    const hasConfiguredRemoteOpenBB = Boolean(openbbConfig?.apiUrl?.trim()) || OpenBB.apiUrlOverridden()

    // 1. Check Docker
    UI.info("Checking Docker availability...")
    try {
      const dockerCheck = Bun.spawnSync(["docker", "info"])
      if (dockerCheck.exitCode !== 0) {
        UI.error("Docker is not running or not installed.")
        UI.info("Please install Docker Desktop or start the docker service.")
        return
      }
    } catch (e) {
      UI.error("Docker executable not found in PATH.")
      UI.info("Please install Docker: https://docs.docker.com/get-docker/")
      return
    }
    UI.success("Docker is running.")

    // 2. Locate docker-compose.yml
    // We expect it in the project root or Global.Path.source
    // Since this is running from compiled code potentially, we look in known locations or cwd
    const candidates = [
      path.join(process.cwd(), "docker-compose.yml"),
      path.join(Global.Path.source, "docker-compose.yml"),
      // If we are in the source tree:
      path.resolve(__dirname, "../../../../../docker-compose.yml"),
    ]

    let composeFile = candidates.find((p) => fs.existsSync(p))

    if (!composeFile) {
      // Fallback: Create it in current directory if not found
      UI.warn("docker-compose.yml not found. Creating a default one in current directory...")
      composeFile = path.join(process.cwd(), "docker-compose.yml")
      const content = `version: '3.8'

services:
  qdrant:
    image: qdrant/qdrant:latest
    container_name: zee-qdrant
    restart: always
    ports:
      - "6333:6333"
    volumes:
      - \${HOME}/.local/share/zee/qdrant:/qdrant/storage
    environment:
      - QDRANT__SERVICE__GRPC_PORT=6334
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:6333/healthz"]
      interval: 30s
      timeout: 10s
      retries: 3
`
      fs.writeFileSync(composeFile, content)
      UI.success(`Created ${composeFile}`)
    } else {
      UI.info(`Using ${composeFile}`)
    }

    // 3. Run Docker Compose
    UI.info("Starting services (Qdrant)...")
    const composeCmd = ["docker", "compose", "-f", composeFile, "up", "-d"]
    const proc = Bun.spawn(composeCmd, {
      stdout: "inherit",
      stderr: "inherit",
    })

    const exitCode = await proc.exited
    if (exitCode !== 0) {
      UI.error("Failed to start docker-compose.")
      return
    }

    // 4. Verify Health
    UI.info("Waiting for Qdrant health check...")
    let attempts = 0
    const maxAttempts = 10
    while (attempts < maxAttempts) {
      try {
        const resp = await fetch("http://localhost:6333/healthz")
        if (resp.ok) {
          UI.success("Qdrant is healthy and ready!")
          break
        }
      } catch (e) {
        // ignore
      }
      await Bun.sleep(2000)
      attempts++
      process.stdout.write(".")
    }

    if (attempts >= maxAttempts) {
      UI.error("Qdrant health check timed out. Setup is incomplete.")
      UI.info("Run `docker compose ps` and `docker compose logs qdrant` to diagnose startup.")
      process.exitCode = 1
      return
    }

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
