import { Logger, OrchletError, type ModelCatalogEntry, type OrchletConfigData } from "@orchlet/shared";
import {
  type AgentRole,
  type IModelRouter,
  type ModelTier,
  type RoutingMode,
  type CostClass,
  type ModelCapability,
  type SubscriptionQuotaState,
  SUPPORTED_REVIEWER_PROVIDERS,
} from "@orchlet/core";
import { UsageManager, usageManager as defaultUsageManager } from "@orchlet/usage";

export interface ModelCandidate {
  providerId: string;
  modelId: string;
  tier: ModelTier;
  costWeight: number; // 1 = baseline, 5 = high, 0.2 = cheap
  costClass?: CostClass;
  capabilities?: ModelCapability[];
  pricing?: {
    promptPerToken: number;
    completionPerToken: number;
  };
  contextLength?: number;
  strengths?: string[];
}

export interface RoutingContext {
  taskRemainingBudgetUsd?: number;
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
  retryCount?: number;
  failureType?: string;
  reviewSeverity?: "P0" | "P1" | "P2" | "P3";
  subscriptionQuotaState?: SubscriptionQuotaState;
  preferredModels?: string[];
  excludedModels?: string[];
  maxCostClass?: CostClass;
}

export interface RoutingDecision {
  providerId: string;
  modelId: string;
  tier: ModelTier;
  costClass?: CostClass;
  estimatedCostUsd?: number;
  estimatedCostWeight: number;
  reason: string;
  reasons: string[];
  fallbackHops: number;
  candidatesConsidered: string[];
  remainingBudgetUsd?: number;
  subscriptionQuotaState?: SubscriptionQuotaState;
}

const COST_CLASS_RANKS: Record<CostClass, number> = {
  FREE: 0,
  TINY: 1,
  CHEAP: 2,
  MODERATE: 3,
  EXPENSIVE: 4,
  PREMIUM: 5,
  SUBSCRIPTION: 1,
};

