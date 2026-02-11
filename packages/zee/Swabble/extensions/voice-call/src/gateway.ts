/**
 * Voice Call Gateway Methods
 * 
 * WebSocket RPC methods for voice call management.
 */

import type { VoiceCallRuntime } from "./runtime.js";

export function registerVoiceCallGatewayMethods(
  registerMethod: (method: string, handler: (params: unknown, respond: (ok: boolean, payload?: unknown) => void) => void) => void,
  getRuntime: () => VoiceCallRuntime | null
): void {
  // voicecall.initiate
  registerMethod("voicecall.initiate", async (params, respond) => {
    const runtime = getRuntime();
    if (!runtime) {
      respond(false, { error: "Voice call runtime not initialized" });
      return;
    }

    try {
      const { to, message, record } = params as { to: string; message?: string; record?: boolean };
      const result = await runtime.initiateCall({ to, message, record });
      respond(true, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      respond(false, { error: message });
    }
  });

  // voicecall.continue
  registerMethod("voicecall.continue", async (params, respond) => {
    const runtime = getRuntime();
    if (!runtime) {
      respond(false, { error: "Voice call runtime not initialized" });
      return;
    }

    try {
      const { callId, message } = params as { callId: string; message: string };
      await runtime.continueCall(callId, message);
      respond(true, { spoken: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      respond(false, { error: message });
    }
  });

  // voicecall.speak
  registerMethod("voicecall.speak", async (params, respond) => {
    const runtime = getRuntime();
    if (!runtime) {
      respond(false, { error: "Voice call runtime not initialized" });
      return;
    }

    try {
      const { callId, message, voice } = params as { callId: string; message: string; voice?: string };
      await runtime.speak({ callId, message, voice });
      respond(true, { spoken: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      respond(false, { error: message });
    }
  });

  // voicecall.end
  registerMethod("voicecall.end", async (params, respond) => {
    const runtime = getRuntime();
    if (!runtime) {
      respond(false, { error: "Voice call runtime not initialized" });
      return;
    }

    try {
      const { callId } = params as { callId: string };
      await runtime.endCall(callId);
      respond(true, { ended: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      respond(false, { error: message });
    }
  });

  // voicecall.status
  registerMethod("voicecall.status", async (params, respond) => {
    const runtime = getRuntime();
    if (!runtime) {
      respond(false, { error: "Voice call runtime not initialized" });
      return;
    }

    try {
      const { callId } = params as { callId?: string };
      
      if (!callId) {
        // List all active calls
        const calls = runtime.getAllActiveCalls();
        respond(true, { calls });
        return;
      }

      const status = await runtime.getStatus(callId);
      const call = runtime.getCall(callId);
      
      respond(true, {
        ...status,
        transcript: call?.transcript,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      respond(false, { error: message });
    }
  });

  // voicecall.start (alias for initiate, used by some clients)
  registerMethod("voicecall.start", async (params, respond) => {
    const runtime = getRuntime();
    if (!runtime) {
      respond(false, { error: "Voice call runtime not initialized" });
      return;
    }

    try {
      const { to, message, record } = params as { to: string; message?: string; record?: boolean };
      const result = await runtime.initiateCall({ to, message, record });
      respond(true, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      respond(false, { error: message });
    }
  });
}
