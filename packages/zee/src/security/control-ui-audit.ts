import { Flag } from "@/flag/flag"
import { FluxRecorder } from "@/flux"
import { isLoopbackHostname } from "@/server/auth"

export const CONTROL_UI_BREAK_GLASS_ACK = "I_UNDERSTAND_CONTROL_UI_AUTH_IS_INSECURE"

export type SecurityAuditSeverity = "error" | "warning"

export type SecurityAuditFinding = {
  severity: SecurityAuditSeverity
  code: string
  message: string
  remediation?: string
}

export type SecurityAuditReport = {
  ok: boolean
  errors: number
  warnings: number
  checked: string[]
  findings: SecurityAuditFinding[]
  metrics: SecurityAuditMetrics
}

export type SecurityAuditMetrics = {
  checkedCount: number
  findingCount: number
  activePairedNodes?: number
  revokedPairedNodes?: number
  totalPairedNodes?: number
  unknownStatusNodes?: number
  duplicateTokenHashes?: number
  missingTokenHashes?: number
  activeNodesMissingLastSeen?: number
  revokedNodesMissingTimestamp?: number
  revokedNodesMissingReason?: number
  nodeClientEnabled?: boolean
  nodeClientSecurityMode?: "deny" | "allowlist" | "full"
}

export type SecurityAuditTelemetrySource = "security.audit" | "doctor.security" | "v3.release"

export type SecurityAuditTelemetryInput = {
  source: SecurityAuditTelemetrySource
  deep: boolean
  strict?: boolean
  report: SecurityAuditReport
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function resolveBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function resolveAuthMode(value: unknown): "token" | "password" | "none" {
  if (value === "token" || value === "password" || value === "none") return value
  if (Flag.ZEE_CONTROL_UI_DISABLE_AUTH) return "none"
  if (Flag.ZEE_CONTROL_UI_ALLOW_PASSWORD_ONLY) return "password"
  return "token"
}

function resolveNodeSecurityMode(value: unknown): "deny" | "allowlist" | "full" {
  if (value === "deny" || value === "allowlist" || value === "full") return value
  return "deny"
}

function resolveStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
}

function hasBreakGlassAcknowledgement(configValue: unknown): boolean {
  const configAck = typeof configValue === "string" ? configValue.trim() : ""
  const envAck = Flag.ZEE_CONTROL_UI_BREAK_GLASS_ACK?.trim() ?? ""
  const effective = envAck || configAck
  return effective === CONTROL_UI_BREAK_GLASS_ACK
}

function summarizeFindings(
  checked: string[],
  findings: SecurityAuditFinding[],
  metrics: Partial<SecurityAuditMetrics> = {},
): SecurityAuditReport {
  const errors = findings.filter((item) => item.severity === "error").length
  const warnings = findings.filter((item) => item.severity === "warning").length
  return {
    ok: errors === 0,
    errors,
    warnings,
    checked,
    findings,
    metrics: {
      checkedCount: checked.length,
      findingCount: findings.length,
      ...metrics,
    },
  }
}

export function emitSecurityAuditTelemetry(input: SecurityAuditTelemetryInput): { traceID: string } {
  const traceID = crypto.randomUUID()
  const metadata = {
    source: input.source,
    deep: input.deep,
    strict: input.strict ?? false,
    ok: input.report.ok,
    errors: input.report.errors,
    warnings: input.report.warnings,
    ...input.report.metrics,
  }

  FluxRecorder.record({
    traceID,
    direction: "internal",
    domain: "security",
    kind: "security.audit.checked",
    status: input.report.ok ? "ok" : "error",
    method: "CLI",
    path: input.source,
    route: input.source,
    metadata,
  })

  for (const finding of input.report.findings) {
    FluxRecorder.record({
      traceID,
      direction: "internal",
      domain: "security",
      kind: "security.audit.finding",
      status: finding.severity === "error" ? "error" : "ok",
      method: "CLI",
      path: input.source,
      route: input.source,
      metadata: {
        source: input.source,
        deep: input.deep,
        severity: finding.severity,
        code: finding.code,
        hasRemediation: Boolean(finding.remediation),
      },
    })
  }

  return { traceID }
}

