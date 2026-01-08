/**
 * Local OAuth compatibility types and stubs.
 * These replace imports from @mariozechner/pi-ai for the OpenCode migration.
 * OAuth token refresh is stubbed - real implementation will come from agent-core plugins.
 */

export type OAuthProvider =
  | "anthropic"
  | "google-antigravity"
  | "google-gemini-cli"
  | "openai-codex";

export type OAuthCredentials = {
  access: string;
  refresh: string;
  expires: number;
  enterpriseUrl?: string;
  projectId?: string;
  accountId?: string;
  email?: string;
};

/**
 * Stub for OAuth API key retrieval/refresh.
 * In the pi-* implementation, this would refresh tokens via the OAuth provider.
 * For now, this returns null (no refresh) - the agent-core plugins will handle OAuth.
 */
export async function getOAuthApiKey(
  _provider: OAuthProvider,
  _credentials: Record<string, OAuthCredentials>,
): Promise<{ apiKey: string; newCredentials: OAuthCredentials } | null> {
  // OAuth token refresh is not implemented in this stub.
  // The agent-core migration will use opencode plugins for OAuth.
  return null;
}

/**
 * Stub for Anthropic OAuth login.
 * @throws Error - OAuth login not available in stub implementation
 */
export async function loginAnthropic(
  _openUrl: (url: string) => Promise<void>,
  _promptCode: () => Promise<string>,
): Promise<OAuthCredentials | null> {
  throw new Error(
    "Anthropic OAuth login is not available. Please use API key authentication or Claude CLI credentials.",
  );
}

/**
 * Stub for OpenAI Codex OAuth login.
 * @throws Error - OAuth login not available in stub implementation
 */
export async function loginOpenAICodex(_params: {
  onAuth: (opts: { url: string }) => Promise<void>;
  onPrompt: (prompt: {
    message: string;
    placeholder?: string;
  }) => Promise<string>;
  onProgress?: (msg: string) => void;
}): Promise<OAuthCredentials | null> {
  throw new Error(
    "OpenAI Codex OAuth login is not available. Please use API key authentication or Codex CLI credentials.",
  );
}

/**
 * Stub for Google Antigravity OAuth login.
 * @throws Error - OAuth login not available in stub implementation
 */
export async function loginAntigravity(
  _openUrl: (opts: { url: string; instructions?: string }) => Promise<void>,
  _onProgress?: (msg: string) => void,
): Promise<OAuthCredentials | null> {
  throw new Error(
    "Google Antigravity OAuth login is not available. The agent-core migration will provide this functionality.",
  );
}
