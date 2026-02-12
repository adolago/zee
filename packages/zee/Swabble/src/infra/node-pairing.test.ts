import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  approveNodePairing,
  listNodePairing,
  requestNodePairing,
  revokePairedNode,
  verifyNodeToken,
} from "./node-pairing.js";

describe("node pairing revocation", () => {
  it("revokes a paired node and clears pending repairs", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "zee-node-pairing-"));
    try {
      const requested = await requestNodePairing(
        {
          nodeId: "node-1",
          displayName: "Studio Node",
        },
        tmpDir,
      );
      expect(requested.status).toBe("pending");

      const approved = await approveNodePairing(requested.request.requestId, tmpDir);
      expect(approved?.node.nodeId).toBe("node-1");

      const before = await listNodePairing(tmpDir);
      expect(before.paired.map((entry) => entry.nodeId)).toContain("node-1");

      // Queue a repair request to ensure revoke removes both paired + pending entries.
      const repairRequest = await requestNodePairing(
        {
          nodeId: "node-1",
          displayName: "Studio Node",
        },
        tmpDir,
      );
      expect(repairRequest.request.isRepair).toBe(true);

      const revoked = await revokePairedNode("node-1", tmpDir);
      expect(revoked?.nodeId).toBe("node-1");

      const after = await listNodePairing(tmpDir);
      expect(after.paired).toHaveLength(0);
      expect(after.pending).toHaveLength(0);

      const verify = await verifyNodeToken("node-1", approved?.node.token ?? "", tmpDir);
      expect(verify.ok).toBe(false);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
