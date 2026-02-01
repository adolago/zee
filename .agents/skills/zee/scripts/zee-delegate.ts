import { requestDaemon } from "../../../../src/daemon/ipc-client.js";

interface DroneResult {
  workerId: string;
  success: boolean;
  result?: string;
  error?: string;
}

export async function delegate(targetPersona: string, task: string, context?: string) {
  const prompt = `DELEGATED TASK from another persona:
Task: ${task}
Context: ${context || "None provided"}
Please execute this and report back.`;

  console.log(`\nDelegating to ${targetPersona}...`);
  console.log(`Task: ${task}`);

  try {
    const response = await requestDaemon<DroneResult>("spawn_drone_with_wait", {
      persona: targetPersona,
      task: task,
      prompt: prompt,
      timeoutMs: 300000 // 5 minutes timeout for the drone execution
    }, {
      timeoutMs: 305000 // 5m+ buffer for the IPC request itself
    });

    if (response.success) {
      console.log(`\n${targetPersona} completed the task:`);
      console.log("----------------------------------------");
      console.log(response.result || "(No output provided)");
      console.log("----------------------------------------");
      return true;
    } else {
      console.error(`\n${targetPersona} failed:`);
      console.error(response.error || "Unknown error");
      throw new Error(response.error);
    }
  } catch (error) {
    console.error(`\nDelegation failed: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}
