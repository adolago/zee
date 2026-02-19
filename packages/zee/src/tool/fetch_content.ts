import z from "zod"
import TurndownService from "turndown"
import { Tool } from "./tool"
import DESCRIPTION from "./fetch_content.txt"
import { abortAfterAny } from "../util/abort"
import { saveSearchContentResponse, type SearchContentItem, type SearchContentMeta } from "./content-store"

const MAX_URLS = 20
const MAX_STORED_CONTENT_CHARS = 500_000
const PREVIEW_CHARS = 260
const DEFAULT_TIMEOUT_MS = 30_000
const MAX_BINARY_TEXT_BYTES = 2 * 1024 * 1024 // 2MB

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7",
  "Accept-Language": "en-US,en;q=0.9",
}

type ExtractedContent = {
  url: string
  title?: string
  contentType?: string
  content: string
  meta?: SearchContentMeta
}

type GitHubTarget = {
  owner: string
  repo: string
  kind: "repo" | "tree" | "blob"
  ref?: string
  contentPath?: string
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function compactPreview(content: string): string {
  return content.replace(/\s+/g, " ").trim().slice(0, PREVIEW_CHARS)
}

function trimStoredContent(content: string): { content: string; truncated: boolean; originalChars: number } {
  if (content.length <= MAX_STORED_CONTENT_CHARS) {
    return { content, truncated: false, originalChars: content.length }
  }
  return {
    content: content.slice(0, MAX_STORED_CONTENT_CHARS),
    truncated: true,
    originalChars: content.length,
  }
}

function ensureHttpUrl(raw: string): URL {
  const parsed = new URL(raw)
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported URL protocol for "${raw}". Only http/https URLs are supported in this tool.`)
  }
  return parsed
}

function normalizeTargets(params: { url?: string; urls?: string[] }): string[] {
  const fromSingle = params.url ? [params.url] : []
  const fromMany = params.urls ?? []
  const merged = [...fromSingle, ...fromMany]
  const deduped: string[] = []
  const seen = new Set<string>()
  for (const raw of merged) {
    const normalized = raw.trim()
    if (!normalized) continue
    if (seen.has(normalized)) continue
    seen.add(normalized)
    deduped.push(normalized)
  }
  return deduped
}

async function fetchWithTimeout(
  url: string,
  abort: AbortSignal,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const { signal, clearTimeout } = abortAfterAny(timeoutMs, abort)
  try {
    return await fetch(url, { ...init, signal })
  } finally {
    clearTimeout()
  }
}

function isTextLikeContentType(contentType: string): boolean {
  const normalized = contentType.toLowerCase()
  return (
    normalized.startsWith("text/") ||
    normalized.includes("json") ||
    normalized.includes("xml") ||
    normalized.includes("javascript") ||
    normalized.includes("markdown")
  )
}

function looksLikePdfUrl(url: URL): boolean {
  return url.pathname.toLowerCase().endsWith(".pdf")
}

function isProbablyBinaryText(content: string): boolean {
  if (!content) return false
  const sample = content.slice(0, 2048)
  let nonPrintable = 0
  for (let index = 0; index < sample.length; index++) {
    const code = sample.charCodeAt(index)
    if (code === 0) return true
    if (code < 9 || (code > 13 && code < 32)) nonPrintable++
  }
  return nonPrintable / sample.length > 0.3
}

function extractTitleFromHtml(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (!match) return undefined
  return match[1].replace(/\s+/g, " ").trim() || undefined
}

function convertHtmlToMarkdown(html: string): string {
  const turndownService = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  })
  turndownService.remove(["script", "style", "meta", "link"])
  return turndownService.turndown(html)
}

async function extractPdfContent(
  url: string,
  abort: AbortSignal,
): Promise<{ content: string; meta: SearchContentMeta }> {
  const readerUrl = `https://r.jina.ai/${url}`
  try {
    const response = await fetchWithTimeout(
      readerUrl,
      abort,
      {
        method: "GET",
        headers: {
          "User-Agent": "zee-fetch-content",
          Accept: "text/plain",
        },
      },
      45_000,
    )
    if (!response.ok) {
      throw new Error(`Jina reader failed with status ${response.status}`)
    }
    const text = (await response.text()).trim()
    if (text) {
      return {
        content: text,
        meta: {
          extraction: "jina-reader",
          readerUrl,
        },
      }
    }
  } catch (error) {
    return {
      content:
        `PDF detected at ${url}.\n\n` +
        "Text extraction was unavailable for this request. Try another source URL or fetch the PDF locally for manual processing.",
      meta: {
        extraction: "unavailable",
        reason: describeError(error),
      },
    }
  }

  return {
    content: `PDF detected at ${url}.\n\n` + "No text could be extracted for this document in this run.",
    meta: {
      extraction: "empty-result",
    },
  }
}

function parseGitHubTarget(parsedUrl: URL): GitHubTarget | undefined {
  const host = parsedUrl.hostname.toLowerCase()
  if (host !== "github.com" && host !== "www.github.com") return undefined

  const parts = parsedUrl.pathname.split("/").filter(Boolean)
  if (parts.length < 2) return undefined

  const owner = parts[0]
  const repo = parts[1].replace(/\.git$/i, "")
  if (!owner || !repo) return undefined

  if (parts[2] === "tree" && parts[3]) {
    return {
      owner,
      repo,
      kind: "tree",
      ref: parts[3],
      contentPath: parts.slice(4).join("/") || undefined,
    }
  }

  if (parts[2] === "blob" && parts[3] && parts[4]) {
    return {
      owner,
      repo,
      kind: "blob",
      ref: parts[3],
      contentPath: parts.slice(4).join("/"),
    }
  }

  return {
    owner,
    repo,
    kind: "repo",
  }
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "zee-fetch-content",
    "X-GitHub-Api-Version": "2022-11-28",
  }
  const token = process.env.GITHUB_TOKEN?.trim()
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

async function fetchGitHubJson(pathname: string, abort: AbortSignal): Promise<unknown> {
  const response = await fetchWithTimeout(`https://api.github.com${pathname}`, abort, {
    headers: githubHeaders(),
  })
  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`GitHub API request failed (${response.status}) for ${pathname}: ${body || "no response body"}`)
  }
  return await response.json()
}

