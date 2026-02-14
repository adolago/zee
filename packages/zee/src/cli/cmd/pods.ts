import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { UI } from "../ui"
import {
  inspectPodsConfig,
  listModels,
  listPods,
  openPodShell,
  removePod,
  runPodSsh,
  setActivePod,
  setupPod,
  startModel,
  stopModel,
  streamModelLogs,
  type VllmProfile,
} from "@/pods/manager"

export const PodsCommand = cmd({
  command: "pods",
  describe: "manage remote GPU pods and vLLM model processes",
  builder: (yargs: Argv) =>
    yargs
      .command(PodsSetupCommand)
      .command(PodsListCommand)
      .command(PodsActiveCommand)
      .command(PodsRemoveCommand)
      .command(PodsShellCommand)
      .command(PodsSshCommand)
      .command(PodsStartModelCommand)
      .command(PodsStopModelCommand)
      .command(PodsModelsCommand)
      .command(PodsLogsCommand)
      .command(PodsConfigCommand)
      .demandCommand(),
  async handler() {},
})

const profileChoices: VllmProfile[] = ["release", "nightly", "gpt-oss", "custom"]

export const PodsSetupCommand = cmd({
  command: "setup <name> <ssh>",
  describe: "register or update a pod definition",
  builder: (yargs: Argv) =>
    yargs
      .positional("name", { type: "string", demandOption: true })
      .positional("ssh", { type: "string", demandOption: true, describe: "ssh command, e.g. 'ssh root@1.2.3.4'" })
      .option("mount", { type: "string", describe: "optional remote mount command metadata" })
      .option("models-path", { type: "string", describe: "optional remote models path metadata" })
      .option("profile", {
        type: "string",
        choices: profileChoices,
        default: "release",
        describe: "vLLM profile metadata",
      })
      .option("no-active", {
        type: "boolean",
        default: false,
        describe: "do not make this pod active",
      }),
  handler: async (args) => {
    const pod = await setupPod({
      name: String(args.name),
      ssh: String(args.ssh),
      mount: args.mount ? String(args.mount) : undefined,
      modelsPath: args.modelsPath ? String(args.modelsPath) : undefined,
      profile: args.profile as VllmProfile,
      setActive: !args.noActive,
    })
    UI.success(`Pod saved: ${pod.name}`)
  },
})

export const PodsListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list configured pods",
  builder: (yargs: Argv) =>
    yargs.option("json", {
      type: "boolean",
      default: false,
    }),
  handler: async (args) => {
    const pods = await listPods()
    if (args.json) {
      console.log(JSON.stringify(pods, null, 2))
      return
    }

    if (!pods.pods.length) {
      UI.println("No pods configured")
      return
    }

    for (const pod of pods.pods) {
      const active = pod.name === pods.activePod ? `${UI.Style.TEXT_SUCCESS}*${UI.Style.TEXT_NORMAL} ` : "  "
      UI.println(`${active}${pod.name} (${pod.profile})`)
      UI.println(UI.Style.TEXT_DIM + `    ${pod.ssh}` + UI.Style.TEXT_NORMAL)
      if (pod.modelsPath) UI.println(UI.Style.TEXT_DIM + `    models: ${pod.modelsPath}` + UI.Style.TEXT_NORMAL)
    }
  },
})

export const PodsActiveCommand = cmd({
  command: "active <name>",
  describe: "set active pod",
  builder: (yargs: Argv) =>
    yargs.positional("name", {
      type: "string",
      demandOption: true,
    }),
  handler: async (args) => {
    const pod = await setActivePod(String(args.name))
    UI.success(`Active pod: ${pod.name}`)
  },
})

export const PodsRemoveCommand = cmd({
  command: "remove <name>",
  aliases: ["rm"],
  describe: "remove pod definition",
  builder: (yargs: Argv) =>
    yargs.positional("name", {
      type: "string",
      demandOption: true,
    }),
  handler: async (args) => {
    const removed = await removePod(String(args.name))
    if (!removed) {
      UI.warn(`Pod not found: ${String(args.name)}`)
      return
    }
    UI.success(`Removed pod: ${removed.name}`)
  },
})

export const PodsShellCommand = cmd({
  command: "shell [name]",
  describe: "open interactive shell on pod",
  builder: (yargs: Argv) =>
    yargs.positional("name", {
      type: "string",
      demandOption: false,
    }),
  handler: async (args) => {
    await openPodShell(args.name ? String(args.name) : undefined)
  },
})

