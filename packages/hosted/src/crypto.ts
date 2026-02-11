import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "crypto"
import fs from "fs"
import path from "path"
import { db, initDb } from "./db"
import { env } from "./env"

const deriveKey = (input: string) => createHash("sha256").update(input).digest()

const KEY_FILE = path.join(env.DATA_DIR, "vault.key")
const LEGACY_DEV_KEY = "zee-hosted-dev"

function parseVaultKey(value: string): Buffer | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const base64Match = /^[A-Za-z0-9+/=]+$/.test(trimmed)
  if (!base64Match) return null
  const buf = Buffer.from(trimmed, "base64")
  return buf.length === 32 ? buf : null
}

function loadKeyFile(): Buffer | null {
  try {
    if (!fs.existsSync(KEY_FILE)) return null
    const raw = fs.readFileSync(KEY_FILE, "utf8").trim()
    return parseVaultKey(raw)
  } catch {
    return null
  }
}

function writeKeyFile(key: Buffer): void {
  const dir = path.dirname(KEY_FILE)
  fs.mkdirSync(dir, { recursive: true })
  // Best-effort mode restriction on POSIX; ignored on Windows.
  fs.writeFileSync(KEY_FILE, key.toString("base64") + "\n", { mode: 0o600 })
}

function encryptStringWithKey(key: Buffer, value: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return JSON.stringify({
    v: 1,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: encrypted.toString("base64"),
  })
}

function decryptStringWithKey(key: Buffer, payload: string) {
  const parsed = JSON.parse(payload)
  if (!parsed || parsed.v !== 1) {
    throw new Error("Unsupported vault payload")
  }
  const iv = Buffer.from(parsed.iv, "base64")
  const tag = Buffer.from(parsed.tag, "base64")
  const data = Buffer.from(parsed.data, "base64")
  const decipher = createDecipheriv("aes-256-gcm", key, iv)
  decipher.setAuthTag(tag)
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()])
  return decrypted.toString("utf8")
}

function migrateLegacyVaultKey(newKey: Buffer): void {
  initDb()

  const providerTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'provider_connections'")
    .get() as { name?: string } | undefined
  if (!providerTable?.name) return

  const countRow = db.prepare("SELECT COUNT(*) as c FROM provider_connections").get() as { c: number } | undefined
  const count = countRow?.c ?? 0
  if (count <= 0) return

  const legacyKey = deriveKey(LEGACY_DEV_KEY)
  const rows = db
    .prepare("SELECT id, encrypted_data FROM provider_connections")
    .all() as Array<{ id: string; encrypted_data: string }>

  // If any row fails to decrypt, abort rather than corrupting data.
  const decrypted = rows.map((row) => ({
    id: row.id,
    data: decryptStringWithKey(legacyKey, row.encrypted_data),
  }))

  const update = db.prepare("UPDATE provider_connections SET encrypted_data = ?, updated_at = ? WHERE id = ?")
  const now = Date.now()
  db.transaction(() => {
    for (const row of decrypted) {
      update.run(encryptStringWithKey(newKey, row.data), now, row.id)
    }
  })()
}

const resolveVaultKey = () => {
  if (env.VAULT_KEY) {
    const trimmed = env.VAULT_KEY.trim()
    return parseVaultKey(trimmed) ?? deriveKey(trimmed)
  }

  const fromFile = loadKeyFile()
  if (fromFile) return fromFile

  // First run: migrate any legacy hardcoded key encryption, otherwise generate a new key.
  const next = randomBytes(32)
  try {
    migrateLegacyVaultKey(next)
  } catch {
    // If migration fails, refuse to silently lose access to existing encrypted data.
    throw new Error(
      "Hosted vault key migration failed. Set HOSTED_VAULT_KEY to the previous value to recover, then rotate.",
    )
  }
  writeKeyFile(next)
  return next
}

const KEY = resolveVaultKey()

export function encryptString(value: string) {
  return encryptStringWithKey(KEY, value)
}

export function decryptString(payload: string) {
  return decryptStringWithKey(KEY, payload)
}

export function encryptJson(value: unknown) {
  return encryptString(JSON.stringify(value))
}

export function decryptJson<T>(payload: string): T {
  return JSON.parse(decryptString(payload)) as T
}

export function safeCompare(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}
