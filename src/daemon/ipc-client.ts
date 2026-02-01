/**
 * Daemon IPC Client
 *
 * Connects to the daemon Unix socket and sends commands.
 */

import { createConnection, Socket } from "node:net";
import { randomUUID } from "node:crypto";
import type {
  DaemonCommand,
  DaemonRequest,
  DaemonResponse,
  IPCClientOptions,
  DEFAULT_SOCKET_PATH,
} from "./types";

export { DEFAULT_SOCKET_PATH } from "./types";

/**
 * Send a command to the daemon and wait for response.
 *
 * @param command - The daemon command to execute
 * @param params - Optional parameters for the command
 * @param options - Connection options (socket path, timeout)
 * @returns The response data from the daemon
 * @throws Error if connection fails, times out, or daemon returns error
 */
export async function requestDaemon<TParams = unknown, TResult = unknown>(
  command: DaemonCommand,
  params?: TParams,
  options: IPCClientOptions = {}
): Promise<TResult> {
  const socketPath =
    options.socketPath ||
    process.env.AGENT_CORE_IPC_SOCKET ||
    getDefaultSocketPath();
  const timeoutMs = options.timeoutMs ?? 10000;

  const request: DaemonRequest<TParams> = {
    id: randomUUID(),
    command,
    params,
    timestamp: Date.now(),
  };

  return new Promise<TResult>((resolve, reject) => {
    let socket: Socket | null = null;
    let buffer = "";
    let settled = false;

    const cleanup = () => {
      if (socket) {
        socket.removeAllListeners();
        socket.destroy();
        socket = null;
      }
    };

    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true;
        cleanup();
        fn();
      }
    };

    // Timeout handler
    const timer = setTimeout(() => {
      settle(() =>
        reject(new Error(`Daemon request timed out after ${timeoutMs}ms`))
      );
    }, timeoutMs);

    try {
      socket = createConnection(socketPath);

      socket.on("connect", () => {
        // Send request as newline-delimited JSON
        socket!.write(JSON.stringify(request) + "\n");
      });

      socket.on("data", (chunk) => {
        buffer += chunk.toString();

        // Look for complete message (newline-delimited)
        const newlineIdx = buffer.indexOf("\n");
        if (newlineIdx >= 0) {
          const message = buffer.slice(0, newlineIdx);
          buffer = buffer.slice(newlineIdx + 1);

          clearTimeout(timer);

          try {
            const response: DaemonResponse<TResult> = JSON.parse(message);

            if (response.id !== request.id) {
              settle(() =>
                reject(
                  new Error(
                    `Response ID mismatch: expected ${request.id}, got ${response.id}`
                  )
                )
              );
              return;
            }

            if (!response.success) {
              settle(() =>
                reject(new Error(response.error || "Daemon returned error"))
              );
              return;
            }

            settle(() => resolve(response.data as TResult));
          } catch (parseError) {
            settle(() =>
              reject(new Error(`Failed to parse daemon response: ${message}`))
            );
          }
        }
      });

      socket.on("error", (err) => {
        clearTimeout(timer);
        const msg =
          (err as NodeJS.ErrnoException).code === "ENOENT"
            ? `Daemon not running (socket not found: ${socketPath})`
            : (err as NodeJS.ErrnoException).code === "ECONNREFUSED"
              ? `Daemon not accepting connections at ${socketPath}`
              : `Socket error: ${err.message}`;
        settle(() => reject(new Error(msg)));
      });

      socket.on("close", () => {
        clearTimeout(timer);
        settle(() => reject(new Error("Connection closed before response")));
      });
    } catch (err) {
      clearTimeout(timer);
      settle(() =>
        reject(
          new Error(
            `Failed to connect to daemon: ${(err as Error).message}`
          )
        )
      );
    }
  });
}

/** Get default socket path (lazy to avoid top-level process.env access issues) */
function getDefaultSocketPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "/tmp";
  return `${home}/.zee/agent-core/daemon.sock`;
}
