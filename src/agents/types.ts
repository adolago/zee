/**
 * Type definitions for zee's agent system.
 * These replace the types that were previously imported from @mariozechner/pi-* packages.
 */

import type { TSchema } from "@sinclair/typebox";

/**
 * Content block types for tool results.
 */
export interface TextContent {
  type: "text";
  text: string;
}

export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export type ContentBlock = TextContent | ImageContent;

/**
 * Tool result returned by agent tools.
 */
export interface AgentToolResult<TDetails = unknown> {
  content: ContentBlock[];
  details?: TDetails;
}

/**
 * Agent tool definition.
 */
export interface AgentTool<
  TParams extends TSchema = TSchema,
  TDetails = unknown,
> {
  name: string;
  label?: string;
  description: string;
  parameters: TParams;
  execute: (
    toolCallId: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: (update: string) => void,
  ) => Promise<AgentToolResult<TDetails>>;
}

/**
 * Any agent tool with flexible parameter typing.
 */
// biome-ignore lint/suspicious/noExplicitAny: Flexible typing for tool parameters
export type AnyAgentTool = AgentTool<any, unknown>;

/**
 * Thinking level for LLM reasoning.
 */
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high";

/**
 * Model information.
 */
export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
}

/**
 * Provider information.
 */
export interface ProviderInfo {
  id: string;
  name: string;
  models: ModelInfo[];
}
