import { cmd } from "./cmd"
import { UI } from "../ui"
import { Global } from "../../global"
import path from "path"
import fs from "fs"
import { Log } from "../../util/log"
import * as prompts from "@clack/prompts"

type SetupProfile = "assistant" | "engine"

type SetupArgs = {
  profile?: SetupProfile
  "skip-profile"?: boolean
}

function buildOnboardingProfileConfig(profile: SetupProfile) {
  const secureControlUiAuth = {
    required: true,
    mode: "token",
    allowPasswordOnly: false,
    allowInsecureHttp: false,
  } as const

  if (profile === "assistant") {
    return {
      $schema: "zee",
      profile,
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
    profile,
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

  UI.success(`Onboarding profile '${profile}' written to ${configPath}`)
  if (profile === "assistant") {
    UI.info("Assistant mode applied secure single-user defaults and disabled messaging channels by default.")
  } else {
    UI.info("Engine mode applied secure defaults while preserving advanced multi-domain flexibility.")
  }
  UI.info("Mode tradeoffs: docs/architecture/assistant-mode.md")
  return true
}

export const SetupCommand = cmd({
  command: "setup",
  describe: "prepare onboarding profile and local environment (Docker, Qdrant)",
  builder: (yargs) =>
    yargs
      .option("profile", {
        type: "string",
        choices: ["assistant", "engine"],
        describe: "onboarding profile preset for first-time setup",
      })
      .option("skip-profile", {
        type: "boolean",
        default: false,
        describe: "skip onboarding profile prompt/write",
      }),
  async handler(args) {
    const typedArgs = args as SetupArgs
    UI.header("Zee Setup")

    const onboardingApplied = await maybeApplyOnboardingProfile(typedArgs)
    if (!onboardingApplied) return

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

    UI.success("Setup complete. You can now run 'zee daemon'.")
  },
})
