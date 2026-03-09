#!/usr/bin/env npx tsx
/**
 * investing-daemon CLI
 *
 * Query zee daemon status via IPC.
 *
 * Usage:
 *   npx tsx investing-daemon.ts status
 *   npx tsx investing-daemon.ts list-workers
 *   npx tsx investing-daemon.ts list-tasks
 */

import { requestDaemon } from "../../../../src/daemon/ipc-client";

const command = process.argv[2] ?? "status";

async function run() {
  switch (command) {
    case "status": {
      const status = await requestDaemon("status");
      console.log(JSON.stringify(status, null, 2));
      break;
    }
    case "list-workers": {
      const workers = await requestDaemon("list_workers");
      console.log(JSON.stringify(workers, null, 2));
      break;
    }
    case "list-tasks": {
      const tasks = await requestDaemon("list_tasks");
      console.log(JSON.stringify(tasks, null, 2));
      break;
    }
    default:
      console.log(`
investing daemon CLI

Commands:
  status
  list-workers
  list-tasks
`);
  }
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
