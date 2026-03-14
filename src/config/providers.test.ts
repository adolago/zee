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
    it("should have expected providers defined", () => {
      expect(PROVIDERS.google).toBeDefined();
      expect(PROVIDERS.openai).toBeDefined();
      expect(PROVIDERS.voyage).toBeDefined();
      expect(PROVIDERS.elevenlabs).toBeDefined();
      expect(PROVIDERS.minimax).toBeDefined();
      expect(PROVIDERS["minimax-tts"]).toBeDefined();
      expect(PROVIDERS.splitwise).toBeDefined();
      expect(PROVIDERS["alpha-vantage"]).toBeDefined();
      expect(PROVIDERS.fmp).toBeDefined();
      expect(PROVIDERS.sec).toBeDefined();
      expect(PROVIDERS.vllm).toBeDefined();
      expect(PROVIDERS.edge).toBeDefined();
    });

    it("each provider should have required fields", () => {
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
    it("should return embedding providers", () => {
      const providers = getProvidersForService("embedding");
      const ids = providers.map((p) => p.id);
      expect(ids).toContain("google");
      expect(ids).not.toContain("openai");
      expect(ids).not.toContain("voyage");
      expect(ids).not.toContain("vllm");
    });

    it("should return reranking providers", () => {
      const providers = getProvidersForService("reranking");
      const ids = providers.map((p) => p.id);
      expect(ids).toContain("voyage");
      expect(ids).toContain("vllm");
    });

    it("should return tts providers", () => {
      const providers = getProvidersForService("tts");
      const ids = providers.map((p) => p.id);
      expect(ids).toContain("openai");
      expect(ids).toContain("elevenlabs");
      expect(ids).toContain("minimax");
      expect(ids).toContain("minimax-tts");
      expect(ids).toContain("edge");
    });

    it("should return stt providers", () => {
      const providers = getProvidersForService("stt");
      const ids = providers.map((p) => p.id);
      expect(ids).toContain("wisprflow");
      expect(ids).not.toContain("google");
    });

    it("should return image providers", () => {
      const providers = getProvidersForService("image");
      const ids = providers.map((p) => p.id);
      expect(ids).toContain("openai");
    });

    it("should return expenses providers", () => {
      const providers = getProvidersForService("expenses");
      const ids = providers.map((p) => p.id);
      expect(ids).toContain("splitwise");
    });

    it("should return market data providers", () => {
      const providers = getProvidersForService("market_data");
      const ids = providers.map((p) => p.id);
      expect(ids).toContain("alpha-vantage");
      expect(ids).toContain("fmp");
      expect(ids).toContain("sec");
    });

    it("should return empty array for non-existent service", () => {
      const providers = getProvidersForService("nonexistent" as ServiceType);
      expect(providers).toEqual([]);
    });
  });

  describe("getProvider", () => {
    it("should return provider by ID", () => {
      const google = getProvider("google");
      expect(google).toBeDefined();
      expect(google?.id).toBe("google");
      expect(google?.name).toBe("Google AI");
    });

    it("should return undefined for non-existent provider", () => {
      const nonexistent = getProvider("nonexistent");
      expect(nonexistent).toBeUndefined();
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

    it("should return true for local providers", () => {
      const vllm = PROVIDERS.vllm;
      expect(hasCredentials(vllm)).toBe(true);

      const edge = PROVIDERS.edge;
      expect(hasCredentials(edge)).toBe(true);
    });

    it("should return true when primary env var is set", () => {
      process.env.OPENAI_API_KEY = "test-key";
      expect(hasCredentials(PROVIDERS.openai)).toBe(true);
    });

    it("should return true when alias env var is set", () => {
      process.env.GEMINI_API_KEY = "test-key";
      expect(hasCredentials(PROVIDERS.google)).toBe(true);
    });

    it("should return false when no credentials are set", () => {
      delete process.env.OPENAI_API_KEY;
      expect(hasCredentials(PROVIDERS.openai)).toBe(false);
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

    it("should return undefined for non-existent provider", () => {
      expect(getApiKeySync("nonexistent")).toBeUndefined();
    });

    it("should return primary env var value", () => {
      process.env.OPENAI_API_KEY = "primary-key";
      expect(getApiKeySync("openai")).toBe("primary-key");
    });

    it("should return alias env var value when primary not set", () => {
      delete process.env.GOOGLE_API_KEY;
      process.env.GEMINI_API_KEY = "alias-key";
      expect(getApiKeySync("google")).toBe("alias-key");
    });

    it("should prefer primary over alias", () => {
      process.env.GOOGLE_API_KEY = "primary-key";
      process.env.GEMINI_API_KEY = "alias-key";
      expect(getApiKeySync("google")).toBe("primary-key");
    });

    it("should return undefined when no env vars are set", () => {
      delete process.env.VOYAGE_API_KEY;
      expect(getApiKeySync("voyage")).toBeUndefined();
    });
  });

  describe("listProvidersByService", () => {
    it("should return providers grouped by service", () => {
      const byService = listProvidersByService();

      expect(byService.embedding).toBeInstanceOf(Array);
      expect(byService.reranking).toBeInstanceOf(Array);
      expect(byService.tts).toBeInstanceOf(Array);
      expect(byService.stt).toBeInstanceOf(Array);
      expect(byService.image).toBeInstanceOf(Array);
      expect(byService.expenses).toBeInstanceOf(Array);
      expect(byService.market_data).toBeInstanceOf(Array);

      expect(byService.embedding.length).toBeGreaterThan(0);
      expect(byService.reranking.length).toBeGreaterThan(0);
      expect(byService.tts.length).toBeGreaterThan(0);
      expect(byService.stt.length).toBeGreaterThan(0);
      expect(byService.image.length).toBeGreaterThan(0);
      expect(byService.expenses.length).toBeGreaterThan(0);
      expect(byService.market_data.length).toBeGreaterThan(0);
    });
  });

  describe("getAllProviderIds", () => {
    it("should return all provider IDs", () => {
      const ids = getAllProviderIds();
      expect(ids).toContain("google");
      expect(ids).toContain("openai");
      expect(ids).toContain("voyage");
      expect(ids).toContain("elevenlabs");
      expect(ids).toContain("minimax");
      expect(ids).toContain("minimax-tts");
      expect(ids).toContain("splitwise");
      expect(ids).toContain("alpha-vantage");
      expect(ids).toContain("fmp");
      expect(ids).toContain("sec");
      expect(ids).toContain("vllm");
      expect(ids).toContain("edge");
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

    it("should return 'local' for local providers", () => {
      expect(getProviderStatus(PROVIDERS.vllm)).toBe("local");
      expect(getProviderStatus(PROVIDERS.edge)).toBe("local");
    });

    it("should return 'configured' when env var is set", () => {
      process.env.OPENAI_API_KEY = "test-key";
      expect(getProviderStatus(PROVIDERS.openai)).toBe("configured");
    });

    it("should return 'configured' when auth store has credential", () => {
      delete process.env.OPENAI_API_KEY;
      expect(getProviderStatus(PROVIDERS.openai, true)).toBe("configured");
    });

    it("should return 'not configured' when no credentials", () => {
      delete process.env.VOYAGE_API_KEY;
      expect(getProviderStatus(PROVIDERS.voyage, false)).toBe("not configured");
    });
  });

  describe("provider service coverage", () => {
    it("voyage should support reranking", () => {
      const voyage = PROVIDERS.voyage;
      expect(voyage.services).toContain("reranking");
    });

    it("openai should support tts and image", () => {
      const openai = PROVIDERS.openai;
      expect(openai.services).toContain("tts");
      expect(openai.services).toContain("image");
    });

    it("google should support embedding only", () => {
      const google = PROVIDERS.google;
      expect(google.services).toContain("embedding");
      expect(google.services).not.toContain("stt");
    });

    it("wisprflow should support stt", () => {
      const wisprflow = PROVIDERS.wisprflow;
      expect(wisprflow.services).toContain("stt");
    });

    it("splitwise should support expenses", () => {
      const splitwise = PROVIDERS.splitwise;
      expect(splitwise.services).toContain("expenses");
    });
  });
});
