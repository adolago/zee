import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import { getCookie } from "hono/cookie"
import { z } from "zod"
import { createHash, randomBytes, randomUUID } from "crypto"
import { env } from "./env"
import { db, initDb } from "./db"
import {
  clearSessionCookie,
  createSession,
  getUserByEmail,
  getUserFromSession,
  hashPassword,
  requireApiAuth,
  SESSION_COOKIE,
  setSessionCookie,
  verifyPassword,
} from "./auth"
import { checkRateLimit } from "./rate-limit"
import { decryptJson, encryptJson, safeCompare } from "./crypto"

initDb()

const app = new Hono()
app.use("*", logger())
app.use(
  "/api/*",
  cors({
    origin: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : "*",
    allowHeaders: ["Content-Type", "Authorization", "X-API-Key", "X-Workspace-Key"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  }),
)

const emailSchema = z.string().min(3).email()
const passwordSchema = z.string().min(8)

const jsonResponse = <T>(c: any, data: T, status = 200) => c.json(data, status)

const now = () => Date.now()

const hashApiKey = (key: string) => createHash("sha256").update(key).digest("hex")

const getClientIp = (c: any) => {
  const forwarded = c.req.header("x-forwarded-for")
  if (forwarded) return forwarded.split(",")[0].trim()
  return c.req.header("x-real-ip") ?? "unknown"
}

const getSetting = (key: string, fallback: string) => {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined
  return row?.value ?? fallback
}

const setSetting = (key: string, value: string) => {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    key,
    value,
  )
}

const parseSettingNumber = (value: string, fallback: number) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const applyRetention = () => {
  const retentionLogs = parseSettingNumber(
    getSetting("retention_logs_days", String(env.RETENTION_LOGS_DAYS)),
    env.RETENTION_LOGS_DAYS,
  )
  const retentionTelemetry = parseSettingNumber(
    getSetting("retention_telemetry_days", String(env.RETENTION_TELEMETRY_DAYS)),
    env.RETENTION_TELEMETRY_DAYS,
  )
  const retentionUsage = parseSettingNumber(
    getSetting("retention_usage_days", String(env.RETENTION_USAGE_DAYS)),
    env.RETENTION_USAGE_DAYS,
  )
  const nowMs = now()
  db.prepare("DELETE FROM log_events WHERE created_at < ?")
    .run(nowMs - retentionLogs * 24 * 60 * 60 * 1000)
  db.prepare("DELETE FROM telemetry_events WHERE created_at < ?")
    .run(nowMs - retentionTelemetry * 24 * 60 * 60 * 1000)
  db.prepare("DELETE FROM usage_events WHERE created_at < ?")
    .run(nowMs - retentionUsage * 24 * 60 * 60 * 1000)
}

const recordBillingEvent = (workspaceId: string, event: string, metadata: Record<string, any> = {}) => {
  db.prepare(
    "INSERT INTO billing_events (id, workspace_id, event, amount, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(randomUUID(), workspaceId, event, null, JSON.stringify(metadata), now())
}

const ensureBootstrapUser = () => {
  const email = process.env.HOSTED_BOOTSTRAP_EMAIL
  const password = process.env.HOSTED_BOOTSTRAP_PASSWORD
  if (!email || !password) return
  const count = db.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number }
  if (count.count > 0) return
  const userId = randomUUID()
  db.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)")
    .run(userId, email, hashPassword(password), now())
  const orgId = randomUUID()
  db.prepare("INSERT INTO orgs (id, name, owner_user_id, created_at) VALUES (?, ?, ?, ?)")
    .run(orgId, "Default", userId, now())
  db.prepare("INSERT INTO org_members (org_id, user_id, role, created_at) VALUES (?, ?, ?, ?)")
    .run(orgId, userId, "owner", now())
  const workspaceId = randomUUID()
  db.prepare(
    "INSERT INTO workspaces (id, org_id, name, plan, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(workspaceId, orgId, "Default", env.DEFAULT_PLAN, "active", now())
  db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)")
    .run(workspaceId, userId, "owner", now())
}

ensureBootstrapUser()

