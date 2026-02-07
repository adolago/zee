import { test, expect } from "bun:test"
import fs from "fs"
import path from "path"

function walk(dir: string, out: string[] = []): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      walk(full, out)
      continue
    }
    out.push(full)
  }
  return out
}

test("packages/agent-core/src does not import from packages/personas", () => {
  const srcRoot = path.join(import.meta.dir, "..", "..", "src")
  const files = walk(srcRoot).filter((p) => p.endsWith(".ts"))

  const offenders: string[] = []
  const importRe = /\b(from|import)\s*(?:\(|)\s*["']([^"']+)["']\s*\)?/g

  // Limited exception: embedded gateway integration imports Zee gateway internals.
  // This is an intentional monorepo coupling for the in-process gateway mode.
  const allow = (relFile: string, spec: string) => {
    if (relFile.startsWith("gateway/") && spec.includes("personas/zee/src/")) return true
    return false
  }

  for (const file of files) {
    const text = fs.readFileSync(file, "utf-8")
    let m: RegExpExecArray | null
    while ((m = importRe.exec(text))) {
      const spec = m[2]
      if (spec.includes("packages/personas/") || spec.includes("personas/zee")) {
        const rel = path.relative(srcRoot, file)
        if (allow(rel, spec)) continue
        offenders.push(`${rel} -> ${spec}`)
        break
      }
    }
  }

  expect(offenders, offenders.join("\n")).toEqual([])
})
