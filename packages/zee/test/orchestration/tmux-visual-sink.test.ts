import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  TmuxVisualOrchestrationSink,
  type TmuxCommandRunner,
} from "@root/orchestration-visual"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
})

describe("TmuxVisualOrchestrationSink", () => {
  test("uses isolated defaults that do not overlap tmux skill socket convention", () => {
    const sink = new TmuxVisualOrchestrationSink()
    expect(sink.socketPath).toContain("/zee/orchestration/tmux/")
    expect(sink.socketPath).not.toContain("clawdbot-tmux-sockets")
    expect(sink.sessionName.startsWith("zee-orch-")).toBe(true)
  })

  test("silently disables when tmux is unavailable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zee-tmux-visual-unavailable-"))
    tempDirs.push(dir)

    const commands: string[][] = []
    const runner: TmuxCommandRunner = async (args) => {
      commands.push(args)
      return { code: 1, stdout: "", stderr: "tmux missing" }
    }

    const sink = new TmuxVisualOrchestrationSink({
      baseDir: dir,
      commandRunner: runner,
    })

    await sink.emit({
      type: "task_started",
      timestamp: Date.now(),
      swarmId: "swarm-1",
      taskId: "task-1",
      workerId: "worker-1",
    })

    expect(commands).toHaveLength(1)
    expect(commands[0]).toEqual(["-V"])
  })

  test("creates isolated session and worker pane with a custom socket", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zee-tmux-visual-"))
    tempDirs.push(dir)
    const socketPath = join(dir, "sock", "visual.sock")
    const sessionName = "zee-orch-test"

    const commands: string[][] = []
    let sessionExists = false

    const runner: TmuxCommandRunner = async (args) => {
      commands.push(args)
      if (args[0] === "-V") return { code: 0, stdout: "tmux 3.4", stderr: "" }

      if (args.includes("has-session")) {
        return { code: sessionExists ? 0 : 1, stdout: "", stderr: "" }
      }
      if (args.includes("new-session")) {
        sessionExists = true
        return { code: 0, stdout: "", stderr: "" }
      }
      if (args.includes("split-window")) {
        return { code: 0, stdout: "%5\n", stderr: "" }
      }
      if (args.includes("kill-session")) {
        sessionExists = false
        return { code: 0, stdout: "", stderr: "" }
      }
      return { code: 0, stdout: "", stderr: "" }
    }

    const sink = new TmuxVisualOrchestrationSink({
      baseDir: dir,
      socketPath,
      sessionName,
      commandRunner: runner,
      cleanupSessionOnClose: true,
    })

    await sink.emit({
      type: "worker_started",
      timestamp: Date.now(),
      swarmId: "swarm-1",
      workerId: "worker-1",
      details: { name: "w1" },
    })
    await sink.close()

    const joined = commands.map((c) => c.join(" ")).join("\n")
    expect(joined).toContain(`-S ${socketPath} has-session -t ${sessionName}`)
    expect(joined).toContain(`-S ${socketPath} new-session -d -s ${sessionName}`)
    expect(joined).toContain(`-S ${socketPath} split-window -t ${sessionName}:orchestration`)
    expect(joined).toContain(`-S ${socketPath} kill-session -t ${sessionName}`)
  })
})