const hasOrgAccess = (userId: string, orgId: string) => {
  const row = db
    .prepare("SELECT 1 FROM org_members WHERE org_id = ? AND user_id = ?")
    .get(orgId, userId) as { 1: number } | undefined
  return Boolean(row)
}

const hasWorkspaceAccess = (userId: string, workspaceId: string) => {
  const row = db
    .prepare("SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ?")
    .get(workspaceId, userId) as { 1: number } | undefined
  return Boolean(row)
}

const getWorkspaceById = (workspaceId: string) =>
  db
    .prepare(
      "SELECT id, org_id, name, plan, status, billing_customer_id, billing_portal_url, usage_cap_requests, usage_cap_tokens FROM workspaces WHERE id = ?",
    )
    .get(workspaceId) as
    | {
        id: string
        org_id: string
        name: string
        plan: string
        status: string
        billing_customer_id: string | null
        billing_portal_url: string | null
        usage_cap_requests: number | null
        usage_cap_tokens: number | null
      }
    | undefined

const planCatalog = {
  free: { id: "free", name: "Free", requestCap: 2000, tokenCap: 250000 },
  pro: { id: "pro", name: "Pro", requestCap: 100000, tokenCap: 20000000 },
  enterprise: { id: "enterprise", name: "Enterprise", requestCap: null, tokenCap: null },
}

const getPlan = (planId: string) => planCatalog[planId as keyof typeof planCatalog] ?? planCatalog.free

const startOfMonth = () => {
  const date = new Date()
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime()
}

const usageSummary = (workspaceId: string) => {
  const row = db
    .prepare(
      "SELECT COALESCE(SUM(requests), 0) as requests, COALESCE(SUM(tokens), 0) as tokens FROM usage_events WHERE workspace_id = ? AND created_at >= ?",
    )
    .get(workspaceId, startOfMonth()) as { requests: number; tokens: number }
  return row
}

const generateShareSlug = () => {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
  const size = 10
  let output = ""
  for (let i = 0; i < size; i += 1) {
    output += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return output
}

const requireShareAuth = (c: any) => {
  const provided = (c.req.header("x-api-key") || c.req.header("authorization")?.replace("Bearer ", ""))?.trim()
  if (env.API_KEYS.length === 0) return { ok: true }
  if (!provided) return { ok: false, status: 401, message: "Missing API key" }
  const match = env.API_KEYS.find((key) => safeCompare(key, provided))
  if (!match) return { ok: false, status: 403, message: "Invalid API key" }
  return { ok: true, key: provided }
}

const getWorkspaceKey = (c: any) => {
  const provided = c.req.header("x-workspace-key") || c.req.header("authorization")?.replace("Bearer ", "")
  return provided?.trim()
}

const validateWorkspaceKey = (workspaceId: string, key: string | undefined) => {
  if (!key) return false
  const hash = hashApiKey(key)
  const row = db
    .prepare("SELECT id FROM workspace_api_keys WHERE workspace_id = ? AND key_hash = ?")
    .get(workspaceId, hash) as { id: string } | undefined
  if (row) {
    db.prepare("UPDATE workspace_api_keys SET last_used_at = ? WHERE id = ?").run(now(), row.id)
    return true
  }
  return false
}

const getOauthConfig = (providerId: string) => {
  const key = providerId.toUpperCase().replace(/[^A-Z0-9]/g, "_")
  const prefix = `HOSTED_OAUTH_${key}_`
  const authorizeUrl = process.env[`${prefix}AUTHORIZE_URL`]
  const tokenUrl = process.env[`${prefix}TOKEN_URL`]
  const clientId = process.env[`${prefix}CLIENT_ID`]
  const clientSecret = process.env[`${prefix}CLIENT_SECRET`]
  const scopes = process.env[`${prefix}SCOPES`] ?? ""
  const baseUrl = process.env[`${prefix}BASE_URL`] ?? "https://api.openai.com"
  if (!authorizeUrl || !clientId) return null
  return { authorizeUrl, tokenUrl, clientId, clientSecret, scopes, baseUrl }
}

app.get("/", (c) => jsonResponse(c, { status: "ok" }))

const api = new Hono()
app.route("/api", api)

api.post("/auth/register", async (c) => {
  if (!env.ALLOW_SIGNUP) return jsonResponse(c, { error: "Signups disabled" }, 403)
  const body = await c.req.json().catch(() => null)
  if (!body) return jsonResponse(c, { error: "Invalid JSON" }, 400)
  const parsedEmail = emailSchema.safeParse(String(body.email ?? "").trim().toLowerCase())
  const parsedPassword = passwordSchema.safeParse(String(body.password ?? ""))
  if (!parsedEmail.success || !parsedPassword.success) {
    return jsonResponse(c, { error: "Invalid email or password" }, 400)
  }
  if (getUserByEmail(parsedEmail.data)) {
    return jsonResponse(c, { error: "Email already registered" }, 409)
  }
  const userId = randomUUID()
  db.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)")
    .run(userId, parsedEmail.data, hashPassword(parsedPassword.data), now())
  const sessionId = createSession(userId)
  setSessionCookie(c, sessionId)
  return jsonResponse(c, { id: userId, email: parsedEmail.data })
})

