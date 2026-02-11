import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { createClawHubClient } from "../../pkg/clawhub/client"
import { createClawHubInstaller } from "../../pkg/clawhub/install"
import { evaluateGating } from "../../pkg/clawhub/gating"

export const ClawHubCommand = cmd({
  command: "clawhub <action> [target]",
  describe: "ClawHub marketplace -- discover and install skills",
  builder: (yargs: Argv) => {
    return yargs
      .positional("action", {
        describe: "Action to perform",
        choices: ["search", "install", "update", "list", "info", "uninstall", "transfer"] as const,
        demandOption: true,
      })
      .positional("target", {
        describe: "Skill ID or search query",
        type: "string",
      })
      .option("all", {
        describe: "Update all installed skills",
        type: "boolean",
        default: false,
      })
      .option("version", {
        describe: "Specific version to install",
        type: "string",
      })
      .option("persona", {
        describe: "Install for a specific persona (zee, stanley, johny). Scopes the skill so only that persona sees it.",
        type: "string",
        choices: ["zee", "stanley", "johny"],
      })
  },
  handler: async (args) => {
    const action = args.action as string
    const target = (args.target as string | undefined) ?? (args._ as string[])[1] as string | undefined

    const client = createClawHubClient()
    const installer = createClawHubInstaller(client)

    switch (action) {
      case "search": {
        if (!target) {
          UI.println("Usage: zee clawhub search <query>")
          process.exit(1)
        }
        try {
          const results = await client.search({ query: target })
          if (results.results.length === 0) {
            UI.println("No skills found.")
            return
          }
          UI.println(`Found ${results.total} skill(s):\n`)
          for (const skill of results.results) {
            UI.println(`  ${skill.id} (v${skill.version})`)
            UI.println(`    ${skill.description}`)
            if (skill.tags.length > 0) {
              UI.println(`    tags: ${skill.tags.join(", ")}`)
            }
            UI.println("")
          }
        } catch (err) {
          UI.println(`Search failed: ${err instanceof Error ? err.message : String(err)}`)
          process.exit(1)
        }
        break
      }

      case "install": {
        if (!target) {
          UI.println("Usage: zee clawhub install <skill-id>")
          process.exit(1)
        }
        try {
          const persona = args.persona as string | undefined
          UI.println(`Installing ${target}${persona ? ` for ${persona}` : ""}...`)
          const result = await installer.install(target, args.version as string | undefined, persona)
          if (result.ok) {
            UI.println(`Installed ${result.skillId} v${result.version}`)
            UI.println(`  Location: ${result.location}`)
            if (result.requiredEnv?.length) {
              const skillName = result.skillId.includes("/") ? result.skillId.split("/").pop()! : result.skillId
              UI.println(`  This skill requires credentials: ${result.requiredEnv.join(", ")}`)
              UI.println(`  Run 'zee auth login ${skillName}' to configure.`)
            }
          } else {
            UI.println(`Installation failed: ${result.error}`)
            if (result.gatingIssues?.length) {
              UI.println("\nUnmet requirements:")
              for (const issue of result.gatingIssues) {
                UI.println(`  [${issue.kind}] ${issue.message}`)
              }
            }
            process.exit(1)
          }
        } catch (err) {
          UI.println(`Install failed: ${err instanceof Error ? err.message : String(err)}`)
          process.exit(1)
        }
        break
      }

      case "update": {
        try {
          const skillId = args.all ? undefined : target
          if (!args.all && !skillId) {
            UI.println("Usage: zee clawhub update <skill-id> or --all")
            process.exit(1)
          }
          UI.println(args.all ? "Updating all skills..." : `Updating ${skillId}...`)
          const results = await installer.update(skillId)
          if (results.length === 0) {
            UI.println("No installed skills to update.")
            return
          }
          for (const r of results) {
            if (r.updated) {
              UI.println(`  Updated ${r.skillId}: ${r.fromVersion} -> ${r.toVersion}`)
            } else if (r.error) {
              UI.println(`  Failed ${r.skillId}: ${r.error}`)
            } else {
              UI.println(`  ${r.skillId}: already at latest (${r.fromVersion})`)
            }
          }
        } catch (err) {
          UI.println(`Update failed: ${err instanceof Error ? err.message : String(err)}`)
          process.exit(1)
        }
        break
      }

      case "list": {
        const installed = installer.list()
        if (installed.length === 0) {
          UI.println("No ClawHub skills installed.")
          return
        }
        UI.println(`Installed ClawHub skills (${installed.length}):\n`)
        for (const skill of installed) {
          const scope = skill.persona ? `@${skill.persona}` : "shared"
          UI.println(`  ${skill.id} v${skill.version} [${scope}]`)
          UI.println(`    installed: ${skill.installedAt}`)
          UI.println(`    location: ${skill.location}`)
          UI.println("")
        }
        break
      }

      case "info": {
        if (!target) {
          UI.println("Usage: zee clawhub info <skill-id>")
          process.exit(1)
        }
        try {
          const detail = await client.get(target)
          UI.println(`${detail.name} (${detail.id})`)
          UI.println(`  version: ${detail.version}`)
          UI.println(`  author: ${detail.author}`)
          UI.println(`  description: ${detail.description}`)
          if (detail.license) UI.println(`  license: ${detail.license}`)
          if (detail.repository) UI.println(`  repository: ${detail.repository}`)
          if (detail.tags.length > 0) UI.println(`  tags: ${detail.tags.join(", ")}`)
          UI.println(`  downloads: ${detail.downloads}`)

          if (detail.requires) {
            UI.println("\n  Requirements:")
            const gating = await evaluateGating(detail.requires)
            if (detail.requires.bins?.length) {
              UI.println(`    bins: ${detail.requires.bins.join(", ")}`)
            }
            if (detail.requires.env?.length) {
              UI.println(`    env: ${detail.requires.env.join(", ")}`)
            }
            if (detail.requires.os?.length) {
              UI.println(`    os: ${detail.requires.os.join(", ")}`)
            }
            UI.println(`    status: ${gating.ok ? "all met" : "UNMET"}`)
            if (!gating.ok) {
              for (const issue of gating.issues) {
                UI.println(`      [${issue.kind}] ${issue.message}`)
              }
            }
          }

          if (detail.versions.length > 0) {
            UI.println(`\n  Versions (${detail.versions.length}):`)
            for (const v of detail.versions.slice(0, 10)) {
              UI.println(`    ${v.version} (${v.publishedAt})`)
            }
            if (detail.versions.length > 10) {
              UI.println(`    ... and ${detail.versions.length - 10} more`)
            }
          }
        } catch (err) {
          UI.println(`Info failed: ${err instanceof Error ? err.message : String(err)}`)
          process.exit(1)
        }
        break
      }

      case "uninstall": {
        if (!target) {
          UI.println("Usage: zee clawhub uninstall <skill-id>")
          process.exit(1)
        }
        const removed = installer.uninstall(target)
        if (removed) {
          UI.println(`Uninstalled ${target}`)
        } else {
          UI.println(`Skill "${target}" is not installed via ClawHub`)
        }
        break
      }

      case "transfer": {
        if (!target) {
          UI.println("Usage: zee clawhub transfer <skill-id> --persona <persona>")
          UI.println("       zee clawhub transfer <skill-id>  (move to shared)")
          process.exit(1)
        }
        const toPersona = args.persona as string | undefined
        const result = installer.transfer(target, toPersona)
        if (result.ok) {
          UI.println(`Transferred ${target}: ${result.from} -> ${result.to}`)
        } else {
          UI.println(`Transfer failed: ${result.error}`)
          process.exit(1)
        }
        break
      }

      default:
        UI.println(`Unknown action: ${action}`)
        process.exit(1)
    }
  },
})