async function fetchGitHubReadme(owner: string, repo: string, ref: string, abort: AbortSignal): Promise<string> {
  const endpoint = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme?ref=${encodeURIComponent(ref)}`
  const headers = githubHeaders()
  headers.Accept = "application/vnd.github.raw"
  const response = await fetchWithTimeout(endpoint, abort, {
    headers,
  })
  if (!response.ok) return ""
  return await response.text()
}

function decodeGitHubFileContent(payload: Record<string, unknown>): string | undefined {
  const encoding = typeof payload.encoding === "string" ? payload.encoding : ""
  const contentRaw = typeof payload.content === "string" ? payload.content : ""
  if (encoding !== "base64" || !contentRaw) return undefined
  try {
    const decoded = Buffer.from(contentRaw.replace(/\n/g, ""), "base64").toString("utf8")
    if (isProbablyBinaryText(decoded)) return undefined
    return decoded
  } catch {
    return undefined
  }
}

function markdownPathList(items: Array<Record<string, unknown>>, max = 60): string {
  if (!items.length) return "- (empty)"
  return items
    .slice(0, max)
    .map((item) => {
      const kind = typeof item.type === "string" ? item.type : "item"
      const name = typeof item.name === "string" ? item.name : "(unknown)"
      const size = typeof item.size === "number" ? item.size : undefined
      return `- [${kind}] ${name}${size !== undefined ? ` (${size} bytes)` : ""}`
    })
    .join("\n")
}

async function extractGitHubContent(
  target: GitHubTarget,
  abort: AbortSignal,
  forceClone: boolean,
): Promise<ExtractedContent> {
  const owner = encodeURIComponent(target.owner)
  const repo = encodeURIComponent(target.repo)

  const repoMeta = (await fetchGitHubJson(`/repos/${owner}/${repo}`, abort)) as Record<string, unknown>
  const defaultBranch = typeof repoMeta.default_branch === "string" ? repoMeta.default_branch : "main"
  const description = typeof repoMeta.description === "string" ? repoMeta.description : ""
  const htmlUrl =
    typeof repoMeta.html_url === "string" ? repoMeta.html_url : `https://github.com/${target.owner}/${target.repo}`

  if (target.kind === "repo" || !target.contentPath) {
    const root = (await fetchGitHubJson(`/repos/${owner}/${repo}/contents`, abort)) as Array<Record<string, unknown>>
    const readme = await fetchGitHubReadme(target.owner, target.repo, defaultBranch, abort)

    const content =
      `# GitHub repository overview: ${target.owner}/${target.repo}\n\n` +
      `${description ? `${description}\n\n` : ""}` +
      `Repository URL: ${htmlUrl}\n` +
      `Default branch: ${defaultBranch}\n` +
      `Extraction mode: GitHub API summary${forceClone ? " (forceClone requested; clone is not enabled in this MVP)" : ""}\n\n` +
      `## Root entries\n${markdownPathList(Array.isArray(root) ? root : [])}\n\n` +
      `${readme ? `## README\n\n${readme}\n` : "## README\n\nREADME unavailable via API for this request.\n"}`

    return {
      url: htmlUrl,
      title: `GitHub: ${target.owner}/${target.repo}`,
      contentType: "text/markdown",
      content,
      meta: {
        provider: "github-api",
        kind: "repo",
        owner: target.owner,
        repo: target.repo,
        defaultBranch,
      },
    }
  }

  const encodedPath = target.contentPath
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/")
  const refQuery = target.ref ? `?ref=${encodeURIComponent(target.ref)}` : ""
  const payload = await fetchGitHubJson(`/repos/${owner}/${repo}/contents/${encodedPath}${refQuery}`, abort)

  if (Array.isArray(payload)) {
    const refLabel = target.ref ?? defaultBranch
    const content =
      `# GitHub directory listing: ${target.owner}/${target.repo}/${target.contentPath}\n\n` +
      `Ref: ${refLabel}\n` +
      `Mode: API directory listing\n\n` +
      `${markdownPathList(payload)}\n`
    return {
      url: `https://github.com/${target.owner}/${target.repo}/tree/${refLabel}/${target.contentPath}`,
      title: `GitHub directory: ${target.contentPath}`,
      contentType: "text/markdown",
      content,
      meta: {
        provider: "github-api",
        kind: "tree",
        owner: target.owner,
        repo: target.repo,
        ref: refLabel,
        path: target.contentPath,
      },
    }
  }

  const fileInfo = payload as Record<string, unknown>
  const fileName = typeof fileInfo.name === "string" ? fileInfo.name : target.contentPath
  const refLabel = target.ref ?? defaultBranch

  let fileContent = decodeGitHubFileContent(fileInfo)
  if (!fileContent) {
    const downloadUrl = typeof fileInfo.download_url === "string" ? fileInfo.download_url : ""
    if (downloadUrl) {
      const response = await fetchWithTimeout(
        downloadUrl,
        abort,
        {
          headers: {
            "User-Agent": "zee-fetch-content",
          },
        },
        30_000,
      )
      if (response.ok) {
        const text = await response.text()
        if (!isProbablyBinaryText(text)) fileContent = text
      }
    }
  }

  if (!fileContent) {
    fileContent =
      `Binary or non-text file detected at ${target.contentPath}.\n` +
      "Raw textual extraction is unavailable for this file through the current API path."
  }

  const content =
    `# GitHub file: ${target.owner}/${target.repo}/${target.contentPath}\n\n` +
    `Ref: ${refLabel}\n` +
    `Mode: API file extraction\n\n` +
    `${fileContent}\n`

  return {
    url: `https://github.com/${target.owner}/${target.repo}/blob/${refLabel}/${target.contentPath}`,
    title: `GitHub file: ${fileName}`,
    contentType: "text/plain",
    content,
    meta: {
      provider: "github-api",
      kind: "blob",
      owner: target.owner,
      repo: target.repo,
      ref: refLabel,
      path: target.contentPath,
    },
  }
}