api.post("/auth/login", async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body) return jsonResponse(c, { error: "Invalid JSON" }, 400)
  const email = String(body.email ?? "").trim().toLowerCase()
  const password = String(body.password ?? "")
  const user = getUserByEmail(email)
  if (!user || !verifyPassword(password, user.password_hash)) {
    return jsonResponse(c, { error: "Invalid credentials" }, 401)
  }
  const sessionId = createSession(user.id)
  setSessionCookie(c, sessionId)
  return jsonResponse(c, { id: user.id, email: user.email })
})

api.post("/auth/logout", requireApiAuth, (c) => {
  const sessionId = getCookie(c, SESSION_COOKIE)
  if (sessionId) db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId)
  clearSessionCookie(c)
  return jsonResponse(c, { ok: true })
})

api.get("/auth/me", (c) => {
  const sessionId = getCookie(c, SESSION_COOKIE)
  const user = getUserFromSession(sessionId)
  if (!user) return jsonResponse(c, { user: null })
  return jsonResponse(c, { user })
})

api.get("/orgs", requireApiAuth, (c) => {
  const user = c.get("user") as { id: string }
  const orgs = db
    .prepare("SELECT id, name, owner_user_id, created_at FROM orgs WHERE id IN (SELECT org_id FROM org_members WHERE user_id = ?)")
    .all(user.id)
  return jsonResponse(c, { orgs })
})

api.post("/orgs", requireApiAuth, async (c) => {
  const user = c.get("user") as { id: string }
  const body = await c.req.json().catch(() => null)
  if (!body?.name) return jsonResponse(c, { error: "Missing name" }, 400)
  const orgId = randomUUID()
  db.prepare("INSERT INTO orgs (id, name, owner_user_id, created_at) VALUES (?, ?, ?, ?)")
    .run(orgId, String(body.name).trim(), user.id, now())
  db.prepare("INSERT INTO org_members (org_id, user_id, role, created_at) VALUES (?, ?, ?, ?)")
    .run(orgId, user.id, "owner", now())
  return jsonResponse(c, { id: orgId })
})

api.patch("/orgs/:orgId", requireApiAuth, async (c) => {
  const user = c.get("user") as { id: string }
  const orgId = c.req.param("orgId")
  if (!hasOrgAccess(user.id, orgId)) return jsonResponse(c, { error: "Forbidden" }, 403)
  const body = await c.req.json().catch(() => null)
  if (!body?.name) return jsonResponse(c, { error: "Missing name" }, 400)
  db.prepare("UPDATE orgs SET name = ? WHERE id = ?").run(String(body.name).trim(), orgId)
  return jsonResponse(c, { ok: true })
})

api.get("/orgs/:orgId/workspaces", requireApiAuth, (c) => {
  const user = c.get("user") as { id: string }
  const orgId = c.req.param("orgId")
  if (!hasOrgAccess(user.id, orgId)) return jsonResponse(c, { error: "Forbidden" }, 403)
  const workspaces = db
    .prepare("SELECT id, name, plan, status, created_at FROM workspaces WHERE org_id = ?")
    .all(orgId)
  return jsonResponse(c, { workspaces })
})

