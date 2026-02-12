import { getStatusSummary } from "../../commands/status.js";
import { loadConfig } from "../../config/config.js";
import { listDevicePairing, summarizeDeviceTokens } from "../../infra/device-pairing.js";
import { listNodePairing } from "../../infra/node-pairing.js";
import { runSecurityAudit } from "../../security/audit.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { formatForLog } from "../ws-log.js";
import type { GatewayRequestHandlers } from "./types.js";

function truncateDetail(detail: string, max = 240): string {
  if (detail.length <= max) return detail;
  return `${detail.slice(0, max - 3)}...`;
}

export const operatorHandlers: GatewayRequestHandlers = {
  "operator.dashboard": async ({ respond, context }) => {
    try {
      const cfg = loadConfig();
      const [status, nodePairing, devicePairing, security] = await Promise.all([
        getStatusSummary(),
        listNodePairing(),
        listDevicePairing(),
        runSecurityAudit({
          config: cfg,
          includeFilesystem: false,
          includeChannelSecurity: true,
          deep: false,
        }),
      ]);

      const pendingApprovals = context.execApprovalManager.listPending().map((record) => ({
        id: record.id,
        createdAtMs: record.createdAtMs,
        expiresAtMs: record.expiresAtMs,
        request: record.request,
      }));

      const securityFindings = security.findings
        .filter((finding) => finding.severity === "critical" || finding.severity === "warn")
        .slice(0, 8)
        .map((finding) => ({
          checkId: finding.checkId,
          severity: finding.severity,
          title: finding.title,
          detail: truncateDetail(finding.detail),
          remediation: finding.remediation,
        }));

      respond(
        true,
        {
          ts: Date.now(),
          status,
          approvals: {
            pendingCount: pendingApprovals.length,
            pending: pendingApprovals,
          },
          pairing: {
            nodes: {
              pendingCount: nodePairing.pending.length,
              pairedCount: nodePairing.paired.length,
              pending: nodePairing.pending,
              paired: nodePairing.paired.map(({ token, ...node }) => node),
            },
            devices: {
              pendingCount: devicePairing.pending.length,
              pairedCount: devicePairing.paired.length,
              pending: devicePairing.pending,
              paired: devicePairing.paired.map(({ tokens, ...device }) => ({
                ...device,
                tokens: summarizeDeviceTokens(tokens),
              })),
            },
          },
          security: {
            summary: security.summary,
            findings: securityFindings,
          },
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
};
