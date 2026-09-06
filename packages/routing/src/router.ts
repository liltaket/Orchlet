import { Logger, OrchletError, type ModelCatalogEntry, type OrchletConfigData } from "@orchlet/shared";
import type { AgentRole, IModelRouter, ModelTier, RoutingMode } from "@orchlet/core";
import { UsageManager, usageManager as defaultUsageManager } from "@orchlet/usage";

export interface ModelCandidate {
  providerId: string;
  modelId: string;
  tier: ModelTier;
  costWeight: number; // 1 = baseline, 5 = high, 0.2 = cheap
  strengths?: string[];
}

export interface RoutingDecision {
  providerId: string;
  modelId: string;
  tier: ModelTier;
  estimatedCostWeight: number;
  reason: string;
  fallbackHops: number;
  candidatesConsidered: string[];
}

export class ModelRouter implements IModelRouter {
  private logger = new Logger({ prefix: "ModelRouter" });
  private catalog: Record<ModelTier, ModelCandidate[]> = {
    fast: [],
    balanced: [],
    strong: [],
  };

  constructor(
    private usage: UsageManager = defaultUsageManager,
    config?: OrchletConfigData,
  ) {
    if (config?.models) {
      this.loadCatalogFromConfig(config.models);
    } else {
      this.loadDefaultCatalog();
    }
  }

  loadCatalogFromConfig(models: Record<string, ModelCatalogEntry>): void {
    this.catalog = { fast: [], balanced: [], strong: [] };
    for (const [key, entry] of Object.entries(models)) {
      this.catalog[entry.tier].push({
        providerId: entry.provider,
        modelId: entry.model,
        tier: entry.tier,
        costWeight: entry.costWeight ?? (entry.tier === "fast" ? 0.3 : entry.tier === "balanced" ? 1.0 : 3.0),
        strengths: entry.strengths,
      });
    }
    this.logger.debug(`Loaded dynamic model catalog with ${Object.keys(models).length} entries`);
  }

  private loadDefaultCatalog(): void {
    this.catalog = {
      fast: [
        { providerId: "openrouter", modelId: "deepseek/deepseek-chat", tier: "fast", costWeight: 0.2 },
        { providerId: "google", modelId: "gemini-2.5-flash", tier: "fast", costWeight: 0.3 },
        { providerId: "openai", modelId: "gpt-4o-mini", tier: "fast", costWeight: 0.4 },
      ],
      balanced: [
        { providerId: "openrouter", modelId: "anthropic/claude-3.7-sonnet", tier: "balanced", costWeight: 1.0 },
        { providerId: "openai", modelId: "gpt-4o", tier: "balanced", costWeight: 0.9 },
        { providerId: "google", modelId: "gemini-2.5-pro", tier: "balanced", costWeight: 1.0 },
      ],
      strong: [
        { providerId: "openrouter", modelId: "anthropic/claude-3.7-sonnet", tier: "strong", costWeight: 3.0 },
        { providerId: "openai", modelId: "o3-mini", tier: "strong", costWeight: 2.8 },
        { providerId: "google", modelId: "gemini-2.5-pro", tier: "strong", costWeight: 3.0 },
      ],
    };
  }

  registerModel(tier: ModelTier, candidate: ModelCandidate): void {
    this.catalog[tier].unshift(candidate);
  }

  private resolveTierForRole(role: AgentRole, mode: RoutingMode): ModelTier {
    if (mode === "CHEAP") {
      return role === "critic" || role === "architect" ? "balanced" : "fast";
    }
    if (mode === "BEST") {
      return "strong";
    }
    if (mode === "QUALITY") {
      return role === "planner" || role === "executor" || role === "repairer" ? "balanced" : "strong";
    }
    // Default AUTO: Best reasonable outcome for lowest reasonable cost
    switch (role) {
      case "planner":
        return "balanced";
      case "architect":
        return "strong";
      case "executor":
        return "balanced";
      case "critic":
        return "strong";
      case "repairer":
        return "fast";
      default:
        return "balanced";
    }
  }

  async resolveModel(role: AgentRole, mode: RoutingMode = "AUTO"): Promise<RoutingDecision> {
    const tier = this.resolveTierForRole(role, mode);
    const candidates = this.catalog[tier] || [];
    const candidatesConsidered: string[] = [];

    let fallbackHops = 0;
    for (const candidate of candidates) {
      const candidateTag = `${candidate.providerId}/${candidate.modelId}`;
      candidatesConsidered.push(candidateTag);
      const isHealthy = this.usage.isProviderHealthy(candidate.providerId);
      if (isHealthy) {
        this.logger.debug(
          `Resolved model for role=${role} mode=${mode}: ${candidateTag} (tier=${tier}, hops=${fallbackHops})`
        );
        return {
          providerId: candidate.providerId,
          modelId: candidate.modelId,
          tier: candidate.tier,
          estimatedCostWeight: candidate.costWeight,
          reason: fallbackHops === 0 ? "optimal_tier_match" : "quota_fallback",
          fallbackHops,
          candidatesConsidered,
        };
      }
      fallbackHops++;
    }

    // Fallback: If entire primary tier is constrained, search adjacent tier candidates with health validation
    const adjacentTiers: ModelTier[] = tier === "strong" ? ["balanced", "fast"] : ["fast", "balanced"];
    for (const adjTier of adjacentTiers) {
      const fallbackCandidates = this.catalog[adjTier] || [];
      for (const fallback of fallbackCandidates) {
        const candidateTag = `${fallback.providerId}/${fallback.modelId}`;
        candidatesConsidered.push(candidateTag);
        if (this.usage.isProviderHealthy(fallback.providerId)) {
          this.logger.warn(
            `Degrading tier for role=${role} from ${tier} to ${adjTier} (provider: ${fallback.providerId}) due to quota constraints`
          );
          return {
            providerId: fallback.providerId,
            modelId: fallback.modelId,
            tier: fallback.tier,
            estimatedCostWeight: fallback.costWeight,
            reason: "cross_tier_healthy_fallback",
            fallbackHops,
            candidatesConsidered,
          };
        }
        fallbackHops++;
      }
    }

    throw new OrchletError(
      `No healthy model found across any tier for role ${role} in mode ${mode}. Evaluated: ${candidatesConsidered.join(", ")}`,
      "NO_HEALTHY_MODEL",
    );
  }
}

export const modelRouter = new ModelRouter();
