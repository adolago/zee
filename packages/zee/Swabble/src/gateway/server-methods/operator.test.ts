import { describe, expect, it, vi } from "vitest";

import { ExecApprovalManager } from "../exec-approval-manager.js";

const loadConfig = vi.fn(() => ({}));
const getStatusSummary = vi.fn(async () => ({
  sessions: { count: 3 },
  channelSummary: {},
}));
const listNodePairing = vi.fn(async () => ({ pending: [], paired: [] }));
const listDevicePairing = vi.fn(async () => ({ pending: [], paired: [] }));
const runSecurityAudit = vi.fn(async () => ({
  summary: { critical: 1, warn: 1, info: 0 },
  findings: [
    {
      checkId: "security.test",
      severity: "warn",
      title: "Warning",
      detail: "x".repeat(320),
      remediation: "fix",
    },
  ],
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: () => loadConfig(),
}));

vi.mock("../../commands/status.js", () => ({
  getStatusSummary: () => getStatusSummary(),
}));

vi.mock("../../infra/node-pairing.js", () => ({
  listNodePairing: () => listNodePairing(),
}));

vi.mock("../../infra/device-pairing.js", () => ({
  listDevicePairing: () => listDevicePairing(),
  summarizeDeviceTokens: () => [],
}));

vi.mock("../../security/audit.js", () => ({
  runSecurityAudit: (opts: unknown) => runSecurityAudit(opts),
}));

const { operatorHandlers } = await import("./operator.js");

describe("operator.dashboard handler", () => {
  it("returns dashboard payload with pending approvals and security findings", async () => {
    const manager = new ExecApprovalManager();
    const record = manager.create(
      {
        command: "npm publish",
        sessionKey: "main",
      },
      60_000,
      "approval-1",
    );
    const waitForDecision = manager.waitForDecision(record, 60_000);

    const respond = vi.fn();
    await operatorHandlers["operator.dashboard"]({
      req: { id: "1", method: "operator.dashboard" } as never,
      params: {},
      client: null,
      respond,
      context: { execApprovalManager: manager } as never,
    });

    expect(respond).toHaveBeenCalledWith(true, expect.any(Object), undefined);
    const payload = respond.mock.calls[0]?.[1] as {
      approvals: { pendingCount: number; pending: Array<{ id: string }> };
      security: { findings: Array<{ detail: string }> };
    };
    expect(payload.approvals.pendingCount).toBe(1);
    expect(payload.approvals.pending[0]?.id).toBe("approval-1");
    expect(payload.security.findings[0]?.detail.length).toBeLessThanOrEqual(240);
    expect(runSecurityAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        includeFilesystem: false,
        includeChannelSecurity: true,
        deep: false,
      }),
    );

    manager.resolve("approval-1", "deny");
    await waitForDecision;
  });

  it("responds unavailable on handler error", async () => {
    getStatusSummary.mockRejectedValueOnce(new Error("status boom"));
    const respond = vi.fn();
    const manager = new ExecApprovalManager();

    await operatorHandlers["operator.dashboard"]({
      req: { id: "2", method: "operator.dashboard" } as never,
      params: {},
      client: null,
      respond,
      context: { execApprovalManager: manager } as never,
    });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: "UNAVAILABLE" }),
    );
  });
});
