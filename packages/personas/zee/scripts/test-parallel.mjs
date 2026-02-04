import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const VITEST_BIN = process.platform === "win32" ? "vitest.cmd" : "vitest";

function findFirstUp(startDir, relativePath) {
  let dir = startDir;
  for (let i = 0; i < 20; i += 1) {
    const candidate = path.join(dir, relativePath);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const vitest = findFirstUp(process.cwd(), path.join("node_modules", ".bin", VITEST_BIN));
if (!vitest) {
  throw new Error("vitest binary not found. Run dependency install for the workspace.");
}

const runs = [
  {
    name: "unit",
    args: ["run", "--config", "vitest.unit.config.ts"],
  },
  {
    name: "extensions",
    args: ["run", "--config", "vitest.extensions.config.ts"],
  },
  {
    name: "gateway",
    args: ["run", "--config", "vitest.gateway.config.ts"],
  },
];

const children = new Set();
const isCI = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
const isWindows = process.platform === "win32" || process.env.RUNNER_OS === "Windows";
const isWindowsCi = isCI && isWindows;
const shardOverride = Number.parseInt(process.env.ZEE_TEST_SHARDS ?? "", 10);
const shardCount = isWindowsCi ? (Number.isFinite(shardOverride) && shardOverride > 1 ? shardOverride : 2) : 1;
const windowsCiArgs = isWindowsCi ? ["--no-file-parallelism", "--dangerouslyIgnoreUnhandledErrors"] : [];
const overrideWorkers = Number.parseInt(process.env.ZEE_TEST_WORKERS ?? "", 10);
const resolvedOverride = Number.isFinite(overrideWorkers) && overrideWorkers > 0 ? overrideWorkers : null;
const parallelRuns = isWindowsCi ? [] : runs.filter((entry) => entry.name !== "gateway");
const serialRuns = isWindowsCi ? runs : runs.filter((entry) => entry.name === "gateway");
const localWorkers = Math.max(4, Math.min(16, os.cpus().length));
const parallelCount = Math.max(1, parallelRuns.length);
const perRunWorkers = Math.max(1, Math.floor(localWorkers / parallelCount));
// Keep worker counts predictable for local runs; in CI on Linux/Windows prefer Vitest defaults.
const maxWorkers = resolvedOverride ?? (isCI && !isWindows ? null : perRunWorkers);

const WARNING_SUPPRESSION_FLAGS = [
  "--disable-warning=ExperimentalWarning",
  "--disable-warning=DEP0040",
  "--disable-warning=DEP0060",
];

const runOnce = (entry, extraArgs = []) =>
  new Promise((resolve) => {
    const args = maxWorkers
      ? [...entry.args, "--maxWorkers", String(maxWorkers), ...windowsCiArgs, ...extraArgs]
      : [...entry.args, ...windowsCiArgs, ...extraArgs];
    const nodeOptions = process.env.NODE_OPTIONS ?? "";
    const nextNodeOptions = WARNING_SUPPRESSION_FLAGS.reduce(
      (acc, flag) => (acc.includes(flag) ? acc : `${acc} ${flag}`.trim()),
      nodeOptions,
    );
    const child = spawn(vitest, args, {
      stdio: "inherit",
      env: { ...process.env, VITEST_GROUP: entry.name, NODE_OPTIONS: nextNodeOptions },
      shell: process.platform === "win32",
    });
    children.add(child);
    child.on("exit", (code, signal) => {
      children.delete(child);
      resolve(code ?? (signal ? 1 : 0));
    });
  });

const run = async (entry) => {
  if (shardCount <= 1) return runOnce(entry);
  for (let shardIndex = 1; shardIndex <= shardCount; shardIndex += 1) {
    // eslint-disable-next-line no-await-in-loop
    const code = await runOnce(entry, ["--shard", `${shardIndex}/${shardCount}`]);
    if (code !== 0) return code;
  }
  return 0;
};

const shutdown = (signal) => {
  for (const child of children) {
    child.kill(signal);
  }
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

const parallelCodes = await Promise.all(parallelRuns.map(run));
const failedParallel = parallelCodes.find((code) => code !== 0);
if (failedParallel !== undefined) {
  process.exit(failedParallel);
}

for (const entry of serialRuns) {
  // eslint-disable-next-line no-await-in-loop
  const code = await run(entry);
  if (code !== 0) {
    process.exit(code);
  }
}

process.exit(0);