api.post("/orgs/:orgId/workspaces", requireApiAuth, async (c) => {
  const user = c.get("user") as { id: string }
  const orgId = c.req.param("orgId")
  if (!hasOrgAccess(user.id, orgId)) return jsonResponse(c, { error: "Forbidden" }, 403)
  const body = await c.req.json().catch(() => null)
  if (!body?.name) return jsonResponse(c, { error: "Missing name" }, 400)
  const workspaceId = randomUUID()
  db.prepare(
    "INSERT INTO workspaces (id, org_id, name, plan, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(workspaceId, orgId, String(body.name).trim(), env.DEFAULT_PLAN, "active", now())
  db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)")
    .run(workspaceId, user.id, "owner", now())
  return jsonResponse(c, { id: workspaceId })
})

api.get("/workspaces/:workspaceId", requireApiAuth, (c) => {
  const user = c.get("user") as { id: string }
  const workspaceId = c.req.param("workspaceId")
  if (!hasWorkspaceAccess(user.id, workspaceId)) return jsonResponse(c, { error: "Forbidden" }, 403)
  const workspace = getWorkspaceById(workspaceId)
  return jsonResponse(c, { workspace })
})

api.patch("/workspaces/:workspaceId", requireApiAuth, async (c) => {
  const user = c.get("user") as { id: string }
  const workspaceId = c.req.param("workspaceId")
  if (!hasWorkspaceAccess(user.id, workspaceId)) return jsonResponse(c, { error: "Forbidden" }, 403)
  const body = await c.req.json().catch(() => null)
  if (!body?.name) return jsonResponse(c, { error: "Missing name" }, 400)
  db.prepare("UPDATE workspaces SET name = ? WHERE id = ?").run(String(body.name).trim(), workspaceId)
  return jsonResponse(c, { ok: true })
})