export const PodsSshCommand = cmd({
  command: "ssh [name] [command..]",
  describe: "run a remote command on a pod",
  builder: (yargs: Argv) =>
    yargs
      .positional("name", {
        type: "string",
        demandOption: false,
      })
      .positional("command", {
        type: "string",
        array: true,
        demandOption: true,
      }),
  handler: async (args) => {
    const command = [...(Array.isArray(args.command) ? args.command : []), ...(args["--"] || [])].join(" ").trim()
    if (!command) {
      UI.error("command is required")
      process.exit(2)
    }
    const result = await runPodSsh({
      name: args.name ? String(args.name) : undefined,
      command,
    })
    if (result.stdout) process.stdout.write(result.stdout + "\n")
    if (result.stderr) process.stderr.write(result.stderr + "\n")
    if (result.code !== 0) process.exit(result.code)
  },
})

export const PodsStartModelCommand = cmd({
  command: "start <model>",
  describe: "start a vLLM model process on a pod",
  builder: (yargs: Argv) =>
    yargs
      .positional("model", { type: "string", demandOption: true })
      .option("name", { type: "string", demandOption: true, describe: "logical process name" })
      .option("pod", { type: "string", describe: "target pod name (defaults to active pod)" })
      .option("port", { type: "number", default: 8000, describe: "vLLM port" })
      .option("log-file", { type: "string", describe: "remote log file path" })
      .option("vllm-arg", {
        type: "string",
        array: true,
        default: [],
        describe: "extra argument passed to vllm serve (repeatable)",
      }),
  handler: async (args) => {
    const started = await startModel({
      model: String(args.model),
      name: String(args.name),
      pod: args.pod ? String(args.pod) : undefined,
      port: Number(args.port),
      logFile: args.logFile ? String(args.logFile) : undefined,
      extraArgs: (args.vllmArg as string[] | undefined) ?? [],
    })
    UI.success(`Started ${started.name} on ${started.pod}:${started.port}`)
    if (started.pid) UI.println(UI.Style.TEXT_DIM + `pid: ${started.pid}` + UI.Style.TEXT_NORMAL)
    UI.println(UI.Style.TEXT_DIM + `log: ${started.logFile}` + UI.Style.TEXT_NORMAL)
  },
})

export const PodsStopModelCommand = cmd({
  command: "stop <name>",
  describe: "stop a tracked model process",
  builder: (yargs: Argv) =>
    yargs.positional("name", {
      type: "string",
      demandOption: true,
    }),
  handler: async (args) => {
    const stopped = await stopModel(String(args.name))
    if (!stopped) {
      UI.warn(`Model process not found: ${String(args.name)}`)
      return
    }
    UI.success(`Stopped model process: ${stopped.name}`)
  },
})

export const PodsModelsCommand = cmd({
  command: "models",
  describe: "list tracked model processes",
  builder: (yargs: Argv) =>
    yargs.option("json", {
      type: "boolean",
      default: false,
    }),
  handler: async (args) => {
    const models = await listModels()
    if (args.json) {
      console.log(JSON.stringify(models, null, 2))
      return
    }
    if (!models.length) {
      UI.println("No model processes tracked")
      return
    }
    for (const model of models) {
      UI.println(`${model.name} (${model.status})`)
      UI.println(UI.Style.TEXT_DIM + `  pod=${model.pod} port=${model.port} model=${model.model}` + UI.Style.TEXT_NORMAL)
    }
  },
})

export const PodsLogsCommand = cmd({
  command: "logs <name>",
  describe: "stream logs for a tracked model process",
  builder: (yargs: Argv) =>
    yargs
      .positional("name", {
        type: "string",
        demandOption: true,
      })
      .option("follow", {
        type: "boolean",
        default: true,
      })
      .option("lines", {
        type: "number",
        default: 200,
      }),
  handler: async (args) => {
    await streamModelLogs({
      name: String(args.name),
      follow: !!args.follow,
      lines: Number(args.lines),
    })
  },
})

export const PodsConfigCommand = cmd({
  command: "config",
  describe: "inspect pods state/config paths",
  builder: (yargs: Argv) =>
    yargs.option("json", {
      type: "boolean",
      default: false,
    }),
  handler: async (args) => {
    const cfg = await inspectPodsConfig()
    if (args.json) {
      console.log(JSON.stringify(cfg, null, 2))
      return
    }
    UI.println(`State file: ${cfg.stateFile}`)
    UI.println(`Active pod: ${cfg.activePod ?? "(none)"}`)
    UI.println(`Pods: ${cfg.pods.length}`)
    UI.println(`Tracked models: ${cfg.models.length}`)
  },
})

