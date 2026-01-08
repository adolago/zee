/**
 * Session compatibility layer for pi-coding-agent migration.
 * Provides minimal stubs for session management.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const CURRENT_SESSION_VERSION = 1;

interface SessionHeader {
  type: string;
  version: number;
  id: string;
  timestamp: string;
  cwd?: string;
}

/**
 * Simple session manager stub.
 * In the OpenCode migration, sessions are managed by the OpenCode SDK.
 * This stub provides compatibility for code that still references the old interface.
 */
export class SessionManager {
  private sessionFile: string;
  private messages: unknown[] = [];
  private header: SessionHeader | null = null;

  private constructor(sessionFile: string) {
    this.sessionFile = sessionFile;
  }

  static open(sessionFile: string): SessionManager {
    const manager = new SessionManager(sessionFile);
    manager.load();
    return manager;
  }

  static create(sessionFile: string): SessionManager {
    const manager = new SessionManager(sessionFile);
    return manager;
  }

  private load(): void {
    try {
      if (fs.existsSync(this.sessionFile)) {
        const content = fs.readFileSync(this.sessionFile, "utf-8");
        const lines = content.trim().split("\n").filter(Boolean);
        this.messages = lines.map((line) => JSON.parse(line));
        // First line is usually the header
        if (this.messages.length > 0) {
          const first = this.messages[0] as Record<string, unknown>;
          if (first.type === "session") {
            this.header = first as unknown as SessionHeader;
          }
        }
      }
    } catch {
      // Ignore errors loading session
    }
  }

  getMessages(): unknown[] {
    return this.messages;
  }

  getSessionFile(): string {
    return this.sessionFile;
  }

  getSessionDir(): string {
    return path.dirname(this.sessionFile);
  }

  getSessionId(): string {
    return this.header?.id ?? crypto.randomUUID();
  }

  getCwd(): string {
    return this.header?.cwd ?? process.cwd();
  }

  getLeafId(): string | undefined {
    // Return the last message id if it exists
    if (this.messages.length > 0) {
      const last = this.messages[this.messages.length - 1] as Record<
        string,
        unknown
      >;
      return last.id as string | undefined;
    }
    return undefined;
  }

  createBranchedSession(leafId: string): string | null {
    // Create a new session file branching from the given leaf
    const sessionId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const fileTimestamp = timestamp.replace(/[:.]/g, "-");
    const newSessionFile = path.join(
      this.getSessionDir(),
      `${fileTimestamp}_${sessionId}_branch.jsonl`,
    );
    const header = {
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id: sessionId,
      timestamp,
      cwd: this.getCwd(),
      parentSession: this.sessionFile,
      branchFrom: leafId,
    };
    try {
      fs.writeFileSync(newSessionFile, `${JSON.stringify(header)}\n`, "utf-8");
      return newSessionFile;
    } catch {
      return null;
    }
  }

  appendMessage(message: unknown): void {
    this.messages.push(message);
    try {
      fs.appendFileSync(
        this.sessionFile,
        `${JSON.stringify(message)}\n`,
        "utf-8",
      );
    } catch {
      // Ignore write errors
    }
  }

  save(): void {
    try {
      const content = this.messages.map((m) => JSON.stringify(m)).join("\n");
      fs.writeFileSync(this.sessionFile, `${content}\n`, "utf-8");
    } catch {
      // Ignore write errors
    }
  }
}

/**
 * Auth storage type.
 */
export type AuthStorage = {
  getApiKey: (provider: string, opts?: unknown) => Promise<string | undefined>;
  setRuntimeApiKey: (provider: string, key: string) => void;
};

/**
 * Auth storage discovery stub.
 * In pi-coding-agent this discovers API keys from various sources.
 */
export function discoverAuthStorage(_agentDir?: string): AuthStorage {
  const runtimeKeys = new Map<string, string>();
  return {
    getApiKey: async (provider: string) => runtimeKeys.get(provider),
    setRuntimeApiKey: (provider: string, key: string) => {
      runtimeKeys.set(provider, key);
    },
  };
}

/**
 * Model type from pi-ai compat.
 */
type Model = {
  provider: string;
  id: string;
  name?: string;
  contextWindow?: number;
  input?: string[];
  baseUrl?: string;
  maxTokens?: number;
  reasoning?: boolean;
};

/**
 * Model registry type.
 */
export type ModelRegistry = {
  getAll: () => Model[];
  getAvailable: () => Model[];
  find: (provider: string, id: string) => Model | null;
};

/**
 * Model discovery stub.
 * In pi-coding-agent this discovers available models.
 */
export function discoverModels(
  _authStorage?: AuthStorage,
  _agentDir?: string,
): ModelRegistry {
  return {
    getAll: () => [],
    getAvailable: () => [],
    find: () => null,
  };
}
