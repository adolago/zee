#!/usr/bin/env bun
/**
 * stanley-gui CLI
 *
 * Launch Stanley's GPUI-based desktop application.
 *
 * Usage:
 *   bun run stanley-gui.ts          # Launch GUI (starts backend if needed)
 *   bun run stanley-gui.ts --no-backend  # Launch GUI only
 *   bun run stanley-gui.ts build    # Rebuild the GUI
 */

import { spawn, execSync } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const STANLEY_REPO =
  process.env.STANLEY_REPO ?? join(homedir(), ".local/src/agent-core/vendor/personas/stanley");
const GUI_DIR = join(STANLEY_REPO, "stanley-gui");
const GUI_BINARY = join(GUI_DIR, "target/release/stanley-gui");
const BACKEND_PORT = 8000;

function isBackendRunning(): boolean {
  try {
    execSync(`lsof -i:${BACKEND_PORT} -t`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function startBackend(): void {
  console.log("Starting Stanley Python backend on port", BACKEND_PORT);
  const venvPython = join(STANLEY_REPO, ".venv/bin/python");
  const python = existsSync(venvPython)
    ? venvPython
    : process.env.STANLEY_PYTHON ?? "python3";

  const backend = spawn(
    python,
    ["-m", "uvicorn", "api.main:app", "--port", String(BACKEND_PORT)],
    {
      cwd: STANLEY_REPO,
      stdio: "inherit",
      detached: true,
    }
  );
  backend.unref();

  // Give backend time to start
  console.log("Waiting for backend to initialize...");
  execSync("sleep 2");
}

async function buildGui(): Promise<void> {
  console.log("Building Stanley GUI...");
  execSync("cargo build --release", {
    cwd: GUI_DIR,
    stdio: "inherit",
  });
  console.log("Build complete:", GUI_BINARY);
}

async function launchGui(): Promise<void> {
  if (!existsSync(GUI_BINARY)) {
    console.error("GUI binary not found. Building...");
    await buildGui();
  }

  console.log("Launching Stanley GUI...");
  const gui = spawn(GUI_BINARY, [], {
    cwd: GUI_DIR,
    stdio: "inherit",
    detached: true,
    env: {
      ...process.env,
      STANLEY_API_URL: `http://localhost:${BACKEND_PORT}`,
    },
  });
  gui.unref();
}

async function run() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case "build":
      await buildGui();
      break;

    case "--help":
    case "-h":
      console.log(`
stanley-gui - Launch Stanley's desktop application

Usage:
  npx tsx stanley-gui.ts              Launch GUI (starts backend if needed)
  npx tsx stanley-gui.ts --no-backend Launch GUI only (backend must be running)
  npx tsx stanley-gui.ts build        Rebuild the GUI from source

Environment:
  STANLEY_REPO    Path to Stanley repository (default: ~/.local/src/agent-core/vendor/personas/stanley)
  STANLEY_PYTHON  Python interpreter (default: .venv/bin/python or python3)
`);
      break;

    default: {
      const noBackend = args.includes("--no-backend");

      if (!noBackend && !isBackendRunning()) {
        startBackend();
      } else if (!noBackend) {
        console.log("Backend already running on port", BACKEND_PORT);
      }

      await launchGui();
      console.log("Stanley GUI launched.");
    }
  }
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
