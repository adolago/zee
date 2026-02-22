import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { z } from "zod";
import type { ToolDefinition, ToolExecutionResult } from "../../mcp/types";

const DEFAULT_REPO = "adolago/zee";
const VERIFY_SCRIPT = path.join("scripts", "verify-pr-target.sh");
const DEFAULT_TIMEOUT_MS = 15_000;

type CommandResult = {
  ok: boolean;
  status: number | null;
  stdout: string;
  stderr: string;
  error?: string;
};

function toStringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toNumberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function runCommand(command: string, args: string[], cwd: string, timeoutMs = DEFAULT_TIMEOUT_MS): CommandResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf-8",
    timeout: timeoutMs,
    env: process.env,
  });

  const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
  const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";

  if (result.error) {
    const err = result.error as NodeJS.ErrnoException;
    return {
      ok: false,
      status: result.status,
      stdout,
      stderr,
      error: err.code === "ENOENT" ? `${command} not found on PATH` : err.message,
    };
  }

  return {
    ok: result.status === 0,
    status: result.status,
    stdout,
    stderr,
  };
}

function runGh(args: string[], cwd: string, timeoutMs = DEFAULT_TIMEOUT_MS): CommandResult {
  return runCommand("gh", args, cwd, timeoutMs);
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function ensureGhInstalled(cwd: string): string | null {
  const probe = runGh(["--version"], cwd, 5_000);
  if (probe.ok) return null;
  return probe.error || probe.stderr || "gh CLI is not available";
}

function verifyRepoTarget(repo: string, cwd: string): { ok: boolean; message?: string } {
  if (repo !== DEFAULT_REPO) return { ok: true };
  const scriptPath = path.join(cwd, VERIFY_SCRIPT);
  if (!existsSync(scriptPath)) {
    return {
      ok: false,
      message: `Target verification script is missing: ${VERIFY_SCRIPT}`,
    };
  }
  const check = runCommand("bash", [scriptPath], cwd, 8_000);
  if (!check.ok) {
    return {
      ok: false,
      message: check.stderr || check.stdout || "Repository target verification failed.",
    };
  }
  return { ok: true };
}

function formatIssueSummary(issue: Record<string, unknown>): string {
  const number = toNumberValue(issue.number) ?? 0;
  const title = toStringValue(issue.title);
  const state = toStringValue(issue.state);
  const url = toStringValue(issue.url);
  return `#${number} [${state}] ${title}${url ? `\n${url}` : ""}`;
}

function formatPrSummary(pr: Record<string, unknown>): string {
  const number = toNumberValue(pr.number) ?? 0;
  const title = toStringValue(pr.title);
  const state = toStringValue(pr.state);
  const base = toStringValue(pr.baseRefName);
  const head = toStringValue(pr.headRefName);
  const url = toStringValue(pr.url);
  return `#${number} [${state}] ${title}${base || head ? ` (${head} -> ${base})` : ""}${url ? `\n${url}` : ""}`;
}

const GitHubLibrarianStatusParams = z.object({
  repo: z.string().default(DEFAULT_REPO).describe("Repository in owner/name format"),
});

export const githubLibrarianStatusTool: ToolDefinition = {
  id: "zee:github-librarian-status",
  category: "domain",
  init: async () => ({
    description: `Check GitHub librarian readiness (gh CLI, auth, and repository target verification).`,
    parameters: GitHubLibrarianStatusParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const cwd = process.cwd();
      ctx.metadata({ title: "GitHub Librarian Status" });

      const ghError = ensureGhInstalled(cwd);
      if (ghError) {
        return {
          title: "GitHub Librarian Unavailable",
          metadata: { ready: false, ghInstalled: false, error: ghError },
          output: `GitHub librarian is unavailable: ${ghError}`,
        };
      }

      const auth = runGh(["auth", "status"], cwd, 8_000);
      const repoCheck = verifyRepoTarget(args.repo, cwd);

      const ready = auth.ok && repoCheck.ok;
      const details = [auth.stdout, auth.stderr].filter(Boolean).join("\n");

      return {
        title: ready ? "GitHub Librarian Ready" : "GitHub Librarian Needs Attention",
        metadata: {
          ready,
          ghInstalled: true,
          authOk: auth.ok,
          repoVerified: repoCheck.ok,
          repo: args.repo,
        },
        output: [
          `Repo: ${args.repo}`,
          `Auth: ${auth.ok ? "ok" : "failed"}`,
          `Target verification: ${repoCheck.ok ? "ok" : "failed"}`,
          repoCheck.message ? `Verification detail: ${repoCheck.message}` : "",
          details ? `\n${details}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      };
    },
  }),
};

const GitHubLibrarianIssuesParams = z.object({
  repo: z.string().default(DEFAULT_REPO).describe("Repository in owner/name format"),
  action: z.enum(["list", "view"]).default("list").describe("Issue operation"),
  number: z.number().int().positive().optional().describe("Issue number for view action"),
  state: z.enum(["open", "closed", "all"]).default("open").describe("Issue state for list action"),
  limit: z.number().int().min(1).max(100).default(20).describe("Max issues to return for list action"),
});

export const githubLibrarianIssuesTool: ToolDefinition = {
  id: "zee:github-librarian-issues",
  category: "domain",
  init: async () => ({
    description: `Read-only issue access via gh CLI. Supports list and view.`,
    parameters: GitHubLibrarianIssuesParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const cwd = process.cwd();
      ctx.metadata({ title: `GitHub Issues: ${args.action}` });

      const ghError = ensureGhInstalled(cwd);
      if (ghError) {
        return {
          title: "GitHub Issues Failed",
          metadata: { error: ghError },
          output: ghError,
        };
      }

      const verified = verifyRepoTarget(args.repo, cwd);
      if (!verified.ok) {
        return {
          title: "GitHub Issues Blocked",
          metadata: { repo: args.repo, error: verified.message },
          output: verified.message ?? "Repository target verification failed.",
        };
      }

      if (args.action === "view") {
        if (!args.number) {
          return {
            title: "GitHub Issues Failed",
            metadata: { repo: args.repo, error: "missing_number" },
            output: "number is required when action=view",
          };
        }

        const result = runGh(
          [
            "issue",
            "view",
            String(args.number),
            "--repo",
            args.repo,
            "--json",
            "number,title,state,author,labels,assignees,updatedAt,url,body",
          ],
          cwd,
        );

        if (!result.ok) {
          return {
            title: "GitHub Issue View Failed",
            metadata: { repo: args.repo, number: args.number, error: result.stderr || result.error },
            output: result.stderr || result.error || "Unknown gh error",
          };
        }

        const parsed = parseJson(result.stdout);
        const issue = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
        if (!issue) {
          return {
            title: "GitHub Issue",
            metadata: { repo: args.repo, number: args.number },
            output: result.stdout || "No output",
          };
        }

        const body = toStringValue(issue.body).trim();
        return {
          title: `Issue #${toNumberValue(issue.number) ?? args.number}`,
          metadata: { repo: args.repo, number: args.number },
          output: `${formatIssueSummary(issue)}${body ? `\n\n${body}` : ""}`,
        };
      }

      const result = runGh(
        [
          "issue",
          "list",
          "--repo",
          args.repo,
          "--state",
          args.state,
          "--limit",
          String(args.limit),
          "--json",
          "number,title,state,author,labels,assignees,updatedAt,url",
        ],
        cwd,
      );

      if (!result.ok) {
        return {
          title: "GitHub Issue List Failed",
          metadata: { repo: args.repo, error: result.stderr || result.error },
          output: result.stderr || result.error || "Unknown gh error",
        };
      }

      const parsed = parseJson(result.stdout);
      const issues = toArray(parsed);
      const formatted = issues
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        .map(formatIssueSummary);

      return {
        title: `Issues (${formatted.length})`,
        metadata: { repo: args.repo, count: formatted.length, state: args.state },
        output: formatted.length > 0 ? formatted.join("\n\n") : "No issues found.",
      };
    },
  }),
};

