/**
 * Voice Call Provider Factory
 */

import type { VoiceCallConfig, VoiceCallProviderInterface } from "../types.js";
import { MockProvider } from "./mock.js";
import { TwilioProvider } from "./twilio.js";
import { TelnyxProvider } from "./telnyx.js";
import { PlivoProvider } from "./plivo.js";

export function createProvider(config: VoiceCallConfig): VoiceCallProviderInterface {
  switch (config.provider) {
    case "twilio":
      return new TwilioProvider(config);
    case "telnyx":
      return new TelnyxProvider(config);
    case "plivo":
      return new PlivoProvider(config);
    case "mock":
      return new MockProvider();
    default:
      throw new Error(`Unknown voice call provider: ${config.provider}`);
  }
}

export { MockProvider, TwilioProvider, TelnyxProvider, PlivoProvider };
