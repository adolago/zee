import type { HttpTransport } from "../http";
import type { SystemHealth, PingResponse, SystemInfo } from "../types/system";
import type { ApiResponse } from "../types/common";

export class SystemRouter {
  constructor(private http: HttpTransport) {}

  async health(): Promise<ApiResponse<SystemHealth>> {
    return this.http.request<SystemHealth>("/api/health");
  }

  async ping(): Promise<ApiResponse<PingResponse>> {
    return this.http.request<PingResponse>("/api/ping");
  }

  async info(): Promise<ApiResponse<SystemInfo>> {
    return this.http.request<SystemInfo>("/api/system/info");
  }
}
