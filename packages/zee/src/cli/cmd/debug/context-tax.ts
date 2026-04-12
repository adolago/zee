import { EOL } from "os"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"
import { measureContextTax, type ContextTaxBreakdown } from "../../../context/context-tax"

// Pricing per million tokens
const PRICING: Record<string, { input: number; output: number }> = {
  opus: { input: 15, output: 75 },
  sonnet: { input: 3, output: 15 },
}

export const ContextTaxCommand = cmd({
  command: "context-tax",
  describe: "measure per-turn token cost of Zee system prompt and tool schemas",
  builder: (yargs) =>
    yargs
      .option("agent", {
        type: "string",
        default: "zee",
        description: "Agent to measure",
      })
      .option("json", {
        type: "boolean",
        default: false,
        description: "Output as JSON",
      }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      try {
        const breakdown = await measureContextTax(args.agent as string)
        if (args.json) {
          process.stdout.write(JSON.stringify(breakdown, null, 2) + EOL)
          return
        }
        printDetailed(breakdown)
      } catch (e) {
        process.stderr.write(`Failed to measure ${args.agent}: ${e instanceof Error ? e.message : String(e)}${EOL}`)
        process.exit(1)
      }
    })
  },
})

function printDetailed(breakdown: ContextTaxBreakdown) {
  const w = process.stdout.write.bind(process.stdout)

  w(`Context Tax Report - Agent: ${breakdown.agent}${EOL}`)
  w(`${"=".repeat(60)}${EOL}${EOL}`)

  // System prompt section
  const systemComponents = breakdown.components.filter((c) => ["system", "awareness", "knowledge"].includes(c.category))
  if (systemComponents.length > 0) {
    w(`SYSTEM PROMPT${EOL}`)
    for (const c of systemComponents) {
      w(
        `  ${padRight(c.name, 38)} ${padLeft(fmtTokens(c.estimatedTokens), 8)}  ${padLeft(fmtKB(c.bytes), 8)}  ${padLeft(`${c.pct}%`, 4)}${EOL}`,
      )
    }
    w(`  ${"─".repeat(56)}${EOL}`)
    w(`  ${padRight("Subtotal", 38)} ${padLeft(fmtTokens(breakdown.systemSubtotal), 8)}${EOL}`)
    w(EOL)
  }

  // Tool schemas section
  const toolComponents = breakdown.components.filter((c) => ["tools", "skills", "mcp"].includes(c.category))
  if (toolComponents.length > 0) {
    w(`TOOL SCHEMAS${EOL}`)
    for (const c of toolComponents) {
      w(
        `  ${padRight(c.name, 38)} ${padLeft(fmtTokens(c.estimatedTokens), 8)}  ${padLeft(fmtKB(c.bytes), 8)}  ${padLeft(`${c.pct}%`, 4)}${EOL}`,
      )
    }
    w(`  ${"─".repeat(56)}${EOL}`)
    w(`  ${padRight("Subtotal", 38)} ${padLeft(fmtTokens(breakdown.toolsSubtotal), 8)}${EOL}`)
    w(EOL)
  }

  // Total
  w(`TOTAL BASE CONTEXT (per turn)${EOL}`)
  w(`  ${padRight("Estimated tokens", 38)} ${padLeft(fmtTokens(breakdown.totalEstimated), 8)}${EOL}`)
  const totalKB = breakdown.components.reduce((sum, c) => sum + c.bytes, 0)
  w(`  ${padRight("Estimated bytes", 38)} ${padLeft(fmtKB(totalKB), 8)}${EOL}`)
  w(EOL)

  // Pricing per turn
  w(`COST PER TURN (input only)${EOL}`)
  for (const [tier, price] of Object.entries(PRICING)) {
    const cost = (breakdown.totalEstimated / 1_000_000) * price.input
    w(`  ${padRight(tier.charAt(0).toUpperCase() + tier.slice(1), 12)} $${cost.toFixed(4)}${EOL}`)
  }
  w(EOL)

  // Lazy pool
  if (breakdown.lazyPool.length > 0) {
    w(`LAZY POOL (loaded on skill invoke)${EOL}`)
    for (const pool of breakdown.lazyPool) {
      w(
        `  ${padRight(`${pool.scope} skills (${pool.skillCount})`, 38)} ${padLeft(fmtTokens(pool.estimatedTokens), 8)}  ${padLeft(fmtKB(pool.totalBytes), 8)}${EOL}`,
      )
    }
    w(EOL)
  }

  // Top heaviest
  const sorted = [...breakdown.components].sort((a, b) => b.estimatedTokens - a.estimatedTokens)
  const top = sorted.slice(0, 5)
  w(`TOP ${top.length} HEAVIEST COMPONENTS${EOL}`)
  for (let i = 0; i < top.length; i++) {
    const c = top[i]
    w(`  ${i + 1}. ${padRight(c.name, 36)} ${padLeft(fmtTokens(c.estimatedTokens), 8)} (${c.pct}%)${EOL}`)
  }
  w(EOL)
}

function fmtTokens(n: number): string {
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}k`
  }
  return String(n)
}

function fmtKB(bytes: number): string {
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${bytes} B`
}

function padRight(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s + " ".repeat(len - s.length)
}

function padLeft(s: string, len: number): string {
  return s.length >= len ? s : " ".repeat(len - s.length) + s
}
