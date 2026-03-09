/** System and health types */

export interface SystemHealth {
  status: string;
  version?: string;
  uptime?: number;
  services?: Record<string, string>;
  core?: boolean;
}

export interface PingResponse {
  pong: boolean;
  timestamp: string;
}

export interface SystemInfo {
  version: string;
  environment: string;
  features: string[];
  endpoints: number;
}