api.post("/workspaces/:workspaceId/api-keys", requireApiAuth, async (c) => {
  const user = c.get("user") as { id: string }
  const workspaceId = c.req.param("workspaceId")
  if (!hasWorkspaceAccess(user.id, workspaceId)) return jsonResponse(c, { error: "Forbidden" }, 403)
  const body = await c.req.json().catch(() => ({}))
  const label = String(body.label ?? "default").trim() || "default"
  const rawKey = `ac_${randomBytes(24).toString("hex")}`
  db.prepare(
    "INSERT INTO workspace_api_keys (id, workspace_id, key_hash, label, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(randomUUID(), workspaceId, hashApiKey(rawKey), label, now())
  return jsonResponse(c, { key: rawKey })
})

api.get("/workspaces/:workspaceId/api-keys", requireApiAuth, (c) => {
  const user = c.get("user") as { id: string }
  const workspaceId = c.req.param("workspaceId")
  if (!hasWorkspaceAccess(user.id, workspaceId)) return jsonResponse(c, { error: "Forbidden" }, 403)
  const keys = db
    .prepare("SELECT id, label, created_at, last_used_at FROM workspace_api_keys WHERE workspace_id = ?")
    .all(workspaceId)
  return jsonResponse(c, { keys })
})

api.get("/workspaces/:workspaceId/providers", requireApiAuth, (c) => {
  const user = c.get("user") as { id: string }
  const workspaceId = c.req.param("workspaceId")
  if (!hasWorkspaceAccess(user.id, workspaceId)) return jsonResponse(c, { error: "Forbidden" }, 403)
  const providers = db
    .prepare("SELECT id, provider_id, connection_type, created_at FROM provider_connections WHERE workspace_id = ?")
    .all(workspaceId)
  return jsonResponse(c, { providers })
})

api.post("/workspaces/:workspaceId/providers", requireApiAuth, async (c) => {
  const user = c.get("user") as { id: string }
  const workspaceId = c.req.param("workspaceId")
  if (!hasWorkspaceAccess(user.id, workspaceId)) return jsonResponse(c, { error: "Forbidden" }, 403)
  const body = await c.req.json().catch(() => null)
  if (!body?.provider_id || !body?.api_key) return jsonResponse(c, { error: "Missing provider_id or api_key" }, 400)
  const payload = {
    base_url: String(body.base_url ?? "https://api.openai.com"),
    api_key: String(body.api_key),
    account_label: String(body.account_label ?? ""),
  }
  db.prepare(
    "INSERT INTO provider_connections (id, workspace_id, provider_id, connection_type, encrypted_data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(randomUUID(), workspaceId, String(body.provider_id), "api", encryptJson(payload), now(), now())
  return jsonResponse(c, { ok: true })
})

api.delete("/workspaces/:workspaceId/providers/:connectionId", requireApiAuth, (c) => {
  const user = c.get("user") as { id: string }
  const workspaceId = c.req.param("workspaceId")
  const connectionId = c.req.param("connectionId")
  if (!hasWorkspaceAccess(user.id, workspaceId)) return jsonResponse(c, { error: "Forbidden" }, 403)
  db.prepare("DELETE FROM provider_connections WHERE id = ? AND workspace_id = ?").run(connectionId, workspaceId)
  return jsonResponse(c, { ok: true })
})

api.post("/workspaces/:workspaceId/providers/:providerId/oauth/authorize", requireApiAuth, (c) => {
  const user = c.get("user") as { id: string }
  const workspaceId = c.req.param("workspaceId")
  const providerId = c.req.param("providerId")
  if (!hasWorkspaceAccess(user.id, workspaceId)) return jsonResponse(c, { error: "Forbidden" }, 403)
  const config = getOauthConfig(providerId)
  if (!config) return jsonResponse(c, { error: "OAuth not configured" }, 400)
  const state = randomUUID()
  db.prepare("INSERT INTO oauth_states (state, provider_id, workspace_id, created_at) VALUES (?, ?, ?, ?)")
    .run(state, providerId, workspaceId, now())
  const redirectUri = `${env.BASE_URL}/oauth/${providerId}/callback`
  const url = new URL(config.authorizeUrl)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("client_id", config.clientId)
  url.searchParams.set("redirect_uri", redirectUri)
  if (config.scopes) url.searchParams.set("scope", config.scopes)
  url.searchParams.set("state", state)
  return jsonResponse(c, { url: url.toString() })
})

api.post("/share", async (c) => {
  const auth = requireShareAuth(c)
  if (!auth.ok) return jsonResponse(c, { error: auth.message }, auth.status)

  const body = await c.req.json().catch(() => null)
  if (!body?.info || !body?.messages) {
    return jsonResponse(c, { error: "Missing info or messages" }, 400)
  }

  const rateKey = `share:${getClientIp(c)}`
  const limit = checkRateLimit(rateKey, env.RATE_LIMIT_PER_MINUTE, 60 * 1000)
  if (!limit.allowed) {
    return jsonResponse(c, { error: "Rate limit exceeded" }, 429)
  }

  let slug = generateShareSlug()
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const existing = db.prepare("SELECT slug FROM shares WHERE slug = ?").get(slug) as { slug: string } | undefined
    if (!existing) break
    slug = generateShareSlug()
  }

  const expiresAt = now() + env.SHARE_TTL_HOURS * 60 * 60 * 1000
  const createdBy = auth.key ? `api:${auth.key.slice(0, 6)}` : "anonymous"
  db.prepare("INSERT INTO shares (slug, created_at, expires_at, created_by, title, data) VALUES (?, ?, ?, ?, ?, ?)")
    .run(slug, now(), expiresAt, createdBy, String(body.title ?? ""), JSON.stringify(body))

  return jsonResponse(c, { slug, url: `${env.BASE_URL}/api/share/${slug}`, expires_at: expiresAt })
})

api.get("/share/:slug", (c) => {
  const slug = c.req.param("slug")
  const row = db.prepare("SELECT data, expires_at FROM shares WHERE slug = ?").get(slug) as
    | { data: string; expires_at: number }
    | undefined
  if (!row) return jsonResponse(c, { error: "Not found" }, 404)
  if (row.expires_at < now()) return jsonResponse(c, { error: "Share expired" }, 404)
  const parsed = JSON.parse(row.data)
  return jsonResponse(c, parsed)
})

api.post("/telemetry", async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body?.kind) return jsonResponse(c, { error: "Missing kind" }, 400)
  db.prepare("INSERT INTO telemetry_events (id, workspace_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(randomUUID(), body.workspace_id ?? null, String(body.kind), JSON.stringify(body.payload ?? {}), now())
  applyRetention()
  return jsonResponse(c, { ok: true })
})

