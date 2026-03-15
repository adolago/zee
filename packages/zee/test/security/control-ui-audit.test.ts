import { afterAll, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { FluxRecorder } from "../../src/flux"
import { resetNodeClientRegistry } from "../../src/gateway/node-client-registry"
import { auditControlUiSecurityDeep, emitSecurityAuditTelemetry } from "../../src/security/control-ui-audit"

const ORIGINAL_ENV = {
  ZEE_STATE_DIR: process.env.ZEE_STATE_DIR,
}

const ORIGINAL_FLUX_CONFIG = FluxRecorder.config()

let isolatedStateDir = ""

async function writeNodeRegistryState(contents: unknown) {
  const stateFile = path.join(isolatedStateDir, "gateway-node-clients.json")
  await fs.mkdir(path.dirname(stateFile), { recursive: true })
  await fs.writeFile(stateFile, JSON.stringify(contents, null, 2), "utf8")
  resetNodeClientRegistry()
}

beforeEach(async () => {
  isolatedStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "zee-control-ui-audit-"))
  process.env.ZEE_STATE_DIR = isolatedStateDir
  FluxRecorder.configure({
    ...ORIGINAL_FLUX_CONFIG,
    enabled: true,
    logMirror: false,
  })
  resetNodeClientRegistry()
})

afterAll(async () => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  FluxRecorder.configure(ORIGINAL_FLUX_CONFIG)
  resetNodeClientRegistry()
  if (isolatedStateDir) {
    await fs.rm(isolatedStateDir, { recursive: true, force: true }).catch(() => {})
  }
})

describe("auditControlUiSecurityDeep", () => {
  test("surfaces node-state drift findings and metrics", async () => {
    await writeNodeRegistryState({
      version: 1,
      nodes: {
        active_one: {
          id: "active_one",
          label: "Desk",
          platform: "linux",
          createdAt: 1,
          updatedAt: 2,
          status: "paired",
          metadata: {},
          toolAllowlist: [],
          tokenHash: "dup-hash",
        },
        revoked_one: {
          id: "revoked_one",
          label: "Old Desk",
          platform: "macos",
          createdAt: 1,
          updatedAt: 3,
          status: "revoked",
          metadata: {},
          toolAllowlist: [],
          tokenHash: "dup-hash",
        },
        unknown_one: {
          id: "unknown_one",
          label: "Drifted",
          platform: "unknown",
          createdAt: 1,
          updatedAt: 4,
          status: "drifted",
          metadata: {},
          toolAllowlist: [],
        },
      },
    })

    const report = await auditControlUiSecurityDeep({
      gateway: {
        nodeClient: {
          enabled: true,
          securityMode: "allowlist",
          toolAllowlist: ["zee_invest_research"],
          maxPairedNodes: 5,
        },
      },
    })

    expect(report.metrics).toMatchObject({
      activePairedNodes: 1,
      revokedPairedNodes: 1,
      totalPairedNodes: 3,
      unknownStatusNodes: 1,
      duplicateTokenHashes: 1,
      missingTokenHashes: 1,
      activeNodesMissingLastSeen: 1,
      revokedNodesMissingTimestamp: 1,
      revokedNodesMissingReason: 1,
      nodeClientEnabled: true,
      nodeClientSecurityMode: "allowlist",
    })

    const codes = report.findings.map((finding) => finding.code)
    expect(codes).toContain("node_client_state_unknown_status")
    expect(codes).toContain("node_client_state_missing_token_hash")
    expect(codes).toContain("node_client_duplicate_token_hash")
    expect(codes).toContain("node_client_active_nodes_missing_last_seen")
    expect(codes).toContain("node_client_revoked_metadata_incomplete")
  })

  test("emits flux telemetry for audit summaries and findings", async () => {
    await writeNodeRegistryState({
      version: 1,
      nodes: {
        active_one: {
          id: "active_one",
          label: "Desk",
          platform: "linux",
          createdAt: 1,
          updatedAt: 2,
          status: "paired",
          metadata: {},
          toolAllowlist: [],
          tokenHash: "dup-hash",
        },
        revoked_one: {
          id: "revoked_one",
          label: "Old Desk",
          platform: "macos",
          createdAt: 1,
          updatedAt: 3,
          status: "revoked",
          metadata: {},
          toolAllowlist: [],
          tokenHash: "dup-hash",
        },
      },
    })

    const report = await auditControlUiSecurityDeep({
      gateway: {
        nodeClient: {
          enabled: true,
          securityMode: "allowlist",
          toolAllowlist: ["zee_invest_research"],
          maxPairedNodes: 5,
        },
      },
    })

    const beforeChecked = FluxRecorder.list({ kind: "security.audit.checked" }).total
    const beforeFindings = FluxRecorder.list({ kind: "security.audit.finding" }).total

    const { traceID } = emitSecurityAuditTelemetry({
      source: "security.audit",
      deep: true,
      strict: true,
      report,
    })

    expect(FluxRecorder.list({ kind: "security.audit.checked" }).total).toBe(beforeChecked + 1)
    expect(FluxRecorder.list({ kind: "security.audit.finding" }).total).toBe(beforeFindings + report.findings.length)

    const events = FluxRecorder.trace(traceID)
    expect(events).toHaveLength(report.findings.length + 1)
    expect(events[0]).toMatchObject({
      kind: "security.audit.checked",
      domain: "security",
      metadata: {
        source: "security.audit",
        deep: true,
        strict: true,
        totalPairedNodes: 2,
      },
    })
    expect(events[1]).toMatchObject({
      kind: "security.audit.finding",
      domain: "security",
      metadata: {
        source: "security.audit",
        deep: true,
        code: report.findings[0]?.code,
      },
    })
  })
})
