import { describe, it, expect } from "vitest";
import { ModelRouter, forecastModelCost } from "../src/router.js";
import { OrchletError } from "@orchlet/shared";

describe("Budget-Aware Routing & Cost Forecasting", () => {
  const customConfig = {
    models: {
      "super-cheap": {
        provider: "openrouter",
        model: "cheap/tiny-model",
        tier: "fast" as const,
        costClass: "TINY" as const,
        costWeight: 0.1,
        pricing: { promptPerToken: 0.00000005, completionPerToken: 0.0000001 },
      },
      "moderate-model": {
        provider: "openrouter",
        model: "moderate/balanced-model",
        tier: "balanced" as const,
        costClass: "MODERATE" as const,
        costWeight: 1.0,
        pricing: { promptPerToken: 0.000001, completionPerToken: 0.000005 },
      },
      "expensive-model": {
        provider: "openrouter",
        model: "expensive/premium-model",
        tier: "strong" as const,
        costClass: "PREMIUM" as const,
        costWeight: 5.0,
        pricing: { promptPerToken: 0.00001, completionPerToken: 0.00003 },
      },
    },
  };

  it("CHEAP mode strictly prefers lowest-cost eligible candidate", async () => {
    const router = new ModelRouter(undefined, customConfig);
    const decision = await router.resolveModel("executor", "CHEAP");

    expect(decision.modelId).toBe("cheap/tiny-model");
    expect(decision.costClass).toBe("TINY");
    expect(decision.reasons.some((r) => r.includes("CHEAP mode"))).toBe(true);
  });

  it("forecastModelCost accurately computes token cost", () => {
    const candidate = {
      providerId: "openrouter",
      modelId: "test-model",
      tier: "fast" as const,
      costWeight: 0.5,
      pricing: { promptPerToken: 0.000001, completionPerToken: 0.000002 },
    };

    // 10,000 prompt tokens ($0.01) + 5,000 completion tokens ($0.01) = $0.02
    const cost = forecastModelCost(candidate, 10000, 5000);
    expect(cost).toBeCloseTo(0.02, 5);
  });

  it("downgrades candidate to affordable model when remaining budget is constrained", async () => {
    const router = new ModelRouter(undefined, customConfig);

    // Executor would normally pick balanced-model in AUTO.
    // Balanced model costs ~0.007 for (2000 in, 1000 out).
    // If budget remaining is only $0.001, it must select tiny-model or fail.
    const decision = await router.resolveModel("executor", "AUTO", customConfig, {
      taskRemainingBudgetUsd: 0.001,
      estimatedInputTokens: 2000,
      estimatedOutputTokens: 1000,
    });

    expect(decision.modelId).toBe("cheap/tiny-model");
    expect(decision.estimatedCostUsd).toBeLessThan(0.001);
    expect(decision.reasons.some((r) => r.includes("downgraded"))).toBe(true);
  });

  it("strictly throws BUDGET_EXHAUSTED when even cheapest model exceeds hard budget", async () => {
    const router = new ModelRouter(undefined, customConfig);

    await expect(
      router.resolveModel("executor", "AUTO", customConfig, {
        taskRemainingBudgetUsd: 0.000001, // 0.0001 cents
        estimatedInputTokens: 5000,
        estimatedOutputTokens: 2000,
      }),
    ).rejects.toThrowError(OrchletError);
  });

  it("filters out excluded models", async () => {
    const router = new ModelRouter(undefined, customConfig);
    const decision = await router.resolveModel("executor", "CHEAP", customConfig, {
      excludedModels: ["cheap/tiny-model"],
    });

    expect(decision.modelId).not.toBe("cheap/tiny-model");
  });

  it("prioritizes preferred models when eligible", async () => {
    const router = new ModelRouter(undefined, customConfig);
    const decision = await router.resolveModel("executor", "AUTO", customConfig, {
      preferredModels: ["cheap/tiny-model"],
    });

    expect(decision.modelId).toBe("cheap/tiny-model");
    expect(decision.reasons.some((r) => r.includes("user-preferred"))).toBe(true);
  });

  it("enforces maxCostClass constraint", async () => {
    const router = new ModelRouter(undefined, customConfig);
    const decision = await router.resolveModel("executor", "AUTO", customConfig, {
      maxCostClass: "TINY",
    });

    expect(decision.costClass).toBe("TINY");
  });

  it("MANUAL mode throws if role mapping is missing", async () => {
    const router = new ModelRouter(undefined);
    await expect(router.resolveModel("executor", "MANUAL")).rejects.toThrow(
      "MANUAL routing mode specified but no role mapping configured",
    );
  });
});