api.post("/logs", async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body?.level || !body?.message) return jsonResponse(c, { error: "Missing level or message" }, 400)
  db.prepare("INSERT INTO log_events (id, workspace_id, level, message, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(
      randomUUID(),
      body.workspace_id ?? null,
      String(body.level),
      String(body.message),
      JSON.stringify(body.meta ?? {}),
      now(),
    )
  applyRetention()
  return jsonResponse(c, { ok: true })
})

api.get("/analytics/summary", requireApiAuth, (c) => {
  const user = c.get("user") as { id: string }
  const workspaceId = c.req.query("workspace_id")
  if (!workspaceId) return jsonResponse(c, { error: "Missing workspace_id" }, 400)
  if (!hasWorkspaceAccess(user.id, workspaceId)) return jsonResponse(c, { error: "Forbidden" }, 403)
  return jsonResponse(c, { summary: usageSummary(workspaceId) })
})

api.get("/billing/plans", (c) => {
  return jsonResponse(c, { plans: Object.values(planCatalog) })
})

api.post("/workspaces/:workspaceId/plan", requireApiAuth, async (c) => {
  const user = c.get("user") as { id: string }
  const workspaceId = c.req.param("workspaceId")
  if (!hasWorkspaceAccess(user.id, workspaceId)) return jsonResponse(c, { error: "Forbidden" }, 403)
  const body = await c.req.json().catch(() => null)
  const planId = String(body?.plan ?? env.DEFAULT_PLAN)
  const plan = getPlan(planId)
  db.prepare("UPDATE workspaces SET plan = ?, usage_cap_requests = ?, usage_cap_tokens = ? WHERE id = ?")
    .run(plan.id, plan.requestCap, plan.tokenCap, workspaceId)
  recordBillingEvent(workspaceId, "plan.updated", { plan: plan.id })
  return jsonResponse(c, { ok: true })
})

api.post("/billing/portal", requireApiAuth, (c) => {
  if (!env.BILLING_PORTAL_URL) return jsonResponse(c, { error: "Billing portal not configured" }, 501)
  return jsonResponse(c, { url: env.BILLING_PORTAL_URL })
})

api.get("/billing/history", requireApiAuth, (c) => {
  const user = c.get("user") as { id: string }
  const workspaceId = c.req.query("workspace_id")
  if (!workspaceId) return jsonResponse(c, { error: "Missing workspace_id" }, 400)
  if (!hasWorkspaceAccess(user.id, workspaceId)) return jsonResponse(c, { error: "Forbidden" }, 403)
  const events = db
    .prepare("SELECT id, event, amount, metadata, created_at FROM billing_events WHERE workspace_id = ? ORDER BY created_at DESC")
    .all(workspaceId)
  return jsonResponse(c, { events })
})

api.post("/settings/retention", requireApiAuth, async (c) => {
  const body = await c.req.json().catch(() => null)
  if (body?.logs_days) setSetting("retention_logs_days", String(body.logs_days))
  if (body?.telemetry_days) setSetting("retention_telemetry_days", String(body.telemetry_days))
  if (body?.usage_days) setSetting("retention_usage_days", String(body.usage_days))
  applyRetention()
  return jsonResponse(c, { ok: true })
})

