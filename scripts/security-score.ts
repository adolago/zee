#!/usr/bin/env bun

import { $ } from "bun"
import fs from "fs"
import path from "path"

const repoRoot = path.resolve(import.meta.dir, "..")

type CheckResult = {
  id: string
  description: string
  points: number
  status: "pass" | "fail" | "skip"
  detail?: string
}

function parseArgs(argv: string[]) {
  const args = new Map<string, string | boolean>()
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--min") {
      args.set("min", argv[i + 1] ?? "")
      i++
      continue
    }
    if (a === "--no-run") {
      args.set("no-run", true)
      continue
    }
  }
  const min = Number(args.get("min") ?? "90")
  const noRun = Boolean(args.get("no-run") ?? false)
  if (!Number.isFinite(min) || min < 0 || min > 100) {
    throw new Error(`invalid --min value: ${String(args.get("min"))}`)
  }
  return { min, noRun }
}

function exists(relPath: string): boolean {
  return fs.existsSync(path.join(repoRoot, relPath))
}

function readText(relPath: string): string {
  return fs.readFileSync(path.join(repoRoot, relPath), "utf-8")
}

function assertIncludes(haystack: string, needle: string): boolean {
  return haystack.includes(needle)
}

async function runCmd(
  cmd: string[],
  opts: { cwd?: string; noRun: boolean },
): Promise<{ ok: boolean; detail?: string }> {
  if (opts.noRun) return { ok: false, detail: "skipped (--no-run)" }
  try {
    await $`${cmd}`.cwd(opts.cwd ?? repoRoot)
    return { ok: true }
  } catch (e: any) {
    const msg = typeof e?.message === "string" ? e.message : String(e)
    return { ok: false, detail: msg }
  }
}

async function main() {
  const { min, noRun } = parseArgs(process.argv.slice(2))

  const results: CheckResult[] = []

  // 1-5: docs/scripts existence
  for (const [id, rel, description] of [
    ["security_architecture", "docs/security/SECURITY-ARCHITECTURE.md", "Security architecture doc exists"],
    ["cve_plan", "docs/security/CVE-REMEDIATION-PLAN.md", "CVE remediation plan doc exists"],
    ["secure_patterns", "docs/security/SECURE-PATTERNS.md", "Secure patterns doc exists"],
    ["threat_model", "docs/security/THREAT-MODEL.md", "Threat model doc exists"],
    ["security_gate", "scripts/security-gate.sh", "Security gate script exists"],
  ] as const) {
    results.push({
      id,
      description,
      points: 10,
      status: exists(rel) ? "pass" : "fail",
      detail: exists(rel) ? undefined : `missing: ${rel}`,
    })
  }

  // 6: dependency audit
  {
    const { ok, detail } = await runCmd(["bash", "scripts/bun-audit-ci.sh"], { noRun })
    results.push({
      id: "bun_audit_high",
      description: "bun audit (high) passes",
      points: 10,
      status: noRun ? "skip" : ok ? "pass" : "fail",
      detail,
    })
  }

  // 7: engine security tests
  {
    const cwd = path.join(repoRoot, "packages", "agent-core")
    const { ok, detail } = await runCmd(["bun", "test", "test/security"], { cwd, noRun })
    results.push({
      id: "agent_core_security_tests",
      description: "agent-core security tests pass",
      points: 10,
      status: noRun ? "skip" : ok ? "pass" : "fail",
      detail,
    })
  }

  // 8: non-loopback bind guardrail exists
  {
    const authTs = readText("packages/agent-core/src/server/auth.ts")
    const ok =
      assertIncludes(authTs, "assertSafeServerBind") &&
      assertIncludes(authTs, "AGENT_CORE_ALLOW_INSECURE_SERVER_NO_AUTH") &&
      assertIncludes(authTs, "AGENT_CORE_DISABLE_SERVER_AUTH")
    results.push({
      id: "non_loopback_guardrail",
      description: "Non-loopback bind guardrail exists",
      points: 10,
      status: ok ? "pass" : "fail",
      detail: ok ? undefined : "expected guardrail symbols not found in packages/agent-core/src/server/auth.ts",
    })
  }

  // 9: scope map marks high-risk routes as admin
  {
    const authTs = readText("packages/agent-core/src/server/auth.ts")
    const ok =
      /"POST\s+\/pty":\s*AuthScope\.ADMIN/.test(authTs) &&
      /"POST\s+\/mcp":\s*AuthScope\.ADMIN/.test(authTs) &&
      /"POST\s+\/tui":\s*AuthScope\.ADMIN/.test(authTs)
    results.push({
      id: "scope_map_admin",
      description: "Scope map marks PTY/MCP/TUI routes as operator.admin",
      points: 10,
      status: ok ? "pass" : "fail",
      detail: ok ? undefined : "expected admin scope mappings not found in packages/agent-core/src/server/auth.ts",
    })
  }

  // 10: messaging RELEASE is blocked by default
  {
    const securityMd = readText("SECURITY.md")
    const ok = securityMd.includes("AGENT_CORE_ALLOW_MESSAGING_RELEASE")
    results.push({
      id: "messaging_release_block",
      description: "Messaging RELEASE is blocked by default (explicit opt-in documented)",
      points: 10,
      status: ok ? "pass" : "fail",
      detail: ok ? undefined : "SECURITY.md does not mention AGENT_CORE_ALLOW_MESSAGING_RELEASE",
    })
  }

  const score = results.reduce((sum, r) => sum + (r.status === "pass" ? r.points : 0), 0)

  console.log("Security score breakdown:")
  for (const r of results) {
    const tag = r.status.toUpperCase().padEnd(4)
    const pts = r.status === "pass" ? `+${r.points}` : r.status === "skip" ? "+0" : "+0"
    const detail = r.detail ? ` (${r.detail})` : ""
    console.log(`- [${tag}] ${r.description}: ${pts}${detail}`)
  }
  console.log("")
  console.log(`Security score: ${score}/100 (min required: ${min})`)

  if (score < min) {
    process.exit(1)
  }
}

await main()

