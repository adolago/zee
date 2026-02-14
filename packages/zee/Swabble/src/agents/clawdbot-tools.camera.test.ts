import { beforeEach, describe, expect, it, vi } from "vitest";

const { callGateway } = vi.hoisted(() => ({
  callGateway: vi.fn(),
}));

vi.mock("../gateway/call.js", () => ({ callGateway }));
vi.mock("../media/image-ops.js", () => ({
  getImageMetadata: vi.fn(async () => ({ width: 1, height: 1 })),
  resizeToJpeg: vi.fn(async () => Buffer.from("jpeg")),
}));

import "./test-helpers/fast-core-tools.js";
import { createZeeTools } from "./zee-tools.js";

describe("nodes camera_snap", () => {
  beforeEach(() => {
    callGateway.mockReset();
  });

  it("maps jpg payloads to image/jpeg", async () => {
    callGateway.mockImplementation(async ({ method }) => {
      if (method === "node.list") {
        return { nodes: [{ nodeId: "node-1" }] };
      }
      if (method === "node.invoke") {
        return {
          payload: {
            format: "jpg",
            base64: "aGVsbG8=",
            width: 1,
            height: 1,
          },
        };
      }
      throw new Error(`unexpected method: ${String(method)}`);
    });

    const tool = createZeeTools().find((candidate) => candidate.name === "nodes");
    if (!tool) throw new Error("missing nodes tool");

    const result = await tool.execute("call1", {
      action: "camera_snap",
      node: "node-1",
      facing: "front",
    });

    const images = (result.content ?? []).filter((block) => block.type === "image");
    expect(images).toHaveLength(1);
    expect(images[0]?.mimeType).toBe("image/jpeg");
  });

  it("passes deviceId when provided", async () => {
    callGateway.mockImplementation(async ({ method, params }) => {
      if (method === "node.list") {
        return { nodes: [{ nodeId: "node-1" }] };
      }
      if (method === "node.invoke") {
        expect(params).toMatchObject({
          command: "camera.snap",
          params: { deviceId: "cam-123" },
        });
        return {
          payload: {
            format: "jpg",
            base64: "aGVsbG8=",
            width: 1,
            height: 1,
          },
        };
      }
      throw new Error(`unexpected method: ${String(method)}`);
    });

    const tool = createZeeTools().find((candidate) => candidate.name === "nodes");
    if (!tool) throw new Error("missing nodes tool");

    await tool.execute("call1", {
      action: "camera_snap",
      node: "node-1",
      facing: "front",
      deviceId: "cam-123",
    });
  });
});

describe("nodes run", () => {
  beforeEach(() => {
    callGateway.mockReset();
  });

  it("passes invoke and command timeouts", async () => {
    callGateway.mockImplementation(async ({ method, params }) => {
      if (method === "node.list") {
        return { nodes: [{ nodeId: "node-1", commands: ["system.run"] }] };
      }
      if (method === "node.invoke") {
        expect(params).toMatchObject({
          nodeId: "node-1",
          command: "system.run",
          timeoutMs: 45_000,
          params: {
            command: ["echo", "hi"],
            cwd: "/tmp",
            env: { FOO: "bar" },
            timeoutMs: 12_000,
          },
        });
        return {
          payload: { stdout: "", stderr: "", exitCode: 0, success: true },
        };
      }
      throw new Error(`unexpected method: ${String(method)}`);
    });

    const tool = createZeeTools().find((candidate) => candidate.name === "nodes");
    if (!tool) throw new Error("missing nodes tool");

    await tool.execute("call1", {
      action: "run",
      node: "node-1",
      command: ["echo", "hi"],
      cwd: "/tmp",
      env: ["FOO=bar"],
      commandTimeoutMs: 12_000,
      invokeTimeoutMs: 45_000,
    });
  });

  it("requests approval and retries when system.run requires approval", async () => {
    let invokeCount = 0;
    callGateway.mockImplementation(async ({ method, params }) => {
      if (method === "node.list") {
        return { nodes: [{ nodeId: "node-1", commands: ["system.run"] }] };
      }
      if (method === "node.invoke") {
        invokeCount += 1;
        if (invokeCount === 1) {
          throw new Error("SYSTEM_RUN_DENIED: approval required");
        }
        expect(params).toMatchObject({
          nodeId: "node-1",
          command: "system.run",
          params: {
            command: ["echo", "approved"],
            approved: true,
            approvalDecision: "allow-once",
          },
        });
        return {
          payload: { stdout: "approved", stderr: "", exitCode: 0, success: true },
        };
      }
      if (method === "exec.approval.request") {
        expect(params).toMatchObject({
          command: "echo approved",
          host: "node",
          timeoutMs: 120_000,
        });
        return { decision: "allow-once" };
      }
      throw new Error(`unexpected method: ${String(method)}`);
    });

    const tool = createZeeTools().find((candidate) => candidate.name === "nodes");
    if (!tool) throw new Error("missing nodes tool");

    const result = await tool.execute("call2", {
      action: "run",
      node: "node-1",
      command: ["echo", "approved"],
    });
    expect(invokeCount).toBe(2);
    expect(result.details).toMatchObject({ success: true, stdout: "approved" });
  });

  it("fails with user denied when approval is denied", async () => {
    callGateway.mockImplementation(async ({ method }) => {
      if (method === "node.list") {
        return { nodes: [{ nodeId: "node-1", commands: ["system.run"] }] };
      }
      if (method === "node.invoke") {
        throw new Error("SYSTEM_RUN_DENIED: approval required");
      }
      if (method === "exec.approval.request") {
        return { decision: "deny" };
      }
      throw new Error(`unexpected method: ${String(method)}`);
    });

    const tool = createZeeTools().find((candidate) => candidate.name === "nodes");
    if (!tool) throw new Error("missing nodes tool");

    await expect(
      tool.execute("call3", {
        action: "run",
        node: "node-1",
        command: ["echo", "denied"],
      }),
    ).rejects.toThrow("exec denied: user denied");
  });

  it("fails with approval timeout when no approval decision is returned", async () => {
    callGateway.mockImplementation(async ({ method }) => {
      if (method === "node.list") {
        return { nodes: [{ nodeId: "node-1", commands: ["system.run"] }] };
      }
      if (method === "node.invoke") {
        throw new Error("SYSTEM_RUN_DENIED: approval required");
      }
      if (method === "exec.approval.request") {
        return { decision: null };
      }
      throw new Error(`unexpected method: ${String(method)}`);
    });

    const tool = createZeeTools().find((candidate) => candidate.name === "nodes");
    if (!tool) throw new Error("missing nodes tool");

    await expect(
      tool.execute("call4", {
        action: "run",
        node: "node-1",
        command: ["echo", "timeout"],
      }),
    ).rejects.toThrow("exec denied: approval timed out");
  });
});
