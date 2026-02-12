import {
  loadVoiceWakeConfig,
  resolveEffectiveVoiceWakeTriggers,
  setVoiceWakeConfig,
} from "../../infra/voicewake.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { normalizeVoiceWakeTriggers } from "../server-utils.js";
import { formatForLog } from "../ws-log.js";
import type { GatewayRequestHandlers } from "./types.js";

export const voicewakeHandlers: GatewayRequestHandlers = {
  "voicewake.get": async ({ respond }) => {
    try {
      const cfg = await loadVoiceWakeConfig();
      respond(true, {
        enabled: cfg.enabled,
        triggers: cfg.triggers,
        effectiveTriggers: resolveEffectiveVoiceWakeTriggers(cfg),
      });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
  "voicewake.set": async ({ params, respond, context }) => {
    const hasEnabled = typeof params.enabled === "boolean";
    const hasTriggers = Array.isArray(params.triggers);
    if (!hasEnabled && !hasTriggers) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "voicewake.set requires enabled:boolean and/or triggers:string[]",
        ),
      );
      return;
    }
    try {
      const triggers = hasTriggers
        ? normalizeVoiceWakeTriggers(params.triggers, {
            allowEmpty: hasEnabled && params.enabled === false,
          })
        : undefined;
      const cfg = await setVoiceWakeConfig({
        ...(hasEnabled ? { enabled: Boolean(params.enabled) } : {}),
        ...(hasTriggers ? { triggers } : {}),
      });
      const effectiveTriggers = resolveEffectiveVoiceWakeTriggers(cfg);
      context.broadcastVoiceWakeChanged(effectiveTriggers);
      respond(true, {
        enabled: cfg.enabled,
        triggers: cfg.triggers,
        effectiveTriggers,
      });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
};