api.post("/gateway/:workspaceId/chat", async (c) => {
  const workspaceId = c.req.param("workspaceId")
  const sessionId = getCookie(c, SESSION_COOKIE)
  const user = getUserFromSession(sessionId)
  const workspaceKey = getWorkspaceKey(c)

  const isMember = user ? hasWorkspaceAccess(user.id, workspaceId) : false
  const keyValid = validateWorkspaceKey(workspaceId, workspaceKey)
  if (!isMember && !keyValid) return jsonResponse(c, { error: "Unauthorized" }, 401)

  const workspace = getWorkspaceById(workspaceId)
  if (!workspace) return jsonResponse(c, { error: "Workspace not found" }, 404)

  const plan = getPlan(workspace.plan)
  const usage = usageSummary(workspaceId)
  if (plan.requestCap !== null && usage.requests + 1 > plan.requestCap) {
    return jsonResponse(c, { error: "Request limit exceeded" }, 429)
  }
  if (plan.tokenCap !== null && usage.tokens > plan.tokenCap) {
    return jsonResponse(c, { error: "Token limit exceeded" }, 429)
  }

  const payload = await c.req.json().catch(() => null)
  if (!payload?.messages) return jsonResponse(c, { error: "Missing messages" }, 400)

  const providerId = String(payload.provider_id ?? "")
  const connection = providerId
    ? (db
        .prepare(
          "SELECT encrypted_data FROM provider_connections WHERE workspace_id = ? AND provider_id = ? ORDER BY created_at DESC LIMIT 1",
        )
        .get(workspaceId, providerId) as { encrypted_data: string } | undefined)
    : (db
        .prepare("SELECT encrypted_data FROM provider_connections WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 1")
        .get(workspaceId) as { encrypted_data: string } | undefined)

  if (!connection) return jsonResponse(c, { error: "No provider connected" }, 400)

  const connData = decryptJson<{ base_url: string; api_key?: string; access_token?: string }>(connection.encrypted_data)
  const baseUrl = connData.base_url.replace(/\/$/, "")
  const apiKey = connData.api_key ?? connData.access_token
  if (!apiKey) return jsonResponse(c, { error: "Provider credentials missing" }, 400)

  const upstream = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: payload.model ?? "gpt-4.1-mini",
      messages: payload.messages,
      temperature: payload.temperature,
    }),
  })

  if (!upstream.ok) {
    const errorText = await upstream.text()
    return jsonResponse(c, { error: "Upstream error", detail: errorText }, 502)
  }

  const data = await upstream.json()
  const tokens = Number(data?.usage?.total_tokens ?? 0)
  db.prepare(
    "INSERT INTO usage_events (id, workspace_id, provider_id, model, tokens, requests, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    randomUUID(),
    workspaceId,
    providerId || null,
    String(payload.model ?? ""),
    tokens,
    1,
    JSON.stringify({ request_id: data?.id ?? null }),
    now(),
  )
  applyRetention()

  return jsonResponse(c, data)
})

app.get("/oauth/:providerId/callback", async (c) => {
  const providerId = c.req.param("providerId")
  const code = c.req.query("code")
  const state = c.req.query("state")
  if (!code || !state) return jsonResponse(c, { error: "Missing code or state" }, 400)
  const record = db
    .prepare("SELECT workspace_id FROM oauth_states WHERE state = ? AND provider_id = ?")
    .get(state, providerId) as { workspace_id: string } | undefined
  if (!record) return jsonResponse(c, { error: "Invalid OAuth state" }, 400)
  const config = getOauthConfig(providerId)
  if (!config) return jsonResponse(c, { error: "OAuth not configured" }, 400)

  let tokenPayload: { access_token: string; refresh_token?: string } = { access_token: code }
  if (config.tokenUrl && config.clientSecret) {
    const body = new URLSearchParams()
    body.set("grant_type", "authorization_code")
    body.set("code", code)
    body.set("client_id", config.clientId)
    body.set("client_secret", config.clientSecret)
    body.set("redirect_uri", `${env.BASE_URL}/oauth/${providerId}/callback`)
    const res = await fetch(config.tokenUrl, { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } })
    if (!res.ok) {
      const text = await res.text()
      return jsonResponse(c, { error: "Token exchange failed", details: text }, 502)
    }
    const json = await res.json()
    tokenPayload = { access_token: json.access_token, refresh_token: json.refresh_token }
  }

  const encrypted = encryptJson({ base_url: config.baseUrl, access_token: tokenPayload.access_token, refresh_token: tokenPayload.refresh_token })
  const connectionId = randomUUID()
  db.prepare(
    "INSERT INTO provider_connections (id, workspace_id, provider_id, connection_type, encrypted_data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(connectionId, record.workspace_id, providerId, "oauth", encrypted, now(), now())
  db.prepare("DELETE FROM oauth_states WHERE state = ?").run(state)
  return jsonResponse(c, { ok: true, connectionId })
})

export { app }
