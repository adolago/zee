import {
  findDuplicateAgentDirs,
  formatDuplicateAgentDirError,
} from "./agent-dirs.js";
import {
  applyIdentityDefaults,
  applyModelDefaults,
  applySessionDefaults,
} from "./defaults.js";
import { findLegacyConfigIssues } from "./legacy.js";
import type { ZeeConfig, ConfigValidationIssue } from "./types.js";
import { ZeeSchema } from "./zod-schema.js";

export function validateConfigObject(
  raw: unknown,
):
  | { ok: true; config: ZeeConfig }
  | { ok: false; issues: ConfigValidationIssue[] } {
  const legacyIssues = findLegacyConfigIssues(raw);
  if (legacyIssues.length > 0) {
    return {
      ok: false,
      issues: legacyIssues.map((iss) => ({
        path: iss.path,
        message: iss.message,
      })),
    };
  }
  const validated = ZeeSchema.safeParse(raw);
  if (!validated.success) {
    return {
      ok: false,
      issues: validated.error.issues.map((iss) => ({
        path: iss.path.join("."),
        message: iss.message,
      })),
    };
  }
  const duplicates = findDuplicateAgentDirs(validated.data as ZeeConfig);
  if (duplicates.length > 0) {
    return {
      ok: false,
      issues: [
        {
          path: "routing.agents",
          message: formatDuplicateAgentDirError(duplicates),
        },
      ],
    };
  }
  return {
    ok: true,
    config: applyModelDefaults(
      applySessionDefaults(
        applyIdentityDefaults(validated.data as ZeeConfig),
      ),
    ),
  };
}
