import { describe, expect, it } from "vitest";
import {
  formatGatewayServiceDescription,
  GATEWAY_SYSTEMD_SERVICE_NAME,
  GATEWAY_WINDOWS_TASK_NAME,
  resolveGatewayProfileSuffix,
  resolveGatewaySystemdServiceName,
  resolveGatewayWindowsTaskName,
} from "./constants.js";

describe("resolveGatewaySystemdServiceName", () => {
  it("returns default service name when no profile is set", () => {
    const result = resolveGatewaySystemdServiceName();
    expect(result).toBe(GATEWAY_SYSTEMD_SERVICE_NAME);
    expect(result).toBe("zee-gateway");
  });

  it("returns default service name when profile is undefined", () => {
    const result = resolveGatewaySystemdServiceName(undefined);
    expect(result).toBe(GATEWAY_SYSTEMD_SERVICE_NAME);
  });

  it("returns default service name when profile is 'default'", () => {
    const result = resolveGatewaySystemdServiceName("default");
    expect(result).toBe(GATEWAY_SYSTEMD_SERVICE_NAME);
  });

  it("returns default service name when profile is 'DEFAULT' (case-insensitive)", () => {
    const result = resolveGatewaySystemdServiceName("DEFAULT");
    expect(result).toBe(GATEWAY_SYSTEMD_SERVICE_NAME);
  });

  it("returns profile-specific service name when profile is set", () => {
    const result = resolveGatewaySystemdServiceName("dev");
    expect(result).toBe("zee-gateway-dev");
  });

  it("returns profile-specific service name for custom profile", () => {
    const result = resolveGatewaySystemdServiceName("production");
    expect(result).toBe("zee-gateway-production");
  });

  it("trims whitespace from profile", () => {
    const result = resolveGatewaySystemdServiceName("  test  ");
    expect(result).toBe("zee-gateway-test");
  });

  it("returns default service name for empty string profile", () => {
    const result = resolveGatewaySystemdServiceName("");
    expect(result).toBe(GATEWAY_SYSTEMD_SERVICE_NAME);
  });

  it("returns default service name for whitespace-only profile", () => {
    const result = resolveGatewaySystemdServiceName("   ");
    expect(result).toBe(GATEWAY_SYSTEMD_SERVICE_NAME);
  });
});

describe("resolveGatewayWindowsTaskName", () => {
  it("returns default task name when no profile is set", () => {
    const result = resolveGatewayWindowsTaskName();
    expect(result).toBe(GATEWAY_WINDOWS_TASK_NAME);
    expect(result).toBe("Zee Gateway");
  });

  it("returns default task name when profile is undefined", () => {
    const result = resolveGatewayWindowsTaskName(undefined);
    expect(result).toBe(GATEWAY_WINDOWS_TASK_NAME);
  });

  it("returns default task name when profile is 'default'", () => {
    const result = resolveGatewayWindowsTaskName("default");
    expect(result).toBe(GATEWAY_WINDOWS_TASK_NAME);
  });

  it("returns default task name when profile is 'DeFaUlT' (case-insensitive)", () => {
    const result = resolveGatewayWindowsTaskName("DeFaUlT");
    expect(result).toBe(GATEWAY_WINDOWS_TASK_NAME);
  });

  it("returns profile-specific task name when profile is set", () => {
    const result = resolveGatewayWindowsTaskName("dev");
    expect(result).toBe("Zee Gateway (dev)");
  });

  it("returns profile-specific task name for custom profile", () => {
    const result = resolveGatewayWindowsTaskName("work");
    expect(result).toBe("Zee Gateway (work)");
  });

  it("trims whitespace from profile", () => {
    const result = resolveGatewayWindowsTaskName("  ci  ");
    expect(result).toBe("Zee Gateway (ci)");
  });

  it("returns default task name for empty string profile", () => {
    const result = resolveGatewayWindowsTaskName("");
    expect(result).toBe(GATEWAY_WINDOWS_TASK_NAME);
  });

  it("returns default task name for whitespace-only profile", () => {
    const result = resolveGatewayWindowsTaskName("   ");
    expect(result).toBe(GATEWAY_WINDOWS_TASK_NAME);
  });
});

describe("resolveGatewayProfileSuffix", () => {
  it("returns empty string when no profile is set", () => {
    expect(resolveGatewayProfileSuffix()).toBe("");
  });

  it("returns empty string for default profiles", () => {
    expect(resolveGatewayProfileSuffix("default")).toBe("");
    expect(resolveGatewayProfileSuffix(" Default ")).toBe("");
  });

  it("returns a hyphenated suffix for custom profiles", () => {
    expect(resolveGatewayProfileSuffix("dev")).toBe("-dev");
  });

  it("trims whitespace from profiles", () => {
    expect(resolveGatewayProfileSuffix("  staging  ")).toBe("-staging");
  });
});

describe("formatGatewayServiceDescription", () => {
  it("returns default description when no profile/version", () => {
    expect(formatGatewayServiceDescription()).toBe("Zee Gateway");
  });

  it("includes profile when set", () => {
    expect(formatGatewayServiceDescription({ profile: "work" })).toBe(
      "Zee Gateway (profile: work)",
    );
  });

  it("includes version when set", () => {
    expect(formatGatewayServiceDescription({ version: "2026.1.10" })).toBe(
      "Zee Gateway (v2026.1.10)",
    );
  });

  it("includes profile and version when set", () => {
    expect(formatGatewayServiceDescription({ profile: "dev", version: "1.2.3" })).toBe(
      "Zee Gateway (profile: dev, v1.2.3)",
    );
  });
});
