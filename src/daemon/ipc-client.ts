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
    process.env.ZEE_IPC_SOCKET ||
    getDefaultSocketPath();
  const timeoutMs = options.timeoutMs ?? 10000;

  const request: DaemonRequest<TParams> = {
    id: randomUUID(),
    command,
    params,
    timestamp: Date.now(),
  };

  const formatSocketError = (error: unknown): Error => {
    const err = error as NodeJS.ErrnoException;
    const code = err.code;
    const message = (err instanceof Error ? err.message : String(error)).toLowerCase();
    if (code === "ENOENT" || message.includes("enoent")) {
      return new Error(`Daemon not running (socket not found: ${socketPath})`);
    }
    if (
      code === "ECONNREFUSED" ||
      code === "ENXIO" ||
      message.includes("econnrefused") ||
      message.includes("enxio") ||
      message.includes("no such device or address")
    ) {
      return new Error(`Daemon not accepting connections at ${socketPath}`);
    }
    if (err instanceof Error) return err;
    return new Error(String(error));
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
        settle(() => reject(formatSocketError(err)));
      });

      socket.on("close", () => {
        clearTimeout(timer);
        settle(() => reject(new Error("Connection closed before response")));
      });
    } catch (err) {
      clearTimeout(timer);
      settle(() => reject(formatSocketError(err)));
    }
  });
}

/** Get default socket path (lazy to avoid top-level process.env access issues) */
function getDefaultSocketPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "/tmp";
  const stateHome = process.env.XDG_STATE_HOME || `${home}/.local/state`;
  return `${stateHome}/zee/daemon.sock`;
}
