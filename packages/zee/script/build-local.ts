#!/usr/bin/env bun

function shouldUseSingleBuild(args: string[]): boolean {
  return !args.includes("--single") && !args.includes("--targets")
}

async function run(command: string[]) {
  const proc = Bun.spawn(command, {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  })
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    process.exit(exitCode)
  }
}

const bunExec = process.execPath
const buildArgs = process.argv.slice(2)

if (shouldUseSingleBuild(buildArgs)) {
  buildArgs.push("--single")
}

await run([bunExec, "run", "script/build.ts", ...buildArgs])
await run([bunExec, "run", "script/link-local-binary.ts"])
