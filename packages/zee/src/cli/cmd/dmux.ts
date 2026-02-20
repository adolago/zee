import { cmd } from "./cmd"
import { Instance } from "../../project/instance"
import { Dmux } from "../../worktree/dmux"

export const DmuxCommand = cmd({
  command: "dmux",
  describe: "manage dmux-style worktree lanes (spawn + merge)",
  builder: (yargs) => yargs.command(DmuxSpawnCommand).command(DmuxMergeCommand).demandCommand(),
  async handler() {},
})

export const DmuxSpawnCommand = cmd({
  command: "spawn",
  describe: "create a worktree lane and launch it in tmux",
  builder: (yargs) =>
    yargs
      .option("name", {
        type: "string",
        describe: "optional lane/worktree name",
      })
      .option("prompt", {
        alias: "p",
        type: "string",
        describe: "task prompt to launch in the lane",
      })
      .option("agent", {
        type: "string",
        choices: ["zee", "codex", "claude", "opencode", "terminal"],
        default: "zee",
        describe: "agent binary to launch in tmux",
      })
      .option("session", {
        type: "string",
        describe: "tmux session name",
      })
      .option("socket", {
        type: "string",
        describe: "tmux socket path",
      })
      .option("launch", {
        type: "boolean",
        default: true,
        describe: "launch tmux command after creating the lane (use --no-launch to disable)",
      })
      .option("command", {
        type: "string",
        describe: "override launch command (instead of agent + prompt)",
      })
      .option("hook-create", {
        type: "string",
        describe: "optional shell hook to run after lane creation",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "output machine-readable JSON",
      }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const result = await Dmux.spawn({
          name: args.name,
          prompt: args.prompt,
          agent: args.agent as Dmux.Agent,
          session: args.session,
          socket: args.socket,
          launch: args.launch,
          command: args.command,
          hookCreate: args.hookCreate,
        })

        if (args.json) {
          console.log(JSON.stringify(result, null, 2))
          return
        }

        console.log(`Lane:      ${result.name}`)
        console.log(`Branch:    ${result.branch}`)
        console.log(`Directory: ${result.directory}`)
        console.log(`Tmux:      ${result.session}:${result.window}${result.socket ? ` (socket: ${result.socket})` : ""}`)
        if (result.command) console.log(`Command:   ${result.command}`)

        if (result.launched) {
          const socket = result.socket ? ` -S ${JSON.stringify(result.socket)}` : ""
          console.log("")
          console.log("To monitor:")
          console.log(`  tmux${socket} attach -t ${result.session}`)
          console.log(`  tmux${socket} capture-pane -p -J -t ${result.session}:${result.window} -S -200`)
        }
      },
    })
  },
})

export const DmuxMergeCommand = cmd({
  command: "merge",
  describe: "merge a lane branch into the current branch and optionally remove the worktree",
  builder: (yargs) =>
    yargs
      .option("directory", {
        alias: "d",
        type: "string",
        demandOption: true,
        describe: "worktree lane directory to merge",
      })
      .option("message", {
        alias: "m",
        type: "string",
        default: "dmux: merge lane",
        describe: "merge/commit message",
      })
      .option("squash", {
        type: "boolean",
        default: false,
        describe: "use squash merge",
      })
      .option("keep-worktree", {
        type: "boolean",
        default: false,
        describe: "keep worktree after merge",
      })
      .option("hook-pre-merge", {
        type: "string",
        describe: "optional pre-merge shell hook (runs in lane directory)",
      })
      .option("hook-post-merge", {
        type: "string",
        describe: "optional post-merge shell hook (runs in primary worktree)",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "output machine-readable JSON",
      }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const result = await Dmux.merge({
          directory: args.directory,
          message: args.message,
          squash: args.squash,
          removeWorktree: !args.keepWorktree,
          hookPreMerge: args.hookPreMerge,
          hookPostMerge: args.hookPostMerge,
        })

        if (args.json) {
          console.log(JSON.stringify(result, null, 2))
          return
        }

        console.log(`Merged lane branch ${result.laneBranch} into ${result.targetBranch}`)
        console.log(`Head: ${result.head}`)
        if (result.removed) {
          console.log(`Removed worktree: ${result.directory}`)
        } else {
          console.log(`Kept worktree: ${result.directory}`)
        }
      },
    })
  },
})
