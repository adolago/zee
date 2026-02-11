import type { BenchCase, BenchResult } from "./types";
import { Provider } from "../../src/provider/provider";
import { ProviderTransform } from "../../src/provider/transform";
import { Config } from "../../src/config/config";
import { Instance } from "../../src/project/instance";
import { streamText, type LanguageModel } from "ai";

type ProviderList = Awaited<ReturnType<typeof Provider.list>>;

function pickModel(config: any, providers: ProviderList): { providerID: string; modelID: string } | null {
  const defaultAgent = (config?.default_agent as string | undefined) ?? "zee";
  const agentConfig = (config?.agent as Record<string, { model?: string } | undefined>)?.[defaultAgent];
  const agentModel = agentConfig?.model;

  if (typeof agentModel === "string" && agentModel.includes("/")) {
    const [providerID, modelID] = agentModel.split("/", 2) as [string, string];
    if (providers[providerID]?.models?.[modelID]) return { providerID, modelID };
  }

  // Fallback: first configured provider with auth + first non-deprecated non-embedding model.
  const isEmbeddingModel = (id: string) => id.includes("embedding") || id.includes("embed");

  for (const [providerID, info] of Object.entries(providers)) {
    if (!info.source) continue;
    const eligible = Object.entries(info.models).filter(([id, m]) => m.status !== "deprecated" && !isEmbeddingModel(id));
    if (eligible.length === 0) continue;
    const [modelID] = eligible.sort(([, a], [, b]) => (a.cost.input || 0) - (b.cost.input || 0))[0] as [string, any];
    return { providerID, modelID };
  }

  return null;
}

async function measureStreaming(model: LanguageModel, options: any): Promise<{
  ttftMs: number | null;
  totalMs: number;
  completionTokens?: number;
  totalTokens?: number;
}> {
  const startedAt = performance.now();
  const result = await streamText({
    model,
    prompt: "Reply with a short paragraph about zee benchmarking. No markdown.",
    temperature: 0,
    maxRetries: 0,
    maxOutputTokens: 256,
    abortSignal: AbortSignal.timeout(60_000),
    providerOptions: options.providerOptions,
    headers: options.headers,
  });

  let ttftMs: number | null = null;
  const stream = (result as any).textStream as AsyncIterable<string> | undefined;

  if (stream && typeof (stream as any)[Symbol.asyncIterator] === "function") {
    for await (const delta of stream) {
      if (ttftMs === null) ttftMs = performance.now() - startedAt;
      // Consume stream fully for stable timing. No-op with delta.
      void delta;
    }
  }

  const totalMs = performance.now() - startedAt;

  let completionTokens: number | undefined;
  let totalTokens: number | undefined;
  try {
    const usage = await (result as any).usage;
    if (usage && typeof usage === "object") {
      completionTokens = typeof usage.completionTokens === "number" ? usage.completionTokens : undefined;
      totalTokens = typeof usage.totalTokens === "number" ? usage.totalTokens : undefined;
    }
  } catch {
    // ignore
  }

  return { ttftMs, totalMs, completionTokens, totalTokens };
}

export const bench: BenchCase = {
  id: "inference_openai_compat",
  name: "Inference (OpenAI-compatible streaming)",
  group: "inference",
  async run(_ctx, opts) {
    const id = this.id;
    const name = this.name;
    const group = this.group;

    // Instance.provide() currently types `fn` as synchronous, but it awaits the result at runtime.
    // Double-await to keep TypeScript happy without changing Instance.provide()'s public signature.
    return await (await Instance.provide({
      directory: process.cwd(),
      fn: async (): Promise<BenchResult> => {
        const config = await Config.get().catch(() => undefined);
        const providers = await Provider.list();
        const picked = pickModel(config, providers);
        if (!picked) {
          return { id, name, group, status: "skipped", reason: "No configured provider/model found" };
        }

        const info = providers[picked.providerID];
        if (!info?.source) {
          return { id, name, group, status: "skipped", reason: `Provider ${picked.providerID} has no auth configured` };
        }

        const model = info.models[picked.modelID];
        if (!model) {
          return { id, name, group, status: "skipped", reason: `Model not found: ${picked.providerID}/${picked.modelID}` };
        }

        const language = await Provider.getLanguage(model);
        const transformed = ProviderTransform.options({
          model,
          sessionID: "bench",
          providerOptions: info.options,
        });

        const runs = Math.max(1, Math.min(3, Math.floor(opts.concurrency)));
        const measurements = [];
        for (let i = 0; i < runs; i++) {
          measurements.push(
            await measureStreaming(language, {
              providerOptions: ProviderTransform.providerOptions(model, transformed),
              headers: model.headers,
            }),
          );
        }

        const ttfts = measurements.map((m) => m.ttftMs).filter((v): v is number => typeof v === "number");
        const totals = measurements.map((m) => m.totalMs);
        const completionTokens = measurements.map((m) => m.completionTokens).filter((v): v is number => typeof v === "number");

        const mean = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0);
        const meanTtft = mean(ttfts);
        const meanTotal = mean(totals);
        const meanCompletion = mean(completionTokens);
        const tokensPerSec = meanTotal > 0 && meanCompletion > 0 ? (meanCompletion / (meanTotal / 1000)) : undefined;

        return {
          id,
          name,
          group,
          status: "ok",
          metrics: {
            model: `${picked.providerID}/${picked.modelID}`,
            runs,
            ttftMs: ttfts.length ? { mean: meanTtft, samples: ttfts } : { mean: null, samples: [] },
            totalMs: { mean: meanTotal, samples: totals },
            completionTokens: completionTokens.length ? { mean: meanCompletion, samples: completionTokens } : undefined,
            tokensPerSec,
          },
        };
      },
    }));
  },
};
