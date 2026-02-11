/**
 * Voice Call CLI Commands
 */

import type { Command } from "commander";
import type { ZeePluginApi } from "zee/plugin-sdk";
import { getVoiceCallRuntime } from "./runtime.js";

export function registerVoiceCallCLI(api: ZeePluginApi) {
  api.registerCli(({ program }: { program: Command }) => {
    const voicecall = program
      .command("voicecall")
      .description("Voice call management (Twilio, Telnyx, Plivo)");

    // Start a call
    voicecall
      .command("start")
      .description("Start a new voice call")
      .requiredOption("--to <number>", "Phone number to call (E.164 format)")
      .option("--message <text>", "Initial message to speak")
      .action(async (options) => {
        try {
          const runtime = getVoiceCallRuntime();
          const result = await runtime.initiateCall({
            to: options.to,
            message: options.message,
          });
          console.log(JSON.stringify(result, null, 2));
        } catch (error) {
          console.error("Failed to start call:", error instanceof Error ? error.message : String(error));
          process.exit(1);
        }
      });

    // End a call
    voicecall
      .command("end")
      .description("End an active call")
      .requiredOption("--call-id <id>", "Call ID to end")
      .action(async (options) => {
        try {
          const runtime = getVoiceCallRuntime();
          await runtime.endCall(options.callId);
          console.log(JSON.stringify({ ended: true, callId: options.callId }, null, 2));
        } catch (error) {
          console.error("Failed to end call:", error instanceof Error ? error.message : String(error));
          process.exit(1);
        }
      });

    // Get call status
    voicecall
      .command("status")
      .description("Get call status")
      .requiredOption("--call-id <id>", "Call ID to check")
      .action(async (options) => {
        try {
          const runtime = getVoiceCallRuntime();
          const status = await runtime.getCallStatus(options.callId);
          console.log(JSON.stringify(status, null, 2));
        } catch (error) {
          console.error("Failed to get status:", error instanceof Error ? error.message : String(error));
          process.exit(1);
        }
      });

    // List active calls
    voicecall
      .command("list")
      .description("List active calls")
      .action(async () => {
        try {
          const runtime = getVoiceCallRuntime();
          const calls = runtime.getActiveCalls();
          console.log(JSON.stringify({ activeCalls: calls }, null, 2));
        } catch (error) {
          console.error("Failed to list calls:", error instanceof Error ? error.message : String(error));
          process.exit(1);
        }
      });

    // Speak during a call
    voicecall
      .command("speak")
      .description("Speak a message during an active call")
      .requiredOption("--call-id <id>", "Call ID")
      .requiredOption("--message <text>", "Message to speak")
      .action(async (options) => {
        try {
          const runtime = getVoiceCallRuntime();
          await runtime.speak({ callId: options.callId, message: options.message });
          console.log(JSON.stringify({ spoken: true, callId: options.callId }, null, 2));
        } catch (error) {
          console.error("Failed to speak:", error instanceof Error ? error.message : String(error));
          process.exit(1);
        }
      });
  });
}
