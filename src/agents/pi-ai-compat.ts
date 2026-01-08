/**
 * Local pi-ai compatibility types and stubs.
 * These replace imports from @mariozechner/pi-ai for the OpenCode migration.
 */

/**
 * Generic API type parameter. Used as a type parameter for Model<Api>.
 */
export type Api = unknown;

/**
 * Model type with provider information.
 */
export type Model<_T = Api> = {
  provider: string;
  id: string;
  name?: string;
  contextWindow?: number;
  input?: string[];
  baseUrl?: string;
  maxTokens?: number;
  reasoning?: boolean;
};

/**
 * OpenAI-specific model type (used in model scanning).
 */
export type OpenAIModel = Model & {
  input?: string[];
  maxTokens?: number;
  reasoning?: boolean;
};

/**
 * Message part for content blocks.
 */
export type Part = {
  type: string;
  text?: string;
  source?: { type: string; data?: string; url?: string };
};

/**
 * Assistant message type.
 */
export type AssistantMessage = {
  role: "assistant";
  content: Part[];
};

/**
 * Context type for LLM completions.
 */
export type Context = {
  signal?: AbortSignal;
  apiKey?: string;
  messages?: unknown[];
  maxTokens?: number;
  tools?: unknown[];
};

/**
 * OpenAI completion options.
 */
export type OpenAICompletionsOptions = Record<string, unknown>;

/**
 * Complete function stub - not implemented.
 * In the pi-* system this runs a completion against an LLM.
 */
export async function complete(
  _model: Model,
  _context: Context,
  _options?: OpenAICompletionsOptions,
): Promise<AssistantMessage> {
  throw new Error("complete() is not implemented in pi-ai-compat stub");
}

/**
 * Get API key from environment variables for a provider.
 * This is a stub - google-vertex ADC lookup is not implemented.
 */
export function getEnvApiKey(provider: string): string | undefined {
  // For google-vertex, this would normally check gcloud ADC
  // For now, return undefined to fall back to other auth methods
  if (provider === "google-vertex") {
    // gcloud ADC lookup not implemented in stub
    return undefined;
  }
  return undefined;
}

/**
 * Tool definition for function calling.
 */
export type Tool = {
  name: string;
  description: string;
  parameters: unknown;
};

/**
 * Get a model by provider/id - stub.
 */
export function getModel(provider: string, id: string): Model {
  return { provider, id };
}

/**
 * OAuth credentials type.
 */
export type OAuthCredentials = {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  clientId?: string;
  clientSecret?: string;
};

/**
 * Simple completion function stub - not implemented.
 */
export async function completeSimple(
  _model: Model,
  _prompt: string,
  _context?: Context,
): Promise<string> {
  throw new Error("completeSimple() is not implemented in pi-ai-compat stub");
}

/**
 * Completion options with prompt parameter.
 */
export interface CompletionPromptOptions {
  apiKey?: string;
  maxTokens?: number;
}

/**
 * Complete with prompt - simplified interface.
 */
export async function completeWithPrompt(
  _model: Model,
  _prompt: { messages: unknown[] },
  _options?: CompletionPromptOptions,
): Promise<AssistantMessage> {
  throw new Error(
    "completeWithPrompt() is not implemented in pi-ai-compat stub",
  );
}
