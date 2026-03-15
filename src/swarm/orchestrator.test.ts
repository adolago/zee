import { describe, expect, test } from "bun:test";
import { FluxRecorder } from "../../packages/zee/src/flux";
import { Orchestrator } from "./orchestrator";

describe("Orchestrator legacy compatibility telemetry", () => {
  test("emits shim telemetry when legacy pi-agent event schema is used", async () => {
    const before = FluxRecorder.list({ kind: "orchestration.pi_agent_event_schema.used" }).total;
    const orchestrator = new Orchestrator({ maxWorkers: 1 });

    try {
      (orchestrator as any).emitOrchestrationEvent("agent_start", { taskId: "task-1" });
      (orchestrator as any).emitOrchestrationEvent("agent_start", { taskId: "task-2" });
      (orchestrator as any).emitOrchestrationEvent("turn_end", { taskId: "task-1" });

      expect(FluxRecorder.list({ kind: "orchestration.pi_agent_event_schema.used" }).total).toBe(before + 2);
    } finally {
      await orchestrator.shutdown();
    }
  });
});
