/**
 * Provider Module
 *
 * Multi-LLM provider system with subscription-based authentication support.
 */

export * from "./types";

// Re-export common provider IDs
export const ANTHROPIC = "anthropic";
export const OPENAI = "openai";
export const GOOGLE = "google";
export const OPENROUTER = "openrouter";
export const DEEPSEEK = "deepseek";
export const KIMI = "kimi-for-coding";
export const MINIMAX = "minimax";
export const ZAI = "zai-coding-plan";
export const XAI = "xai";

// Subscription providers
export const CLAUDE_MAX = "claude-max";
export const CHATGPT_PLUS = "chatgpt-plus";
