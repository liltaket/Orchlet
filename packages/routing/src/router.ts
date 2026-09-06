import { Logger, OrchletError } from "@orchlet/shared";
import type { AgentRole, IModelRouter, ModelTier, RoutingMode } from "@orchlet/core";
import { UsageManager, usageManager as defaultUsageManager } from "@orchlet/usage";

export interface ModelCandidate {
  providerId: string;
  modelId: string;
  tier: ModelTier;
  costWeight: number; // 1 = baseline, 5 = high, 0.2 = cheap
}

export interface RoutingDecision {
  providerId: string;
  modelId: string;
  tier: ModelTier;
  estimatedCostWeight: number;
  reason: string;
  fallbackHops: number;
}

export class ModelRouter implements IModelRouter {
  private logger = new Logger({ prefix: "ModelRouter" });
  private catalog: Record<ModelTier, ModelCandidate[]> = {
    fast: [
      { providerId: "openrouter", modelId: "deepseek/deepseek-chat", tier: "fast", costWeight: 0.2 },
      { providerId: "google", modelId: "gemini-2.5-flash", tier: "fast", costWeight: 0.3 },
      { providerId: "openai", modelId: "gpt-4o-mini", tier: "fast", costWeight: 0.4 },
    ],
    balanced: [
      { providerId: "openrouter", modelId: "anthropic/claude-3.7-sonnet", tier: "balanced", costWeight: 1.0 },
      { providerId: "openai", modelId: "codex/o4-mini", tier: "balanced", costWeight: 0.9 },
      { providerId: "google", modelId: "gemini-2.5-pro", tier: "balanced", costWeight: 1.0 },
    ],
    strong: [
      { providerId: "openrouter", modelId: "anthropic/claude-3.7-sonnet:thinking", tier: "strong", costWeight: 3.0 },
      { providerId: "openai", modelId: "o3-mini:high", tier: "strong", costWeight: 2.8 },
      { providerId: "google", modelId: "gemini-3.1-pro-preview", tier: "strong", costWeight: 3.0 },
    ],
  };

  constructor(private usage: UsageManager = defaultUsageManager) {}

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

    let fallbackHops = 0;
    for (const candidate of candidates) {
      const isHealthy = this.usage.isProviderHealthy(candidate.providerId);
      if (isHealthy) {
        this.logger.debug(
          `Resolved model for role=${role} mode=${mode}: ${candidate.providerId}/${candidate.modelId} (tier=${tier}, hops=${fallbackHops})`
        );
        return {
          providerId: candidate.providerId,
          modelId: candidate.modelId,
          tier: candidate.tier,
          estimatedCostWeight: candidate.costWeight,
          reason: fallbackHops === 0 ? "optimal_tier_match" : "quota_fallback",
          fallbackHops,
        };
      }
      fallbackHops++;
    }

    // Fallback: If entire tier is constrained, borrow candidate from adjacent tier
    const adjacentTier: ModelTier = tier === "strong" ? "balanced" : "fast";
    const fallbackCandidates = this.catalog[adjacentTier] || [];
    if (fallbackCandidates.length > 0) {
      const fallback = fallbackCandidates[0];
      this.logger.warn(`Degrading tier for role=${role} from ${tier} to ${adjacentTier} due to quota constraints`);
      return {
        providerId: fallback.providerId,
        modelId: fallback.modelId,
        tier: fallback.tier,
        estimatedCostWeight: fallback.costWeight,
        reason: "cross_tier_degraded_fallback",
        fallbackHops,
      };
    }

    throw new OrchletError(`No healthy model found for role ${role} in mode ${mode}`, "NO_HEALTHY_MODEL");
  }
}

export const modelRouter = new ModelRouter();
