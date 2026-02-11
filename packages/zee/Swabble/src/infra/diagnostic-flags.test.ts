import { describe, expect, it } from "vitest";

import type { ZeeConfig } from "../config/config.js";
import { isDiagnosticFlagEnabled, resolveDiagnosticFlags } from "./diagnostic-flags.js";

describe("diagnostic flags", () => {
  it("merges config + env flags", () => {
    const cfg = {
      diagnostics: { flags: ["whatsapp.http", "cache.*"] },
    } as ZeeConfig;
    const env = {
      ZEE_DIAGNOSTICS: "foo,bar",
    } as NodeJS.ProcessEnv;

    const flags = resolveDiagnosticFlags(cfg, env);
    expect(flags).toEqual(expect.arrayContaining(["whatsapp.http", "cache.*", "foo", "bar"]));
    expect(isDiagnosticFlagEnabled("whatsapp.http", cfg, env)).toBe(true);
    expect(isDiagnosticFlagEnabled("cache.hit", cfg, env)).toBe(true);
    expect(isDiagnosticFlagEnabled("foo", cfg, env)).toBe(true);
  });

  it("treats env true as wildcard", () => {
    const env = { ZEE_DIAGNOSTICS: "1" } as NodeJS.ProcessEnv;
    expect(isDiagnosticFlagEnabled("anything.here", undefined, env)).toBe(true);
  });

  it("treats env false as disabled", () => {
    const env = { ZEE_DIAGNOSTICS: "0" } as NodeJS.ProcessEnv;
    expect(isDiagnosticFlagEnabled("whatsapp.http", undefined, env)).toBe(false);
  });
});
