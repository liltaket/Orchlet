import { describe, it, expect } from "vitest";
import { ModelRouter } from "../src/router.js";
import { UsageManager } from "@orchlet/usage";

describe("ModelRouter & Quota Health Allocation", () => {
  it("resolves balanced tier for executor in AUTO mode", async () => {
    const usage = new UsageManager();
    const router = new ModelRouter(usage);

    const decision = await router.resolveModel("executor", "AUTO");
    expect(decision.tier).toBe("balanced");
    expect(decision.fallbackHops).toBe(0);
  });

  it("resolves strong tier for critic in AUTO mode", async () => {
    const usage = new UsageManager();
    const router = new ModelRouter(usage);

    const decision = await router.resolveModel("critic", "AUTO");
    expect(decision.tier).toBe("strong");
  });

  it("downgrades to fast tier in CHEAP mode", async () => {
    const usage = new UsageManager();
    const router = new ModelRouter(usage);

    const decision = await router.resolveModel("executor", "CHEAP");
    expect(decision.tier).toBe("fast");
    expect(decision.estimatedCostWeight).toBeLessThan(1.0);
  });

  it("triggers fallback when primary provider is exhausted", async () => {
    const usage = new UsageManager();
    // Simulate openrouter exhausted
    usage.updateWindows(
      "openrouter",
      [{ name: "primary", type: "credit_balance", usedPercent: 100, resetsAt: null, resetRemainingMs: 0 }],
      true,
    );

    const router = new ModelRouter(usage);
    const decision = await router.resolveModel("executor", "AUTO");

    // Must have hopped away from openrouter to healthy provider (openai or google)
    expect(decision.providerId).not.toBe("openrouter");
    expect(decision.fallbackHops).toBeGreaterThan(0);
  });
});
