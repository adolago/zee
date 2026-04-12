import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  PROVIDERS,
  getProvidersForService,
  getProvider,
  hasCredentials,
  getApiKeySync,
  listProvidersByService,
  getAllProviderIds,
  getProviderStatus,
  type ServiceType,
} from "./providers";

describe("providers registry", () => {
  describe("PROVIDERS", () => {
    it("keeps only core service providers", () => {
      expect(PROVIDERS.wisprflow).toBeDefined();
      expect(PROVIDERS.openai).toBeDefined();
      expect(PROVIDERS.minimax).toBeDefined();
      expect(PROVIDERS["minimax-tts"]).toBeDefined();
      expect(PROVIDERS["alpha-vantage"]).toBeDefined();
      expect(PROVIDERS.fmp).toBeDefined();
      expect(PROVIDERS.sec).toBeDefined();

      expect(PROVIDERS.voyage).toBeUndefined();
      expect(PROVIDERS.splitwise).toBeUndefined();
      expect(PROVIDERS.elevenlabs).toBeUndefined();
      expect(PROVIDERS.vllm).toBeUndefined();
      expect(PROVIDERS.edge).toBeUndefined();
    });

    it("each provider has required fields", () => {
      for (const [id, provider] of Object.entries(PROVIDERS)) {
        expect(provider.id).toBe(id);
        expect(provider.name).toBeTruthy();
        expect(provider.services).toBeInstanceOf(Array);
        expect(provider.services.length).toBeGreaterThan(0);
        expect(["api", "oauth", "service-account", "none"]).toContain(provider.authType);
      }
    });
  });

  describe("getProvidersForService", () => {
    it("does not expose embedding, reranking, or expenses providers", () => {
      expect(getProvidersForService("embedding" as ServiceType)).toEqual([]);
      expect(getProvidersForService("reranking" as ServiceType)).toEqual([]);
      expect(getProvidersForService("expenses" as ServiceType)).toEqual([]);
    });

    it("returns only messaging TTS providers", () => {
      const ids = getProvidersForService("tts").map((p) => p.id);
      expect(ids).toEqual(["minimax", "minimax-tts"]);
    });

    it("returns Wispr Flow as the only STT provider", () => {
      const ids = getProvidersForService("stt").map((p) => p.id);
      expect(ids).toEqual(["wisprflow"]);
    });

    it("returns OpenAI for image generation", () => {
      const ids = getProvidersForService("image").map((p) => p.id);
      expect(ids).toEqual(["openai"]);
    });

    it("keeps OpenBB-compatible market data providers", () => {
      const ids = getProvidersForService("market_data").map((p) => p.id);
      expect(ids).toContain("alpha-vantage");
      expect(ids).toContain("fmp");
      expect(ids).toContain("sec");
    });

    it("returns empty array for non-existent service", () => {
      expect(getProvidersForService("nonexistent" as ServiceType)).toEqual([]);
    });
  });

  describe("getProvider", () => {
    it("returns provider by ID", () => {
      const openai = getProvider("openai");
      expect(openai).toBeDefined();
      expect(openai?.id).toBe("openai");
      expect(openai?.name).toBe("OpenAI");
    });

    it("returns undefined for pruned and unknown providers", () => {
      expect(getProvider("voyage")).toBeUndefined();
      expect(getProvider("splitwise")).toBeUndefined();
      expect(getProvider("kernel")).toBeUndefined();
      expect(getProvider("nonexistent")).toBeUndefined();
    });
  });

  describe("hasCredentials", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("returns true when primary env var is set", () => {
      process.env.OPENAI_API_KEY = "test-key";
      expect(hasCredentials(PROVIDERS.openai)).toBe(true);
    });

    it("returns true when alias env var is set", () => {
      delete process.env.TRADIER_API_KEY;
      process.env.TRADIER_TOKEN = "test-key";
      expect(hasCredentials(PROVIDERS.tradier)).toBe(true);
    });

    it("returns false when no credentials are set", () => {
      delete process.env.WISPRFLOW_API_KEY;
      expect(hasCredentials(PROVIDERS.wisprflow)).toBe(false);
    });
  });

  describe("getApiKeySync", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("returns undefined for non-existent provider", () => {
      expect(getApiKeySync("nonexistent")).toBeUndefined();
    });

    it("returns primary env var value", () => {
      process.env.OPENAI_API_KEY = "primary-key";
      expect(getApiKeySync("openai")).toBe("primary-key");
    });

    it("returns alias env var value when primary is not set", () => {
      delete process.env.TRADIER_API_KEY;
      process.env.TRADIER_TOKEN = "alias-key";
      expect(getApiKeySync("tradier")).toBe("alias-key");
    });

    it("prefers primary over alias", () => {
      process.env.TRADIER_API_KEY = "primary-key";
      process.env.TRADIER_TOKEN = "alias-key";
      expect(getApiKeySync("tradier")).toBe("primary-key");
    });
  });

  describe("listProvidersByService", () => {
    it("returns providers grouped by retained services", () => {
      const byService = listProvidersByService();

      expect(byService.tts).toBeInstanceOf(Array);
      expect(byService.stt).toBeInstanceOf(Array);
      expect(byService.image).toBeInstanceOf(Array);
      expect(byService.market_data).toBeInstanceOf(Array);

      expect("embedding" in byService).toBe(false);
      expect("reranking" in byService).toBe(false);
      expect("expenses" in byService).toBe(false);
      expect(byService.tts.length).toBeGreaterThan(0);
      expect(byService.stt).toHaveLength(1);
      expect(byService.image).toHaveLength(1);
      expect(byService.market_data.length).toBeGreaterThan(0);
    });
  });

  describe("getAllProviderIds", () => {
    it("returns retained provider IDs", () => {
      const ids = getAllProviderIds();
      expect(ids).toContain("openai");
      expect(ids).toContain("wisprflow");
      expect(ids).toContain("minimax");
      expect(ids).toContain("minimax-tts");
      expect(ids).toContain("alpha-vantage");
      expect(ids).toContain("fmp");
      expect(ids).toContain("sec");

      expect(ids).not.toContain("voyage");
      expect(ids).not.toContain("splitwise");
      expect(ids).not.toContain("elevenlabs");
      expect(ids).not.toContain("vllm");
      expect(ids).not.toContain("edge");
    });
  });

  describe("getProviderStatus", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("returns configured when env var is set", () => {
      process.env.OPENAI_API_KEY = "test-key";
      expect(getProviderStatus(PROVIDERS.openai)).toBe("configured");
    });

    it("returns configured when auth store has credential", () => {
      delete process.env.OPENAI_API_KEY;
      expect(getProviderStatus(PROVIDERS.openai, true)).toBe("configured");
    });

    it("returns not configured when no credentials are available", () => {
      delete process.env.WISPRFLOW_API_KEY;
      expect(getProviderStatus(PROVIDERS.wisprflow, false)).toBe("not configured");
    });
  });

  describe("provider service coverage", () => {
    it("openai supports image generation only in the service registry", () => {
      expect(PROVIDERS.openai.services).toEqual(["image"]);
    });

    it("wisprflow supports stt", () => {
      expect(PROVIDERS.wisprflow.services).toEqual(["stt"]);
    });
  });
});