async function extractGenericContent(parsedUrl: URL, abort: AbortSignal): Promise<ExtractedContent> {
  const response = await fetchWithTimeout(parsedUrl.toString(), abort, {
    method: "GET",
    headers: DEFAULT_HEADERS,
  })

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`Request failed (${response.status}) for ${parsedUrl.toString()}: ${body || "no response body"}`)
  }

  const contentType = (response.headers.get("content-type") || "").toLowerCase()
  const finalUrl = response.url || parsedUrl.toString()
  const isPdf = contentType.includes("application/pdf") || looksLikePdfUrl(parsedUrl)

  if (isPdf) {
    const extracted = await extractPdfContent(finalUrl, abort)
    return {
      url: finalUrl,
      title: `PDF: ${parsedUrl.pathname.split("/").filter(Boolean).pop() || parsedUrl.hostname}`,
      contentType: "application/pdf",
      content: extracted.content,
      meta: extracted.meta,
    }
  }

  if (contentType.includes("text/html") || contentType.includes("application/xhtml+xml")) {
    const html = await response.text()
    const markdown = convertHtmlToMarkdown(html)
    return {
      url: finalUrl,
      title: extractTitleFromHtml(html) ?? parsedUrl.hostname,
      contentType: "text/markdown",
      content: markdown,
      meta: {
        extraction: "html-to-markdown",
      },
    }
  }

  if (isTextLikeContentType(contentType)) {
    const text = await response.text()
    return {
      url: finalUrl,
      title: parsedUrl.hostname,
      contentType: contentType || "text/plain",
      content: text,
    }
  }

  const headerLength = Number(response.headers.get("content-length") || 0)
  if (headerLength > MAX_BINARY_TEXT_BYTES) {
    return {
      url: finalUrl,
      title: parsedUrl.hostname,
      contentType: contentType || "application/octet-stream",
      content:
        `Binary content detected at ${finalUrl}.\n` +
        `Content-Length: ${headerLength} bytes.\n` +
        "Automatic text extraction was skipped due to size.",
      meta: {
        extraction: "binary-size-skip",
        bytes: headerLength,
      },
    }
  }

  const bytes = await response.arrayBuffer()
  const text = new TextDecoder().decode(bytes)
  if (isProbablyBinaryText(text)) {
    return {
      url: finalUrl,
      title: parsedUrl.hostname,
      contentType: contentType || "application/octet-stream",
      content:
        `Binary content detected at ${finalUrl}.\n` +
        `Downloaded bytes: ${bytes.byteLength}.\n` +
        "No readable text content was extracted.",
      meta: {
        extraction: "binary-detected",
        bytes: bytes.byteLength,
      },
    }
  }

  return {
    url: finalUrl,
    title: parsedUrl.hostname,
    contentType: contentType || "text/plain",
    content: text,
    meta: {
      extraction: "text-decoder-fallback",
    },
  }
}

