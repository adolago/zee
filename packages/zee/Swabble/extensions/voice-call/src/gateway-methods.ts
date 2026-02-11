/**
 * Voice Call Gateway Methods
 */

import type { ZeePluginApi } from "zee/plugin-sdk";
import { getVoiceCallRuntime } from "./runtime.js";

export function registerVoiceCallGatewayMethods(api: ZeePluginApi) {
  // Initiate a new call
  api.registerGatewayMethod("voicecall.initiate", async (ctx) => {
    const runtime = getVoiceCallRuntime();
    const { to, message, record } = ctx.params as { to: string; message?: string; record?: boolean };

    try {
      const result = await runtime.initiateCall({ to, message, record });
      ctx.respond(true, result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      ctx.respond(false, { error: msg });
    }
  });

  // Continue/speak during a call
  api.registerGatewayMethod("voicecall.continue", async (ctx) => {
    const runtime = getVoiceCallRuntime();
    const { callId, message } = ctx.params as { callId: string; message: string };

    try {
      await runtime.continueCall(callId, message);
      ctx.respond(true, { callId, spoken: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      ctx.respond(false, { error: msg });
    }
  });

  // Speak to user (alias)
  api.registerGatewayMethod("voicecall.speak", async (ctx) => {
    const runtime = getVoiceCallRuntime();
    const { callId, message } = ctx.params as { callId: string; message: string };

    try {
      await runtime.speak({ callId, message });
      ctx.respond(true, { callId, spoken: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      ctx.respond(false, { error: msg });
    }
  });

  // End a call
  api.registerGatewayMethod("voicecall.end", async (ctx) => {
    const runtime = getVoiceCallRuntime();
    const { callId } = ctx.params as { callId: string };

    try {
      await runtime.endCall(callId);
      ctx.respond(true, { callId, ended: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      ctx.respond(false, { error: msg });
    }
  });

  // Get call status
  api.registerGatewayMethod("voicecall.status", async (ctx) => {
    const runtime = getVoiceCallRuntime();
    const { callId } = ctx.params as { callId: string };

    try {
      const status = await runtime.getCallStatus(callId);
      ctx.respond(true, status);
    } catch (error) {
      // Check if it's a mock provider with fallback
      const call = runtime.getCall(callId);
      if (call) {
        ctx.respond(true, {
          callId,
          providerCallId: call.providerCallId,
          status: call.status,
          duration: call.duration,
        });
      } else {
        const msg = error instanceof Error ? error.message : String(error);
        ctx.respond(false, { error: msg });
      }
    }
  });

  // Start a call (CLI convenience alias)
  api.registerGatewayMethod("voicecall.start", async (ctx) => {
    const runtime = getVoiceCallRuntime();
    const { to, message } = ctx.params as { to: string; message?: string };

    try {
      const result = await runtime.initiateCall({ to, message });
      ctx.respond(true, result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      ctx.respond(false, { error: msg });
    }
  });
}
