import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { Global } from "@/global"
import { Log } from "@/util/log"

const log = Log.create({ service: "gateway:node-client" })

export type NodeClientPlatform = "macos" | "ios" | "android" | "linux" | "windows" | "unknown"
export type NodeClientSecurityMode = "deny" | "allowlist" | "full"

export type NodeClientPolicy = {
  enabled: boolean
  securityMode: NodeClientSecurityMode
  allowRemotePairing: boolean
  toolAllowlist: string[]
  maxPairedNodes: number
}

export type NodeClientAuditSnapshot = {
  active: number
  revoked: number
  total: number
  unknownStatus: number
  duplicateTokenHashes: number
  missingTokenHashes: number
  activeMissingLastSeen: number
  revokedMissingTimestamp: number
  revokedMissingReason: number
}

export type NodeClientRecord = {
  id: string
  label: string
  platform: NodeClientPlatform
  createdAt: number
  updatedAt: number
  lastSeenAt?: number
  status: "paired" | "revoked"
  revokedAt?: number
  revokeReason?: string
  metadata: Record<string, string>
  toolAllowlist: string[]
  tokenHash: string
}

type NodeClientState = {
  version: 1
  nodes: Record<string, NodeClientRecord>
}

const DEFAULT_POLICY: NodeClientPolicy = {
  enabled: false,
  securityMode: "deny",
  allowRemotePairing: false,
  toolAllowlist: [],
  maxPairedNodes: 10,
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function resolveStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
}

function resolveBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function resolveSecurityMode(value: unknown): NodeClientSecurityMode {
  if (value === "deny" || value === "allowlist" || value === "full") return value
  return "deny"
}

function sanitizeLabel(label: string): string {
  return label.trim().slice(0, 120)
}

function hasFiniteTimestamp(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value)
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf-8").digest("hex")
}

function tokenEquals(left: string, right: string): boolean {
  const leftBuf = Buffer.from(left, "utf-8")
  const rightBuf = Buffer.from(right, "utf-8")
  if (leftBuf.length !== rightBuf.length) return false
  return timingSafeEqual(leftBuf, rightBuf)
}

function sanitizeRecord(record: NodeClientRecord) {
  const safe = { ...record } as Omit<NodeClientRecord, "tokenHash"> & { tokenHash?: string }
  delete safe.tokenHash
  return safe
}

export function resolveNodeClientPolicy(config: unknown): NodeClientPolicy {
  const root = asObject(config) ?? {}
  const gateway = asObject(root.gateway) ?? {}
  const nodeClient = asObject(gateway.nodeClient) ?? {}

  const maxPairedNodesRaw = nodeClient.maxPairedNodes
  const maxPairedNodes =
    typeof maxPairedNodesRaw === "number" && Number.isFinite(maxPairedNodesRaw)
      ? Math.max(1, Math.floor(maxPairedNodesRaw))
      : DEFAULT_POLICY.maxPairedNodes

  return {
    enabled: resolveBool(nodeClient.enabled, DEFAULT_POLICY.enabled),
    securityMode: resolveSecurityMode(nodeClient.securityMode),
    allowRemotePairing: resolveBool(nodeClient.allowRemotePairing, DEFAULT_POLICY.allowRemotePairing),
    toolAllowlist: resolveStringArray(nodeClient.toolAllowlist),
    maxPairedNodes,
  }
}

export class NodeClientRegistry {
  private readonly filepath = path.join(Global.Path.state, "gateway-node-clients.json")

  private async readState(): Promise<NodeClientState> {
    const raw = await fs.readFile(this.filepath, "utf-8").catch(() => "")
    if (!raw) return { version: 1, nodes: {} }
    try {
      const parsed = JSON.parse(raw) as NodeClientState
      return {
        version: 1,
        nodes: parsed?.nodes ?? {},
      }
    } catch {
      return { version: 1, nodes: {} }
    }
  }

  private async writeState(state: NodeClientState): Promise<void> {
    await fs.mkdir(path.dirname(this.filepath), { recursive: true })
    await fs.writeFile(this.filepath, JSON.stringify(state, null, 2) + "\n", "utf-8")
  }

  private findRecord(state: NodeClientState, nodeId: string): NodeClientRecord {
    const record = state.nodes[nodeId]
    if (!record) {
      throw new Error(`Paired node not found: ${nodeId}`)
    }
    return record
  }

  private assertToken(record: NodeClientRecord, token: string): void {
    const tokenHash = hashToken(token)
    if (!tokenEquals(record.tokenHash, tokenHash)) {
      throw new Error("Invalid node token")
    }
    if (record.status === "revoked") {
      throw new Error(`Node is revoked: ${record.id}`)
    }
  }

  async pairNode(
    input: {
      label: string
      platform: NodeClientPlatform
      toolAllowlist?: string[]
      metadata?: Record<string, string>
    },
    policy: NodeClientPolicy,
  ): Promise<{ node: ReturnType<typeof sanitizeRecord>; token: string }> {
    const state = await this.readState()
    const activeNodes = Object.values(state.nodes).filter((node) => node.status === "paired")

    if (activeNodes.length >= policy.maxPairedNodes) {
      throw new Error(`Paired node limit reached (${policy.maxPairedNodes})`)
    }

    const id = `node_${randomUUID().replace(/-/g, "").slice(0, 20)}`
    const token = randomBytes(24).toString("hex")
    const now = Date.now()

    const record: NodeClientRecord = {
      id,
      label: sanitizeLabel(input.label) || "unnamed-node",
      platform: input.platform,
      status: "paired",
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
      metadata: input.metadata ?? {},
      toolAllowlist: input.toolAllowlist ?? [],
      tokenHash: hashToken(token),
    }

    state.nodes[id] = record
    await this.writeState(state)
    log.info("Node paired", { id, platform: record.platform, label: record.label })

    return { node: sanitizeRecord(record), token }
  }

