type CompatConfig = {
  supportsStore?: boolean;
  supportsDeveloperRole?: boolean;
  supportsReasoningEffort?: boolean;
  supportsUsageInStreaming?: boolean;
  supportsStrictMode?: boolean;
  maxTokensField?: "max_completion_tokens" | "max_tokens";
  thinkingFormat?: "openai" | "zai" | "qwen";
  requiresToolResultName?: boolean;
  requiresAssistantAfterToolResult?: boolean;
  requiresThinkingAsText?: boolean;
  requiresMistralToolIds?: boolean;
};

export type ValidationResult = {
  ok: boolean;
  errors?: string[];
};

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function validateCompat(compat: unknown, path: string, errors: string[]): void {
  if (!isRecord(compat)) {
    errors.push(`${path} must be an object`);
    return;
  }

  const booleanKeys: Array<keyof CompatConfig> = [
    "supportsStore",
    "supportsDeveloperRole",
    "supportsReasoningEffort",
    "supportsUsageInStreaming",
    "supportsStrictMode",
    "requiresToolResultName",
    "requiresAssistantAfterToolResult",
    "requiresThinkingAsText",
    "requiresMistralToolIds",
  ];

  for (const key of booleanKeys) {
    const value = compat[key];
    if (value !== undefined && typeof value !== "boolean") {
      errors.push(`${path}.${key} must be a boolean`);
    }
  }

  if (
    compat.maxTokensField !== undefined &&
    compat.maxTokensField !== "max_completion_tokens" &&
    compat.maxTokensField !== "max_tokens"
  ) {
    errors.push(`${path}.maxTokensField must be one of: max_completion_tokens, max_tokens`);
  }

  if (
    compat.thinkingFormat !== undefined &&
    compat.thinkingFormat !== "openai" &&
    compat.thinkingFormat !== "zai" &&
    compat.thinkingFormat !== "qwen"
  ) {
    errors.push(`${path}.thinkingFormat must be one of: openai, zai, qwen`);
  }
}

export function validateConfigObject(config: unknown): ValidationResult {
  if (!isRecord(config)) {
    return { ok: false, errors: ["config must be an object"] };
  }

  const errors: string[] = [];
  const modelsRoot = config.models;
  if (!isRecord(modelsRoot)) return { ok: true };

  const providers = modelsRoot.providers;
  if (!isRecord(providers)) return { ok: true };

  for (const [providerId, providerValue] of Object.entries(providers)) {
    if (!isRecord(providerValue)) continue;
    const models = providerValue.models;
    if (!Array.isArray(models)) continue;

    for (let index = 0; index < models.length; index += 1) {
      const model = models[index];
      if (!isRecord(model) || model.compat === undefined) continue;
      validateCompat(model.compat, `models.providers.${providerId}.models[${index}].compat`, errors);
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
