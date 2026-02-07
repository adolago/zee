import { describe, expect, it } from "vitest";
import { migrateLegacyConfig } from "./legacy-migrate.js";

describe("legacy migrations: matrix dm allowlist keys", () => {
  it("moves channels.matrix.dmPolicy/allowFrom to channels.matrix.dm.*", () => {
    const raw = {
      channels: {
        matrix: {
          dmPolicy: "pairing",
          allowFrom: ["@alice:example.org"],
        },
      },
    };

    const { config, changes } = migrateLegacyConfig(raw);
    expect(config).not.toBeNull();
    expect(changes.join("\n")).toContain("channels.matrix.dmPolicy");
    expect(changes.join("\n")).toContain("channels.matrix.allowFrom");

    const migrated = config as any;
    expect(migrated.channels.matrix.dm.policy).toBe("pairing");
    expect(migrated.channels.matrix.dm.allowFrom).toEqual(["@alice:example.org"]);
    expect(migrated.channels.matrix.dmPolicy).toBeUndefined();
    expect(migrated.channels.matrix.allowFrom).toBeUndefined();
  });

  it("migrates account-scoped legacy keys", () => {
    const raw = {
      channels: {
        matrix: {
          accounts: {
            a: {
              dmPolicy: "allowlist",
              allowFrom: ["@bob:example.org"],
            },
          },
        },
      },
    };

    const { config } = migrateLegacyConfig(raw);
    expect(config).not.toBeNull();

    const migrated = config as any;
    expect(migrated.channels.matrix.accounts.a.dm.policy).toBe("allowlist");
    expect(migrated.channels.matrix.accounts.a.dm.allowFrom).toEqual(["@bob:example.org"]);
    expect(migrated.channels.matrix.accounts.a.dmPolicy).toBeUndefined();
    expect(migrated.channels.matrix.accounts.a.allowFrom).toBeUndefined();
  });
});

