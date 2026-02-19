type CompatConfig = {
  supportsUsageInStreaming?: boolean;
  supportsStrictMode?: boolean;
  thinkingFormat?: string;
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

  if (compat.thinkingFormat !== undefined && typeof compat.thinkingFormat !== "string") {
    errors.push(`${path}.thinkingFormat must be a string`);
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

