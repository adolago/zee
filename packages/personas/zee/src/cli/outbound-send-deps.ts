import type { OutboundSendDeps } from "../infra/outbound/deliver.js";

export type CliDeps = {
  sendMessageWhatsApp: NonNullable<OutboundSendDeps["sendWhatsApp"]>;
};

// Provider docking: extend this mapping when adding new outbound send deps.
export function createOutboundSendDeps(deps: CliDeps): OutboundSendDeps {
  return {
    sendWhatsApp: deps.sendMessageWhatsApp,
  };
}
