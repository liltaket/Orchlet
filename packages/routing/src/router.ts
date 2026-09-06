import { Logger, OrchletError, type ModelCatalogEntry, type OrchletConfigData } from "@orchlet/shared";
import {
  type AgentRole,
  type IModelRouter,
  type ModelTier,
  type RoutingMode,
  SUPPORTED_REVIEWER_PROVIDERS,
} from "@orchlet/core";
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
        { providerId: "openrouter", modelId: "google/gemini-2.5-flash", tier: "fast", costWeight: 0.1 },
        { providerId: "openrouter", modelId: "deepseek/deepseek-chat", tier: "fast", costWeight: 0.2 },
      ],
      balanced: [
        { providerId: "openrouter", modelId: "google/gemini-2.5-flash", tier: "balanced", costWeight: 0.3 },
        { providerId: "openrouter", modelId: "deepseek/deepseek-chat", tier: "balanced", costWeight: 0.5 },
      ],
      strong: [
        { providerId: "openrouter", modelId: "google/gemini-2.5-pro", tier: "strong", costWeight: 1.0 },
        { providerId: "openrouter", modelId: "deepseek/deepseek-chat", tier: "strong", costWeight: 1.5 },
      ],
    };
  }

  registerModel(tier: ModelTier, candidate: ModelCandidate): void {
    this.catalog[tier].unshift(candidate);
  }

  async resolveModel(
    role: AgentRole | string,
    mode: RoutingMode = "AUTO",
    config?: OrchletConfigData,
  ): Promise<RoutingDecision> {
    if (config?.models && Object.keys(config.models).length > 0) {
      this.loadCatalogFromConfig(config.models);
    }

    // Check explicit roleMappings first
    const roleMapping = (config?.roleMappings as any)?.[role];
    if (roleMapping) {
      if (role === "critic" || role === "reviewer") {
        if (!SUPPORTED_REVIEWER_PROVIDERS.includes(roleMapping.provider as any)) {
          throw new OrchletError(
            `Configured reviewer provider '${roleMapping.provider}' is unsupported. Supported reviewer providers: ${SUPPORTED_REVIEWER_PROVIDERS.join(", ")}`,
            "UNSUPPORTED_REVIEWER_PROVIDER",
          );
        }
      }

      return {
        providerId: roleMapping.provider,
        modelId: roleMapping.model,
        tier: "strong",
        estimatedCostWeight: 1.0,
        reason: "role_mapping",
        fallbackHops: 0,
        candidatesConsidered: [`${roleMapping.provider}/${roleMapping.model}`],
      };
    }

    const tier = this.determineTier(role, mode);
    let candidates = [...this.catalog[tier]];

    // If role is critic/reviewer, strictly filter candidates to supported reviewer providers
    if (role === "critic" || role === "reviewer") {
      candidates = candidates.filter((c) =>
        SUPPORTED_REVIEWER_PROVIDERS.includes(c.providerId as any)
      );
      if (candidates.length === 0) {
        throw new OrchletError(
          `No supported reviewer providers available for tier '${tier}'. Supported providers: ${SUPPORTED_REVIEWER_PROVIDERS.join(", ")}`,
          "NO_SUPPORTED_REVIEWER_PROVIDER"
        );
      }
    }

    if (candidates.length === 0) {
      throw new OrchletError(
        `No model candidates available for tier '${tier}'`,
        "NO_CANDIDATE_MODELS",
      );
    }

    const candidatesConsidered = candidates.map((c) => `${c.providerId}/${c.modelId}`);

    // Sort by cost weight according to mode
    if (mode === "CHEAP") {
      candidates.sort((a, b) => a.costWeight - b.costWeight);
    } else if (mode === "BEST") {
      candidates.sort((a, b) => b.costWeight - a.costWeight);
    }

    const selected = candidates[0];

    this.logger.debug(
      `Routed role='${role}' mode='${mode}' -> tier='${tier}' candidate='${selected.providerId}/${selected.modelId}'`,
    );

    return {
      providerId: selected.providerId,
      modelId: selected.modelId,
      tier,
      estimatedCostWeight: selected.costWeight,
      reason: `Selected best available candidate in '${tier}' tier for role '${role}' (mode: ${mode})`,
      fallbackHops: 0,
      candidatesConsidered,
    };
  }

  private determineTier(role: AgentRole | string, mode: RoutingMode): ModelTier {
    if (mode === "CHEAP") return "fast";
    if (mode === "BEST") return "strong";

    // Mode: AUTO or QUALITY
    switch (role) {
      case "executor":
        return mode === "QUALITY" ? "strong" : "balanced";
      case "repairer":
        return "strong";
      case "critic":
      case "reviewer":
        return "strong";
      case "planner":
      case "architect":
        return "balanced";
      default:
        return "balanced";
    }
  }
}

export const modelRouter = new ModelRouter();