async function extractContent(rawUrl: string, abort: AbortSignal, forceClone: boolean): Promise<ExtractedContent> {
  const parsed = ensureHttpUrl(rawUrl)
  const github = parseGitHubTarget(parsed)
  if (github) {
    return await extractGitHubContent(github, abort, forceClone)
  }
  return await extractGenericContent(parsed, abort)
}

const FetchContentParameters = z
  .object({
    url: z.string().optional().describe("Single URL to fetch and extract."),
    urls: z.array(z.string()).max(MAX_URLS).optional().describe("Multiple URLs to fetch and extract."),
    forceClone: z
      .boolean()
      .default(false)
      .describe("Accepted for compatibility. Full clone behavior is not enabled in this MVP."),
  })
  .superRefine((value, ctx) => {
    const hasUrl = typeof value.url === "string" && value.url.trim().length > 0
    const hasUrls = Array.isArray(value.urls) && value.urls.length > 0
    if (!hasUrl && !hasUrls) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide either `url` or `urls`.",
      })
      return
    }
    if (hasUrl && hasUrls) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide only one of `url` or `urls`, not both.",
      })
    }
  })

export const FetchContentTool = Tool.define("fetch_content", {
  description: DESCRIPTION,
  parameters: FetchContentParameters,
  async execute(params, ctx) {
    const targets = normalizeTargets(params)
    if (!targets.length) {
      throw new Error("No valid URLs provided.")
    }
    if (targets.length > MAX_URLS) {
      throw new Error(`Too many URLs. Maximum supported URLs per call is ${MAX_URLS}.`)
    }

    await ctx.ask({
      permission: "webfetch",
      patterns: targets,
      always: ["*"],
      metadata: {
        urlCount: targets.length,
        forceClone: params.forceClone,
      },
    })

    const items: SearchContentItem[] = []
    const failures: Array<{ url: string; error: string }> = []

    for (const target of targets) {
      try {
        const extracted = await extractContent(target, ctx.abort, params.forceClone)
        const trimmed = trimStoredContent(extracted.content)

        const meta: SearchContentMeta = {
          ...(extracted.meta ?? {}),
          storedChars: trimmed.content.length,
          originalChars: trimmed.originalChars,
          storeTruncated: trimmed.truncated,
        }

        items.push({
          url: extracted.url,
          title: extracted.title,
          contentType: extracted.contentType,
          content: trimmed.content,
          preview: compactPreview(trimmed.content),
          meta,
        })
      } catch (error) {
        failures.push({
          url: target,
          error: describeError(error),
        })
      }
    }

    if (!items.length) {
      throw new Error(`Failed to fetch all URLs. ${failures.map((item) => `${item.url}: ${item.error}`).join(" | ")}`)
    }

    const stored = await saveSearchContentResponse({
      sessionID: ctx.sessionID,
      sourceTool: "fetch_content",
      items,
    })

    const lines: string[] = []
    lines.push(`Stored ${stored.items.length} content item(s) with responseId "${stored.responseId}".`)
    lines.push("")
    lines.push("Items:")
    stored.items.forEach((item, index) => {
      lines.push(
        `${index}. ${item.title ?? item.url} | type: ${item.contentType ?? "unknown"} | chars: ${item.content.length}`,
      )
      if (item.preview) lines.push(`   preview: ${item.preview}`)
    })

    if (failures.length) {
      lines.push("")
      lines.push(`Failures (${failures.length}):`)
      failures.forEach((failure) => {
        lines.push(`- ${failure.url}: ${failure.error}`)
      })
    }

    lines.push("")
    lines.push(`Retrieve full stored content with get_search_content:`)
    lines.push(`- { "responseId": "${stored.responseId}" }`)
    lines.push(`- { "responseId": "${stored.responseId}", "urlIndex": 0 }`)

    return {
      title: `Fetched ${stored.items.length} content item${stored.items.length === 1 ? "" : "s"}`,
      output: lines.join("\n"),
      metadata: {
        responseId: stored.responseId,
        itemCount: stored.items.length,
        failureCount: failures.length,
      },
    }
  },
})
