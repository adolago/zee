import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateTalkModeParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

export const talkHandlers: GatewayRequestHandlers = {
  "talk.mode": ({ params, respond, context }) => {
    if (!validateTalkModeParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid talk.mode params: ${formatValidationErrors(validateTalkModeParams.errors)}`,
        ),
      );
      return;
    }
    const payload = {
      enabled: (params as { enabled: boolean }).enabled,
      phase: (params as { phase?: string }).phase ?? null,
      ts: Date.now(),
    };
    context.broadcast("talk.mode", payload, { dropIfSlow: true });
    respond(true, payload, undefined);
  },
};