export function forecastModelCost(
  candidate: ModelCandidate,
  inputTokens = 2000,
  outputTokens = 1000,
): number {
  if (candidate.pricing) {
    return (
      inputTokens * candidate.pricing.promptPerToken +
      outputTokens * candidate.pricing.completionPerToken
    );
  }
  // Approximate from costWeight if exact pricing not configured ($0.005 per weight unit)
  return candidate.costWeight * 0.005;
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
    for (const [, entry] of Object.entries(models)) {
      this.catalog[entry.tier].push({
        providerId: entry.provider,
        modelId: entry.model,
        tier: entry.tier,
        costWeight:
          entry.costWeight ?? (entry.tier === "fast" ? 0.3 : entry.tier === "balanced" ? 1.0 : 3.0),
        costClass: entry.costClass,
        capabilities: entry.capabilities as ModelCapability[] | undefined,
        pricing: entry.pricing,
        contextLength: entry.contextLength,
        strengths: entry.strengths,
      });
    }
    this.logger.debug(`Loaded dynamic model catalog with ${Object.keys(models).length} entries`);
  }

  private loadDefaultCatalog(): void {
    this.catalog = {
      fast: [
        {
          providerId: "openrouter",
          modelId: "z-ai/glm-5.3-flash",
          tier: "fast",
          costClass: "TINY",
          costWeight: 0.1,
          pricing: { promptPerToken: 0.000000075, completionPerToken: 0.00000025 },
          capabilities: ["coding", "structuredOutput", "fast", "toolUse"],
        },
        {
          providerId: "openrouter",
          modelId: "deepseek/deepseek-chat",
          tier: "fast",
          costClass: "CHEAP",
          costWeight: 0.2,
          pricing: { promptPerToken: 0.00000014, completionPerToken: 0.00000028 },
          capabilities: ["coding", "structuredOutput", "fast", "toolUse"],
        },
      ],
      balanced: [
        {
          providerId: "openrouter",
          modelId: "google/gemini-3.8-flash",
          tier: "balanced",
          costClass: "MODERATE",
          costWeight: 0.5,
          pricing: { promptPerToken: 0.00000075, completionPerToken: 0.00000375 },
          capabilities: ["coding", "reasoning", "structuredOutput", "review", "toolUse", "longContext"],
        },
        {
          providerId: "openrouter",
          modelId: "deepseek/deepseek-chat",
          tier: "balanced",
          costClass: "CHEAP",
          costWeight: 0.3,
          pricing: { promptPerToken: 0.00000014, completionPerToken: 0.00000028 },
          capabilities: ["coding", "structuredOutput", "fast", "toolUse"],
        },
      ],
      strong: [
        {
          providerId: "openrouter",
          modelId: "anthropic/claude-3.7-sonnet",
          tier: "strong",
          costClass: "EXPENSIVE",
          costWeight: 2.5,
          pricing: { promptPerToken: 0.000003, completionPerToken: 0.000015 },
          capabilities: ["coding", "reasoning", "structuredOutput", "review", "toolUse", "longContext"],
        },
        {
          providerId: "openrouter",
          modelId: "google/gemini-3.8-flash",
          tier: "strong",
          costClass: "MODERATE",
          costWeight: 0.5,
          pricing: { promptPerToken: 0.00000075, completionPerToken: 0.00000375 },
          capabilities: ["coding", "reasoning", "structuredOutput", "review", "toolUse", "longContext"],
        },
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
    context: RoutingContext = {},
  ): Promise<RoutingDecision> {
    const reasons: string[] = [];

    if (config?.models && Object.keys(config.models).length > 0) {
      this.loadCatalogFromConfig(config.models);
    }

    // 1. MANUAL mode or explicit roleMappings take precedence
    const roleMapping = (config?.roleMappings as any)?.[role];
    if (roleMapping || mode === "MANUAL") {
      if (!roleMapping) {
        throw new OrchletError(
          `MANUAL routing mode specified but no role mapping configured for '${role}'`,
          "MISSING_MANUAL_ROLE_MAPPING",
        );
      }

      if (role === "critic" || role === "reviewer") {
        if (!SUPPORTED_REVIEWER_PROVIDERS.includes(roleMapping.provider as any)) {
          throw new OrchletError(
            `Configured reviewer provider '${roleMapping.provider}' is unsupported. Supported reviewer providers: ${SUPPORTED_REVIEWER_PROVIDERS.join(", ")}`,
            "UNSUPPORTED_REVIEWER_PROVIDER",
          );
        }
      }

      reasons.push(`Explicit role mapping configured for role '${role}'`);
      return {
        providerId: roleMapping.provider,
        modelId: roleMapping.model,
        tier: roleMapping.tier || "strong",
        estimatedCostWeight: 1.0,
        reason: "role_mapping",
        reasons,
        fallbackHops: 0,
        candidatesConsidered: [`${roleMapping.provider}/${roleMapping.model}`],
        remainingBudgetUsd: context.taskRemainingBudgetUsd,
      };
    }

    // 2. Determine target tier with escalation rules
    const targetTier = this.determineTier(role, mode, context);
    reasons.push(`Target tier determined as '${targetTier}' based on mode '${mode}' and role '${role}'`);

    if (context.retryCount && context.retryCount > 0) {
      reasons.push(`Retry cycle ${context.retryCount} active; escalation policy evaluated`);
    }

    // 3. Collect candidates across tiers with target tier prioritized
    const tierOrder: ModelTier[] =
      targetTier === "strong"
        ? ["strong", "balanced", "fast"]
        : targetTier === "balanced"
          ? ["balanced", "fast", "strong"]
          : ["fast", "balanced", "strong"];

    let candidates: ModelCandidate[] = [];
    const seen = new Set<string>();

    for (const t of tierOrder) {
      for (const c of this.catalog[t]) {
        const key = `${c.providerId}/${c.modelId}`;
        if (!seen.has(key)) {
          seen.add(key);
          candidates.push(c);
        }
      }
    }

    // If role is critic/reviewer, strictly filter to supported reviewer providers
    if (role === "critic" || role === "reviewer") {
      candidates = candidates.filter((c) =>
        SUPPORTED_REVIEWER_PROVIDERS.includes(c.providerId as any),
      );
      if (candidates.length === 0) {
        throw new OrchletError(
          `No supported reviewer providers available. Supported providers: ${SUPPORTED_REVIEWER_PROVIDERS.join(", ")}`,
          "NO_SUPPORTED_REVIEWER_PROVIDER",
        );
      }
    }

    // 4. Excluded models filter
    const excluded = context.excludedModels || config?.excludedModels || [];
    if (excluded.length > 0) {
      candidates = candidates.filter((c) => !excluded.includes(c.modelId));
      reasons.push(`Filtered out ${excluded.length} excluded model(s)`);
    }

    // 5. Max cost class filter
    const maxClass = context.maxCostClass || config?.maxCostClass;
    if (maxClass) {
      const maxRank = COST_CLASS_RANKS[maxClass] ?? 5;
      candidates = candidates.filter((c) => {
        if (!c.costClass) return true;
        return (COST_CLASS_RANKS[c.costClass] ?? 3) <= maxRank;
      });
      reasons.push(`Enforced maximum cost class '${maxClass}'`);
    }

    if (candidates.length === 0) {
      throw new OrchletError(
        `No model candidates available after policy filters (mode: '${mode}', role: '${role}')`,
        "NO_CANDIDATE_MODELS",
      );
    }

    const inputTokens = context.estimatedInputTokens || 2000;
    const outputTokens = context.estimatedOutputTokens || 1000;

    // 6. Sort candidates according to mode
    if (mode === "CHEAP") {
      candidates.sort((a, b) => {
        const costA = forecastModelCost(a, inputTokens, outputTokens);
        const costB = forecastModelCost(b, inputTokens, outputTokens);
        return costA - costB;
      });
      reasons.push("CHEAP mode active: sorted strictly by lowest projected call cost");
    } else if (mode === "BEST") {
      candidates.sort((a, b) => b.costWeight - a.costWeight);
      reasons.push("BEST mode active: sorted by highest capability weight");
    } else {
      // AUTO or QUALITY: prioritize target tier, then cost-efficiency
      candidates.sort((a, b) => {
        const aIsTarget = a.tier === targetTier ? 0 : 1;
        const bIsTarget = b.tier === targetTier ? 0 : 1;
        if (aIsTarget !== bIsTarget) return aIsTarget - bIsTarget;
        return a.costWeight - b.costWeight;
      });
      reasons.push(`AUTO/QUALITY mode active: target tier '${targetTier}' prioritized`);
    }

    // 7. Preferred models boost
    const preferred = context.preferredModels || config?.preferredModels || [];
    if (preferred.length > 0) {
      const prefCandidate = candidates.find((c) => preferred.includes(c.modelId));
      if (prefCandidate) {
        candidates = [prefCandidate, ...candidates.filter((c) => c !== prefCandidate)];
        reasons.push(`Prioritized user-preferred model '${prefCandidate.modelId}'`);
      }
    }

    // 8. Budget constraint check
    let selected = candidates[0];
    let selectedCost = forecastModelCost(selected, inputTokens, outputTokens);

    if (context.taskRemainingBudgetUsd !== undefined) {
      const rem = context.taskRemainingBudgetUsd;

      // Find first candidate that fits under remaining budget
      const affordable = candidates.find(
        (c) => forecastModelCost(c, inputTokens, outputTokens) <= rem,
      );

      if (affordable) {
        if (affordable !== selected) {
          reasons.push(
            `Selected model downgraded from '${selected.modelId}' ($${selectedCost.toFixed(4)}) to '${affordable.modelId}' ($${forecastModelCost(affordable, inputTokens, outputTokens).toFixed(4)}) to stay within remaining task budget ($${rem.toFixed(4)})`,
          );
          selected = affordable;
          selectedCost = forecastModelCost(selected, inputTokens, outputTokens);
        } else {
          reasons.push(
            `Projected spend ($${selectedCost.toFixed(4)}) fits within remaining budget ($${rem.toFixed(4)})`,
          );
        }
      } else {
        // Hard budget violated
        const cheapest = [...candidates].sort(
          (a, b) =>
            forecastModelCost(a, inputTokens, outputTokens) -
            forecastModelCost(b, inputTokens, outputTokens),
        )[0];
        const minCost = forecastModelCost(cheapest, inputTokens, outputTokens);

        throw new OrchletError(
          `Task remaining budget ($${rem.toFixed(4)}) is exhausted. Lowest-cost eligible model '${cheapest.modelId}' requires ~$${minCost.toFixed(4)}.`,
          "BUDGET_EXHAUSTED",
        );
      }
    }

    const candidatesConsidered = candidates.map((c) => `${c.providerId}/${c.modelId}`);

    this.logger.info(
      `Routed role='${role}' mode='${mode}' -> ${selected.providerId}/${selected.modelId} (tier: ${selected.tier}, est: $${selectedCost.toFixed(5)})`,
    );

    return {
      providerId: selected.providerId,
      modelId: selected.modelId,
      tier: selected.tier,
      costClass: selected.costClass,
      estimatedCostUsd: selectedCost,
      estimatedCostWeight: selected.costWeight,
      reason: reasons[0] || `Selected ${selected.modelId} for ${role}`,
      reasons,
      fallbackHops: 0,
      candidatesConsidered,
      remainingBudgetUsd: context.taskRemainingBudgetUsd,
      subscriptionQuotaState: context.subscriptionQuotaState || "UNKNOWN",
    };
  }

  private determineTier(
    role: AgentRole | string,
    mode: RoutingMode,
    context: RoutingContext,
  ): ModelTier {
    if (mode === "CHEAP") return "fast";
    if (mode === "BEST") return "strong";

    // Mode: AUTO or QUALITY
    switch (role) {
      case "executor":
        return mode === "QUALITY" ? "strong" : "balanced";
      case "repairer":
        // Escalate repairer if prior attempts failed or P0 defect
        if (context.retryCount && context.retryCount >= 2) return "strong";
        if (context.reviewSeverity === "P0") return "strong";
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
