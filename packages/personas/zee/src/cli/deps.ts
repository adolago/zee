import { logWebSelfId, sendMessageWhatsApp } from "../channels/web/index.js";
import type { OutboundSendDeps } from "../infra/outbound/deliver.js";

export type CliDeps = {
  sendMessageWhatsApp: typeof sendMessageWhatsApp;
};

export function createDefaultDeps(): CliDeps {
  return {
    sendMessageWhatsApp,
  };
}

// Provider docking: extend this mapping when adding new outbound send deps.
export function createOutboundSendDeps(deps: CliDeps): OutboundSendDeps {
  return {
    sendWhatsApp: deps.sendMessageWhatsApp,
  };
}

export { logWebSelfId };