const GitHubLibrarianPrsParams = z.object({
  repo: z.string().default(DEFAULT_REPO).describe("Repository in owner/name format"),
  action: z.enum(["list", "view", "checks"]).default("list").describe("PR operation"),
  number: z.number().int().positive().optional().describe("PR number for view/checks"),
  state: z.enum(["open", "closed", "merged", "all"]).default("open").describe("PR state for list action"),
  limit: z.number().int().min(1).max(100).default(20).describe("Max PRs to return for list action"),
});

export const githubLibrarianPrsTool: ToolDefinition = {
  id: "zee:github-librarian-prs",
  category: "domain",
  init: async () => ({
    description: `Read-only pull request access via gh CLI. Supports list, view, and checks.`,
    parameters: GitHubLibrarianPrsParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const cwd = process.cwd();
      ctx.metadata({ title: `GitHub PRs: ${args.action}` });

      const ghError = ensureGhInstalled(cwd);
      if (ghError) {
        return {
          title: "GitHub PR Tool Failed",
          metadata: { error: ghError },
          output: ghError,
        };
      }

      const verified = verifyRepoTarget(args.repo, cwd);
      if (!verified.ok) {
        return {
          title: "GitHub PR Tool Blocked",
          metadata: { repo: args.repo, error: verified.message },
          output: verified.message ?? "Repository target verification failed.",
        };
      }

      if (args.action === "checks") {
        if (!args.number) {
          return {
            title: "GitHub PR Checks Failed",
            metadata: { repo: args.repo, error: "missing_number" },
            output: "number is required when action=checks",
          };
        }
        const checks = runGh(["pr", "checks", String(args.number), "--repo", args.repo], cwd, 20_000);
        if (!checks.ok) {
          return {
            title: "GitHub PR Checks Failed",
            metadata: { repo: args.repo, number: args.number, error: checks.stderr || checks.error },
            output: checks.stderr || checks.error || "Unknown gh error",
          };
        }
        return {
          title: `PR #${args.number} Checks`,
          metadata: { repo: args.repo, number: args.number },
          output: checks.stdout || "No checks output.",
        };
      }

      if (args.action === "view") {
        if (!args.number) {
          return {
            title: "GitHub PR View Failed",
            metadata: { repo: args.repo, error: "missing_number" },
            output: "number is required when action=view",
          };
        }

        const result = runGh(
          [
            "pr",
            "view",
            String(args.number),
            "--repo",
            args.repo,
            "--json",
            "number,title,state,author,isDraft,reviewDecision,headRefName,baseRefName,updatedAt,url,body",
          ],
          cwd,
        );
        if (!result.ok) {
          return {
            title: "GitHub PR View Failed",
            metadata: { repo: args.repo, number: args.number, error: result.stderr || result.error },
            output: result.stderr || result.error || "Unknown gh error",
          };
        }

        const parsed = parseJson(result.stdout);
        const pr = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
        if (!pr) {
          return {
            title: `PR #${args.number}`,
            metadata: { repo: args.repo, number: args.number },
            output: result.stdout || "No output",
          };
        }
        const body = toStringValue(pr.body).trim();
        return {
          title: `PR #${toNumberValue(pr.number) ?? args.number}`,
          metadata: { repo: args.repo, number: args.number },
          output: `${formatPrSummary(pr)}${body ? `\n\n${body}` : ""}`,
        };
      }

      const result = runGh(
        [
          "pr",
          "list",
          "--repo",
          args.repo,
          "--state",
          args.state,
          "--limit",
          String(args.limit),
          "--json",
          "number,title,state,author,isDraft,reviewDecision,headRefName,baseRefName,updatedAt,url",
        ],
        cwd,
      );
      if (!result.ok) {
        return {
          title: "GitHub PR List Failed",
          metadata: { repo: args.repo, error: result.stderr || result.error },
          output: result.stderr || result.error || "Unknown gh error",
        };
      }

      const parsed = parseJson(result.stdout);
      const prs = toArray(parsed);
      const formatted = prs
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        .map(formatPrSummary);
      return {
        title: `PRs (${formatted.length})`,
        metadata: { repo: args.repo, count: formatted.length, state: args.state },
        output: formatted.length > 0 ? formatted.join("\n\n") : "No pull requests found.",
      };
    },
  }),
};

