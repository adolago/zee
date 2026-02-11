import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(),
  },
}));

const installPluginFromNpmSpec = vi.fn();
vi.mock("../../plugins/install.js", () => ({
  installPluginFromNpmSpec: (...args: unknown[]) => installPluginFromNpmSpec(...args),
}));

vi.mock("../../plugins/loader.js", () => ({
  loadZeePlugins: vi.fn(),
}));

import fs from "node:fs";
import type { ChannelPluginCatalogEntry } from "../../channels/plugins/catalog.js";
import type { ZeeConfig } from "../../config/config.js";
import type { WizardPrompter } from "../../wizard/prompts.js";
import { makePrompter, makeRuntime } from "./__tests__/test-utils.js";
import { ensureOnboardingPluginInstalled } from "./plugin-install.js";

const baseEntry: ChannelPluginCatalogEntry = {
  id: "custom",
  meta: {
    id: "custom",
    label: "Custom",
    selectionLabel: "Custom (Bot API)",
    docsPath: "/channels/custom",
    docsLabel: "custom",
    blurb: "Test",
  },
  install: {
    npmSpec: "@zee/custom",
    localPath: "extensions/custom",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ensureOnboardingPluginInstalled", () => {
  it("installs from npm and enables the plugin", async () => {
    const runtime = makeRuntime();
    const prompter = makePrompter({
      select: vi.fn(async () => "npm") as WizardPrompter["select"],
    });
    const cfg: ZeeConfig = { plugins: { allow: ["other"] } };
    vi.mocked(fs.existsSync).mockReturnValue(false);
    installPluginFromNpmSpec.mockResolvedValue({
      ok: true,
      pluginId: "custom",
      targetDir: "/tmp/custom",
      extensions: [],
    });

    const result = await ensureOnboardingPluginInstalled({
      cfg,
      entry: baseEntry,
      prompter,
      runtime,
    });

    expect(result.installed).toBe(true);
    expect(result.cfg.plugins?.entries?.custom?.enabled).toBe(true);
    expect(result.cfg.plugins?.allow).toContain("custom");
    expect(result.cfg.plugins?.installs?.custom?.source).toBe("npm");
    expect(result.cfg.plugins?.installs?.custom?.spec).toBe("@zee/custom");
    expect(result.cfg.plugins?.installs?.custom?.installPath).toBe("/tmp/custom");
    expect(installPluginFromNpmSpec).toHaveBeenCalledWith(
      expect.objectContaining({ spec: "@zee/custom" }),
    );
  });

  it("uses local path when selected", async () => {
    const runtime = makeRuntime();
    const prompter = makePrompter({
      select: vi.fn(async () => "local") as WizardPrompter["select"],
    });
    const cfg: ZeeConfig = {};
    vi.mocked(fs.existsSync).mockImplementation((value) => {
      const raw = String(value);
      return (
        raw.endsWith(`${path.sep}.git`) || raw.endsWith(`${path.sep}extensions${path.sep}custom`)
      );
    });

    const result = await ensureOnboardingPluginInstalled({
      cfg,
      entry: baseEntry,
      prompter,
      runtime,
    });

    const expectedPath = path.resolve(process.cwd(), "extensions/custom");
    expect(result.installed).toBe(true);
    expect(result.cfg.plugins?.load?.paths).toContain(expectedPath);
    expect(result.cfg.plugins?.entries?.custom?.enabled).toBe(true);
  });

  it("defaults to local on dev channel when local path exists", async () => {
    const runtime = makeRuntime();
    const select = vi.fn(async () => "skip") as WizardPrompter["select"];
    const prompter = makePrompter({ select });
    const cfg: ZeeConfig = { update: { channel: "dev" } };
    vi.mocked(fs.existsSync).mockImplementation((value) => {
      const raw = String(value);
      return (
        raw.endsWith(`${path.sep}.git`) || raw.endsWith(`${path.sep}extensions${path.sep}custom`)
      );
    });

    await ensureOnboardingPluginInstalled({
      cfg,
      entry: baseEntry,
      prompter,
      runtime,
    });

    const firstCall = select.mock.calls[0]?.[0];
    expect(firstCall?.initialValue).toBe("local");
  });

  it("defaults to npm on beta channel even when local path exists", async () => {
    const runtime = makeRuntime();
    const select = vi.fn(async () => "skip") as WizardPrompter["select"];
    const prompter = makePrompter({ select });
    const cfg: ZeeConfig = { update: { channel: "beta" } };
    vi.mocked(fs.existsSync).mockImplementation((value) => {
      const raw = String(value);
      return (
        raw.endsWith(`${path.sep}.git`) || raw.endsWith(`${path.sep}extensions${path.sep}custom`)
      );
    });

    await ensureOnboardingPluginInstalled({
      cfg,
      entry: baseEntry,
      prompter,
      runtime,
    });

    const firstCall = select.mock.calls[0]?.[0];
    expect(firstCall?.initialValue).toBe("npm");
  });

  it("falls back to local path after npm install failure", async () => {
    const runtime = makeRuntime();
    const note = vi.fn(async () => {});
    const confirm = vi.fn(async () => true);
    const prompter = makePrompter({
      select: vi.fn(async () => "npm") as WizardPrompter["select"],
      note,
      confirm,
    });
    const cfg: ZeeConfig = {};
    vi.mocked(fs.existsSync).mockImplementation((value) => {
      const raw = String(value);
      return (
        raw.endsWith(`${path.sep}.git`) || raw.endsWith(`${path.sep}extensions${path.sep}custom`)
      );
    });
    installPluginFromNpmSpec.mockResolvedValue({
      ok: false,
      error: "nope",
    });

    const result = await ensureOnboardingPluginInstalled({
      cfg,
      entry: baseEntry,
      prompter,
      runtime,
    });

    const expectedPath = path.resolve(process.cwd(), "extensions/custom");
    expect(result.installed).toBe(true);
    expect(result.cfg.plugins?.load?.paths).toContain(expectedPath);
    expect(note).toHaveBeenCalled();
    expect(runtime.error).not.toHaveBeenCalled();
  });
});
