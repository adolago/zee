import { cmd } from "./cmd"
import { UI } from "../ui"
import { Global } from "../../global"
import path from "path"
import fs from "fs"
import { Log } from "../../util/log"

export const SetupCommand = cmd({
  command: "setup",
  describe: "prepare the environment (Docker, Qdrant)",
  async handler() {
    UI.header("Agent-Core Setup")

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
    container_name: agent-core-qdrant
    restart: always
    ports:
      - "6333:6333"
    volumes:
      - \${HOME}/.local/share/agent-core/qdrant:/qdrant/storage
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
        stderr: "inherit"
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
        UI.warn("Qdrant started but health check timed out. It might still be initializing.")
    }

    UI.success("Setup complete. You can now run 'agent-core daemon'.")
  },
})
