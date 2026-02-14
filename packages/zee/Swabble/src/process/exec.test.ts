import { describe, expect, it } from "vitest";

import { runCommandWithTimeout } from "./exec.js";

describe("runCommandWithTimeout", () => {
  it("passes env overrides to child", async () => {
    const result = await runCommandWithTimeout(
      [process.execPath, "-e", 'process.stdout.write(process.env.ZEE_TEST_ENV ?? "")'],
      {
        timeoutMs: 5_000,
        env: { ZEE_TEST_ENV: "ok" },
      },
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toBe("ok");
  });

  it("merges custom env with process.env", async () => {
    const previous = process.env.ZEE_BASE_ENV;
    process.env.ZEE_BASE_ENV = "base";
    try {
      const result = await runCommandWithTimeout(
        [
          process.execPath,
          "-e",
          'process.stdout.write((process.env.ZEE_BASE_ENV ?? "") + "|" + (process.env.ZEE_TEST_ENV ?? ""))',
        ],
        {
          timeoutMs: 5_000,
          env: { ZEE_TEST_ENV: "ok" },
        },
      );

      expect(result.code).toBe(0);
      expect(result.stdout).toBe("base|ok");
    } finally {
      if (previous === undefined) {
        delete process.env.ZEE_BASE_ENV;
      } else {
        process.env.ZEE_BASE_ENV = previous;
      }
    }
  });

  it("coerces env values to strings and omits undefined values", async () => {
    const result = await runCommandWithTimeout(
      [
        process.execPath,
        "-e",
        'process.stdout.write((process.env.ZEE_NUM ?? "") + "|" + String(Object.prototype.hasOwnProperty.call(process.env, "ZEE_UNDEF")))',
      ],
      {
        timeoutMs: 5_000,
        env: {
          ZEE_NUM: 42 as unknown as string,
          ZEE_UNDEF: undefined,
        } as unknown as NodeJS.ProcessEnv,
      },
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toBe("42|false");
  });
});
