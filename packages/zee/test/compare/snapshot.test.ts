import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { ExecRunner } from "@/compare/snapshot"
import { collectSnapshot } from "@/compare/snapshot"

describe("compare snapshot", () => {
  const makeExec = (): ExecRunner => async (cmd) => {
    const key = cmd.join(" ")
    const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: "" })
    const fail = (stderr: string) => ({ exitCode: 1, stdout: "", stderr })

    if (key === "git rev-parse --verify HEAD") return ok("zee-head-sha\n")

    if (key === "git remote get-url opencode") return ok("https://github.com/sst/opencode.git\n")
    if (key === "git remote get-url openclaw") return ok("https://github.com/openclaw/openclaw.git\n")
    if (key === "git remote get-url pimono") return ok("https://github.com/badlogic/pi-mono.git\n")

    if (key === "git fetch opencode --quiet") return ok("")
    if (key === "git fetch openclaw --quiet") return ok("")
    if (key === "git fetch pimono --quiet") return ok("")

    if (key === "git rev-parse --verify opencode/dev") return ok("opencode-sha\n")
    if (key === "git rev-parse --verify openclaw/main") return ok("openclaw-sha\n")
    if (key === "git rev-parse --verify pimono/main") return ok("pimono-sha\n")

    if (key === "git tag -l v0.* --sort=-v:refname") return ok("v0.52.9\nv0.52.8\n")
    if (key === "git merge-base --is-ancestor v0.52.9 pimono/main") return ok("")

    return fail("unknown command")
  }

  test("collects best-effort pins using an injected exec runner", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "zee-compare-"))
    await fs.mkdir(path.join(tmp, "packages", "zee", "Swabble"), { recursive: true })
    await fs.writeFile(
      path.join(tmp, "packages", "zee", "Swabble", "package.json"),
      JSON.stringify(
        {
          dependencies: {
            "@mariozechner/pi-coding-agent": "0.52.9",
          },
        },
        null,
        2,
      ),
      "utf-8",
    )

    const snapshot = await collectSnapshot({
      rootDir: tmp,
      exec: makeExec(),
      fetch: true,
      includeSkills: false,
      now: new Date("2026-02-12T00:00:00.000Z"),
    })

    expect(snapshot.generatedAt).toBe("2026-02-12T00:00:00.000Z")
    expect(snapshot.zee.gitSha).toBe("zee-head-sha")
    expect(snapshot.upstream.opencode?.head).toBe("opencode-sha")
    expect(snapshot.upstream.openclaw?.head).toBe("openclaw-sha")
    expect(snapshot.upstream.pimono?.head).toBe("pimono-sha")
    expect(snapshot.pimono.installedPiCodingAgentVersion).toBe("0.52.9")
    expect(snapshot.pimono.latestTag).toBe("v0.52.9")
  })

  test("falls back to packages/zee manifest for pi-mono dependency pin", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "zee-compare-"))
    await fs.mkdir(path.join(tmp, "packages", "zee"), { recursive: true })
    await fs.writeFile(
      path.join(tmp, "packages", "zee", "package.json"),
      JSON.stringify(
        {
          dependencies: {
            "@mariozechner/pi-coding-agent": "^0.53.1",
          },
        },
        null,
        2,
      ),
      "utf-8",
    )

    const snapshot = await collectSnapshot({
      rootDir: tmp,
      exec: makeExec(),
      fetch: true,
      includeSkills: false,
      now: new Date("2026-02-12T00:00:00.000Z"),
    })

    expect(snapshot.pimono.installedPiCodingAgentVersion).toBe("0.53.1")
    expect(
      snapshot.warnings.some((warning) => warning.includes("Installed pi-mono dependency pin not found")),
    ).toBe(false)
  })

  test("falls back to upstream-pins manifest for pi-mono dependency pin", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "zee-compare-"))
    await fs.mkdir(path.join(tmp, "docs", "architecture"), { recursive: true })
    await fs.writeFile(
      path.join(tmp, "docs", "architecture", "upstream-pins.json"),
      JSON.stringify(
        {
          pimono: {
            piCodingAgentVersion: "0.53.1",
          },
        },
        null,
        2,
      ),
      "utf-8",
    )

    const snapshot = await collectSnapshot({
      rootDir: tmp,
      exec: makeExec(),
      fetch: true,
      includeSkills: false,
      now: new Date("2026-02-12T00:00:00.000Z"),
    })

    expect(snapshot.pimono.installedPiCodingAgentVersion).toBe("0.53.1")
    expect(
      snapshot.warnings.some((warning) => warning.includes("Installed pi-mono dependency pin not found")),
    ).toBe(false)
  })

  test("emits warning when pi-mono dependency pin is not discoverable", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "zee-compare-"))

    const snapshot = await collectSnapshot({
      rootDir: tmp,
      exec: makeExec(),
      fetch: true,
      includeSkills: false,
      now: new Date("2026-02-12T00:00:00.000Z"),
    })

    expect(snapshot.pimono.installedPiCodingAgentVersion).toBeUndefined()
    expect(snapshot.warnings).toContain(
      "Installed pi-mono dependency pin not found in known manifests (packages/zee/Swabble/package.json, packages/zee/package.json, package.json, docs/architecture/upstream-pins.json).",
    )
  })
})
