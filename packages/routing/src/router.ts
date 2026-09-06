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
    if (config?.models && Object.keys(config.models).length > 0) {
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
        { providerId: "openrouter", modelId: "google/gemini-2.5-flash", tier: "fast", costWeight: 0.3 },
      ],
      balanced: [
        { providerId: "openrouter", modelId: "deepseek/deepseek-chat", tier: "balanced", costWeight: 0.5 },
        { providerId: "openrouter", modelId: "google/gemini-2.5-flash", tier: "balanced", costWeight: 0.5 },
      ],
      strong: [
        { providerId: "openrouter", modelId: "google/gemini-2.5-pro", tier: "strong", costWeight: 2.0 },
        { providerId: "openrouter", modelId: "deepseek/deepseek-chat", tier: "strong", costWeight: 1.0 },
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

  async resolveModel(
    role: AgentRole,
    mode: RoutingMode = "AUTO",
    config?: OrchletConfigData,
  ): Promise<RoutingDecision> {
    // 1. Check explicit roleMappings from effective config
    const roleMapping = config?.roleMappings?.[role];
    if (roleMapping?.model) {
      const providerId = roleMapping.provider || "openrouter";
      const modelId = roleMapping.model;
      const tier = roleMapping.tier || this.resolveTierForRole(role, mode);
      return {
        providerId,
        modelId,
        tier,
        estimatedCostWeight: 1.0,
        reason: "role_mapping",
        fallbackHops: 0,
        candidatesConsidered: [`${providerId}/${modelId}`],
      };
    }

    // 2. If runtime config has custom models catalog, check dynamic catalog
    let activeCatalog = this.catalog;
    if (config?.models && Object.keys(config.models).length > 0) {
      activeCatalog = { fast: [], balanced: [], strong: [] };
      for (const entry of Object.values(config.models)) {
        const tier: ModelTier =
          entry.tier && (["fast", "balanced", "strong"] as const).includes(entry.tier)
            ? entry.tier
            : "balanced";
        activeCatalog[tier].push({
          providerId: entry.provider,
          modelId: entry.model,
          tier,
          costWeight: entry.costWeight ?? (tier === "fast" ? 0.3 : tier === "balanced" ? 1.0 : 3.0),
          strengths: entry.strengths,
        });
      }
    }

    const tier = roleMapping?.tier || this.resolveTierForRole(role, mode);
    const candidates = activeCatalog[tier] || [];
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
      const fallbackCandidates = activeCatalog[adjTier] || [];
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

    // All registered providers are exhausted/unhealthy
    throw new OrchletError(
      `All candidate providers exhausted or throttled for role '${role}' (tier ${tier}). Considered: ${candidatesConsidered.join(", ")}`,
      "NO_HEALTHY_MODELS",
    );
  }
}

export const modelRouter = new ModelRouter();
