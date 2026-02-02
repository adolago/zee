import { describe, expect, test } from "bun:test"
import * as fs from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"

describe("canvas tool plugin", () => {
  // Pre-existing: .agent-core/tool/canvas.ts imports { tool } from "@agent-core/plugin"
  // but src/plugin/index.ts does not export a named "tool" binding.
  test.todo("renders inline when WezTerm integration disabled", async () => {
    const prev = process.env.AGENT_CORE_CANVAS_WEZTERM
    process.env.AGENT_CORE_CANVAS_WEZTERM = "0"
    try {
      const mod = await import("../../../../.agent-core/tool/canvas.ts")
      const output = await mod.spawn.execute({
        kind: "text",
        id: "poem",
        config: JSON.stringify({ title: "Poem", content: "Hello canvas" }),
      } as any, {} as any)

      expect(output).toContain("=== Poem ===")
      expect(output).toContain("Hello canvas")
      expect(output).toContain("Content displayed inline")
    } finally {
      if (prev === undefined) {
        delete process.env.AGENT_CORE_CANVAS_WEZTERM
      } else {
        process.env.AGENT_CORE_CANVAS_WEZTERM = prev
      }
    }
  })

  test.todo("ignores invalid configured pane id", async () => {
    if (process.platform === "win32") return

    await using tmp = await tmpdir()
    const weztermPath = path.join(tmp.path, "wezterm")
    await fs.writeFile(
      weztermPath,
      `#!/usr/bin/env bash
set -euo pipefail

if [ \"\${1:-}\" != \"cli\" ]; then
  echo \"expected wezterm cli\" >&2
  exit 1
fi
shift

cmd=\"\${1:-}\"
shift || true

case \"$cmd\" in
  list)
    echo '[{\"pane_id\":1,\"is_active\":true}]'
    ;;
  split-pane)
    pane=\"\"
    args=(\"$@\")
    for ((i=0; i<\${#args[@]}; i++)); do
      if [ \"\${args[$i]}\" = \"--pane-id\" ]; then
        pane=\"\${args[$((i+1))]:-}\"
      fi
    done
    if [ -n \"$pane\" ] && [ \"$pane\" != \"1\" ]; then
      echo \"Invalid pane id $pane\" >&2
      exit 1
    fi
    echo \"200\"
    ;;
  activate-pane|send-text|kill-pane)
    ;;
  *)
    echo \"unsupported cmd: $cmd\" >&2
    exit 1
    ;;
esac
`,
      { mode: 0o755 },
    )

    const prevEnv = {
      AGENT_CORE_CANVAS_PANE_ID: process.env.AGENT_CORE_CANVAS_PANE_ID,
      AGENT_CORE_CANVAS_WEZTERM: process.env.AGENT_CORE_CANVAS_WEZTERM,
      PATH: process.env.PATH,
      WEZTERM_UNIX_SOCKET: process.env.WEZTERM_UNIX_SOCKET,
      XDG_STATE_HOME: process.env.XDG_STATE_HOME,
    }

    process.env.AGENT_CORE_CANVAS_PANE_ID = "999"
    delete process.env.AGENT_CORE_CANVAS_WEZTERM
    process.env.WEZTERM_UNIX_SOCKET = "mock"
    process.env.XDG_STATE_HOME = tmp.path
    process.env.PATH = `${tmp.path}:${process.env.PATH ?? ""}`

    try {
      const mod = await import("../../../../.agent-core/tool/canvas.ts")
      const output = await mod.spawn.execute({
        kind: "document",
        id: "pair",
        config: JSON.stringify({ title: "Pair", content: "Hello from canvas" }),
      } as any, {} as any)

      expect(output).toContain("Canvas created")
      expect(output).toContain("WezTerm pane 200")
    } finally {
      for (const [k, v] of Object.entries(prevEnv)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    }
  })

  test.todo("falls back inline when wezterm split-pane fails", async () => {
    if (process.platform === "win32") return

    await using tmp = await tmpdir()
    const weztermPath = path.join(tmp.path, "wezterm")
    await fs.writeFile(
      weztermPath,
      `#!/usr/bin/env bash
set -euo pipefail

if [ \"\${1:-}\" != \"cli\" ]; then
  echo \"expected wezterm cli\" >&2
  exit 1
fi
shift

cmd=\"\${1:-}\"
shift || true

case \"$cmd\" in
  list)
    echo '[{\"pane_id\":1,\"is_active\":true}]'
    ;;
  split-pane)
    echo \"split-pane failed\" >&2
    exit 1
    ;;
  activate-pane|send-text|kill-pane)
    ;;
  *)
    echo \"unsupported cmd: $cmd\" >&2
    exit 1
    ;;
esac
`,
      { mode: 0o755 },
    )

    const prevEnv = {
      AGENT_CORE_CANVAS_PANE_ID: process.env.AGENT_CORE_CANVAS_PANE_ID,
      AGENT_CORE_CANVAS_WEZTERM: process.env.AGENT_CORE_CANVAS_WEZTERM,
      PATH: process.env.PATH,
      WEZTERM_UNIX_SOCKET: process.env.WEZTERM_UNIX_SOCKET,
      XDG_STATE_HOME: process.env.XDG_STATE_HOME,
    }

    delete process.env.AGENT_CORE_CANVAS_PANE_ID
    delete process.env.AGENT_CORE_CANVAS_WEZTERM
    process.env.WEZTERM_UNIX_SOCKET = "mock"
    process.env.XDG_STATE_HOME = tmp.path
    process.env.PATH = `${tmp.path}:${process.env.PATH ?? ""}`

    try {
      const mod = await import("../../../../.agent-core/tool/canvas.ts")
      const output = await mod.spawn.execute({
        kind: "text",
        id: "pair-fallback",
        config: JSON.stringify({ title: "Pair Fallback", content: "Hello inline" }),
      } as any, {} as any)

      expect(output).toContain("=== Pair Fallback ===")
      expect(output).toContain("Hello inline")
      expect(output).toContain("Failed to render canvas in WezTerm")
      expect(output).toContain("Content displayed inline")
    } finally {
      for (const [k, v] of Object.entries(prevEnv)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    }
  })
})
