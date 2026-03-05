import { Flag } from "@/flag/flag"
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

function hasBreakGlassAcknowledgement(configValue: unknown): boolean {
  const configAck = typeof configValue === "string" ? configValue.trim() : ""
  const envAck = Flag.ZEE_CONTROL_UI_BREAK_GLASS_ACK?.trim() ?? ""
  const effective = envAck || configAck
  return effective === CONTROL_UI_BREAK_GLASS_ACK
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
    "server.hostname",
  ]

  const root = asObject(config) ?? {}
  const server = asObject(root.server) ?? {}
  const gateway = asObject(root.gateway) ?? {}
  const controlUi = asObject(gateway.controlUi) ?? {}
  const auth = asObject(controlUi.auth) ?? {}
  const actionPacks = asObject(gateway.actionPacks) ?? {}
  const telegramActionPack = asObject(actionPacks.telegram) ?? {}

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

  const errors = findings.filter((item) => item.severity === "error").length
  const warnings = findings.filter((item) => item.severity === "warning").length

  return {
    ok: errors === 0,
    errors,
    warnings,
    checked,
    findings,
  }
}
