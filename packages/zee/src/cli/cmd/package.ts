import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"
import { Instance } from "@/project/instance"
import {
  formatManifestKinds,
  inspectPackageConfig,
  installSource,
  listInstalled,
  removePackage,
  type PackageScope,
  updatePackages,
} from "@/package/manager"

type ScopeInput = {
  local?: boolean
}

async function withScope<T>(args: ScopeInput, fn: (scope: PackageScope, projectRoot?: string) => Promise<T>) {
  return bootstrap(process.cwd(), async () => {
    const scope: PackageScope = args.local ? "local" : "global"
    const projectRoot = scope === "local" ? Instance.worktree : undefined
    if (scope === "local" && projectRoot === "/") {
      throw new Error("Local package scope requires running inside a git worktree")
    }
    return fn(scope, projectRoot)
  })
}

function scopeOption(yargs: Argv) {
  return yargs.option("local", {
    alias: "l",
    type: "boolean",
    default: false,
    describe: "install in project-local .zee scope instead of global scope",
  })
}

export const PackageCommand = cmd({
  command: "package",
  describe: "manage unified packages (plugins, skills, prompts, themes, extensions)",
  builder: (yargs: Argv) =>
    yargs
      .command(PackageInstallCommand)
      .command(PackageRemoveCommand)
      .command(PackageUpdateCommand)
      .command(PackageListCommand)
      .command(PackageConfigCommand)
      .demandCommand(),
  async handler() {},
})

export const PackageInstallCommand = cmd({
  command: "install <source>",
  aliases: ["add", "i"],
  describe: "install a package from npm/git and apply zee manifest resources",
  builder: (yargs: Argv) =>
    scopeOption(yargs).positional("source", {
      describe: "package source (npm, git url, or other Bun-supported spec)",
      type: "string",
      demandOption: true,
    }),
  handler: async (args) => {
    await withScope(args, async (scope, projectRoot) => {
      const source = String(args.source)
      UI.println(UI.Style.TEXT_DIM + `Installing ${source} (${scope})...` + UI.Style.TEXT_NORMAL)
      const installed = await installSource({ source, scope, projectRoot })
      if (!installed.length) {
        UI.warn("No dependency changes detected")
        return
      }
      for (const entry of installed) {
        UI.success(`Installed ${entry.packageName}@${entry.version ?? "unknown"}`)
        const summary = formatManifestKinds(entry.manifest)
        if (Object.keys(summary).length) {
          UI.println(UI.Style.TEXT_DIM + `  resources: ${JSON.stringify(summary)}` + UI.Style.TEXT_NORMAL)
        } else {
          UI.println(UI.Style.TEXT_DIM + "  resources: none declared in manifest" + UI.Style.TEXT_NORMAL)
        }
      }
    })
  },
})

export const PackageRemoveCommand = cmd({
  command: "remove <identifier>",
  aliases: ["rm", "uninstall"],
  describe: "remove an installed package by source or package name",
  builder: (yargs: Argv) =>
    scopeOption(yargs).positional("identifier", {
      describe: "package source or package name",
      type: "string",
      demandOption: true,
    }),
  handler: async (args) => {
    await withScope(args, async (scope, projectRoot) => {
      const identifier = String(args.identifier)
      const removed = await removePackage({ identifier, scope, projectRoot })
      if (!removed.length) {
        UI.warn(`No package matched "${identifier}"`)
        return
      }
      for (const entry of removed) {
        UI.success(`Removed ${entry.packageName}`)
      }
    })
  },
})

export const PackageUpdateCommand = cmd({
  command: "update [identifier]",
  aliases: ["upgrade"],
  describe: "update installed packages (all or selected)",
  builder: (yargs: Argv) =>
    scopeOption(yargs).positional("identifier", {
      describe: "optional package source or package name",
      type: "string",
      demandOption: false,
    }),
  handler: async (args) => {
    await withScope(args, async (scope, projectRoot) => {
      const identifier = args.identifier ? String(args.identifier) : undefined
      const updated = await updatePackages({ identifier, scope, projectRoot })
      if (!updated.length) {
        UI.warn("No packages updated")
        return
      }
      for (const entry of updated) {
        UI.success(`Updated ${entry.packageName}@${entry.version ?? "unknown"}`)
      }
    })
  },
})

export const PackageListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list installed packages",
  builder: (yargs: Argv) =>
    scopeOption(
      yargs.option("json", {
        type: "boolean",
        default: false,
        describe: "output JSON",
      }),
    ),
  handler: async (args) => {
    await withScope(args, async (scope, projectRoot) => {
      const installed = await listInstalled({ scope, projectRoot })
      if (args.json) {
        console.log(JSON.stringify(installed, null, 2))
        return
      }
      if (!installed.length) {
        UI.println("No packages installed")
        return
      }
      for (const entry of installed) {
        const when = new Date(entry.installedAt).toISOString()
        UI.println(`${entry.packageName} ${UI.Style.TEXT_DIM}(${entry.scope}, ${when})${UI.Style.TEXT_NORMAL}`)
        UI.println(UI.Style.TEXT_DIM + `  source: ${entry.source}` + UI.Style.TEXT_NORMAL)
      }
    })
  },
})

export const PackageConfigCommand = cmd({
  command: "config",
  describe: "show package runtime/configuration details",
  builder: (yargs: Argv) =>
    scopeOption(
      yargs.option("json", {
        type: "boolean",
        default: false,
        describe: "output JSON",
      }),
    ),
  handler: async (args) => {
    await withScope(args, async (scope, projectRoot) => {
      const details = await inspectPackageConfig({ scope, projectRoot })
      if (args.json) {
        console.log(JSON.stringify(details, null, 2))
        return
      }

      UI.println(`Scope: ${details.scope}`)
      UI.println(`Runtime root: ${details.runtimeRoot}`)
      UI.println(`Resources root: ${details.resourcesRoot}`)
      UI.println(`State file: ${details.stateFile}`)
      UI.println(`Installed: ${details.installs.length}`)
    })
  },
})
