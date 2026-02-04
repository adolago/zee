import { EOL } from "os"
import { Skill } from "../../../skill"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"

const PERSONAS = ["zee", "stanley", "johny"] as const

type SkillAuditArgs = {
  persona?: string
  json?: boolean
  verbose?: boolean
}

export const SkillAuditCommand = cmd({
  command: "skill-audit",
  describe: "comprehensive skill health audit with per-persona breakdown",
  builder: (yargs) =>
    yargs
      .option("persona", {
        type: "string",
        choices: PERSONAS,
        describe: "filter by persona",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "output as JSON",
      })
      .option("verbose", {
        alias: "v",
        type: "boolean",
        default: false,
        describe: "show detailed information",
      }),
  async handler(args: SkillAuditArgs) {
    await bootstrap(process.cwd(), async () => {
      const report = await Skill.audit()

      if (args.json) {
        const output = args.persona
          ? filterByPersona(report, args.persona)
          : report
        process.stdout.write(JSON.stringify(output, null, 2) + EOL)
        return
      }

      printAudit(report, args)
    })
  },
})

function filterByPersona(report: Skill.AuditReport, persona: string) {
  return {
    ...report,
    loaded: report.loaded.filter(
      (s) => s.context === persona || !s.context
    ),
    missingEnv: report.missingEnv.filter((m) => {
      const skill = report.loaded.find((s) => s.name === m.skill)
      return skill && (skill.context === persona || !skill.context)
    }),
  }
}

function printAudit(report: Skill.AuditReport, args: SkillAuditArgs) {
  const dim = "\x1b[2m"
  const reset = "\x1b[0m"
  const green = "\x1b[32m"
  const yellow = "\x1b[33m"
  const red = "\x1b[31m"
  const bold = "\x1b[1m"
  const cyan = "\x1b[36m"

  const ok = (s: string) => `${green}ok${reset} ${s}`
  const warn = (s: string) => `${yellow}!!${reset} ${s}`

  // Summary
  console.log(`${bold}Skill Audit Report${reset}`)
  console.log("")
  console.log(
    report.loaded.length > 0
      ? ok(`${report.loaded.length} skills loaded`)
      : warn("No skills loaded")
  )
  if (report.excluded.length > 0) {
    console.log(warn(`${report.excluded.length} skills excluded`))
  }
  if (report.conflicts.length > 0) {
    console.log(warn(`${report.conflicts.length} name conflicts`))
  }
  if (report.missingEnv.length > 0) {
    const total = report.missingEnv.reduce((sum, m) => sum + m.vars.length, 0)
    console.log(warn(`${total} missing env vars across ${report.missingEnv.length} skills`))
  }
  if (report.schemaWarnings.length > 0) {
    console.log(warn(`${report.schemaWarnings.length} skills with unknown frontmatter keys`))
  }

  // Per-persona breakdown
  console.log("")
  console.log(`${bold}Per-Persona Breakdown${reset}`)
  for (const persona of PERSONAS) {
    if (args.persona && args.persona !== persona) continue

    const skills = report.loaded.filter((s) => s.context === persona)
    console.log("")
    console.log(`  ${cyan}@${persona}${reset} (${skills.length} skills)`)

    if (args.verbose) {
      for (const skill of skills) {
        const envWarn = report.missingEnv.find((m) => m.skill === skill.name)
        const suffix = envWarn
          ? ` ${yellow}[missing: ${envWarn.vars.join(", ")}]${reset}`
          : ""
        console.log(`    ${dim}-${reset} ${skill.name}${suffix}`)
      }
    }
  }

  // Shared skills
  const shared = report.loaded.filter((s) => !s.context)
  if (shared.length > 0 && (!args.persona)) {
    console.log("")
    console.log(`  ${cyan}shared${reset} (${shared.length} skills)`)
    if (args.verbose) {
      for (const skill of shared) {
        console.log(`    ${dim}-${reset} ${skill.name}`)
      }
    }
  }

  // Exclusions
  if (report.excluded.length > 0) {
    console.log("")
    console.log(`${bold}Exclusions${reset}`)
    for (const excl of report.excluded) {
      const name = excl.name || excl.path.split("/").slice(-2, -1)[0] || excl.path
      console.log(`  ${red}x${reset} ${name}: ${excl.reason}`)
      if (args.verbose) {
        console.log(`    ${dim}${excl.path}${reset}`)
      }
    }
  }

  // Conflicts
  if (report.conflicts.length > 0) {
    console.log("")
    console.log(`${bold}Name Conflicts${reset}`)
    for (const conflict of report.conflicts) {
      console.log(`  ${yellow}!${reset} "${conflict.name}"`)
      console.log(`    ${dim}kept:${reset} ${conflict.kept}`)
      for (const shadowed of conflict.shadowed) {
        console.log(`    ${dim}shadowed:${reset} ${shadowed}`)
      }
    }
  }

  // Missing env vars
  if (report.missingEnv.length > 0 && args.verbose) {
    console.log("")
    console.log(`${bold}Missing Environment Variables${reset}`)
    for (const entry of report.missingEnv) {
      console.log(`  ${yellow}!${reset} ${entry.skill}: ${entry.vars.join(", ")}`)
    }
  }

  // Schema warnings
  if (report.schemaWarnings.length > 0) {
    console.log("")
    console.log(`${bold}Schema Warnings${reset}`)
    for (const warning of report.schemaWarnings) {
      console.log(`  ${yellow}!${reset} ${warning.skill}: unknown keys [${warning.unknownKeys.join(", ")}]`)
      if (args.verbose) {
        console.log(`    ${dim}${warning.path}${reset}`)
      }
    }
  }

  console.log("")
}
