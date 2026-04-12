import { Database } from "bun:sqlite"
import { mkdirSync } from "fs"
import path from "path"
import { env } from "./env"

const ensureDir = (filePath: string) => {
  const dir = path.dirname(filePath)
  mkdirSync(dir, { recursive: true })
}

ensureDir(env.DB_PATH)

export const db = new Database(env.DB_PATH, { create: true })

export function initDb() {
  db.exec("PRAGMA journal_mode = WAL;")
  db.exec("PRAGMA foreign_keys = ON;")

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS orgs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS org_members (
      org_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (org_id, user_id),
      FOREIGN KEY(org_id) REFERENCES orgs(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      name TEXT NOT NULL,
      plan TEXT NOT NULL,
      status TEXT NOT NULL,
      billing_customer_id TEXT,
      billing_portal_url TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(org_id) REFERENCES orgs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workspace_members (
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (workspace_id, user_id),
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workspace_api_keys (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      label TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS shares (
      slug TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      created_by TEXT,
      title TEXT,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS provider_connections (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      connection_type TEXT NOT NULL,
      encrypted_data TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS log_events (
      id TEXT PRIMARY KEY,
      workspace_id TEXT,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      meta TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS billing_events (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      event TEXT NOT NULL,
      amount INTEGER,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
}
