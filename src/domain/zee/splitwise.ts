import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { getZeeSplitwiseConfig, type ZeeSplitwiseConfig } from "../../config/runtime";
import { getApiKeySync } from "../../config/providers";

export const SPLITWISE_ACTIONS = [
  "current-user",
  "groups",
  "group",
  "friends",
  "friend",
  "expenses",
  "expense",
  "create-expense",
  "update-expense",
  "delete-expense",
  "create-payment",
  "notifications",
  "currencies",
  "categories",
  "request",
] as const;

export type SplitwiseAction = typeof SPLITWISE_ACTIONS[number];

export type SplitwiseMethod = "GET" | "POST" | "PUT" | "DELETE";

export type SplitwisePayloadFormat = "json" | "form";

export type SplitwiseValue = string | number | boolean;

export type SplitwiseActionInput = {
  action: SplitwiseAction;
  groupId?: number;
  friendId?: number;
  expenseId?: number;
  endpoint?: string;
  method?: SplitwiseMethod;
  query?: Record<string, SplitwiseValue>;
  payload?: Record<string, SplitwiseValue>;
  payloadFormat?: SplitwisePayloadFormat;
  timeoutMs?: number;
};

export type SplitwiseRequest = {
  endpoint: string;
  method: SplitwiseMethod;
  query?: Record<string, SplitwiseValue>;
  payload?: Record<string, SplitwiseValue>;
  payloadFormat?: SplitwisePayloadFormat;
  timeoutMs?: number;
};

export type SplitwiseConfigResolved = {
  enabled: boolean;
  token?: string;
  baseUrl: string;
  timeoutMs?: number;
  error?: string;
  tokenSource?: "config" | "env" | "file" | "auth";
};

export type SplitwiseResponse = {
  ok: boolean;
  status: number;
  data: unknown;
  raw: string;
};

const DEFAULT_BASE_URL = "https://secure.splitwise.com/api/v3.0";

function resolveUserPath(input: string): string {
  if (input.startsWith("~/")) {
    return path.join(homedir(), input.slice(2));
  }
  return path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
}

function readTokenFile(tokenFile: string): { token?: string; error?: string } {
  try {
    const resolved = resolveUserPath(tokenFile);
    const token = readFileSync(resolved, "utf-8").trim();
    if (!token) {
      return { error: `Splitwise token file is empty: ${resolved}` };
    }
    return { token };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: `Failed to read Splitwise token file: ${message}` };
  }
}

function parseTimeoutMs(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function resolveSplitwiseConfig(): SplitwiseConfigResolved {
  const config: ZeeSplitwiseConfig = getZeeSplitwiseConfig();
  const enabled = config.enabled === true;
  const baseUrl = (config.baseUrl || process.env.SPLITWISE_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const timeoutMs =
    config.timeoutMs ?? parseTimeoutMs(process.env.SPLITWISE_TIMEOUT_MS);

  const configToken = config.token?.trim();
  if (configToken) {
    return { enabled, token: configToken, baseUrl, timeoutMs, tokenSource: "config" };
  }

  const envToken = process.env.SPLITWISE_TOKEN?.trim();
  if (envToken) {
    return { enabled, token: envToken, baseUrl, timeoutMs, tokenSource: "env" };
  }

  // Check Zee auth store (set via `zee auth login splitwise`)
  const authToken = getApiKeySync("splitwise");
  if (authToken) {
    return { enabled, token: authToken, baseUrl, timeoutMs, tokenSource: "auth" };
  }

  const tokenFile = config.tokenFile || process.env.SPLITWISE_TOKEN_FILE;
  if (tokenFile) {
    const result = readTokenFile(tokenFile);
    if (result.token) {
      return { enabled, token: result.token, baseUrl, timeoutMs, tokenSource: "file" };
    }
    return { enabled, baseUrl, timeoutMs, error: result.error };
  }

  return { enabled, baseUrl, timeoutMs };
}

export function buildSplitwiseRequest(input: SplitwiseActionInput): { request?: SplitwiseRequest; error?: string } {
  const payloadFormat = input.payloadFormat ?? "json";
  let endpoint = "";
  let method: SplitwiseMethod = "GET";

  switch (input.action) {
    case "current-user":
      endpoint = "get_current_user";
      break;
    case "groups":
      endpoint = "get_groups";
      break;
    case "group":
      if (!input.groupId) return { error: "groupId is required for action: group" };
      endpoint = `get_group/${input.groupId}`;
      break;
    case "friends":
      endpoint = "get_friends";
      break;
    case "friend":
      if (!input.friendId) return { error: "friendId is required for action: friend" };
      endpoint = `get_friend/${input.friendId}`;
      break;
    case "expenses":
      endpoint = "get_expenses";
      break;
    case "expense":
      if (!input.expenseId) return { error: "expenseId is required for action: expense" };
      endpoint = `get_expense/${input.expenseId}`;
      break;
    case "create-expense":
      endpoint = "create_expense";
      method = "POST";
      break;
    case "update-expense":
      if (!input.expenseId) return { error: "expenseId is required for action: update-expense" };
      endpoint = `update_expense/${input.expenseId}`;
      method = "POST";
      break;
    case "delete-expense":
      if (!input.expenseId) return { error: "expenseId is required for action: delete-expense" };
      endpoint = `delete_expense/${input.expenseId}`;
      method = "POST";
      break;
    case "create-payment":
      endpoint = "create_payment";
      method = "POST";
      break;
    case "notifications":
      endpoint = "get_notifications";
      break;
    case "currencies":
      endpoint = "get_currencies";
      break;
    case "categories":
      endpoint = "get_categories";
      break;
    case "request":
      if (!input.endpoint) return { error: "endpoint is required for action: request" };
      endpoint = input.endpoint.replace(/^\/+/, "");
      method = input.method ?? "GET";
      break;
  }

  return {
    request: {
      endpoint,
      method,
      query: input.query,
      payload: input.payload,
      payloadFormat,
      timeoutMs: input.timeoutMs,
    },
  };
}

function toSearchParams(values?: Record<string, SplitwiseValue>): URLSearchParams {
  const params = new URLSearchParams();
  if (!values) return params;
  for (const [key, value] of Object.entries(values)) {
    params.set(key, String(value));
  }
  return params;
}

export async function callSplitwiseApi(
  request: SplitwiseRequest,
  config: SplitwiseConfigResolved,
): Promise<SplitwiseResponse> {
  const method = request.method ?? "GET";
  const endpoint = request.endpoint.replace(/^\/+/, "");
  const url = new URL(`${config.baseUrl}/${endpoint}`);

  const query = toSearchParams(request.query);
  query.forEach((value, key) => {
    url.searchParams.set(key, value);
  });

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.token ?? ""}`,
  };

  let body: string | undefined;
  if (method !== "GET") {
    const payload = request.payload ?? {};
    if (request.payloadFormat === "form") {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = toSearchParams(payload).toString();
    } else {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(payload);
    }
  }

  const timeoutMs = request.timeoutMs ?? config.timeoutMs ?? 15000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method,
      headers,
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  const raw = await response.text();
  let data: unknown = raw;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = raw;
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
    raw,
  };
}
