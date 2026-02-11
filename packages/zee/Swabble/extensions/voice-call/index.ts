/**
 * Voice Call Extension for Zee
 * 
 * Provides voice calling capabilities via Twilio, Telnyx, or Plivo.
 */

import type { ZeePluginApi } from "zee/plugin-sdk";
import { initializeVoiceCallRuntime, stopVoiceCallRuntime } from "./src/runtime.js";
import { createVoiceCallTool } from "./src/tool.js";
import { registerVoiceCallGatewayMethods } from "./src/gateway-methods.js";
import { registerVoiceCallCLI } from "./src/cli.js";

export interface VoiceCallPluginConfig {
  provider: "twilio" | "telnyx" | "plivo" | "mock";
  fromNumber: string;
  twilio?: {
    accountSid: string;
    authToken: string;
  };
  telnyx?: {
    apiKey: string;
    connectionId?: string;
  };
  plivo?: {
    authId: string;
    authToken: string;
  };
}

export default function register(api: ZeePluginApi) {
  const config = api.pluginConfig as VoiceCallPluginConfig | undefined;

  if (!config) {
    api.logger?.warn("Voice call plugin: No configuration found");
    return;
  }

  if (!config.provider) {
    api.logger?.warn("Voice call plugin: No provider configured");
    return;
  }

  if (!config.fromNumber) {
    api.logger?.warn("Voice call plugin: No fromNumber configured");
    return;
  }

  try {
    // Initialize runtime
    initializeVoiceCallRuntime({
      provider: config.provider,
      fromNumber: config.fromNumber,
      twilio: config.twilio,
      telnyx: config.telnyx,
      plivo: config.plivo,
    });

    // Register tool
    api.registerTool(createVoiceCallTool(api), { optional: true });

    // Register gateway methods
    registerVoiceCallGatewayMethods(api);

    // Register CLI
    registerVoiceCallCLI(api);

    api.logger?.info(`Voice call plugin initialized with provider: ${config.provider}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    api.logger?.error(`Voice call plugin initialization failed: ${msg}`);
  }
}

// Cleanup on shutdown
export async function stop(): Promise<void> {
  await stopVoiceCallRuntime();
}
