import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Memory, resetMemory } from "../../../../src/memory/unified";
import { mapWithConcurrency } from "./_util";

export interface MemoryBenchContext {
  memory: Memory;
  namespace: string;
  qdrantUrl: string;
  collection: string;
  ftsDir: string;
  queries: {
    keyword: string[];
    semantic: string[];
    hybrid: string[];
  };
  cleanup: () => Promise<void>;
}

async function checkQdrant(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/collections`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function patchFetchWaitTrue(qdrantUrl: string): () => void {
  const base = qdrantUrl.replace(/\/$/, "");
  const originalFetch = globalThis.fetch;

  const patchedFetch = ((input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const method = (init?.method ?? "GET").toUpperCase();

    if (url.startsWith(base) && (method === "PUT" || method === "POST" || method === "DELETE")) {
      const isPointWrite =
        url.includes("/points") &&
        !url.includes("/points/scroll") &&
        !url.includes("/points/search") &&
        !url.includes("/points/count");

      if (isPointWrite) {
        const sep = url.includes("?") ? "&" : "?";
        return originalFetch(`${url}${sep}wait=true`, init);
      }
    }

    return originalFetch(input, init);
  }) as typeof fetch;

  // Preserve Bun-specific fetch helpers (e.g. fetch.preconnect) for type + runtime compatibility.
  (patchedFetch as any).preconnect = (originalFetch as any).preconnect;

  globalThis.fetch = patchedFetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

export async function createMemoryBenchContext(options: {
  seedCount: number;
  concurrency: number;
  qdrantUrl?: string;
  namespace?: string;
}): Promise<{ ctx: MemoryBenchContext | null; skipReason?: string }> {
  const qdrantUrl = options.qdrantUrl ?? process.env.QDRANT_URL ?? "http://localhost:6333";
  const ok = await checkQdrant(qdrantUrl);
  if (!ok) {
    return {
      ctx: null,
      skipReason: `Qdrant not reachable at ${qdrantUrl} (set QDRANT_URL to override)`,
    };
  }

  const namespace = options.namespace ?? "bench";
  const ftsDir = fs.mkdtempSync(path.join(os.tmpdir(), "zee-bench-fts-"));
  const collection = `bench_mem_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const restoreFetch = patchFetchWaitTrue(qdrantUrl);

  resetMemory();
  const memory = new Memory({
    qdrant: { url: qdrantUrl, collection },
    embedding: { provider: "google", dimensions: 384 },
    namespace,
    fts: { dbDir: ftsDir, dbName: "fts.sqlite" },
    markdown: { enabled: false },
  });

  try {
    await memory.init();
    if (!memory.isAvailable()) {
      restoreFetch();
      return {
        ctx: null,
        skipReason: "Memory unavailable after init (Qdrant reachable but init failed)",
      };
    }

    const seedCount = Math.max(0, Math.floor(options.seedCount));
    const ids = Array.from({ length: seedCount }, (_, i) => i);

    await mapWithConcurrency(ids, Math.max(1, options.concurrency), async (i) => {
      const tag = i % 3 === 0 ? "alpha" : i % 3 === 1 ? "beta" : "gamma";
      const topic = `topic_${i % 10}`;
      const subtopic = `sub_${i % 4}`;
      const bucket = `bucket_${i % 25}`;

      await memory.save({
        category: "note",
        content: `zee bench entry_${i} ${topic} ${subtopic} ${bucket} tag ${tag} issue 206 memory search perf`,
        summary: `bench entry_${i}`,
        namespace,
        domain: "bench",
        topic,
        subtopic,
        metadata: { tags: [tag, bucket] },
      });
    });

    const queryCount = Math.min(25, seedCount);
    const queryIds = new Set<number>();
    while (queryIds.size < queryCount && seedCount > 0) {
      queryIds.add(Math.floor(Math.random() * seedCount));
    }

    const keyword = Array.from(queryIds).map((i) => `entry_${i}`);
    const semantic = [
      "zee bench memory search performance",
      "issue 206 perf search",
      "topic_1 sub_1",
      "tag alpha",
      "bucket_7",
    ];
    const hybrid = [
      "zee issue 206 memory search",
      "topic_2 sub_2 tag beta",
      "bucket_3 tag gamma",
    ];

    const cleanup = async () => {
      restoreFetch();

      try {
        await fetch(`${qdrantUrl.replace(/\/$/, "")}/collections/${collection}`, {
          method: "DELETE",
          signal: AbortSignal.timeout(5000),
        });
      } catch {
        // ignore
      }

      try {
        fs.rmSync(ftsDir, { recursive: true, force: true });
      } catch {
        // ignore
      }

      resetMemory();
    };

    return {
      ctx: {
        memory,
        namespace,
        qdrantUrl,
        collection,
        ftsDir,
        queries: { keyword, semantic, hybrid },
        cleanup,
      },
    };
  } catch (e) {
    restoreFetch();
    try {
      fs.rmSync(ftsDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    return {
      ctx: null,
      skipReason: `Memory bench init failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
