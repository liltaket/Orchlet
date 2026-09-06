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

  it("respects explicit roleMappings in effective configuration", async () => {
    const usage = new UsageManager();
    const router = new ModelRouter(usage);

    const config = {
      roleMappings: {
        executor: { provider: "custom-provider", model: "model-X" },
        critic: { provider: "openrouter", model: "model-Y" },
      },
    };

    const execDecision = await router.resolveModel("executor", "AUTO", config);
    expect(execDecision.modelId).toBe("model-X");
    expect(execDecision.providerId).toBe("custom-provider");
    expect(execDecision.reason).toBe("role_mapping");

    const criticDecision = await router.resolveModel("critic", "AUTO", config);
    expect(criticDecision.modelId).toBe("model-Y");
    expect(criticDecision.providerId).toBe("openrouter");
    expect(criticDecision.reason).toBe("role_mapping");
  });

  it("rejects unsupported reviewer provider in roleMappings with explicit capability error", async () => {
    const usage = new UsageManager();
    const router = new ModelRouter(usage);

    const config = {
      roleMappings: {
        critic: { provider: "direct-google", model: "gemini-2.5-pro" },
      },
    };

    await expect(router.resolveModel("critic", "AUTO", config)).rejects.toThrow(
      /Configured reviewer provider 'direct-google' is unsupported/,
    );
  });

  it("filters out non-supported reviewer providers during automatic candidate selection", async () => {
    const usage = new UsageManager();
    const router = new ModelRouter(usage);

    const config = {
      models: {
        "google-direct": {
          provider: "direct-google",
          model: "gemini-2.5-pro",
          tier: "strong" as const,
        },
        "openrouter-critic": {
          provider: "openrouter",
          model: "anthropic/claude-3.7-sonnet",
          tier: "strong" as const,
        },
      },
    };

    const decision = await router.resolveModel("critic", "AUTO", config);
    expect(decision.providerId).toBe("openrouter");
    expect(decision.modelId).toBe("anthropic/claude-3.7-sonnet");
  });

  it("respects custom dynamic models catalog in configuration", async () => {
    const usage = new UsageManager();
    const router = new ModelRouter(usage);

    const config = {
      models: {
        "special-balanced": {
          provider: "special-provider",
          model: "special-model-1",
          tier: "balanced" as const,
        },
      },
    };

    const decision = await router.resolveModel("executor", "AUTO", config);
    expect(decision.modelId).toBe("special-model-1");
    expect(decision.providerId).toBe("special-provider");
  });
});
