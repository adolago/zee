import { describe, expect, it, vi } from "vitest";

const authStatusCommand = vi.fn();
const authUseCommand = vi.fn();
const authRotateCommand = vi.fn();

vi.mock("../commands/auth.js", () => ({
  authStatusCommand,
  authUseCommand,
  authRotateCommand,
}));

describe("auth cli", () => {
  it("registers auth command and runs status", async () => {
    const { Command } = await import("commander");
    const { registerAuthCli } = await import("./auth-cli.js");
    const program = new Command();
    registerAuthCli(program);

    const auth = program.commands.find((cmd) => cmd.name() === "auth");
    expect(auth).toBeTruthy();

    await program.parseAsync(["auth", "status", "--provider", "anthropic"], { from: "user" });

    expect(authStatusCommand).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "anthropic" }),
      expect.any(Object),
    );
  });

  it("runs auth use", async () => {
    const { Command } = await import("commander");
    const { registerAuthCli } = await import("./auth-cli.js");
    const program = new Command();
    registerAuthCli(program);

    await program.parseAsync(
      ["auth", "use", "--provider", "anthropic", "--profile", "anthropic:default"],
      { from: "user" },
    );

    expect(authUseCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "anthropic",
        profile: "anthropic:default",
      }),
      expect.any(Object),
    );
  });

  it("runs auth rotate", async () => {
    const { Command } = await import("commander");
    const { registerAuthCli } = await import("./auth-cli.js");
    const program = new Command();
    registerAuthCli(program);

    await program.parseAsync(["auth", "rotate", "--provider", "openai"], { from: "user" });

    expect(authRotateCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openai",
      }),
      expect.any(Object),
    );
  });
});