export function auditControlUiSecurity(config: unknown): SecurityAuditReport {
  const findings: SecurityAuditFinding[] = []
  const checked = [
    "gateway.controlUi.auth.required",
    "gateway.controlUi.auth.mode",
    "gateway.controlUi.auth.allowPasswordOnly",
    "gateway.controlUi.auth.allowInsecureHttp",
    "gateway.controlUi.auth.breakGlassAck",
    "gateway.controlUi.trustedOrigins",
    "gateway.actionPacks.telegram.enabled",
    "gateway.actionPacks.telegram.messageActions",
    "gateway.actionPacks.telegram.moderationActions",
    "gateway.actionPacks.telegram.metadataActions",
    "gateway.nodeClient.enabled",
    "gateway.nodeClient.securityMode",
    "gateway.nodeClient.allowRemotePairing",
    "gateway.nodeClient.toolAllowlist",
    "gateway.nodeClient.maxPairedNodes",
    "server.hostname",
  ]

  const root = asObject(config) ?? {}
  const server = asObject(root.server) ?? {}
  const gateway = asObject(root.gateway) ?? {}
  const controlUi = asObject(gateway.controlUi) ?? {}
  const auth = asObject(controlUi.auth) ?? {}
  const actionPacks = asObject(gateway.actionPacks) ?? {}
  const telegramActionPack = asObject(actionPacks.telegram) ?? {}
  const nodeClient = asObject(gateway.nodeClient) ?? {}

  const hostname = typeof server.hostname === "string" && server.hostname.trim().length > 0 ? server.hostname : "127.0.0.1"
  const nonLoopbackBind = !isLoopbackHostname(hostname)

  const required = resolveBool(auth.required, !Flag.ZEE_CONTROL_UI_DISABLE_AUTH)
  const mode = resolveAuthMode(auth.mode)
  const allowPasswordOnly = resolveBool(auth.allowPasswordOnly, false) || Flag.ZEE_CONTROL_UI_ALLOW_PASSWORD_ONLY
  const allowInsecureHttp = resolveBool(auth.allowInsecureHttp, false) || Flag.ZEE_CONTROL_UI_ALLOW_INSECURE_HTTP
  const breakGlassAck = hasBreakGlassAcknowledgement(auth.breakGlassAck)

  const trustedOrigins = Array.isArray(controlUi.trustedOrigins)
    ? controlUi.trustedOrigins.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : []
  const telegramActionPackEnabled = resolveBool(telegramActionPack.enabled, true)
  const telegramMessageActions = resolveBool(telegramActionPack.messageActions, true)
  const telegramModerationActions = resolveBool(telegramActionPack.moderationActions, false)
  const telegramMetadataActions = resolveBool(telegramActionPack.metadataActions, true)
  const telegramAnyActionEnabled = telegramActionPackEnabled && (telegramMessageActions || telegramModerationActions || telegramMetadataActions)

  const nodeClientEnabled = resolveBool(nodeClient.enabled, false)
  const nodeClientMode = resolveNodeSecurityMode(nodeClient.securityMode)
  const nodeClientAllowRemotePairing = resolveBool(nodeClient.allowRemotePairing, false)
  const nodeClientToolAllowlist = resolveStringArray(nodeClient.toolAllowlist)
  const nodeClientMaxPairedNodes =
    typeof nodeClient.maxPairedNodes === "number" && Number.isFinite(nodeClient.maxPairedNodes)
      ? Math.max(1, Math.floor(nodeClient.maxPairedNodes))
      : 10

  const authDisabled = required === false || mode === "none"
  const passwordDowngrade = mode === "password" || allowPasswordOnly

  if (authDisabled) {
    findings.push({
      severity: breakGlassAck ? "warning" : "error",
      code: "control_ui_auth_disabled",
      message: "Control UI authentication is disabled (`required=false` or `mode=none`).",
      remediation: breakGlassAck
        ? "Re-enable auth (`required=true`, `mode=token`) as soon as incident response is complete."
        : `Set gateway.controlUi.auth.required=true and mode=token. For temporary break-glass only, set breakGlassAck=${CONTROL_UI_BREAK_GLASS_ACK}.`,
    })
  }

  if (allowInsecureHttp) {
    findings.push({
      severity: breakGlassAck ? "warning" : "error",
      code: "control_ui_insecure_http_allowed",
      message: "Control UI is configured to allow insecure HTTP transport.",
      remediation: breakGlassAck
        ? "Disable `allowInsecureHttp` after emergency access is no longer needed."
        : `Set gateway.controlUi.auth.allowInsecureHttp=false and terminate TLS at the reverse proxy. For temporary break-glass only, acknowledge with ${CONTROL_UI_BREAK_GLASS_ACK}.`,
    })
  }

  if (passwordDowngrade) {
    findings.push({
      severity: breakGlassAck ? "warning" : "warning",
      code: "control_ui_password_only_mode",
      message: "Control UI is configured with password-based downgrade mode.",
      remediation:
        "Prefer token auth (`mode=token`, `allowPasswordOnly=false`) and rotate credentials after any temporary downgrade.",
    })
  }

  if ((authDisabled || allowInsecureHttp || passwordDowngrade) && !breakGlassAck) {
    findings.push({
      severity: "error",
      code: "control_ui_break_glass_ack_missing",
      message: "Dangerous Control UI auth downgrade is configured without break-glass acknowledgment.",
      remediation: `Set gateway.controlUi.auth.breakGlassAck or ZEE_CONTROL_UI_BREAK_GLASS_ACK to ${CONTROL_UI_BREAK_GLASS_ACK}, and revert to secure defaults quickly.`,
    })
  }

  if (nonLoopbackBind && authDisabled) {
    findings.push({
      severity: "error",
      code: "control_ui_non_loopback_without_auth",
      message: `Server hostname is non-loopback (${hostname}) while Control UI auth is disabled.`,
      remediation: "Bind to loopback or re-enable Control UI auth before exposing externally.",
    })
  }

  if (nonLoopbackBind && trustedOrigins.length === 0) {
    findings.push({
      severity: "warning",
      code: "control_ui_non_loopback_without_trusted_origins",
      message: `Server hostname is non-loopback (${hostname}) but gateway.controlUi.trustedOrigins is empty.`,
      remediation: "Set explicit trusted origins and enforce TLS at the reverse proxy.",
    })
  }

  if (telegramAnyActionEnabled && authDisabled) {
    findings.push({
      severity: "error",
      code: "telegram_action_pack_with_disabled_control_ui_auth",
      message: "Telegram action pack is enabled while Control UI auth is disabled.",
      remediation: "Re-enable Control UI auth before exposing Telegram action endpoints.",
    })
  }

  if (telegramModerationActions && !required) {
    findings.push({
      severity: "error",
      code: "telegram_moderation_actions_without_required_auth",
      message: "Telegram moderation actions are enabled while Control UI auth `required` is false.",
      remediation: "Set gateway.controlUi.auth.required=true or disable telegram moderation actions.",
    })
  }

  if (telegramAnyActionEnabled && nonLoopbackBind && trustedOrigins.length === 0) {
    findings.push({
      severity: "warning",
      code: "telegram_action_pack_non_loopback_without_trusted_origins",
      message: `Telegram action pack is enabled on non-loopback hostname (${hostname}) without trusted origins.`,
      remediation: "Configure trusted origins and TLS before exposing action endpoints externally.",
    })
  }

  if (nodeClientEnabled && authDisabled) {
    findings.push({
      severity: "error",
      code: "node_client_enabled_with_disabled_control_ui_auth",
      message: "Node client pairing is enabled while Control UI auth is disabled.",
      remediation: "Re-enable Control UI auth (`required=true`, `mode=token`) before enabling node pairing.",
    })
  }

  if (nodeClientEnabled && nodeClientMode === "full") {
    findings.push({
      severity: nonLoopbackBind ? "error" : "warning",
      code: "node_client_full_mode",
      message: "Node client policy is set to `full`, allowing unrestricted tool execution on paired nodes.",
      remediation: "Set gateway.nodeClient.securityMode=allowlist and configure explicit toolAllowlist.",
    })
  }

  if (nodeClientEnabled && nodeClientMode === "allowlist" && nodeClientToolAllowlist.length === 0) {
    findings.push({
      severity: "warning",
      code: "node_client_allowlist_empty",
      message: "Node client policy mode is `allowlist` but no tools are allowlisted.",
      remediation: "Set gateway.nodeClient.toolAllowlist with explicit allowed tool IDs.",
    })
  }

  if (nodeClientEnabled && nodeClientAllowRemotePairing && nonLoopbackBind) {
    findings.push({
      severity: "warning",
      code: "node_client_remote_pairing_enabled",
      message: "Node client remote pairing is enabled on a non-loopback bind.",
      remediation: "Keep pairing local-only (`allowRemotePairing=false`) unless you enforce TLS + scoped auth.",
    })
  }

  if (nodeClientEnabled && nodeClientMaxPairedNodes > 100) {
    findings.push({
      severity: "warning",
      code: "node_client_max_pairs_high",
      message: `Node client maxPairedNodes (${nodeClientMaxPairedNodes}) is unusually high.`,
      remediation: "Reduce maxPairedNodes to a least-privilege operational value.",
    })
  }

  return summarizeFindings(checked, findings)
}