  async reconnect(input: { nodeId: string; token: string }): Promise<ReturnType<typeof sanitizeRecord>> {
    const state = await this.readState()
    const record = this.findRecord(state, input.nodeId)
    this.assertToken(record, input.token)

    const now = Date.now()
    record.lastSeenAt = now
    record.updatedAt = now
    state.nodes[record.id] = record
    await this.writeState(state)

    return sanitizeRecord(record)
  }

  async revoke(input: { nodeId: string; reason?: string }): Promise<ReturnType<typeof sanitizeRecord>> {
    const state = await this.readState()
    const record = this.findRecord(state, input.nodeId)

    const now = Date.now()
    record.status = "revoked"
    record.revokedAt = now
    record.updatedAt = now
    record.revokeReason = input.reason?.trim() || "revoked-by-operator"
    state.nodes[record.id] = record

    await this.writeState(state)
    log.warn("Node revoked", { id: record.id, reason: record.revokeReason })

    return sanitizeRecord(record)
  }

  async list(opts: { includeRevoked?: boolean } = {}): Promise<Array<ReturnType<typeof sanitizeRecord>>> {
    const state = await this.readState()
    return Object.values(state.nodes)
      .filter((record) => (opts.includeRevoked ? true : record.status === "paired"))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((record) => sanitizeRecord(record))
  }

  async authorizeTool(input: {
    nodeId: string
    token: string
    tool: string
    policy: NodeClientPolicy
  }): Promise<{
    authorized: boolean
    mode: NodeClientSecurityMode
    reason: string
    node: ReturnType<typeof sanitizeRecord>
  }> {
    const state = await this.readState()
    const record = this.findRecord(state, input.nodeId)
    this.assertToken(record, input.token)

    const mode = input.policy.securityMode
    if (mode === "deny") {
      return {
        authorized: false,
        mode,
        reason: "Node policy is deny",
        node: sanitizeRecord(record),
      }
    }

    if (mode === "full") {
      return {
        authorized: true,
        mode,
        reason: "Node policy is full",
        node: sanitizeRecord(record),
      }
    }

    const allowlist = new Set([...input.policy.toolAllowlist, ...record.toolAllowlist])
    const authorized = allowlist.has(input.tool)
    return {
      authorized,
      mode,
      reason: authorized ? "Tool is allowlisted" : "Tool is not allowlisted",
      node: sanitizeRecord(record),
    }
  }

  async getStats(): Promise<{ active: number; revoked: number; total: number }> {
    const state = await this.readState()
    const nodes = Object.values(state.nodes)
    const active = nodes.filter((record) => record.status === "paired").length
    const revoked = nodes.filter((record) => record.status === "revoked").length
    return {
      active,
      revoked,
      total: nodes.length,
    }
  }

  async getAuditSnapshot(): Promise<NodeClientAuditSnapshot> {
    const state = await this.readState()
    const nodes = Object.values(state.nodes)
    const tokenHashCounts = new Map<string, number>()

    let active = 0
    let revoked = 0
    let unknownStatus = 0
    let missingTokenHashes = 0
    let activeMissingLastSeen = 0
    let revokedMissingTimestamp = 0
    let revokedMissingReason = 0

    for (const record of nodes) {
      const tokenHash = typeof record.tokenHash === "string" ? record.tokenHash.trim() : ""
      if (tokenHash) {
        tokenHashCounts.set(tokenHash, (tokenHashCounts.get(tokenHash) ?? 0) + 1)
      } else {
        missingTokenHashes++
      }

      if (record.status === "paired") {
        active++
        if (!hasFiniteTimestamp(record.lastSeenAt)) {
          activeMissingLastSeen++
        }
        continue
      }

      if (record.status === "revoked") {
        revoked++
        if (!hasFiniteTimestamp(record.revokedAt)) {
          revokedMissingTimestamp++
        }
        if (typeof record.revokeReason !== "string" || record.revokeReason.trim().length === 0) {
          revokedMissingReason++
        }
        continue
      }

      unknownStatus++
    }

    let duplicateTokenHashes = 0
    for (const count of tokenHashCounts.values()) {
      duplicateTokenHashes += Math.max(0, count - 1)
    }

    return {
      active,
      revoked,
      total: nodes.length,
      unknownStatus,
      duplicateTokenHashes,
      missingTokenHashes,
      activeMissingLastSeen,
      revokedMissingTimestamp,
      revokedMissingReason,
    }
  }
}

let registrySingleton: NodeClientRegistry | undefined

export function getNodeClientRegistry(): NodeClientRegistry {
  if (!registrySingleton) {
    registrySingleton = new NodeClientRegistry()
  }
  return registrySingleton
}

export function resetNodeClientRegistry(): void {
  registrySingleton = undefined
}
