import { z } from "zod";
import type { ZodTypeAny } from "zod";

import type { ChannelConfigSchema } from "./types.plugin.js";

export function buildChannelConfigSchema(schema: ZodTypeAny): ChannelConfigSchema {
  return {
    schema: z.toJSONSchema(schema as any, {
      target: "draft-7",
      unrepresentable: "any",
    }) as Record<string, unknown>,
  };
}