export async function auditControlUiSecurityDeep(config: unknown): Promise<SecurityAuditReport> {
  const base = auditControlUiSecurity(config)
  const checked = [
    ...base.checked,
    "gateway.nodeClient.state.active",
    "gateway.nodeClient.state.revoked",
    "gateway.nodeClient.state.total",
    "gateway.nodeClient.state.status",
    "gateway.nodeClient.state.tokenHash",
    "gateway.nodeClient.state.lastSeenAt",
    "gateway.nodeClient.state.revokeMetadata",
  ]
  const findings = [...base.findings]

  try {
    const { getNodeClientRegistry, resolveNodeClientPolicy } = await import("@/gateway/node-client-registry")
    const policy = resolveNodeClientPolicy(config)
    const snapshot = await getNodeClientRegistry().getAuditSnapshot()

    if (snapshot.active > 0 && !policy.enabled) {
      findings.push({
        severity: "warning",
        code: "node_client_state_present_but_feature_disabled",
        message: `There are ${snapshot.active} active paired nodes while gateway.nodeClient.enabled is false.`,
        remediation: "Reconcile state: either enable nodeClient policy or revoke stale paired nodes.",
      })
    }

    if (snapshot.active > policy.maxPairedNodes) {
      findings.push({
        severity: "error",
        code: "node_client_active_nodes_exceed_limit",
        message: `Active paired nodes (${snapshot.active}) exceed maxPairedNodes (${policy.maxPairedNodes}).`,
        remediation: "Revoke unused nodes or increase maxPairedNodes after explicit risk review.",
      })
    }

    if (snapshot.active > 0 && policy.securityMode === "full") {
      findings.push({
        severity: "error",
        code: "node_client_active_nodes_with_full_mode",
        message: `There are ${snapshot.active} active nodes while securityMode=full.`,
        remediation: "Move to allowlist mode and rotate pair tokens after policy downgrade.",
      })
    }

    if (snapshot.unknownStatus > 0) {
      findings.push({
        severity: "error",
        code: "node_client_state_unknown_status",
        message: `${snapshot.unknownStatus} node record(s) use an unknown status value.`,
        remediation: "Repair corrupted node-client state and keep record statuses limited to `paired` or `revoked`.",
      })
    }

    if (snapshot.missingTokenHashes > 0) {
      findings.push({
        severity: "error",
        code: "node_client_state_missing_token_hash",
        message: `${snapshot.missingTokenHashes} node record(s) are missing a token hash.`,
        remediation: "Revoke affected node records and re-pair them to regenerate credentials safely.",
      })
    }

    if (snapshot.duplicateTokenHashes > 0) {
      findings.push({
        severity: "error",
        code: "node_client_duplicate_token_hash",
        message: `${snapshot.duplicateTokenHashes} duplicate node credential hash collision(s) were detected.`,
        remediation: "Revoke the duplicated node records and re-pair them to restore unique credentials.",
      })
    }

    if (snapshot.activeMissingLastSeen > 0) {
      findings.push({
        severity: "warning",
        code: "node_client_active_nodes_missing_last_seen",
        message: `${snapshot.activeMissingLastSeen} active node record(s) are missing lastSeenAt audit metadata.`,
        remediation: "Reconnect or rotate affected nodes so operator audit history reflects current activity.",
      })
    }

    if (snapshot.revokedMissingTimestamp > 0 || snapshot.revokedMissingReason > 0) {
      findings.push({
        severity: "warning",
        code: "node_client_revoked_metadata_incomplete",
        message:
          `Revoked node metadata is incomplete (` +
          `missing revokedAt=${snapshot.revokedMissingTimestamp}, missing revokeReason=${snapshot.revokedMissingReason}).`,
        remediation: "Normalize stale revoked records so audit trails retain both revocation timestamp and operator reason.",
      })
    }

    return summarizeFindings(checked, findings, {
      ...base.metrics,
      activePairedNodes: snapshot.active,
      revokedPairedNodes: snapshot.revoked,
      totalPairedNodes: snapshot.total,
      unknownStatusNodes: snapshot.unknownStatus,
      duplicateTokenHashes: snapshot.duplicateTokenHashes,
      missingTokenHashes: snapshot.missingTokenHashes,
      activeNodesMissingLastSeen: snapshot.activeMissingLastSeen,
      revokedNodesMissingTimestamp: snapshot.revokedMissingTimestamp,
      revokedNodesMissingReason: snapshot.revokedMissingReason,
      nodeClientEnabled: policy.enabled,
      nodeClientSecurityMode: policy.securityMode,
    })
  } catch (error) {
    findings.push({
      severity: "warning",
      code: "node_client_deep_audit_unavailable",
      message: `Deep node-client audit could not load registry state: ${error instanceof Error ? error.message : String(error)}`,
      remediation: "Ensure state directory is readable and retry `zee security audit --deep`.",
    })
  }

  return summarizeFindings(checked, findings, base.metrics)
}
