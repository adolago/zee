import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as logger from "../../logger.js";
import * as ssrf from "../../infra/net/ssrf.js";

const lookupMock = vi.fn();
const resolvePinnedHostname = ssrf.resolvePinnedHostname;

function makeHeaders(map: Record<string, string>): { get: (key: string) => string | null } {
  return {
    get: (key) => map[key.toLowerCase()] ?? null,
  };
}

function markdownResponse(body: string, extraHeaders: Record<string, string> = {}): Response {
  return {
    ok: true,
    status: 200,
    headers: makeHeaders({ "content-type": "text/markdown; charset=utf-8", ...extraHeaders }),
    text: async () => body,
  } as Response;
}

function htmlResponse(body: string): Response {
  return {
    ok: true,
    status: 200,
    headers: makeHeaders({ "content-type": "text/html; charset=utf-8" }),
    text: async () => body,
  } as Response;
}

describe("web_fetch Cloudflare Markdown for Agents", () => {
  const priorFetch = global.fetch;

  beforeEach(() => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    vi.spyOn(ssrf, "resolvePinnedHostname").mockImplementation((hostname) =>
      resolvePinnedHostname(hostname, lookupMock),
    );
  });

  afterEach(() => {
    // @ts-expect-error restore
    global.fetch = priorFetch;
    lookupMock.mockReset();
    vi.restoreAllMocks();
  });

  it("sends Accept header preferring text/markdown", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(markdownResponse("# Test Page\n\nHello world."));
    // @ts-expect-error mock fetch
    global.fetch = fetchSpy;

    const { createWebFetchTool } = await import("./web-tools.js");
    const tool = createWebFetchTool({
      config: {
        tools: { web: { fetch: { cacheTtlMinutes: 0, firecrawl: { enabled: false } } } },
      },
    });

    await tool?.execute?.("call", { url: "https://example.com/page" });

    expect(fetchSpy).toHaveBeenCalled();
    const [, init] = fetchSpy.mock.calls[0];
    expect(init.headers.Accept).toBe("text/markdown, text/html;q=0.9, */*;q=0.1");
  });

  it("uses cf-markdown extractor for text/markdown responses", async () => {
    const md = "# CF Markdown\n\nThis is server-rendered markdown.";
    const fetchSpy = vi.fn().mockResolvedValue(markdownResponse(md));
    // @ts-expect-error mock fetch
    global.fetch = fetchSpy;

    const { createWebFetchTool } = await import("./web-tools.js");
    const tool = createWebFetchTool({
      config: {
        tools: { web: { fetch: { cacheTtlMinutes: 0, firecrawl: { enabled: false } } } },
      },
    });

    const result = await tool?.execute?.("call", { url: "https://example.com/cf" });
    expect(result?.details).toMatchObject({
      status: 200,
      extractor: "cf-markdown",
    });
    expect((result?.details as { contentType?: string })?.contentType).toContain("text/markdown");
    expect((result?.details as { text?: string })?.text).toContain("CF Markdown");
  });

  it("falls back to readability for text/html responses", async () => {
    const html =
      "<html><body><article><h1>HTML Page</h1><p>Content here.</p></article></body></html>";
    const fetchSpy = vi.fn().mockResolvedValue(htmlResponse(html));
    // @ts-expect-error mock fetch
    global.fetch = fetchSpy;

    const { createWebFetchTool } = await import("./web-tools.js");
    const tool = createWebFetchTool({
      config: {
        tools: { web: { fetch: { cacheTtlMinutes: 0, firecrawl: { enabled: false } } } },
      },
    });

    const result = await tool?.execute?.("call", { url: "https://example.com/html" });
    expect((result?.details as { extractor?: string })?.extractor).not.toBe("cf-markdown");
    expect((result?.details as { contentType?: string })?.contentType).toContain("text/html");
  });

  it("logs x-markdown-tokens when header is present", async () => {
    const logSpy = vi.spyOn(logger, "logDebug").mockImplementation(() => {});
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(markdownResponse("# Tokens Test", { "x-markdown-tokens": "1500" }));
    // @ts-expect-error mock fetch
    global.fetch = fetchSpy;

    const { createWebFetchTool } = await import("./web-tools.js");
    const tool = createWebFetchTool({
      config: {
        tools: { web: { fetch: { cacheTtlMinutes: 0, firecrawl: { enabled: false } } } },
      },
    });

    await tool?.execute?.("call", { url: "https://example.com/tokens" });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("x-markdown-tokens: 1500"));
  });

  it("converts markdown to text when extractMode is text", async () => {
    const md = "# Heading\n\n**Bold text** and [a link](https://example.com).";
    const fetchSpy = vi.fn().mockResolvedValue(markdownResponse(md));
    // @ts-expect-error mock fetch
    global.fetch = fetchSpy;

    const { createWebFetchTool } = await import("./web-tools.js");
    const tool = createWebFetchTool({
      config: {
        tools: { web: { fetch: { cacheTtlMinutes: 0, firecrawl: { enabled: false } } } },
      },
    });

    const result = await tool?.execute?.("call", {
      url: "https://example.com/text-mode",
      extractMode: "text",
    });
    expect(result?.details).toMatchObject({
      extractor: "cf-markdown",
      extractMode: "text",
    });
    const detailsText = (result?.details as { text?: string })?.text ?? "";
    expect(detailsText).toContain("Heading");
    expect(detailsText).not.toContain("[a link](https://example.com)");
  });

  it("does not log x-markdown-tokens when header is absent", async () => {
    const logSpy = vi.spyOn(logger, "logDebug").mockImplementation(() => {});
    const fetchSpy = vi.fn().mockResolvedValue(markdownResponse("# No tokens"));
    // @ts-expect-error mock fetch
    global.fetch = fetchSpy;

    const { createWebFetchTool } = await import("./web-tools.js");
    const tool = createWebFetchTool({
      config: {
        tools: { web: { fetch: { cacheTtlMinutes: 0, firecrawl: { enabled: false } } } },
      },
    });

    await tool?.execute?.("call", { url: "https://example.com/no-tokens" });
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("x-markdown-tokens"));
  });
});
