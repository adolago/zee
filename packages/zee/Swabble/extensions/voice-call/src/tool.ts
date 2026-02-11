/**
 * Voice Call Tool
 */

import type { ZeePluginApi } from "zee/plugin-sdk";
import { getVoiceCallRuntime } from "./runtime.js";

export function createVoiceCallTool(api: ZeePluginApi) {
  return {
    label: "Voice Call",
    name: "voice_call",
    description: `Make and manage voice calls via phone.

**Actions:**
- initiate_call: Start a new call to a phone number
- continue_call: Speak a message during an active call
- speak_to_user: Alias for continue_call
- end_call: Hang up an active call
- get_status: Get the status of a call

**Providers:**
- Twilio: Requires accountSid, authToken, fromNumber
- Telnyx: Requires apiKey, fromNumber, optional connectionId
- Plivo: Requires authId, authToken, fromNumber
- Mock: For testing (no actual calls)

**Examples:**
- { action: "initiate_call", to: "+15551234567", message: "Hello, this is Zee calling" }
- { action: "continue_call", callId: "CA123...", message: "Let me check that for you" }
- { action: "end_call", callId: "CA123..." }
- { action: "get_status", callId: "CA123..." }

**Note:** Calls cost money. The mock provider is free for testing.`,
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["initiate_call", "continue_call", "speak_to_user", "end_call", "get_status"],
          description: "Voice call action",
        },
        to: {
          type: "string",
          description: "Phone number to call (E.164 format, e.g., +15551234567) for initiate_call",
        },
        message: {
          type: "string",
          description: "Message to speak during the call",
        },
        callId: {
          type: "string",
          description: "Call ID for continue, end, or status actions",
        },
        record: {
          type: "boolean",
          description: "Record the call (provider-dependent)",
        },
      },
      required: ["action"],
    },
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      const runtime = getVoiceCallRuntime();
      const action = params.action as string;

      try {
        switch (action) {
          case "initiate_call": {
            const to = params.to as string;
            const message = params.message as string | undefined;
            const record = params.record as boolean | undefined;

            if (!to) {
              return {
                content: [{ type: "text" as const, text: "Error: 'to' phone number is required" }],
                details: { error: "missing_to" },
              };
            }

            const result = await runtime.initiateCall({
              to,
              message,
              record,
            });

            return {
              content: [{
                type: "text" as const,
                text: `Call initiated to ${to}\nCall ID: ${result.callId}\nStatus: ${result.status}`,
              }],
              details: result,
            };
          }

          case "continue_call":
          case "speak_to_user": {
            const callId = params.callId as string;
            const message = params.message as string;

            if (!callId || !message) {
              return {
                content: [{ type: "text" as const, text: "Error: 'callId' and 'message' are required" }],
                details: { error: "missing_params" },
              };
            }

            await runtime.speak({ callId, message });

            return {
              content: [{
                type: "text" as const,
                text: `Message spoken: "${message.substring(0, 100)}${message.length > 100 ? "..." : ""}"`,
              }],
              details: { callId, spoken: true },
            };
          }

          case "end_call": {
            const callId = params.callId as string;

            if (!callId) {
              return {
                content: [{ type: "text" as const, text: "Error: 'callId' is required" }],
                details: { error: "missing_callId" },
              };
            }

            await runtime.endCall(callId);

            return {
              content: [{
                type: "text" as const,
                text: `Call ${callId.substring(0, 20)}... ended`,
              }],
              details: { callId, ended: true },
            };
          }

          case "get_status": {
            const callId = params.callId as string;

            if (!callId) {
              return {
                content: [{ type: "text" as const, text: "Error: 'callId' is required" }],
                details: { error: "missing_callId" },
              };
            }

            const status = await runtime.getCallStatus(callId);

            return {
              content: [{
                type: "text" as const,
                text: `Call Status:\nID: ${status.callId}\nProvider ID: ${status.providerCallId}\nStatus: ${status.status}${status.duration ? `\nDuration: ${status.duration}s` : ""}`,
              }],
              details: status,
            };
          }

          default:
            return {
              content: [{ type: "text" as const, text: `Error: Unknown action '${action}'` }],
              details: { error: "unknown_action", action },
            };
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Voice call error: ${errorMsg}` }],
          details: { error: errorMsg },
        };
      }
    },
  };
}
