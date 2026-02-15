/**
 * Common types shared across all Stanley SDK domains
 */

import { z } from "zod";

/** Standard API response wrapper matching Stanley's format */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data: T | null;
  error: string | null;
  timestamp: string;
}

/** Health check response */
export interface HealthResponse {
  status: string;
  version?: string;
  uptime?: number;
  services?: Record<string, string>;
}

/** Paginated response */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/** Zod schema for ApiResponse validation */
export const ApiResponseSchema = z.object({
  success: z.boolean(),
  data: z.unknown().nullable(),
  error: z.string().nullable(),
  timestamp: z.string(),
});

/** Zod schema for health response */
export const HealthResponseSchema = z.object({
  status: z.string(),
  version: z.string().optional(),
  uptime: z.number().optional(),
  services: z.record(z.string(), z.string()).optional(),
});

/** Sort direction */
export type SortDirection = "asc" | "desc";

/** Date range filter */
export interface DateRange {
  start?: string;
  end?: string;
}

/** Symbol identifier (uppercase ticker) */
export type Symbol = string;

/** Confidence level for statistical calculations */
export type ConfidenceLevel = 0.9 | 0.95 | 0.99;

/** Time period strings */
export type TimePeriod = "1D" | "1W" | "1M" | "3M" | "6M" | "1Y" | "3Y" | "5Y" | "YTD";
