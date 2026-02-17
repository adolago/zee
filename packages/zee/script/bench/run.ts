#!/usr/bin/env bun
import fs from "node:fs"
import path from "node:path"
import { createMemoryBenchContext } from "./memory"
import type { BenchCase, BenchContext, BenchResult, BenchRunOptions } from "./types"
import { bench as memoryKeyword } from "./memory_keyword.bench"
import { bench as memorySemantic } from "./memory_vector.bench"
import { bench as memoryHybrid } from "./memory_hybrid.bench"
import { bench as inferenceOpenAICompat } from "./inference_openai_compat.bench"

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string
    if (!a.startsWith("--")) continue

    const eq = a.indexOf("=")
    if (eq !== -1) {
      const k = a.slice(2, eq)
      const v = a.slice(eq + 1)
      out[k] = v
      continue
    }

    const k = a.slice(2)
    const next = argv[i + 1]
    if (next && !String(next).startsWith("--")) {
      out[k] = String(next)
      i++
    } else {
      out[k] = true
    }
  }
  return out
}

function toInt(v: unknown, fallback: number): number {
  const n = typeof v === "string" ? Number.parseInt(v, 10) : typeof v === "number" ? v : NaN
  return Number.isFinite(n) ? n : fallback
}

function git(repoRoot: string, args: string[]): string | null {
  const proc = Bun.spawnSync(["git", ...args], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  })
  if (proc.exitCode !== 0) return null
  return new TextDecoder().decode(proc.stdout).trim()
}

async function runBench(bench: BenchCase, ctx: BenchContext, opts: BenchRunOptions): Promise<BenchResult> {
  try {
    return await bench.run(ctx, opts)
  } catch (e) {
    return {
      id: bench.id,
      name: bench.name,
      group: bench.group,
      status: "error",
      error: e instanceof Error ? (e.stack ?? e.message) : String(e),
    }
  }
}

async function main() {
  // Benchmarks should not modify ~/.config/zee (or other config dirs) by installing plugins/deps.
  // If you intentionally want that behavior, set ZEE_DISABLE_CONFIG_DEPENDENCY_INSTALL=0.
  process.env.ZEE_DISABLE_CONFIG_DEPENDENCY_INSTALL ??= "1"

  const args = parseArgs(process.argv.slice(2))

  const opts: BenchRunOptions = {
    durationSeconds: Math.max(1, toInt(args.durationSeconds, 10)),
    seedCount: Math.max(0, toInt(args.seedCount, 500)),
    concurrency: Math.max(1, toInt(args.concurrency, 5)),
  }

  const repoRoot = path.resolve(import.meta.dir, "../../../../")
  const commit = git(repoRoot, ["rev-parse", "HEAD"])
  const branch = git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"])
  const status = git(repoRoot, ["status", "--porcelain"])
  const dirty = status ? status.length > 0 : null

  const outputDir = path.resolve(process.cwd(), "output", "bench")
  fs.mkdirSync(outputDir, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, "-")
  const outputFile = path.join(outputDir, `${ts}.json`)

  const results: BenchResult[] = []
  let memoryCtx: Awaited<ReturnType<typeof createMemoryBenchContext>>["ctx"] | null = null

  try {
    const created = await createMemoryBenchContext({
      seedCount: opts.seedCount,
      concurrency: opts.concurrency,
    })
    memoryCtx = created.ctx

    const benchCtx: BenchContext = { memory: memoryCtx }
    const memoryBenches: BenchCase[] = [memoryKeyword, memorySemantic, memoryHybrid]

    if (!memoryCtx && created.skipReason) {
      for (const b of memoryBenches) {
        results.push({
          id: b.id,
          name: b.name,
          group: b.group,
          status: "skipped",
          reason: created.skipReason,
        })
      }
    } else {
      for (const b of memoryBenches) {
        results.push(await runBench(b, benchCtx, opts))
      }
    }

    if (memoryCtx) {
      await memoryCtx.cleanup()
      benchCtx.memory = null
      memoryCtx = null
    }

    results.push(await runBench(inferenceOpenAICompat, { memory: null }, opts))
  } finally {
    if (memoryCtx) {
      await memoryCtx.cleanup()
    }
  }

  const report = {
    tool: "zee benchmark",
    generatedAt: new Date().toISOString(),
    git: { commit, branch, dirty },
    options: opts,
    environment: {
      platform: process.platform,
      arch: process.arch,
      bun: process.versions.bun,
      node: process.versions.node,
    },
    results,
  }

  fs.writeFileSync(outputFile, JSON.stringify(report, null, 2))
  // Explicit exit: Provider/Config can leave handles open.
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
