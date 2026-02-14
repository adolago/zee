import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  BROWSER_DOWNLOAD_ROOT,
  BROWSER_TRACE_ROOT,
  resolveBrowserDownloadOutputPath,
  resolveBrowserTraceOutputPath,
} from "./artifact-paths.js";

describe("browser artifact paths", () => {
  it("resolves default download paths under the controlled root", () => {
    const out = resolveBrowserDownloadOutputPath({
      suggestedFilename: "report 2026?.pdf",
    });
    const root = `${path.resolve(BROWSER_DOWNLOAD_ROOT)}${path.sep}`;
    expect(out.startsWith(root)).toBe(true);
    expect(path.basename(out)).toContain("report-2026-.pdf");
  });

  it("allows relative download paths inside the controlled root", () => {
    const out = resolveBrowserDownloadOutputPath({
      requestedPath: "exports/run-1/report.pdf",
      suggestedFilename: "ignored.pdf",
    });
    expect(out).toBe(path.resolve(BROWSER_DOWNLOAD_ROOT, "exports/run-1/report.pdf"));
  });

  it("rejects download paths that escape the controlled root", () => {
    expect(() =>
      resolveBrowserDownloadOutputPath({
        requestedPath: "../outside/report.pdf",
      }),
    ).toThrow(/within/i);
    expect(() =>
      resolveBrowserDownloadOutputPath({
        requestedPath: "/tmp/report.pdf",
      }),
    ).toThrow(/within/i);
  });

  it("resolves default trace paths under the controlled root", () => {
    const out = resolveBrowserTraceOutputPath({});
    const root = `${path.resolve(BROWSER_TRACE_ROOT)}${path.sep}`;
    expect(out.startsWith(root)).toBe(true);
    expect(out.endsWith(".zip")).toBe(true);
  });
});