const GitHubLibrarianSearchParams = z.object({
  repo: z.string().default(DEFAULT_REPO).describe("Repository in owner/name format"),
  query: z.string().min(1).describe("Search query"),
  kind: z.enum(["issues", "prs", "code"]).default("issues").describe("Search target"),
  limit: z.number().int().min(1).max(50).default(10).describe("Max results"),
});

export const githubLibrarianSearchTool: ToolDefinition = {
  id: "zee:github-librarian-search",
  category: "domain",
  init: async () => ({
    description: `Search GitHub entities with gh CLI. Supports issues, prs, and code.`,
    parameters: GitHubLibrarianSearchParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const cwd = process.cwd();
      ctx.metadata({ title: `GitHub Search: ${args.kind}` });

      const ghError = ensureGhInstalled(cwd);
      if (ghError) {
        return {
          title: "GitHub Search Failed",
          metadata: { error: ghError },
          output: ghError,
        };
      }

      const verified = verifyRepoTarget(args.repo, cwd);
      if (!verified.ok) {
        return {
          title: "GitHub Search Blocked",
          metadata: { repo: args.repo, error: verified.message },
          output: verified.message ?? "Repository target verification failed.",
        };
      }

      if (args.kind === "code") {
        const query = `${args.query} repo:${args.repo}`;
        const result = runGh(
          ["search", "code", query, "--limit", String(args.limit), "--json", "path,repository,url,textMatches"],
          cwd,
          20_000,
        );
        if (!result.ok) {
          return {
            title: "GitHub Code Search Failed",
            metadata: { repo: args.repo, error: result.stderr || result.error },
            output: result.stderr || result.error || "Unknown gh error",
          };
        }
        const parsed = toArray(parseJson(result.stdout));
        const lines = parsed
          .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
          .map((item) => {
            const repo = item.repository && typeof item.repository === "object"
              ? toStringValue((item.repository as Record<string, unknown>).nameWithOwner)
              : "";
            const filePath = toStringValue(item.path);
            const url = toStringValue(item.url);
            return `${repo}:${filePath}${url ? `\n${url}` : ""}`;
          });
        return {
          title: `Code Results (${lines.length})`,
          metadata: { repo: args.repo, kind: args.kind, count: lines.length },
          output: lines.length > 0 ? lines.join("\n\n") : "No code results found.",
        };
      }

      const searchKind = args.kind === "prs" ? "prs" : "issues";
      const result = runGh(
        [
          "search",
          searchKind,
          args.query,
          "--repo",
          args.repo,
          "--limit",
          String(args.limit),
          "--json",
          "number,title,state,url",
        ],
        cwd,
        20_000,
      );
      if (!result.ok) {
        return {
          title: "GitHub Search Failed",
          metadata: { repo: args.repo, kind: args.kind, error: result.stderr || result.error },
          output: result.stderr || result.error || "Unknown gh error",
        };
      }

      const parsed = toArray(parseJson(result.stdout));
      const lines = parsed
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        .map((item) => {
          const number = toNumberValue(item.number) ?? 0;
          const state = toStringValue(item.state);
          const title = toStringValue(item.title);
          const url = toStringValue(item.url);
          return `#${number} [${state}] ${title}${url ? `\n${url}` : ""}`;
        });

      return {
        title: `Search Results (${lines.length})`,
        metadata: { repo: args.repo, kind: args.kind, count: lines.length },
        output: lines.length > 0 ? lines.join("\n\n") : "No search results found.",
      };
    },
  }),
};

export const GITHUB_LIBRARIAN_TOOLS = [
  githubLibrarianStatusTool,
  githubLibrarianIssuesTool,
  githubLibrarianPrsTool,
  githubLibrarianSearchTool,
];
