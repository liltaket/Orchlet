import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { Logger } from "@orchlet/shared";
import type { ModelConfigEntry, CostClass, ModelCapability } from "@orchlet/core";

export interface DiscoveredModel {
  id: string;
  name: string;
  contextLength: number;
  promptPricePerToken: number;
  completionPricePerToken: number;
  costClass: CostClass;
  capabilities: ModelCapability[];
  observedAt: string;
  source: string;
}

export interface ModelCacheData {
  observedAt: string;
  ttlMs: number;
  models: Record<string, DiscoveredModel>;
}

export class OpenRouterCatalogService {
  private cachePath: string;
  private ttlMs: number;
  private logger = new Logger({ prefix: "ModelCatalogService" });
  private memoryCache: Record<string, DiscoveredModel> | null = null;
  private lastObservedAt: string | null = null;

  constructor(options: { cachePath?: string; ttlMs?: number } = {}) {
    this.cachePath =
      options.cachePath || path.join(os.homedir(), ".orchlet", "models-cache.json");
    this.ttlMs = options.ttlMs || 24 * 60 * 60 * 1000; // 24 hours
  }

  async getCachedModels(): Promise<Record<string, DiscoveredModel>> {
    if (this.memoryCache) {
      return this.memoryCache;
    }

    try {
      const raw = await fs.readFile(this.cachePath, "utf-8");
      const parsed: ModelCacheData = JSON.parse(raw);
      const age = Date.now() - new Date(parsed.observedAt).getTime();
      if (age < (parsed.ttlMs || this.ttlMs)) {
        this.memoryCache = parsed.models;
        this.lastObservedAt = parsed.observedAt;
        this.logger.debug(
          `Loaded ${Object.keys(parsed.models).length} models from disk cache (${(age / 1000 / 60).toFixed(0)}m old)`
        );
        return this.memoryCache;
      }
    } catch {
      // Cache missing or unreadable
    }

    return {};
  }

  async refreshCatalog(force = false): Promise<Record<string, DiscoveredModel>> {
    const cached = await this.getCachedModels();
    if (!force && Object.keys(cached).length > 0) {
      return cached;
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      this.logger.debug("OPENROUTER_API_KEY not set, skipping remote model discovery.");
      return cached;
    }

    try {
      this.logger.info("Discovering current model catalog from OpenRouter...");
      const res = await fetch("https://openrouter.ai/api/v1/models", {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": "https://github.com/liltaket/Orchlet",
          "X-Title": "Orchlet Control Plane",
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        this.logger.warn(`OpenRouter models API returned ${res.status}: using cached catalog.`);
        return cached;
      }

      const data = (await res.json()) as any;
      const rawList = data.data || [];
      const discovered: Record<string, DiscoveredModel> = {};
      const now = new Date().toISOString();

      for (const item of rawList) {
        if (!item.id) continue;

        const promptPrice = parseFloat(item.pricing?.prompt || "0") || 0;
        const completionPrice = parseFloat(item.pricing?.completion || "0") || 0;
        const contextLength = item.context_length || 32768;

        discovered[item.id] = {
          id: item.id,
          name: item.name || item.id,
          contextLength,
          promptPricePerToken: promptPrice,
          completionPricePerToken: completionPrice,
          costClass: this.deriveCostClass(promptPrice),
          capabilities: this.deriveCapabilities(item.id, item.architecture, contextLength),
          observedAt: now,
          source: "openrouter-api",
        };
      }

      this.memoryCache = discovered;
      this.lastObservedAt = now;

      // Persist to disk
      try {
        await fs.mkdir(path.dirname(this.cachePath), { recursive: true });
        const cachePayload: ModelCacheData = {
          observedAt: now,
          ttlMs: this.ttlMs,
          models: discovered,
        };
        await fs.writeFile(this.cachePath, JSON.stringify(cachePayload, null, 2), "utf-8");
        this.logger.info(`Discovered and cached ${Object.keys(discovered).length} models.`);
      } catch (err: any) {
        this.logger.warn(`Failed to persist model cache: ${err.message}`);
      }

      return discovered;
    } catch (err: any) {
      this.logger.warn(`Model discovery failed (${err.message}): retaining cached catalog.`);
      return cached;
    }
  }

  deriveCostClass(promptPricePerToken: number): CostClass {
    if (promptPricePerToken <= 0) return "FREE";
    if (promptPricePerToken <= 0.0000001) return "TINY";        // <= $0.10 / M
    if (promptPricePerToken <= 0.0000005) return "CHEAP";       // <= $0.50 / M
    if (promptPricePerToken <= 0.000002) return "MODERATE";     // <= $2.00 / M
    if (promptPricePerToken <= 0.00001) return "EXPENSIVE";     // <= $10.00 / M
    return "PREMIUM";
  }

  deriveCapabilities(id: string, architecture?: any, contextLength = 32768): ModelCapability[] {
    const lower = id.toLowerCase();
    const caps: Set<ModelCapability> = new Set();

    caps.add("structuredOutput");

    if (
      lower.includes("code") ||
      lower.includes("coder") ||
      lower.includes("dev") ||
      lower.includes("deepseek") ||
      lower.includes("glm") ||
      lower.includes("gemini") ||
      lower.includes("claude") ||
      lower.includes("gpt")
    ) {
      caps.add("coding");
      caps.add("toolUse");
    }

    if (
      lower.includes("flash") ||
      lower.includes("mini") ||
      lower.includes("haiku") ||
      lower.includes("turbo") ||
      lower.includes("fast")
    ) {
      caps.add("fast");
    }

    if (
      lower.includes("pro") ||
      lower.includes("sonnet") ||
      lower.includes("opus") ||
      lower.includes("r1") ||
      lower.includes("reasoning") ||
      lower.includes("o1") ||
      lower.includes("o3")
    ) {
      caps.add("reasoning");
      caps.add("review");
    }

    if (lower.includes("flash") || lower.includes("pro") || lower.includes("sonnet")) {
      caps.add("review");
    }

    if (contextLength >= 128000) {
      caps.add("longContext");
    }

    const modality = String(architecture?.modality || "").toLowerCase();
    if (modality.includes("image") || modality.includes("video")) {
      caps.add("multimodal");
    }

    return Array.from(caps);
  }

  buildEffectiveCatalog(
    userConfigModels: Record<string, ModelConfigEntry> = {},
    discovered: Record<string, DiscoveredModel> = {},
  ): Record<string, ModelConfigEntry> {
    const effective: Record<string, ModelConfigEntry> = {};

    // 1. Populate from user configuration first (user config is supreme)
    for (const [key, entry] of Object.entries(userConfigModels)) {
      const disc = discovered[entry.model];
      effective[key] = {
        ...entry,
        costClass: entry.costClass || disc?.costClass || "MODERATE",
        capabilities: entry.capabilities || disc?.capabilities || ["coding", "structuredOutput"],
        pricing: entry.pricing || (disc ? {
          promptPerToken: disc.promptPricePerToken,
          completionPerToken: disc.completionPricePerToken,
        } : undefined),
        contextLength: entry.contextLength || disc?.contextLength || 32768,
        discoveredAt: disc?.observedAt,
        discoverySource: disc?.source || "user-config",
      };
    }

    return effective;
  }
}

export const modelCatalogService = new OpenRouterCatalogService();
